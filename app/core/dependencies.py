"""
FastAPI dependency for JWT Bearer token validation.

Exposes:
  - ``get_current_user`` — validates the Access_Token and returns the
    corresponding User ORM instance (Requirements 2.9, 2.11, 10.6).

Validation sequence (enforced on every protected request):
  1. Extract the Bearer token from the ``Authorization`` header.
  2. Decode and verify the RS256 signature against the configured public key.
  3. Assert ``exp`` has not passed.
  4. Assert ``iss == "lenis"`` and ``aud == "lenis-api"``.
  5. Assert ``jti`` is not present in the Redis blocklist.
  6. Load the user from the database; assert ``status != "suspended"``.
"""
from __future__ import annotations

import uuid

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.models import User
from app.core.redis_client import get_redis
from app.core.tokens import JWTError, decode_access_token, is_token_blocklisted

# HTTPBearer reads the ``Authorization: Bearer <token>`` header.
_bearer_scheme = HTTPBearer(auto_error=True)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer_scheme),
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> User:
    """FastAPI dependency that returns the authenticated User.

    Validates the Bearer token in the following order:

    1. Decode RS256 JWT (signature, exp, iss, aud) — 401 on any failure.
    2. Check that the token JTI is not in the Redis blocklist — 401 if blocklisted.
    3. Load the user from the database — 401 if not found.
    4. Reject suspended users — 403 ACCOUNT_SUSPENDED (Requirement 2.11).

    Returns:
        The authenticated :class:`~app.core.models.User` instance.

    Raises:
        HTTPException(401) — invalid / expired / blocklisted token.
        HTTPException(403) — user account is suspended.
    """
    token = credentials.credentials

    # Step 1 — Decode and validate the JWT (signature, exp, iss, aud)
    try:
        claims = decode_access_token(token)
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "detail": "Invalid or expired access token.",
                "code": "INVALID_TOKEN",
            },
            headers={"WWW-Authenticate": "Bearer"},
        )

    jti: str = claims.get("jti", "")
    sub: str = claims.get("sub", "")

    # Step 2 — JTI blocklist check
    if jti and await is_token_blocklisted(redis, jti):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "detail": "Token has been revoked.",
                "code": "TOKEN_REVOKED",
            },
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Step 3 — Load user from DB
    try:
        user_id = uuid.UUID(sub)
    except (ValueError, AttributeError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "detail": "Invalid token subject.",
                "code": "INVALID_TOKEN",
            },
            headers={"WWW-Authenticate": "Bearer"},
        )

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "detail": "User not found.",
                "code": "INVALID_TOKEN",
            },
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Step 4 — Suspended account check (Requirement 2.11)
    if user.status == "suspended":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "detail": "Your account has been suspended.",
                "code": "ACCOUNT_SUSPENDED",
            },
        )

    return user


async def get_current_user_allow_suspended(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer_scheme),
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> User:
    """Like ``get_current_user`` but does NOT block suspended accounts.

    Used exclusively by the suspension-info and appeal endpoints so that
    suspended users can still authenticate to read their suspension details
    and submit an appeal.
    """
    token = credentials.credentials

    try:
        claims = decode_access_token(token)
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "detail": "Invalid or expired access token.",
                "code": "INVALID_TOKEN",
            },
            headers={"WWW-Authenticate": "Bearer"},
        )

    jti: str = claims.get("jti", "")
    sub: str = claims.get("sub", "")

    if jti and await is_token_blocklisted(redis, jti):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "detail": "Token has been revoked.",
                "code": "TOKEN_REVOKED",
            },
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        user_id = uuid.UUID(sub)
    except (ValueError, AttributeError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "detail": "Invalid token subject.",
                "code": "INVALID_TOKEN",
            },
            headers={"WWW-Authenticate": "Bearer"},
        )

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "detail": "User not found.",
                "code": "INVALID_TOKEN",
            },
            headers={"WWW-Authenticate": "Bearer"},
        )

    # NOTE: suspended check intentionally omitted — this dependency allows
    # suspended users to access suspension-info and appeal endpoints.
    return user


_optional_bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user_flexible(
    credentials: HTTPAuthorizationCredentials | None = Depends(_optional_bearer_scheme),
    token: str | None = None,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> User:
    """Accepts access token either from Authorization header or 'token' query param."""
    raw_token = credentials.credentials if credentials else token
    if not raw_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "detail": "Missing access token.",
                "code": "AUTHENTICATION_REQUIRED",
            },
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        claims = decode_access_token(raw_token)
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "detail": "Invalid or expired access token.",
                "code": "INVALID_TOKEN",
            },
            headers={"WWW-Authenticate": "Bearer"},
        )

    jti: str = claims.get("jti", "")
    sub: str = claims.get("sub", "")

    if jti and await is_token_blocklisted(redis, jti):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "detail": "Token has been revoked.",
                "code": "TOKEN_REVOKED",
            },
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        user_id = uuid.UUID(sub)
    except (ValueError, AttributeError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "detail": "Invalid token subject.",
                "code": "INVALID_TOKEN",
            },
            headers={"WWW-Authenticate": "Bearer"},
        )

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail={
                "detail": "User not found.",
                "code": "INVALID_TOKEN",
            },
            headers={"WWW-Authenticate": "Bearer"},
        )

    if user.status == "suspended":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "detail": "Your account has been suspended.",
                "code": "ACCOUNT_SUSPENDED",
            },
        )

    return user

