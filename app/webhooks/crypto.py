"""
AES-256-GCM encryption/decryption for webhook endpoint secrets.

Secrets are stored encrypted at rest. The ciphertext format is:

    base64(nonce_12_bytes || ciphertext_bytes)

The WEBHOOK_ENCRYPTION_KEY setting must be a base64-encoded 32-byte value.
At startup in production, _get_key() is called to fail fast on misconfiguration.

Requirements: 8.1, 8.2, 8.3, 8.4, 8.5
"""
from __future__ import annotations

import base64
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


def _get_key() -> bytes:
    """Return the 32-byte AES-256 key from settings.

    Raises:
        SystemExit(1) if the key is missing or not exactly 32 bytes after
        base64 decoding.  This is intentional — a misconfigured key must
        prevent the server from starting in production (Req 8.4).
    """
    from app.core.config import settings  # local import to avoid circular deps at module load

    raw = settings.webhook_encryption_key
    if not raw:
        raise SystemExit(
            "WEBHOOK_ENCRYPTION_KEY is not configured. "
            "Set it to a base64-encoded 32-byte value."
        )
    try:
        key = base64.b64decode(raw)
    except Exception:
        raise SystemExit(
            "WEBHOOK_ENCRYPTION_KEY is not valid base64."
        )
    if len(key) != 32:
        raise SystemExit(
            f"WEBHOOK_ENCRYPTION_KEY must decode to exactly 32 bytes "
            f"(got {len(key)})."
        )
    return key


def encrypt_secret(plaintext: str) -> str:
    """Encrypt a webhook secret string with AES-256-GCM.

    Generates a random 12-byte nonce per call (so each encryption produces a
    unique ciphertext).  The stored value is:

        base64(nonce_12_bytes || aes_gcm_ciphertext_bytes)

    The base64-encoded result is roughly 108 characters for a 64-char hex
    secret, which fits the String(200) column.

    Args:
        plaintext: the raw webhook secret (e.g. a 64-char hex string).

    Returns:
        Base64-encoded string containing nonce + ciphertext.
    """
    key = _get_key()
    aesgcm = AESGCM(key)
    nonce = os.urandom(12)
    ct = aesgcm.encrypt(nonce, plaintext.encode(), None)
    return base64.b64encode(nonce + ct).decode()


def decrypt_secret(ciphertext: str) -> str:
    """Decrypt an AES-256-GCM encrypted webhook secret.

    Reverses ``encrypt_secret``: base64-decode, split the first 12 bytes as
    the nonce, decrypt the remainder.

    Args:
        ciphertext: base64-encoded string as produced by ``encrypt_secret``.

    Returns:
        The original plaintext secret string.

    Raises:
        cryptography.exceptions.InvalidTag if the ciphertext has been tampered
        with or the key is wrong.
    """
    key = _get_key()
    aesgcm = AESGCM(key)
    raw = base64.b64decode(ciphertext)
    nonce, ct = raw[:12], raw[12:]
    return aesgcm.decrypt(nonce, ct, None).decode()
