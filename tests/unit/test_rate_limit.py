"""
Unit tests for app/core/rate_limit.py.

All Redis interactions are mocked with ``unittest.mock`` so no live Redis
instance is required.  The middleware is exercised through Starlette's
``TestClient`` with a patched ``_get_pool`` so it never touches real Redis.

Test coverage:
  - RateLimitMiddleware: requests within limit pass through
  - RateLimitMiddleware: requests exceeding the limit return 429 + Retry-After
  - RateLimitMiddleware: only the matched endpoint pattern is rate-limited
  - record_login_failure: increments counter and sets TTL on first call
  - is_login_blocked: returns True when block key exists, False otherwise
  - set_login_block: sets key with correct 900-second TTL
  - reset_login_counter: deletes both login_fail and login_block keys
"""
from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import FastAPI
from httpx import AsyncClient, ASGITransport
from starlette.requests import Request
from starlette.responses import Response

from app.core.rate_limit import (
    RateLimitMiddleware,
    is_login_blocked,
    record_login_failure,
    reset_login_counter,
    set_login_block,
)


# ---------------------------------------------------------------------------
# Helpers: build a minimal FastAPI app with RateLimitMiddleware
# ---------------------------------------------------------------------------

def _make_app(endpoint_pattern: str, max_requests: int, window_seconds: int) -> FastAPI:
    """Return a minimal FastAPI app with RateLimitMiddleware applied."""
    application = FastAPI()

    @application.get("/auth/login")
    async def login() -> dict:  # type: ignore[return]
        return {"ok": True}

    @application.get("/auth/register")
    async def register() -> dict:  # type: ignore[return]
        return {"ok": True}

    @application.get("/public")
    async def public() -> dict:  # type: ignore[return]
        return {"ok": True}

    application.add_middleware(
        RateLimitMiddleware,
        endpoint_pattern=endpoint_pattern,
        max_requests=max_requests,
        window_seconds=window_seconds,
    )
    return application


def _mock_redis_pipeline(counter_value: int) -> MagicMock:
    """Build a mock Redis pipeline that returns ``counter_value`` for INCR."""
    pipe = MagicMock()
    pipe.incr = MagicMock()
    pipe.ttl = MagicMock()
    # pipeline.execute() returns [count, ttl]; ttl=-2 means new key.
    pipe.execute = AsyncMock(return_value=[counter_value, -2])
    pipe.__aenter__ = AsyncMock(return_value=pipe)
    pipe.__aexit__ = AsyncMock(return_value=False)
    return pipe


def _make_mock_redis(counter_value: int) -> MagicMock:
    """Return a mock Redis client whose pipeline yields the given counter."""
    pipe = _mock_redis_pipeline(counter_value)
    mock_redis = MagicMock()
    mock_redis.pipeline = MagicMock(return_value=pipe)
    mock_redis.expire = AsyncMock()
    mock_redis.aclose = AsyncMock()
    return mock_redis


# ---------------------------------------------------------------------------
# RateLimitMiddleware – requests within limit
# ---------------------------------------------------------------------------

class TestRateLimitMiddlewareAllows:
    @pytest.mark.asyncio
    async def test_request_within_limit_returns_200(self) -> None:
        app = _make_app("/auth/login", max_requests=10, window_seconds=60)
        mock_redis = _make_mock_redis(counter_value=1)  # first request

        with patch("app.core.rate_limit._get_pool", return_value=MagicMock()), \
             patch("app.core.rate_limit.aioredis.Redis", return_value=mock_redis):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                response = await client.get("/auth/login")

        assert response.status_code == 200
        assert response.json() == {"ok": True}

    @pytest.mark.asyncio
    async def test_request_at_exact_limit_is_allowed(self) -> None:
        app = _make_app("/auth/login", max_requests=10, window_seconds=60)
        mock_redis = _make_mock_redis(counter_value=10)  # exactly at limit

        with patch("app.core.rate_limit._get_pool", return_value=MagicMock()), \
             patch("app.core.rate_limit.aioredis.Redis", return_value=mock_redis):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                response = await client.get("/auth/login")

        assert response.status_code == 200

    @pytest.mark.asyncio
    async def test_unmatched_path_is_not_rate_limited(self) -> None:
        """Requests to /public are never rate-limited even with a counter > limit."""
        app = _make_app("/auth/login", max_requests=1, window_seconds=60)
        # Even if the middleware were triggered it would get counter=99 and block,
        # but it should NOT be triggered for /public.
        mock_redis = _make_mock_redis(counter_value=99)

        with patch("app.core.rate_limit._get_pool", return_value=MagicMock()), \
             patch("app.core.rate_limit.aioredis.Redis", return_value=mock_redis):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                response = await client.get("/public")

        assert response.status_code == 200
        # Redis pipeline should NOT have been called for the unmatched path.
        mock_redis.pipeline.assert_not_called()


# ---------------------------------------------------------------------------
# RateLimitMiddleware – requests exceeding the limit
# ---------------------------------------------------------------------------

class TestRateLimitMiddlewareBlocks:
    @pytest.mark.asyncio
    async def test_request_over_limit_returns_429(self) -> None:
        app = _make_app("/auth/login", max_requests=10, window_seconds=60)
        mock_redis = _make_mock_redis(counter_value=11)  # one over limit

        with patch("app.core.rate_limit._get_pool", return_value=MagicMock()), \
             patch("app.core.rate_limit.aioredis.Redis", return_value=mock_redis):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                response = await client.get("/auth/login")

        assert response.status_code == 429

    @pytest.mark.asyncio
    async def test_429_response_contains_retry_after_header(self) -> None:
        window = 60
        app = _make_app("/auth/login", max_requests=10, window_seconds=window)
        mock_redis = _make_mock_redis(counter_value=11)

        with patch("app.core.rate_limit._get_pool", return_value=MagicMock()), \
             patch("app.core.rate_limit.aioredis.Redis", return_value=mock_redis):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                response = await client.get("/auth/login")

        assert "retry-after" in response.headers
        assert response.headers["retry-after"] == str(window)

    @pytest.mark.asyncio
    async def test_429_response_has_correct_json_error_code(self) -> None:
        app = _make_app("/auth/login", max_requests=10, window_seconds=60)
        mock_redis = _make_mock_redis(counter_value=50)

        with patch("app.core.rate_limit._get_pool", return_value=MagicMock()), \
             patch("app.core.rate_limit.aioredis.Redis", return_value=mock_redis):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                response = await client.get("/auth/login")

        data = response.json()
        assert data["code"] == "RATE_LIMIT_EXCEEDED"
        assert "detail" in data

    @pytest.mark.asyncio
    async def test_register_endpoint_is_also_rate_limited(self) -> None:
        app = _make_app("/auth/register", max_requests=10, window_seconds=60)
        mock_redis = _make_mock_redis(counter_value=15)

        with patch("app.core.rate_limit._get_pool", return_value=MagicMock()), \
             patch("app.core.rate_limit.aioredis.Redis", return_value=mock_redis):
            async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
                response = await client.get("/auth/register")

        assert response.status_code == 429


# ---------------------------------------------------------------------------
# record_login_failure
# ---------------------------------------------------------------------------

class TestRecordLoginFailure:
    @pytest.fixture
    def redis_new_key(self) -> MagicMock:
        """Simulate a brand-new login_fail key (first failure)."""
        pipe = MagicMock()
        pipe.incr = MagicMock()
        pipe.ttl = MagicMock()
        # count=1, ttl=-2 (key doesn't exist yet after INCR, common Redis pipeline result)
        pipe.execute = AsyncMock(return_value=[1, -2])
        mock_r = MagicMock()
        mock_r.pipeline = MagicMock(return_value=pipe)
        mock_r.expire = AsyncMock()
        return mock_r

    @pytest.fixture
    def redis_existing_key(self) -> MagicMock:
        """Simulate an existing login_fail key at count 3."""
        pipe = MagicMock()
        pipe.incr = MagicMock()
        pipe.ttl = MagicMock()
        # count=4 after increment, ttl=450 (within original window)
        pipe.execute = AsyncMock(return_value=[4, 450])
        mock_r = MagicMock()
        mock_r.pipeline = MagicMock(return_value=pipe)
        mock_r.expire = AsyncMock()
        return mock_r

    @pytest.mark.asyncio
    async def test_returns_incremented_count(self, redis_new_key: MagicMock) -> None:
        count = await record_login_failure(redis_new_key, "1.2.3.4")
        assert count == 1

    @pytest.mark.asyncio
    async def test_increments_existing_counter(self, redis_existing_key: MagicMock) -> None:
        count = await record_login_failure(redis_existing_key, "1.2.3.4")
        assert count == 4

    @pytest.mark.asyncio
    async def test_sets_ttl_600_on_new_key(self, redis_new_key: MagicMock) -> None:
        await record_login_failure(redis_new_key, "1.2.3.4")
        redis_new_key.expire.assert_awaited_once_with("login_fail:1.2.3.4", 600)

    @pytest.mark.asyncio
    async def test_does_not_reset_ttl_for_existing_key(self, redis_existing_key: MagicMock) -> None:
        """TTL should NOT be reset when the key already exists (count > 1)."""
        await record_login_failure(redis_existing_key, "1.2.3.4")
        redis_existing_key.expire.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_uses_correct_redis_key(self, redis_new_key: MagicMock) -> None:
        await record_login_failure(redis_new_key, "10.0.0.1")
        # The pipeline's incr is called inside pipeline context; verify key via
        # checking the expire call uses the correct key.
        redis_new_key.expire.assert_awaited_once_with("login_fail:10.0.0.1", 600)


# ---------------------------------------------------------------------------
# is_login_blocked
# ---------------------------------------------------------------------------

class TestIsLoginBlocked:
    @pytest.fixture
    def redis_blocked(self) -> MagicMock:
        r = MagicMock()
        r.get = AsyncMock(return_value="1")
        return r

    @pytest.fixture
    def redis_not_blocked(self) -> MagicMock:
        r = MagicMock()
        r.get = AsyncMock(return_value=None)
        return r

    @pytest.mark.asyncio
    async def test_returns_true_when_block_key_exists(self, redis_blocked: MagicMock) -> None:
        result = await is_login_blocked(redis_blocked, "1.2.3.4")
        assert result is True

    @pytest.mark.asyncio
    async def test_returns_false_when_block_key_absent(self, redis_not_blocked: MagicMock) -> None:
        result = await is_login_blocked(redis_not_blocked, "1.2.3.4")
        assert result is False

    @pytest.mark.asyncio
    async def test_queries_correct_key(self, redis_not_blocked: MagicMock) -> None:
        await is_login_blocked(redis_not_blocked, "5.6.7.8")
        redis_not_blocked.get.assert_awaited_once_with("login_block:5.6.7.8")


# ---------------------------------------------------------------------------
# set_login_block
# ---------------------------------------------------------------------------

class TestSetLoginBlock:
    @pytest.fixture
    def mock_redis(self) -> MagicMock:
        r = MagicMock()
        r.set = AsyncMock()
        return r

    @pytest.mark.asyncio
    async def test_sets_block_key_with_900s_ttl(self, mock_redis: MagicMock) -> None:
        await set_login_block(mock_redis, "1.2.3.4")
        mock_redis.set.assert_awaited_once_with("login_block:1.2.3.4", "1", ex=900)

    @pytest.mark.asyncio
    async def test_uses_correct_ip_in_key(self, mock_redis: MagicMock) -> None:
        await set_login_block(mock_redis, "192.168.1.100")
        call_args = mock_redis.set.call_args
        assert call_args[0][0] == "login_block:192.168.1.100"

    @pytest.mark.asyncio
    async def test_sets_sentinel_value_one(self, mock_redis: MagicMock) -> None:
        await set_login_block(mock_redis, "1.2.3.4")
        call_args = mock_redis.set.call_args
        assert call_args[0][1] == "1"

    @pytest.mark.asyncio
    async def test_ttl_is_exactly_900(self, mock_redis: MagicMock) -> None:
        await set_login_block(mock_redis, "1.2.3.4")
        call_kwargs = mock_redis.set.call_args[1]
        assert call_kwargs["ex"] == 900


# ---------------------------------------------------------------------------
# reset_login_counter
# ---------------------------------------------------------------------------

class TestResetLoginCounter:
    @pytest.fixture
    def mock_redis(self) -> MagicMock:
        pipe = MagicMock()
        pipe.delete = MagicMock()
        pipe.execute = AsyncMock(return_value=[1, 1])
        mock_r = MagicMock()
        mock_r.pipeline = MagicMock(return_value=pipe)
        return mock_r

    @pytest.mark.asyncio
    async def test_deletes_both_keys(self, mock_redis: MagicMock) -> None:
        await reset_login_counter(mock_redis, "1.2.3.4")
        pipe = mock_redis.pipeline.return_value
        # Both delete calls must have been enqueued.
        assert pipe.delete.call_count == 2
        deleted_keys = {call[0][0] for call in pipe.delete.call_args_list}
        assert "login_fail:1.2.3.4" in deleted_keys
        assert "login_block:1.2.3.4" in deleted_keys

    @pytest.mark.asyncio
    async def test_uses_pipeline_for_atomic_delete(self, mock_redis: MagicMock) -> None:
        await reset_login_counter(mock_redis, "1.2.3.4")
        mock_redis.pipeline.assert_called_once()
        mock_redis.pipeline.return_value.execute.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_uses_correct_ip_in_keys(self, mock_redis: MagicMock) -> None:
        await reset_login_counter(mock_redis, "10.20.30.40")
        pipe = mock_redis.pipeline.return_value
        deleted_keys = {call[0][0] for call in pipe.delete.call_args_list}
        assert "login_fail:10.20.30.40" in deleted_keys
        assert "login_block:10.20.30.40" in deleted_keys
