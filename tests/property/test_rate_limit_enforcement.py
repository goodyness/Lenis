"""
Property-based tests for API key rate limit enforcement.

Property 7: Rate Limit Enforcement
  Making exactly 101 requests within a 60-second sliding window with
  the same API key must result in request 101 receiving HTTP 429 and
  requests 1-100 receiving non-429 responses.

Validates: Requirements 3.1, 3.3

Feature: developer-api-and-public-platform
"""
from __future__ import annotations

import time
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from hypothesis import given, settings
from hypothesis import strategies as st
from starlette.responses import JSONResponse

from app.developer.middleware import APIKeyRateLimitMiddleware


# ---------------------------------------------------------------------------
# Test app factory
# ---------------------------------------------------------------------------


def _make_api_app() -> FastAPI:
    """Create a minimal FastAPI app with APIKeyRateLimitMiddleware."""
    app = FastAPI()

    @app.get("/v1/payments")
    async def list_payments() -> dict:
        return {"data": [], "has_more": False}

    @app.post("/v1/payments")
    async def create_payment() -> dict:
        return {"id": "pay_test", "status": "pending"}

    app.add_middleware(APIKeyRateLimitMiddleware)
    return app


# ---------------------------------------------------------------------------
# Sliding window mock helpers
# ---------------------------------------------------------------------------


class _FakeRedis:
    """
    In-memory Redis mock that simulates the sliding window counters used
    by APIKeyRateLimitMiddleware.

    Internally keeps a single integer counter per (key_discriminator, window)
    pair so we can simulate sequential requests accurately.
    """

    def __init__(self) -> None:
        self._data: dict[str, int] = {}

    async def get(self, key: str) -> str | None:
        val = self._data.get(key)
        return str(val) if val is not None else None

    async def incr(self, key: str) -> int:
        self._data[key] = self._data.get(key, 0) + 1
        return self._data[key]

    async def expire(self, key: str, seconds: int) -> None:
        pass  # TTL management not needed for these tests

    async def aclose(self) -> None:
        pass


def _make_patched_redis_for_middleware(fake: _FakeRedis) -> tuple[MagicMock, MagicMock]:
    """Return (mock_pool, mock_redis_constructor) for patching _get_pool and aioredis.Redis."""
    mock_pool = MagicMock()
    mock_redis_cls = MagicMock(return_value=fake)
    return mock_pool, mock_redis_cls


# ---------------------------------------------------------------------------
# Property 7: Rate Limit Enforcement
# Validates: Requirements 3.1, 3.3
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
@settings(max_examples=20)
@given(
    # We test that the limit holds for various API keys (discriminated by auth hash prefix)
    auth_token=st.text(min_size=32, max_size=64, alphabet="abcdefghijklmnopqrstuvwxyz0123456789"),
)
async def test_rate_limit_enforcement_property(auth_token: str) -> None:
    """**Validates: Requirements 3.1, 3.3**

    Property 7: Rate Limit Enforcement.

    Making exactly 101 requests within a 60-second sliding window must result
    in request 101 receiving HTTP 429, and requests 1-100 receiving non-429.

    Uses a mocked Redis backend to simulate the sliding window counters
    deterministically without requiring a live Redis instance.
    """
    fake_redis = _FakeRedis()
    app = _make_api_app()

    # Mock the Redis client used by APIKeyRateLimitMiddleware
    with patch("app.developer.middleware._get_pool", return_value=MagicMock()), \
         patch("app.developer.middleware.aioredis.Redis", return_value=fake_redis):

        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            status_codes: list[int] = []
            auth_header = f"Bearer sk_test_{auth_token}"

            for i in range(101):
                resp = await client.get(
                    "/v1/payments",
                    headers={"Authorization": auth_header},
                )
                status_codes.append(resp.status_code)

            # First 100 requests must be non-429
            non_rate_limited = status_codes[:100]
            for idx, code in enumerate(non_rate_limited):
                assert code != 429, (
                    f"Request {idx + 1} should not be rate-limited (got {code})"
                )

            # Request 101 must be 429
            assert status_codes[100] == 429, (
                f"Request 101 must be rate-limited (got {status_codes[100]})"
            )


@pytest.mark.asyncio
async def test_rate_limit_returns_retry_after_header() -> None:
    """HTTP 429 response must include Retry-After header."""
    fake_redis = _FakeRedis()
    app = _make_api_app()

    with patch("app.developer.middleware._get_pool", return_value=MagicMock()), \
         patch("app.developer.middleware.aioredis.Redis", return_value=fake_redis):

        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            auth_header = "Bearer sk_live_abcdefghijklmnopqrstuvwxyz012345"

            # Make 101 requests to trigger rate limit
            for _ in range(100):
                await client.get("/v1/payments", headers={"Authorization": auth_header})

            resp = await client.get("/v1/payments", headers={"Authorization": auth_header})

    assert resp.status_code == 429
    assert "retry-after" in resp.headers
    body = resp.json()
    assert body["error"] == "rate_limit_exceeded"
    assert "retry_after" in body


@pytest.mark.asyncio
async def test_rate_limit_sets_x_ratelimit_headers() -> None:
    """Non-rate-limited requests must have X-RateLimit-* headers when Redis works."""
    fake_redis = _FakeRedis()
    app = _make_api_app()

    with patch("app.developer.middleware._get_pool", return_value=MagicMock()), \
         patch("app.developer.middleware.aioredis.Redis", return_value=fake_redis):

        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            auth_header = "Bearer sk_test_abcdefghijklmnopqrstuvwxyz012345"
            resp = await client.get("/v1/payments", headers={"Authorization": auth_header})

    assert resp.status_code == 200
    assert "x-ratelimit-limit" in resp.headers
    assert "x-ratelimit-remaining" in resp.headers
    assert "x-ratelimit-reset" in resp.headers
    assert resp.headers["x-ratelimit-limit"] == "100"


@pytest.mark.asyncio
async def test_rate_limit_fail_open_on_redis_error() -> None:
    """When Redis is unavailable, requests must pass through (fail-open) without rate-limit headers."""
    app = _make_api_app()

    error_redis = MagicMock()
    error_redis.get = AsyncMock(side_effect=Exception("Redis connection error"))
    error_redis.incr = AsyncMock(side_effect=Exception("Redis connection error"))

    with patch("app.developer.middleware._get_pool", return_value=MagicMock()), \
         patch("app.developer.middleware.aioredis.Redis", return_value=error_redis):

        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            auth_header = "Bearer sk_test_abcdefghijklmnopqrstuvwxyz012345"
            resp = await client.get("/v1/payments", headers={"Authorization": auth_header})

    # Must pass through (fail-open)
    assert resp.status_code != 429
    # Rate-limit headers must be absent
    assert "x-ratelimit-limit" not in resp.headers
    assert "x-ratelimit-remaining" not in resp.headers


@pytest.mark.asyncio
async def test_rate_limit_not_applied_outside_v1() -> None:
    """Requests outside /v1/* must not be rate-limited even if limit is exceeded."""
    fake_redis = _FakeRedis()
    app = FastAPI()

    @app.get("/healthz")
    async def healthz() -> dict:
        return {"ok": True}

    app.add_middleware(APIKeyRateLimitMiddleware)

    with patch("app.developer.middleware._get_pool", return_value=MagicMock()), \
         patch("app.developer.middleware.aioredis.Redis", return_value=fake_redis):

        async with AsyncClient(
            transport=ASGITransport(app=app),
            base_url="http://test",
        ) as client:
            # Make many requests to a non-/v1/ path — never hits rate limiter
            for _ in range(110):
                resp = await client.get("/healthz")
                assert resp.status_code == 200
