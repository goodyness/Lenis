"""
Middleware for the Developer API (`/v1/*`).

Three middleware classes are defined here, intended to be registered in order
on the FastAPI application (last registered = outermost wrapper):

1. ``RequestIDMiddleware``   — injects ``X-Request-ID`` on every response.
2. ``IdempotencyMiddleware`` — deduplicates POST /v1/* via Redis cache.
3. ``APIKeyRateLimitMiddleware`` — sliding-window per-key rate limiter.

Requirements: 3.1–3.5, 4.1–4.5, 19.3
"""
from __future__ import annotations

import hashlib
import json
import time
import uuid
from typing import Callable

import redis.asyncio as aioredis
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from app.core.redis_client import _get_pool

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _get_redis() -> aioredis.Redis:
    """Return a Redis client backed by the shared connection pool."""
    return aioredis.Redis(connection_pool=_get_pool())


def _auth_hash(request: Request) -> str | None:
    """Return SHA-256 hex digest of the raw Authorization header, or None."""
    auth = request.headers.get("Authorization")
    if not auth:
        return None
    return hashlib.sha256(auth.encode()).hexdigest()


async def _consume_response_body(response: Response) -> bytes:
    """Drain a streaming response body into bytes."""
    chunks: list[bytes] = []
    async for chunk in response.body_iterator:  # type: ignore[attr-defined]
        if isinstance(chunk, str):
            chunks.append(chunk.encode())
        else:
            chunks.append(chunk)
    return b"".join(chunks)


# ---------------------------------------------------------------------------
# 1. RequestIDMiddleware (task 3.5)
# ---------------------------------------------------------------------------


class RequestIDMiddleware(BaseHTTPMiddleware):
    """Inject a unique ``X-Request-ID`` header on every response.

    The header is added to ALL responses (not just /v1/*) for simplicity and
    to ensure it is always present when needed.

    Requirement: 19.3
    """

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        response: Response = await call_next(request)
        response.headers["X-Request-ID"] = str(uuid.uuid4())
        return response


# ---------------------------------------------------------------------------
# 2. IdempotencyMiddleware (task 3.2)
# ---------------------------------------------------------------------------


class IdempotencyMiddleware(BaseHTTPMiddleware):
    """Deduplicate POST /v1/* requests using an ``Idempotency-Key`` header.

    Cache key schema::

        idempotency:{auth_hash}:{sha256(idempotency_key_value)}

    Stored JSON::

        {"status_code": int, "body": str, "endpoint": str, "body_hash": str}

    TTL: 86 400 seconds (24 hours).

    Requirements: 4.1, 4.2, 4.3, 4.4, 4.5
    """

    _TTL = 86_400  # 24 hours

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Only act on POST requests to /v1/* paths
        if request.method != "POST" or not request.url.path.startswith("/v1/"):
            return await call_next(request)

        idempotency_key = request.headers.get("Idempotency-Key")
        if not idempotency_key:
            # No idempotency key supplied — pass through unchanged
            return await call_next(request)

        # ------------------------------------------------------------------
        # Validate key length (1–255 chars; empty already excluded above)
        # ------------------------------------------------------------------
        if len(idempotency_key) > 255:
            return JSONResponse(
                status_code=422,
                content={"error": "invalid_idempotency_key"},
            )

        # ------------------------------------------------------------------
        # Build Redis cache key
        # ------------------------------------------------------------------
        auth_hash = _auth_hash(request)
        if not auth_hash:
            # No Authorization header; auth middleware will reject this request
            # anyway — pass through so the auth error is returned normally.
            return await call_next(request)

        key_hash = hashlib.sha256(idempotency_key.encode()).hexdigest()
        redis_key = f"idempotency:{auth_hash}:{key_hash}"

        # ------------------------------------------------------------------
        # Read request body (must re-inject so the route handler can read it)
        # ------------------------------------------------------------------
        body_bytes: bytes = await request.body()
        body_hash = hashlib.sha256(body_bytes).hexdigest()

        # Re-inject body into the ASGI receive channel
        async def _receive():  # type: ignore[return]
            return {"type": "http.request", "body": body_bytes, "more_body": False}

        request._receive = _receive  # type: ignore[attr-defined]

        # ------------------------------------------------------------------
        # Check Redis for a cached entry
        # ------------------------------------------------------------------
        redis: aioredis.Redis = _get_redis()
        cached_raw: str | None = None
        try:
            cached_raw = await redis.get(redis_key)
        except Exception:
            # Redis unavailable — fail open, proceed as cache miss
            cached_raw = None

        if cached_raw is not None:
            try:
                cached = json.loads(cached_raw)
            except (json.JSONDecodeError, TypeError):
                cached = None

            if cached is not None:
                # Validate same endpoint and same body hash
                same_endpoint = cached.get("endpoint") == request.url.path
                same_body = cached.get("body_hash") == body_hash
                if same_endpoint and same_body:
                    # Return cached response with replay header
                    return Response(
                        content=cached.get("body", ""),
                        status_code=cached.get("status_code", 200),
                        media_type="application/json",
                        headers={"Idempotency-Replayed": "true"},
                    )
                else:
                    # Key reused with different request
                    return JSONResponse(
                        status_code=422,
                        content={"error": "idempotency_key_reused_with_different_request"},
                    )

        # ------------------------------------------------------------------
        # Cache miss — execute the handler
        # ------------------------------------------------------------------
        response: Response = await call_next(request)

        # Only cache 2xx responses
        if 200 <= response.status_code < 300:
            # Drain the response body so we can cache it and still return it
            response_body = await _consume_response_body(response)
            body_str = response_body.decode("utf-8", errors="replace")

            cache_value = json.dumps(
                {
                    "status_code": response.status_code,
                    "body": body_str,
                    "endpoint": request.url.path,
                    "body_hash": body_hash,
                }
            )
            try:
                await redis.set(redis_key, cache_value, ex=self._TTL)
            except Exception:
                pass  # Fail open on Redis write error

            # Reconstruct the response with the drained body
            return Response(
                content=response_body,
                status_code=response.status_code,
                headers=dict(response.headers),
                media_type=response.media_type,
            )

        return response


# ---------------------------------------------------------------------------
# 3. APIKeyRateLimitMiddleware (task 3.3)
# ---------------------------------------------------------------------------


class APIKeyRateLimitMiddleware(BaseHTTPMiddleware):
    """Per-API-key sliding-window rate limiter for /v1/* endpoints.

    Sliding window algorithm:
    - Current window: ``int(time.time()) // 60``
    - Previous window: current - 1
    - ``effective = prev_count * (1 - elapsed_fraction) + curr_count``
    - Base limit: 100 requests / 60-second window; multiplied by tier.

    Redis keys: ``ratelimit:{key_id}:{window_minute}``
    Tier key:   ``api_key_tier:{key_discriminator}``

    On Redis failure: fail-open, omit rate-limit headers.

    Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 4.5
    """

    RATE_LIMIT = 100
    WINDOW_SECONDS = 60
    TIER_MULTIPLIERS: dict[str, int] = {
        "enterprise": 10,
        "pro": 5,
        "growth": 2,
        "free": 1,
    }

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        # Only act on /v1/* paths
        if not request.url.path.startswith("/v1/"):
            return await call_next(request)

        # Use SHA-256 of Authorization header as key discriminator (request.state
        # is not populated yet at middleware time — auth dependency runs later).
        key_id = _auth_hash(request)
        if not key_id:
            # No auth header — let auth middleware/dependency return 401
            return await call_next(request)

        # Use a truncated prefix for the Redis key (32 hex chars is plenty)
        key_discriminator = key_id[:32]

        redis: aioredis.Redis = _get_redis()

        # Fetch tier from Redis (set by auth dependency after key validation)
        tier = "free"
        try:
            tier_raw = await redis.get(f"api_key_tier:{key_discriminator}")
            if tier_raw:
                tier = tier_raw.decode() if isinstance(tier_raw, bytes) else tier_raw
        except Exception:
            pass  # fail open, use default "free"
        effective_limit = self.RATE_LIMIT * self.TIER_MULTIPLIERS.get(tier, 1)

        now = time.time()
        current_minute = int(now) // self.WINDOW_SECONDS
        prev_minute = current_minute - 1
        elapsed_fraction = (now % self.WINDOW_SECONDS) / self.WINDOW_SECONDS

        curr_key = f"ratelimit:{key_discriminator}:{current_minute}"
        prev_key = f"ratelimit:{key_discriminator}:{prev_minute}"

        rate_limit_available = True
        prev_count = 0
        curr_count = 0

        try:
            prev_raw = await redis.get(prev_key)
            curr_raw = await redis.get(curr_key)
            prev_count = int(prev_raw) if prev_raw else 0
            curr_count = int(curr_raw) if curr_raw else 0
        except Exception:
            rate_limit_available = False

        if rate_limit_available:
            effective = prev_count * (1 - elapsed_fraction) + curr_count

            if effective >= effective_limit:
                retry_after = int(self.WINDOW_SECONDS - (now % self.WINDOW_SECONDS)) + 1
                return JSONResponse(
                    status_code=429,
                    content={
                        "error": "rate_limit_exceeded",
                        "retry_after": retry_after,
                    },
                    headers={"Retry-After": str(retry_after)},
                )

            # Increment current window counter
            try:
                await redis.incr(curr_key)
                # TTL = 2 windows so previous-window count survives into next window
                await redis.expire(curr_key, self.WINDOW_SECONDS * 2)
            except Exception:
                rate_limit_available = False

        # Execute handler
        response: Response = await call_next(request)

        # Attach rate-limit headers if Redis was available
        if rate_limit_available:
            remaining = max(0, int(effective_limit - effective - 1))  # type: ignore[possibly-undefined]
            reset_ts = (current_minute + 1) * self.WINDOW_SECONDS
            response.headers["X-RateLimit-Limit"] = str(effective_limit)
            response.headers["X-RateLimit-Remaining"] = str(remaining)
            response.headers["X-RateLimit-Reset"] = str(reset_ts)

        return response
