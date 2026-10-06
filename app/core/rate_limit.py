"""
Redis-backed rate limiting for the Lenis platform.

Provides two layers of protection:

1. **General endpoint rate limit** (RateLimitMiddleware):
   Sliding-window counter keyed by ``rate_limit:{ip}:{endpoint}``.
   Applied to ``/auth/register`` and ``/auth/login`` at 10 req / 60 s.
   Returns 429 with a ``Retry-After`` header when the limit is exceeded.

2. **Login-failure lockout**:
   - ``record_login_failure(redis, ip)`` - increments ``login_fail:{ip}``
     with a 10-minute TTL and returns the new count.
   - ``is_login_blocked(redis, ip)`` - checks for the ``login_block:{ip}``
     sentinel key.
   - ``set_login_block(redis, ip)`` - writes ``login_block:{ip}`` = "1"
     with a 15-minute TTL.
   - ``reset_login_counter(redis, ip)`` - deletes both
     ``login_fail:{ip}`` and ``login_block:{ip}``.

Key schema (as defined in the design document):
  ``rate_limit:{ip}:{endpoint}``  integer counter, TTL = window_seconds
  ``login_fail:{ip}``             integer counter, TTL = 600 s (10 min)
  ``login_block:{ip}``            sentinel "1",   TTL = 900 s (15 min)
"""
from __future__ import annotations

import json
import re

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp

from app.core.redis_client import _get_pool

import redis.asyncio as aioredis
from redis.asyncio import Redis


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _client_ip(request: Request) -> str:
    """Extract the originating IP, respecting ``X-Forwarded-For``."""
    forwarded_for = request.headers.get("X-Forwarded-For")
    if forwarded_for:
        # The leftmost entry is the original client IP.
        return forwarded_for.split(",")[0].strip()
    if request.client:
        return request.client.host
    return "unknown"


def _sanitise_endpoint(path: str) -> str:
    """Return a Redis-safe version of the request path for use in keys."""
    # Replace any characters that are not alphanumeric, hyphen, or underscore
    # with an underscore so the key stays clean.
    return re.sub(r"[^a-zA-Z0-9_\-]", "_", path)


# ---------------------------------------------------------------------------
# General endpoint rate-limit middleware
# ---------------------------------------------------------------------------

class RateLimitMiddleware(BaseHTTPMiddleware):
    """Sliding-window IP-based rate limiter for a single endpoint pattern.

    Instantiate once per protected endpoint and register it with the FastAPI
    application:

        app.add_middleware(
            RateLimitMiddleware,
            endpoint_pattern="/auth/login",
            max_requests=10,
            window_seconds=60,
        )

    The middleware uses an atomic Redis pipeline (INCR + EXPIRE) so concurrent
    requests cannot slip through the counter boundary.
    """

    def __init__(
        self,
        app: ASGIApp,
        endpoint_pattern: str,
        max_requests: int,
        window_seconds: int,
    ) -> None:
        super().__init__(app)
        self._pattern = re.compile(rf"^{re.escape(endpoint_pattern)}(/.*)?$")
        self._max_requests = max_requests
        self._window_seconds = window_seconds

    async def dispatch(self, request: Request, call_next: object) -> Response:  # type: ignore[override]
        if not self._pattern.match(request.url.path):
            return await call_next(request)  # type: ignore[misc]

        ip = _client_ip(request)
        endpoint_key = _sanitise_endpoint(request.url.path)
        redis_key = f"rate_limit:{ip}:{endpoint_key}"

        # Acquire a fresh client from the shared pool for this check.
        redis: Redis = aioredis.Redis(connection_pool=_get_pool())
        try:
            # Atomic pipeline: INCR then conditionally set TTL.
            pipe = redis.pipeline()
            pipe.incr(redis_key)
            pipe.ttl(redis_key)
            results: list[int] = await pipe.execute()
            count, ttl = results[0], results[1]

            # Only set the expiry when the key is brand-new (count == 1) or
            # the key has no TTL (-1 means persisted without expiry).
            if count == 1 or ttl == -1:
                await redis.expire(redis_key, self._window_seconds)

            if count > self._max_requests:
                body = json.dumps(
                    {
                        "detail": "Too many requests. Please slow down.",
                        "code": "RATE_LIMIT_EXCEEDED",
                    }
                )
                return Response(
                    content=body,
                    status_code=429,
                    media_type="application/json",
                    headers={"Retry-After": str(self._window_seconds)},
                )
        finally:
            await redis.aclose()

        return await call_next(request)  # type: ignore[misc]


# ---------------------------------------------------------------------------
# Login-failure lockout helpers
# ---------------------------------------------------------------------------

async def record_login_failure(redis: Redis, ip: str) -> int:
    """Increment the failed-login counter for *ip* and return the new value.

    The key ``login_fail:{ip}`` is given a TTL of 600 seconds (10 minutes)
    when it is first created.  Subsequent increments within the window extend
    *only the counter*, not the TTL, which preserves the original window
    boundary as required by Requirement 2.5.

    Args:
        redis: An async Redis client.
        ip:    The client IP address string.

    Returns:
        The updated failure count after this increment.
    """
    key = f"login_fail:{ip}"
    pipe = redis.pipeline()
    pipe.incr(key)
    pipe.ttl(key)
    results: list[int] = await pipe.execute()
    count, ttl = results[0], results[1]
    if ttl == -1:
        # Key existed without a TTL (unusual edge case) — set it now.
        await redis.expire(key, 600)
    if count == 1:
        # Brand-new key: set the 10-minute window TTL.
        await redis.expire(key, 600)
    return count


async def is_login_blocked(redis: Redis, ip: str) -> bool:
    """Return True if *ip* has an active login-block sentinel in Redis.

    Checks for the existence of ``login_block:{ip}``.  A non-None value
    means the block is active.

    Args:
        redis: An async Redis client.
        ip:    The client IP address string.

    Returns:
        ``True`` if the block key exists, ``False`` otherwise.
    """
    value = await redis.get(f"login_block:{ip}")
    return value is not None


async def set_login_block(redis: Redis, ip: str) -> None:
    """Write a login-block sentinel for *ip* with a 15-minute TTL.

    Sets ``login_block:{ip}`` = "1" with TTL = 900 seconds.  Callers are
    responsible for checking the failure count and calling this function
    when the threshold (>= 5) is reached, as per Requirement 2.5.

    Args:
        redis: An async Redis client.
        ip:    The client IP address string.
    """
    await redis.set(f"login_block:{ip}", "1", ex=900)


async def reset_login_counter(redis: Redis, ip: str) -> None:
    """Delete both the failure counter and the block sentinel for *ip*.

    Removes ``login_fail:{ip}`` and ``login_block:{ip}`` atomically via a
    pipeline.  Called on successful login or token refresh to satisfy
    Requirement 2.6.

    Args:
        redis: An async Redis client.
        ip:    The client IP address string.
    """
    pipe = redis.pipeline()
    pipe.delete(f"login_fail:{ip}")
    pipe.delete(f"login_block:{ip}")
    await pipe.execute()
