"""
Tests for lenis._http — HttpClient sync and async request methods.

Covers:
- Successful 2xx requests return parsed JSON
- HTTP 401 raises LenisAuthError
- Non-2xx, non-401 raises LenisAPIError (with optional param)
- 5xx triggers retries and raises LenisAPIError after exhausting delays
- close() / async_close() are callable
- Context manager support (sync and async)
"""

from __future__ import annotations

import json
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from lenis._http import HttpClient, RETRY_DELAYS
from lenis.exceptions import LenisAuthError, LenisAPIError


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _mock_response(status_code: int, json_body: dict) -> httpx.Response:
    """Build a minimal httpx.Response without making a real network call."""
    content = json.dumps(json_body).encode()
    return httpx.Response(
        status_code=status_code,
        headers={"Content-Type": "application/json"},
        content=content,
    )


def _make_client() -> HttpClient:
    return HttpClient(api_key="sk_test_abc123")


# ---------------------------------------------------------------------------
# Sync — success path
# ---------------------------------------------------------------------------

class TestSyncSuccess:
    def test_returns_parsed_json_on_200(self):
        client = _make_client()
        client._sync_client.request = MagicMock(
            return_value=_mock_response(200, {"id": "pay_1", "status": "pending"})
        )

        result = client.request("GET", "/v1/payments/pay_1")

        assert result == {"id": "pay_1", "status": "pending"}
        client._sync_client.request.assert_called_once_with("GET", "/v1/payments/pay_1")

    def test_returns_parsed_json_on_201(self):
        client = _make_client()
        client._sync_client.request = MagicMock(
            return_value=_mock_response(201, {"id": "pay_2"})
        )

        result = client.request("POST", "/v1/payments", json={"amount": "10.00"})
        assert result["id"] == "pay_2"


# ---------------------------------------------------------------------------
# Sync — error handling
# ---------------------------------------------------------------------------

class TestSyncErrors:
    def test_401_raises_lenis_auth_error(self):
        client = _make_client()
        client._sync_client.request = MagicMock(
            return_value=_mock_response(401, {"error": "invalid_api_key"})
        )

        with pytest.raises(LenisAuthError) as exc_info:
            client.request("GET", "/v1/payments")

        err = exc_info.value
        assert err.status_code == 401
        assert err.error == "invalid_api_key"

    def test_401_default_error_when_body_missing_error_key(self):
        client = _make_client()
        client._sync_client.request = MagicMock(
            return_value=_mock_response(401, {})
        )

        with pytest.raises(LenisAuthError) as exc_info:
            client.request("GET", "/v1/payments")

        assert exc_info.value.error == "invalid_api_key"

    def test_422_raises_lenis_api_error_with_param(self):
        client = _make_client()
        client._sync_client.request = MagicMock(
            return_value=_mock_response(422, {"error": "invalid_amount", "param": "amount"})
        )

        with pytest.raises(LenisAPIError) as exc_info:
            client.request("POST", "/v1/payments", json={})

        err = exc_info.value
        assert err.status_code == 422
        assert err.error == "invalid_amount"
        assert err.param == "amount"

    def test_404_raises_lenis_api_error(self):
        client = _make_client()
        client._sync_client.request = MagicMock(
            return_value=_mock_response(404, {"error": "payment_not_found"})
        )

        with pytest.raises(LenisAPIError) as exc_info:
            client.request("GET", "/v1/payments/missing")

        assert exc_info.value.status_code == 404
        assert exc_info.value.param is None

    def test_non_json_body_uses_unknown_error_fallback(self):
        """A malformed (non-JSON) response body should not crash."""
        client = _make_client()
        bad_response = httpx.Response(
            status_code=503,
            headers={"Content-Type": "text/plain"},
            content=b"Service Unavailable",
        )
        client._sync_client.request = MagicMock(return_value=bad_response)

        with patch("lenis._http.time.sleep"):
            with pytest.raises(LenisAPIError) as exc_info:
                client.request("GET", "/v1/payments")

        assert exc_info.value.status_code == 503
        assert exc_info.value.error == "unknown_error"


# ---------------------------------------------------------------------------
# Sync — retry logic
# ---------------------------------------------------------------------------

class TestSyncRetries:
    def test_retries_on_500_then_succeeds(self):
        client = _make_client()
        responses = [
            _mock_response(500, {"error": "server_error"}),
            _mock_response(200, {"id": "pay_ok"}),
        ]
        client._sync_client.request = MagicMock(side_effect=responses)

        with patch("lenis._http.time.sleep") as sleep_mock:
            result = client.request("GET", "/v1/payments/pay_ok")

        assert result == {"id": "pay_ok"}
        sleep_mock.assert_called_once_with(RETRY_DELAYS[0])

    def test_retries_exhausted_raises_lenis_api_error(self):
        client = _make_client()
        client._sync_client.request = MagicMock(
            return_value=_mock_response(503, {"error": "service_unavailable"})
        )

        with patch("lenis._http.time.sleep"):
            with pytest.raises(LenisAPIError) as exc_info:
                client.request("GET", "/v1/payments")

        assert exc_info.value.status_code == 503
        assert exc_info.value.error == "service_unavailable"

    def test_correct_number_of_retries(self):
        client = _make_client()
        client._sync_client.request = MagicMock(
            return_value=_mock_response(500, {"error": "server_error"})
        )

        with patch("lenis._http.time.sleep") as sleep_mock:
            with pytest.raises(LenisAPIError):
                client.request("GET", "/v1/payments")

        # One call per RETRY_DELAYS entry
        assert client._sync_client.request.call_count == len(RETRY_DELAYS)
        assert sleep_mock.call_count == len(RETRY_DELAYS)
        assert [c.args[0] for c in sleep_mock.call_args_list] == RETRY_DELAYS

    def test_no_retry_on_4xx(self):
        """4xx responses should NOT be retried."""
        client = _make_client()
        client._sync_client.request = MagicMock(
            return_value=_mock_response(429, {"error": "rate_limit_exceeded"})
        )

        with patch("lenis._http.time.sleep") as sleep_mock:
            with pytest.raises(LenisAPIError):
                client.request("GET", "/v1/payments")

        assert client._sync_client.request.call_count == 1
        sleep_mock.assert_not_called()


# ---------------------------------------------------------------------------
# Async — success path
# ---------------------------------------------------------------------------

class TestAsyncSuccess:
    @pytest.mark.asyncio
    async def test_async_returns_parsed_json_on_200(self):
        client = _make_client()
        client._async_client.request = AsyncMock(
            return_value=_mock_response(200, {"id": "pay_async"})
        )

        result = await client.async_request("GET", "/v1/payments/pay_async")
        assert result == {"id": "pay_async"}


# ---------------------------------------------------------------------------
# Async — error handling
# ---------------------------------------------------------------------------

class TestAsyncErrors:
    @pytest.mark.asyncio
    async def test_async_401_raises_lenis_auth_error(self):
        client = _make_client()
        client._async_client.request = AsyncMock(
            return_value=_mock_response(401, {"error": "invalid_api_key"})
        )

        with pytest.raises(LenisAuthError) as exc_info:
            await client.async_request("GET", "/v1/payments")

        assert exc_info.value.status_code == 401

    @pytest.mark.asyncio
    async def test_async_422_raises_lenis_api_error(self):
        client = _make_client()
        client._async_client.request = AsyncMock(
            return_value=_mock_response(422, {"error": "invalid_amount", "param": "amount"})
        )

        with pytest.raises(LenisAPIError) as exc_info:
            await client.async_request("POST", "/v1/payments")

        assert exc_info.value.param == "amount"


# ---------------------------------------------------------------------------
# Async — retry logic
# ---------------------------------------------------------------------------

class TestAsyncRetries:
    @pytest.mark.asyncio
    async def test_async_retries_on_500_then_succeeds(self):
        client = _make_client()
        responses = [
            _mock_response(500, {"error": "server_error"}),
            _mock_response(200, {"id": "pay_ok"}),
        ]
        client._async_client.request = AsyncMock(side_effect=responses)

        with patch("lenis._http.asyncio.sleep", new_callable=AsyncMock):
            result = await client.async_request("GET", "/v1/payments/pay_ok")

        assert result == {"id": "pay_ok"}

    @pytest.mark.asyncio
    async def test_async_retries_exhausted_raises(self):
        client = _make_client()
        client._async_client.request = AsyncMock(
            return_value=_mock_response(503, {"error": "service_unavailable"})
        )

        with patch("lenis._http.asyncio.sleep", new_callable=AsyncMock):
            with pytest.raises(LenisAPIError) as exc_info:
                await client.async_request("GET", "/v1/payments")

        assert exc_info.value.status_code == 503

    @pytest.mark.asyncio
    async def test_async_correct_number_of_retries(self):
        client = _make_client()
        client._async_client.request = AsyncMock(
            return_value=_mock_response(500, {"error": "server_error"})
        )

        with patch("lenis._http.asyncio.sleep", new_callable=AsyncMock) as sleep_mock:
            with pytest.raises(LenisAPIError):
                await client.async_request("GET", "/v1/payments")

        assert client._async_client.request.call_count == len(RETRY_DELAYS)
        assert sleep_mock.call_count == len(RETRY_DELAYS)
        assert [c.args[0] for c in sleep_mock.call_args_list] == RETRY_DELAYS

    @pytest.mark.asyncio
    async def test_async_no_retry_on_4xx(self):
        """4xx responses should NOT be retried (async)."""
        client = _make_client()
        client._async_client.request = AsyncMock(
            return_value=_mock_response(404, {"error": "not_found"})
        )

        with patch("lenis._http.asyncio.sleep", new_callable=AsyncMock) as sleep_mock:
            with pytest.raises(LenisAPIError):
                await client.async_request("GET", "/v1/payments/missing")

        assert client._async_client.request.call_count == 1
        sleep_mock.assert_not_called()


# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------

class TestLifecycle:
    def test_close_is_callable(self):
        client = _make_client()
        close_mock = MagicMock()
        client._sync_client.close = close_mock
        client.close()
        close_mock.assert_called_once()

    @pytest.mark.asyncio
    async def test_async_close_is_callable(self):
        client = _make_client()
        aclose_mock = AsyncMock()
        client._async_client.aclose = aclose_mock
        await client.async_close()
        aclose_mock.assert_called_once()

    def test_sync_context_manager_calls_close(self):
        client = _make_client()
        close_mock = MagicMock()
        client._sync_client.close = close_mock
        with client:
            pass
        close_mock.assert_called_once()

    @pytest.mark.asyncio
    async def test_async_context_manager_calls_async_close(self):
        client = _make_client()
        aclose_mock = AsyncMock()
        client._async_client.aclose = aclose_mock
        async with client:
            pass
        aclose_mock.assert_called_once()


# ---------------------------------------------------------------------------
# Default configuration
# ---------------------------------------------------------------------------

class TestConfiguration:
    def test_default_base_url(self):
        client = HttpClient(api_key="sk_live_xyz")
        assert str(client._sync_client.base_url).rstrip("/") == "https://api.lenis.io"

    def test_custom_base_url(self):
        client = HttpClient(api_key="sk_live_xyz", base_url="https://staging.lenis.io")
        assert str(client._sync_client.base_url).rstrip("/") == "https://staging.lenis.io"

    def test_authorization_header_set(self):
        client = HttpClient(api_key="sk_test_mykey123")
        assert client._sync_client.headers["Authorization"] == "Bearer sk_test_mykey123"

    def test_user_agent_header_set(self):
        client = HttpClient(api_key="sk_test_mykey123")
        assert "lenis-python" in client._sync_client.headers["User-Agent"]

    def test_retry_delays_constant(self):
        assert RETRY_DELAYS == [1, 2, 4]

    def test_content_type_header_set(self):
        client = HttpClient(api_key="sk_test_mykey123")
        assert client._sync_client.headers["Content-Type"] == "application/json"

    def test_accept_header_set(self):
        client = HttpClient(api_key="sk_test_mykey123")
        assert client._sync_client.headers["Accept"] == "application/json"
