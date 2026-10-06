"""
Merchant wallet balance fetcher.

Queries live on-chain balances (native token + ERC-20) for all active/pending
merchant wallets.  Results are cached in Redis for 30 seconds to avoid hammering
RPC endpoints on every dashboard load.

Requirements: 25.1, 25.2, 25.3, 25.4, 25.5, 25.6, 25.7
"""
from __future__ import annotations

import json
import logging
import uuid
from decimal import Decimal
from typing import Any, Optional

import redis.asyncio as aioredis
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.models import MerchantWallet
from app.core.networks import network_registry
from app.core.redis_client import _get_pool
from app.web3.indexer import EVMRpcClient, TESTNET_RPC_MAP

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Token decimals
# ---------------------------------------------------------------------------

TOKEN_DECIMALS: dict[str, int] = {
    "ETH": 18,
    "MATIC": 18,
    "BNB": 18,
    "USDC": 6,
    "USDT": 6,
    "DAI": 18,
}

# Default to 18 decimals for any unknown token
DEFAULT_DECIMALS = 18


def _get_decimals(symbol: str) -> int:
    return TOKEN_DECIMALS.get(symbol.upper(), DEFAULT_DECIMALS)


# ---------------------------------------------------------------------------
# RPC URL resolution
# ---------------------------------------------------------------------------


def _resolve_rpc_url(wallet_network: str) -> Optional[str]:
    """Return the RPC URL to use for *wallet_network*.

    When testnet_mode is True, checks TESTNET_RPC_MAP for an override keyed by
    the mainnet chain_id whose display_name matches wallet_network.  Falls back
    to the mainnet RPC URL if no testnet URL is configured.
    """
    # Find the matching NetworkConfig by display_name (case-insensitive)
    matched = None
    for net in network_registry.get_active_networks():
        if net.display_name.lower() == wallet_network.lower():
            matched = net
            break

    if matched is None:
        return None

    if settings.testnet_mode:
        testnet_rpc = TESTNET_RPC_MAP.get(matched.chain_id, "")
        if testnet_rpc and testnet_rpc.strip():
            return testnet_rpc
        # Fall through to mainnet URL if testnet URL is not configured
    return matched.rpc_url if matched.rpc_url.strip() else None


# ---------------------------------------------------------------------------
# ERC-20 balanceOf via eth_call
# ---------------------------------------------------------------------------


async def _fetch_erc20_balance(
    client: EVMRpcClient,
    wallet_address: str,
    contract_address: str,
) -> int:
    """Call balanceOf(address) on *contract_address* and return the raw integer.

    ABI encoding: function selector 0x70a08231 + 32-byte padded address.
    """
    padded_address = wallet_address[2:].lower().zfill(64)
    call_data = f"0x70a08231{padded_address}"
    result: str = await client._rpc_call(
        "eth_call",
        [{"to": contract_address, "data": call_data}, "latest"],
    )
    if not result or result == "0x":
        return 0
    return int(result, 16)


# ---------------------------------------------------------------------------
# Per-wallet balance fetcher
# ---------------------------------------------------------------------------


async def _fetch_balances(wallet: MerchantWallet) -> list[dict[str, Any]]:
    """Fetch live balances for *wallet*.

    Returns a list of balance dicts.  Raises on RPC error so the caller can
    catch and substitute an error placeholder.
    """
    rpc_url = _resolve_rpc_url(wallet.network)
    if not rpc_url:
        raise RuntimeError(f"No RPC URL available for network '{wallet.network}'")

    client = EVMRpcClient(rpc_url)
    balances: list[dict[str, Any]] = []

    # ----------------------------------------------------------------
    # 1. Native token balance (eth_getBalance)
    # ----------------------------------------------------------------
    # Find the native token symbol for this network
    native_symbol: Optional[str] = None
    network_config = None
    for net in network_registry.get_active_networks():
        if net.display_name.lower() == wallet.network.lower():
            network_config = net
            native_symbol = net.native_symbol
            break

    if native_symbol is None:
        # Fallback: try "ETH" if network not in registry
        native_symbol = "ETH"

    raw_native_hex: str = await client._rpc_call(
        "eth_getBalance",
        [wallet.address, "latest"],
    )
    raw_native = int(raw_native_hex, 16) if raw_native_hex else 0
    decimals_native = _get_decimals(native_symbol)
    formatted_native = str(
        round(Decimal(raw_native) / Decimal(10 ** decimals_native), 6)
    )
    balances.append(
        {
            "token_symbol": native_symbol,
            "raw_balance": str(raw_native),
            "formatted_balance": formatted_native,
            "contract_address": None,
        }
    )

    # ----------------------------------------------------------------
    # 2. ERC-20 token balances (eth_call balanceOf)
    # ----------------------------------------------------------------
    if network_config is not None:
        for token in network_config.tokens:
            if token.contract_address is None:
                # Native token already handled above
                continue
            try:
                raw_erc20 = await _fetch_erc20_balance(
                    client,
                    wallet.address,
                    token.contract_address,
                )
                decimals_erc20 = _get_decimals(token.symbol)
                formatted_erc20 = str(
                    round(Decimal(raw_erc20) / Decimal(10 ** decimals_erc20), 6)
                )
                balances.append(
                    {
                        "token_symbol": token.symbol,
                        "raw_balance": str(raw_erc20),
                        "formatted_balance": formatted_erc20,
                        "contract_address": token.contract_address,
                    }
                )
            except Exception as exc:
                logger.warning(
                    "_fetch_balances: ERC-20 balanceOf failed for %s on %s: %s",
                    token.symbol,
                    wallet.network,
                    exc,
                )
                # Skip this token but continue with others

    return balances


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def get_merchant_balances(
    merchant_id: uuid.UUID,
    db: AsyncSession,
) -> list[dict[str, Any]]:
    """Return live on-chain balances for all active/pending wallets of *merchant_id*.

    Checks a Redis cache keyed ``balances:{merchant_id}:{wallet.id}`` (TTL 30s)
    before making RPC calls.  On RPC error the wallet entry contains
    ``{"error": "rpc_unavailable"}`` instead of a balance list.

    Requirements: 25.1–25.7
    """
    # Load all active/pending wallets for this merchant
    result = await db.execute(
        select(MerchantWallet).where(
            and_(
                MerchantWallet.merchant_id == merchant_id,
                MerchantWallet.status.in_(["active", "pending"]),
            )
        )
    )
    wallets: list[MerchantWallet] = list(result.scalars().all())

    redis_client: aioredis.Redis = aioredis.Redis(connection_pool=_get_pool())
    output: list[dict[str, Any]] = []

    try:
        for wallet in wallets:
            cache_key = f"balances:{merchant_id}:{wallet.id}"

            # ----------------------------------------------------------------
            # Check Redis cache
            # ----------------------------------------------------------------
            cached = await redis_client.get(cache_key)
            if cached:
                try:
                    balances = json.loads(cached)
                    output.append(
                        {
                            "wallet_address": wallet.address,
                            "network": wallet.network,
                            "balances": balances,
                        }
                    )
                    continue
                except (json.JSONDecodeError, ValueError):
                    pass  # cache corrupted — re-fetch

            # ----------------------------------------------------------------
            # Fetch live balances via RPC
            # ----------------------------------------------------------------
            try:
                balances = await _fetch_balances(wallet)
            except Exception as exc:
                logger.warning(
                    "get_merchant_balances: RPC error for wallet %s on %s: %s",
                    wallet.address,
                    wallet.network,
                    exc,
                )
                balances = [{"error": "rpc_unavailable"}]

            # ----------------------------------------------------------------
            # Cache the result (even error placeholders)
            # ----------------------------------------------------------------
            try:
                await redis_client.set(cache_key, json.dumps(balances), ex=30)
            except Exception as exc:
                logger.warning(
                    "get_merchant_balances: Redis SET failed for key %s: %s",
                    cache_key,
                    exc,
                )

            output.append(
                {
                    "wallet_address": wallet.address,
                    "network": wallet.network,
                    "balances": balances,
                }
            )
    finally:
        await redis_client.aclose()

    return output
