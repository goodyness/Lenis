"""
Security utilities for the Lenis platform.

Provides password hashing/verification using bcrypt and CSPRNG token
generation/hashing utilities used by the auth, email-token, and API-key
subsystems.

Implementation note on bcrypt backend
--------------------------------------
``passlib 1.7.4`` is not compatible with ``bcrypt >= 4.0`` due to an internal
wrap-bug detection probe that exceeds bcrypt's 72-byte password limit.  Rather
than downgrading either package, we call ``bcrypt`` directly.  The output
format (``$2b$12$...``) is identical to what passlib would produce.
"""
from __future__ import annotations

import hashlib
import secrets

import bcrypt

# Cost factor used for all password hashes on this platform.
_BCRYPT_ROUNDS: int = 12


# ---------------------------------------------------------------------------
# Password hashing
# ---------------------------------------------------------------------------


def hash_password(plain: str) -> str:
    """Return a bcrypt hash (cost=12) of *plain*.

    The resulting string always starts with ``$2b$12$``, confirming the
    algorithm and cost factor that were applied.
    """
    return bcrypt.hashpw(plain.encode("utf-8"), bcrypt.gensalt(rounds=_BCRYPT_ROUNDS)).decode(
        "utf-8"
    )


def verify_password(plain: str, hashed: str) -> bool:
    """Return ``True`` if *plain* matches *hashed*, ``False`` otherwise."""
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


# ---------------------------------------------------------------------------
# CSPRNG token generation
# ---------------------------------------------------------------------------


def generate_token() -> str:
    """Return a cryptographically random 256-bit token as a 64-character hex string.

    Uses :func:`secrets.token_hex` which draws from the OS CSPRNG
    (``/dev/urandom`` on POSIX, ``CryptGenRandom`` on Windows).  Each call
    produces 32 bytes (256 bits) of entropy, satisfying Requirement 10.5.
    """
    return secrets.token_hex(32)


def hash_token(token: str) -> str:
    """Return the SHA-256 hex digest of *token*.

    The raw plaintext token is never stored in the database; only this hash
    is persisted.  On submission the caller hashes the supplied value and
    compares against the stored hash.
    """
    return hashlib.sha256(token.encode()).hexdigest()
