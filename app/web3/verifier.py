"""
Cryptographic Wallet Ownership Verification (EIP-191).

Generates time-limited cryptographic challenges and verifies signatures
produced by browser wallets (MetaMask, Coinbase Wallet, Rainbow, etc.)
or external EVM signers to prove ownership of receiving wallet addresses.
"""
from __future__ import annotations

import json
import logging
import secrets
import time
import uuid
from datetime import UTC, datetime
from typing import Optional

from eth_account import Account
from eth_account.messages import encode_defunct

from app.core.config import settings

logger = logging.getLogger(__name__)

# Fallback in-memory store for challenge nonces: {nonce: (challenge_text, address, expires_at)}
_MEMORY_CHALLENGES: dict[str, tuple[str, str, float]] = {}
CHALLENGE_TTL_SECONDS = 600  # 10 minutes


def _clean_memory_challenges() -> None:
    """Evict expired nonces from in-memory fallback store."""
    now = time.time()
    expired = [k for k, v in _MEMORY_CHALLENGES.items() if v[2] < now]
    for k in expired:
        _MEMORY_CHALLENGES.pop(k, None)


async def generate_wallet_challenge(
    merchant_id: uuid.UUID | str,
    address: str,
) -> dict[str, str | int]:
    """Generate a cryptographic challenge for the merchant to sign.

    Parameters
    ----------
    merchant_id : UUID or str
        The ID of the authenticated merchant.
    address : str
        The 0x-prefixed 40-hex-character EVM wallet address to be verified.

    Returns
    -------
    dict
        {
            "challenge": str,
            "nonce": str,
            "address": str,
            "expires_in": int
        }
    """
    clean_address = address.strip()
    nonce = secrets.token_hex(16)
    timestamp = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")

    # Strictly normalize newlines with \n for cross-platform and wallet client consistency
    challenge_text = (
        f"Lenis Platform Wallet Verification\n\n"
        f"I confirm that I own and control the receiving wallet address:\n"
        f"{clean_address}\n\n"
        f"Merchant ID: {merchant_id}\n"
        f"Nonce: {nonce}\n"
        f"Issued At: {timestamp}\n\n"
        f"Sign this message to verify wallet ownership. This request does not cost gas."
    ).replace("\r\n", "\n").replace("\r", "\n")

    payload = json.dumps(
        {
            "address": clean_address.lower(),
            "challenge": challenge_text,
        }
    )

    # Attempt to persist in Redis, fallback to in-memory store
    saved_in_redis = False
    try:
        import redis.asyncio as aioredis
        from app.core.redis_client import _get_pool

        r = aioredis.Redis(connection_pool=_get_pool())
        key = f"wallet_challenge:{nonce}"
        await r.set(key, payload, ex=CHALLENGE_TTL_SECONDS)
        await r.aclose()
        saved_in_redis = True
    except Exception as exc:
        logger.debug("Redis unavailable for wallet challenge (%s), using memory store", exc)

    if not saved_in_redis:
        _clean_memory_challenges()
        _MEMORY_CHALLENGES[nonce] = (
            challenge_text,
            clean_address.lower(),
            time.time() + CHALLENGE_TTL_SECONDS,
        )

    return {
        "challenge": challenge_text,
        "nonce": nonce,
        "address": clean_address,
        "expires_in": CHALLENGE_TTL_SECONDS,
    }


async def verify_wallet_signature(
    address: str,
    signature: str,
    nonce: str,
) -> bool:
    """Verify an EIP-191 signature against a previously issued challenge nonce.

    Parameters
    ----------
    address : str
        The claimed wallet address.
    signature : str
        The 0x-prefixed hex-encoded EIP-191 signature string.
    nonce : str
        The nonce issued during challenge generation.

    Returns
    -------
    bool
        True if the signature is valid, matches the address, and the nonce is consumed.
    """
    clean_address = address.strip().lower()
    clean_sig = signature.strip()
    while clean_sig.startswith("0x0x"):
        clean_sig = clean_sig[2:]
    if not clean_sig.startswith("0x"):
        clean_sig = f"0x{clean_sig}"

    if len(clean_sig) < 130:
        logger.warning("Invalid signature hex format: %s", clean_sig[:10])
        return False

    challenge_text: Optional[str] = None
    expected_address: Optional[str] = None

    # Retrieve and consume from Redis
    try:
        import redis.asyncio as aioredis
        from app.core.redis_client import _get_pool

        r = aioredis.Redis(connection_pool=_get_pool())
        key = f"wallet_challenge:{nonce}"
        raw_val = await r.get(key)
        if raw_val:
            await r.delete(key)
            if isinstance(raw_val, bytes):
                raw_val = raw_val.decode("utf-8")
            if raw_val.startswith("{"):
                try:
                    parsed = json.loads(raw_val)
                    expected_address = parsed.get("address")
                    challenge_text = parsed.get("challenge")
                except Exception as parse_err:
                    logger.warning("Failed to parse JSON challenge data: %s", parse_err)
            else:
                parts = raw_val.split(":", 1)
                if len(parts) == 2:
                    expected_address, challenge_text = parts[0], parts[1]
        await r.aclose()
    except Exception as exc:
        logger.debug("Redis read failed for wallet challenge (%s), checking memory store", exc)

    # Check in-memory store if not found in Redis
    if challenge_text is None and nonce in _MEMORY_CHALLENGES:
        stored_text, stored_addr, expires_at = _MEMORY_CHALLENGES.pop(nonce)
        if time.time() <= expires_at:
            challenge_text = stored_text
            expected_address = stored_addr

    if not challenge_text or not expected_address:
        logger.warning("Wallet verification nonce %s expired or not found", nonce)
        return False

    if expected_address != clean_address:
        logger.warning(
            "Address mismatch: challenge requested for %s, signature presented for %s",
            expected_address,
            clean_address,
        )
        return False

    # Attempt message recovery testing against normalized newlines and alternate variants
    candidate_messages = [
        challenge_text,
        challenge_text.replace("\r\n", "\n").replace("\r", "\n"),
        challenge_text.replace("\r\n", "\n").replace("\n", "\r\n"),
    ]
    seen_candidates: list[str] = []
    for c in candidate_messages:
        if c not in seen_candidates:
            seen_candidates.append(c)

    for candidate_msg in seen_candidates:
        try:
            encoded_msg = encode_defunct(text=candidate_msg)
            recovered_address = Account.recover_message(encoded_msg, signature=clean_sig)
            if recovered_address.lower() == clean_address:
                logger.info("Successfully verified ownership of wallet %s", clean_address)
                return True
        except Exception as exc:
            logger.debug("Error recovering candidate signature for %s: %s", clean_address, exc)
            continue

    logger.warning("Signature verification failed for %s", clean_address)
    return False
