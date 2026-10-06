"""
Custom ASGI middleware for the Lenis platform.

Provides three middleware classes:

- HTTPSRedirectMiddleware: Redirects plain HTTP requests to HTTPS (301) when
  running in production. Passes through in non-production environments so local
  development and test suites are unaffected.

- SecurityHeadersMiddleware: Injects HSTS, X-Content-Type-Options, X-Frame-Options,
  and Content-Security-Policy on every outbound response, regardless of status code.

- RequestIDMiddleware: Assigns a unique request ID to every inbound request (using
  the ``X-Request-ID`` header if provided by the caller, or generating a UUID-4
  otherwise). The ID is stored on ``request.state.request_id`` and echoed back as
  ``X-Request-ID`` on the response for end-to-end tracing.
"""
from __future__ import annotations

import secrets
import uuid

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import RedirectResponse, Response
from starlette.types import ASGIApp

from app.core.config import settings


class HTTPSRedirectMiddleware(BaseHTTPMiddleware):
    """Redirect HTTP requests to HTTPS with a 301 status code.

    Only active when ``settings.app_env == "production"``.  In all other
    environments the middleware is a transparent pass-through so development
    servers and test clients work without TLS.
    """

    def __init__(self, app: ASGIApp) -> None:
        super().__init__(app)

    async def dispatch(self, request: Request, call_next: object) -> Response:
        if settings.app_env == "production" and request.url.scheme == "http":
            https_url = request.url.replace(scheme="https")
            return RedirectResponse(url=str(https_url), status_code=301)
        return await call_next(request)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Inject security-related HTTP headers on every response.

    Headers added:
    - ``Strict-Transport-Security``: enables HSTS for two years with subdomains
      and preload consent.
    - ``X-Content-Type-Options``: prevents MIME-type sniffing.
    - ``X-Frame-Options``: blocks the page from being embedded in a frame.
    - ``Content-Security-Policy``: dynamic per-request policy with a nonce for
      inline scripts. The nonce is also stored on ``request.state.csp_nonce``
      so templates can reference it.
    """

    async def dispatch(self, request: Request, call_next: object) -> Response:
        nonce = secrets.token_urlsafe(16)
        request.state.csp_nonce = nonce

        script_src = f"'self' 'nonce-{nonce}'"
        if settings.app_env == "development":
            script_src += " 'unsafe-eval'"

        csp = (
            f"default-src 'self'; "
            f"script-src {script_src}; "
            f"style-src 'self' 'unsafe-inline'; "
            f"font-src 'self' data:; "
            f"connect-src 'self' {settings.frontend_origin}; "
            f"img-src 'self' data: blob:; "
            f"frame-ancestors 'none'"
        )

        response: Response = await call_next(request)
        response.headers["Content-Security-Policy"] = csp
        response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        return response


class RequestIDMiddleware(BaseHTTPMiddleware):
    """Assign a unique request ID to every inbound request.

    The ID is read from the ``X-Request-ID`` request header if the caller
    provides one (useful when a load-balancer or API gateway already assigns
    trace IDs). Otherwise a fresh UUID-4 is generated.

    The resolved ID is:
    - stored on ``request.state.request_id`` for downstream handlers and
      middleware to reference in log calls.
    - echoed back as ``X-Request-ID`` on the response so clients can
      correlate their request with server-side log entries.
    """

    async def dispatch(self, request: Request, call_next: object) -> Response:
        req_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
        request.state.request_id = req_id
        response: Response = await call_next(request)
        response.headers["X-Request-ID"] = req_id
        return response
