"""
Integration tests for HTTPS enforcement and security headers.

Verifies two middleware behaviours:

1. HTTPSRedirectMiddleware (production mode only):
   - Any HTTP request is redirected 301 → HTTPS equivalent,
     preserving path and query string.

2. SecurityHeadersMiddleware (always active):
   - Every response carries all four required headers regardless of
     status code (200, 401, 404, 405, etc.).
"""
from __future__ import annotations

import unittest.mock as mock
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from fastapi import FastAPI
from fastapi.responses import JSONResponse

from app.main import app, create_app


# ---------------------------------------------------------------------------
# Redis mock helpers (mirrors the unit test pattern)
# ---------------------------------------------------------------------------


def _make_mock_redis_client() -> MagicMock:
    """Return a mock Redis client that never tries to reach a real server."""
    pipe = MagicMock()
    pipe.incr = MagicMock()
    pipe.ttl = MagicMock()
    # Simulate a first request (count=1, ttl=-2 so the middleware sets TTL).
    pipe.execute = AsyncMock(return_value=[1, -2])
    mock_redis = MagicMock()
    mock_redis.pipeline = MagicMock(return_value=pipe)
    mock_redis.expire = AsyncMock()
    mock_redis.aclose = AsyncMock()
    return mock_redis


# ---------------------------------------------------------------------------
# Expected header values (matches SecurityHeadersMiddleware._HEADERS)
# ---------------------------------------------------------------------------

EXPECTED_HEADERS: dict[str, str] = {
    "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "content-security-policy": "default-src 'self'",
}


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def production_app() -> FastAPI:
    """Return a fresh FastAPI instance with HTTPS redirect enabled.

    Patches ``app.core.middleware.settings`` so that ``app_env == "production"``
    and stubs out the Redis pool so that RateLimitMiddleware (which is always
    registered) never tries to open a real Redis connection during tests.
    """
    mock_redis = _make_mock_redis_client()
    with (
        mock.patch("app.core.middleware.settings") as mock_settings,
        mock.patch("app.core.rate_limit._get_pool", return_value=MagicMock()),
        mock.patch("app.core.rate_limit.aioredis.Redis", return_value=mock_redis),
    ):
        mock_settings.app_env = "production"
        yield create_app()


@pytest.fixture
def app_with_ok_route() -> FastAPI:
    """Return a fresh app that exposes a simple ``GET /test-ok`` → 200 route.

    Used to assert security headers are present on successful responses when
    no other reliably-200 route is guaranteed to exist yet.
    """
    with mock.patch("app.core.middleware.settings") as mock_settings:
        mock_settings.app_env = "development"
        test_app = create_app()

    @test_app.get("/test-ok")
    async def _ok() -> JSONResponse:
        return JSONResponse({"status": "ok"})

    return test_app


# ---------------------------------------------------------------------------
# HTTPS redirect tests (production mode)
# ---------------------------------------------------------------------------


class TestHTTPSRedirect:
    """HTTP requests to the production app must redirect 301 to HTTPS."""

    @pytest.mark.asyncio
    async def test_root_redirects_to_https(self, production_app: FastAPI) -> None:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=production_app),
            base_url="http://testserver",
            follow_redirects=False,
        ) as client:
            response = await client.get("/")

        assert response.status_code == 301
        assert response.headers["location"].startswith("https://")

    @pytest.mark.asyncio
    async def test_auth_register_redirects(self, production_app: FastAPI) -> None:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=production_app),
            base_url="http://testserver",
            follow_redirects=False,
        ) as client:
            response = await client.get("/auth/register")

        assert response.status_code == 301
        assert response.headers["location"] == "https://testserver/auth/register"

    @pytest.mark.asyncio
    async def test_auth_login_post_redirects(self, production_app: FastAPI) -> None:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=production_app),
            base_url="http://testserver",
            follow_redirects=False,
        ) as client:
            response = await client.post("/auth/login")

        assert response.status_code == 301
        assert response.headers["location"] == "https://testserver/auth/login"

    @pytest.mark.asyncio
    async def test_path_with_query_string_preserved(self, production_app: FastAPI) -> None:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=production_app),
            base_url="http://testserver",
            follow_redirects=False,
        ) as client:
            response = await client.get("/some/path?foo=bar&baz=qux")

        assert response.status_code == 301
        location = response.headers["location"]
        assert location == "https://testserver/some/path?foo=bar&baz=qux"

    @pytest.mark.asyncio
    async def test_redirect_location_has_https_scheme(self, production_app: FastAPI) -> None:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=production_app),
            base_url="http://testserver",
            follow_redirects=False,
        ) as client:
            response = await client.get("/some/path")

        assert response.status_code == 301
        assert response.headers["location"].startswith("https://")


# ---------------------------------------------------------------------------
# Security headers tests (any environment)
# ---------------------------------------------------------------------------


class TestSecurityHeaders:
    """Every response must carry all four security headers, regardless of status."""

    def _assert_security_headers(self, response: httpx.Response) -> None:
        """Assert all four required security headers are present with correct values."""
        for header, expected_value in EXPECTED_HEADERS.items():
            assert header in response.headers, (
                f"Missing security header '{header}' on {response.status_code} response"
            )
            assert response.headers[header] == expected_value, (
                f"Header '{header}' has value {response.headers[header]!r}, "
                f"expected {expected_value!r}"
            )

    @pytest.mark.asyncio
    async def test_headers_on_404_response(self) -> None:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://testserver",
        ) as client:
            response = await client.get("/nonexistent-path-that-returns-404")

        assert response.status_code == 404
        self._assert_security_headers(response)

    @pytest.mark.asyncio
    async def test_headers_on_200_response(self, app_with_ok_route: FastAPI) -> None:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app_with_ok_route),
            base_url="http://testserver",
        ) as client:
            response = await client.get("/test-ok")

        assert response.status_code == 200
        self._assert_security_headers(response)

    @pytest.mark.asyncio
    async def test_headers_on_401_response(self) -> None:
        """GET /users/me without a token should return 401 with security headers."""
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://testserver",
        ) as client:
            response = await client.get("/users/me")

        assert response.status_code == 401
        self._assert_security_headers(response)

    @pytest.mark.asyncio
    async def test_headers_on_405_response(self) -> None:
        """DELETE on a GET-only endpoint should return 405 with security headers."""
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://testserver",
        ) as client:
            # /users/me is GET-only; DELETE is not allowed.
            response = await client.delete("/users/me")

        # 401 is also acceptable if auth middleware fires before method check,
        # but in either case security headers must be present.
        assert response.status_code in (401, 405)
        self._assert_security_headers(response)

    @pytest.mark.asyncio
    async def test_strict_transport_security_value(self) -> None:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://testserver",
        ) as client:
            response = await client.get("/nonexistent")

        assert response.headers.get("strict-transport-security") == (
            "max-age=63072000; includeSubDomains; preload"
        )

    @pytest.mark.asyncio
    async def test_x_content_type_options_value(self) -> None:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://testserver",
        ) as client:
            response = await client.get("/nonexistent")

        assert response.headers.get("x-content-type-options") == "nosniff"

    @pytest.mark.asyncio
    async def test_x_frame_options_value(self) -> None:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://testserver",
        ) as client:
            response = await client.get("/nonexistent")

        assert response.headers.get("x-frame-options") == "DENY"

    @pytest.mark.asyncio
    async def test_content_security_policy_value(self) -> None:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://testserver",
        ) as client:
            response = await client.get("/nonexistent")

        assert response.headers.get("content-security-policy") == "default-src 'self'"


# ---------------------------------------------------------------------------
# Combined test: redirect response itself carries security headers
# ---------------------------------------------------------------------------


class TestRedirectCarriesSecurityHeaders:
    """The 301 redirect response from the production app must also have all
    four security headers, because SecurityHeadersMiddleware wraps
    HTTPSRedirectMiddleware in the middleware stack.
    """

    @pytest.mark.asyncio
    async def test_redirect_response_has_all_security_headers(
        self, production_app: FastAPI
    ) -> None:
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=production_app),
            base_url="http://testserver",
            follow_redirects=False,
        ) as client:
            response = await client.get("/any/path")

        assert response.status_code == 301

        for header, expected_value in EXPECTED_HEADERS.items():
            assert header in response.headers, (
                f"Security header '{header}' missing from redirect response"
            )
            assert response.headers[header] == expected_value, (
                f"Header '{header}' on redirect has value "
                f"{response.headers[header]!r}, expected {expected_value!r}"
            )
