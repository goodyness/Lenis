"""
lenis._http — Low-level HTTP client wrapping httpx.

Provides:
    HttpClient   — exposes both sync and async request methods via a single instance

Both sync and async paths:
    - Set base URL (default https://api.lenis.io)
    - Attach Authorization: Bearer {api_key} on every request
    - Apply a 30-second timeout
    - Retry on 5xx with delays [1, 2, 4] seconds (max 3 retries)
    - Raise LenisAuthError on HTTP 401
    - Raise LenisAPIError on any other non-2xx
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

import httpx

from lenis.exceptions import LenisAPIError, LenisAuthError

# Delays in seconds between retry attempts for 5xx responses.
# With 3 entries, at most 3 retries are made before the error is raised.
RETRY_DELAYS: list[int] = [1, 2, 4]

_DEFAULT_BASE_URL = "https://api.lenis.io"
_DEFAULT_TIMEOUT = 30.0
_USER_AGENT = "lenis-python/0.1.0"


def _default_headers(api_key: str) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "Accept": "application/json",
        "User-Agent": _USER_AGENT,
    }


def _parse_error_body(response: httpx.Response) -> dict[str, Any]:
    """Return parsed JSON body, falling back to a generic error dict."""
    try:
        return response.json()  # type: ignore[no-any-return]
    except Exception:
        return {"error": "unknown_error"}


def _raise_for_status(response: httpx.Response) -> None:
    """Raise the appropriate Lenis exception for a non-2xx response.

    Does nothing for 2xx responses.
    Raises LenisAuthError on 401.
    Raises LenisAPIError on all other non-2xx codes.
    Does NOT handle 5xx here — callers retry before delegating here.
    """
    if response.is_success:
        return

    body = _parse_error_body(response)
    status = response.status_code

    if status == 401:
        raise LenisAuthError(
            status_code=status,
            error=body.get("error", "invalid_api_key"),
        )

    raise LenisAPIError(
        status_code=status,
        error=body.get("error", "unknown_error"),
        param=body.get("param"),
    )


class HttpClient:
    """Thin wrapper around ``httpx.Client`` and ``httpx.AsyncClient``.

    A single ``HttpClient`` instance owns one sync client and one async
    client.  Both share identical default headers and timeout settings.

    Args:
        api_key:  Lenis secret key (``sk_test_*`` or ``sk_live_*``).
        base_url: Root URL for the Lenis API.  Defaults to
                  ``https://api.lenis.io``.
        timeout:  Per-request timeout in seconds.  Defaults to 30.0.
    """

    def __init__(
        self,
        api_key: str,
        base_url: str = _DEFAULT_BASE_URL,
        timeout: float = _DEFAULT_TIMEOUT,
    ) -> None:
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._timeout = timeout
        self._headers = _default_headers(api_key)

        self._sync_client = httpx.Client(
            base_url=self._base_url,
            headers=self._headers,
            timeout=self._timeout,
        )
        self._async_client = httpx.AsyncClient(
            base_url=self._base_url,
            headers=self._headers,
            timeout=self._timeout,
        )

    # ------------------------------------------------------------------
    # Sync interface
    # ------------------------------------------------------------------

    def request(
        self,
        method: str,
        path: str,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Make a synchronous HTTP request.

        Retries on 5xx up to ``len(RETRY_DELAYS)`` times with delays
        defined in ``RETRY_DELAYS``.  After exhausting retries the last
        5xx response is raised as ``LenisAPIError``.

        Args:
            method: HTTP verb (``"GET"``, ``"POST"``, etc.).
            path:   URL path relative to ``base_url`` (e.g. ``"/v1/payments"``).
            **kwargs: Extra keyword arguments forwarded to
                      ``httpx.Client.request``.

        Returns:
            Parsed JSON response body as a ``dict``.

        Raises:
            LenisAuthError: On HTTP 401.
            LenisAPIError:  On any other non-2xx response after retries.
        """
        url = path if path.startswith("http") else path
        last_error: LenisAPIError | None = None

        for attempt, delay in enumerate(RETRY_DELAYS):
            response = self._sync_client.request(method, url, **kwargs)

            if response.status_code >= 500:
                body = _parse_error_body(response)
                last_error = LenisAPIError(
                    status_code=response.status_code,
                    error=body.get("error", "unknown_error"),
                    param=body.get("param"),
                )
                time.sleep(delay)
                continue

            # Non-5xx: raise immediately for 4xx, return body for 2xx.
            _raise_for_status(response)
            return response.json()  # type: ignore[no-any-return]

        # All retries exhausted — raise the last captured 5xx error.
        assert last_error is not None  # always set when we exit the loop
        raise last_error

    # ------------------------------------------------------------------
    # Async interface
    # ------------------------------------------------------------------

    async def async_request(
        self,
        method: str,
        path: str,
        **kwargs: Any,
    ) -> dict[str, Any]:
        """Make an asynchronous HTTP request.

        Mirrors the retry logic of :meth:`request` using
        ``asyncio.sleep`` instead of ``time.sleep``.

        Args:
            method: HTTP verb (``"GET"``, ``"POST"``, etc.).
            path:   URL path relative to ``base_url``.
            **kwargs: Extra keyword arguments forwarded to
                      ``httpx.AsyncClient.request``.

        Returns:
            Parsed JSON response body as a ``dict``.

        Raises:
            LenisAuthError: On HTTP 401.
            LenisAPIError:  On any other non-2xx response after retries.
        """
        url = path if path.startswith("http") else path
        last_error: LenisAPIError | None = None

        for attempt, delay in enumerate(RETRY_DELAYS):
            response = await self._async_client.request(method, url, **kwargs)

            if response.status_code >= 500:
                body = _parse_error_body(response)
                last_error = LenisAPIError(
                    status_code=response.status_code,
                    error=body.get("error", "unknown_error"),
                    param=body.get("param"),
                )
                await asyncio.sleep(delay)
                continue

            _raise_for_status(response)
            return response.json()  # type: ignore[no-any-return]

        assert last_error is not None
        raise last_error

    # ------------------------------------------------------------------
    # Cleanup
    # ------------------------------------------------------------------

    def close(self) -> None:
        """Close the underlying synchronous ``httpx.Client``."""
        self._sync_client.close()

    async def async_close(self) -> None:
        """Close the underlying asynchronous ``httpx.AsyncClient``."""
        await self._async_client.aclose()

    # Context-manager support (sync)
    def __enter__(self) -> HttpClient:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    # Context-manager support (async)
    async def __aenter__(self) -> HttpClient:
        return self

    async def __aexit__(self, *_: object) -> None:
        await self.async_close()
