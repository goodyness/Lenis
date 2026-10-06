"""
JWT utilities and Redis-backed access-token blocklist for the Lenis platform.

Access tokens are RS256-signed JWTs.  On logout the token's JTI is written to
Redis with a TTL equal to the token's remaining lifetime so that further use
of the token is rejected even before it naturally expires.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt as _jwt
from jwt.exceptions import PyJWTError as JWTError
from redis.asyncio import Redis

from app.core.config import settings

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_ALGORITHM = "RS256"
_ISSUER = "lenis"
_AUDIENCE = "lenis-api"
_BLOCKLIST_PREFIX = "blocklist:jti:"

# ---------------------------------------------------------------------------
# Token creation
# ---------------------------------------------------------------------------


def create_access_token(payload: dict[str, Any]) -> str:
    """Return a signed RS256 JWT containing *payload* plus standard claims.

    Standard claims added automatically:

    * ``iss`` -- ``"lenis"``
    * ``aud`` -- ``"lenis-api"``
    * ``iat`` -- current UTC time
    * ``exp`` -- current UTC time + ``jwt_access_token_expire_minutes`` (default 15)
    * ``jti`` -- a fresh UUID4 string (unique per token)

    Callers should supply at minimum ``sub`` (user ID string) and may also
    include ``email`` and ``role``.
    """
    now = datetime.now(tz=timezone.utc)
    expire = now + timedelta(minutes=settings.jwt_access_token_expire_minutes)

    claims: dict[str, Any] = {
        **payload,
        "iss": _ISSUER,
        "aud": _AUDIENCE,
        "iat": now,
        "exp": expire,
        "jti": str(uuid.uuid4()),
    }

    return _jwt.encode(claims, settings.jwt_private_key, algorithm=_ALGORITHM)


# ---------------------------------------------------------------------------
# Token validation
# ---------------------------------------------------------------------------


def decode_access_token(token: str) -> dict[str, Any]:
    """Decode and validate *token*, returning the claims dictionary.

    Validation steps performed by ``python-jose``:

    1. Verify the RS256 signature against ``jwt_public_key``.
    2. Assert ``exp`` has not passed.
    3. Assert ``iss == "lenis"``.
    4. Assert ``aud == "lenis-api"``.

    Raises :class:`jose.JWTError` if any check fails.  The caller is
    responsible for the Redis blocklist check (step 5) and the suspended-user
    check (step 6) as described in the design document, because those require
    async I/O.
    """
    return _jwt.decode(
        token,
        settings.jwt_public_key,
        algorithms=[_ALGORITHM],
        issuer=_ISSUER,
        audience=_AUDIENCE,
    )


# ---------------------------------------------------------------------------
# Redis blocklist
# ---------------------------------------------------------------------------


async def blocklist_token(redis: Redis, jti: str, ttl_seconds: int) -> None:
    """Write ``blocklist:jti:{jti}`` to Redis with *ttl_seconds* TTL.

    Called on logout.  After the TTL elapses the key is automatically removed
    by Redis, which aligns with the token's natural expiry.
    """
    if ttl_seconds <= 0:
        # Token is already expired; no need to store anything.
        return
    key = f"{_BLOCKLIST_PREFIX}{jti}"
    await redis.set(key, "1", ex=ttl_seconds)


async def is_token_blocklisted(redis: Redis, jti: str) -> bool:
    """Return ``True`` if ``blocklist:jti:{jti}`` exists in Redis."""
    key = f"{_BLOCKLIST_PREFIX}{jti}"
    value = await redis.get(key)
    return value is not None


# ---------------------------------------------------------------------------
# Re-export JWTError for convenience
# ---------------------------------------------------------------------------

__all__ = [
    "create_access_token",
    "decode_access_token",
    "blocklist_token",
    "is_token_blocklisted",
    "JWTError",
]
