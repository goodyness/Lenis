"""
lenis.exceptions — Exception classes for the Lenis Python SDK.

Hierarchy:
    LenisAuthError(Exception)             — HTTP 401 or empty/None api_key (status_code=0)
    LenisAPIError(Exception)              — any other non-2xx HTTP error
    LenisWebhookSignatureError(Exception) — HMAC verification failure
"""

from __future__ import annotations

from typing import Optional


class LenisAuthError(Exception):
    """Raised when authentication fails.

    This covers two distinct cases:

    1. The Lenis API returned HTTP 401 — pass ``status_code=401`` and the
       ``error`` string from the response body.
    2. The SDK was constructed with a ``None`` or empty ``api_key`` — pass
       ``status_code=0`` and a descriptive ``error`` message.  No network
       request is made in this case.

    Attributes:
        status_code: The HTTP status code (401), or 0 when the key is absent.
        error: Human-readable description of the authentication failure.
    """

    status_code: int
    error: str

    def __init__(self, status_code: int, error: str) -> None:
        self.status_code = status_code
        self.error = error
        super().__init__(f"[{status_code}] {error}")


class LenisAPIError(Exception):
    """Raised when the Lenis API returns a non-2xx, non-401 response.

    Attributes:
        status_code: The HTTP status code returned by the API (e.g. 422, 429, 500).
        error: The ``error`` field from the JSON response body, or a fallback
               string when the body is not parseable.
        param: Optional field name that caused the error, if the API supplies one.
    """

    status_code: int
    error: str
    param: Optional[str]

    def __init__(
        self,
        status_code: int,
        error: str,
        param: Optional[str] = None,
    ) -> None:
        self.status_code = status_code
        self.error = error
        self.param = param
        msg = f"[{status_code}] {error}"
        if param:
            msg += f" (param: {param})"
        super().__init__(msg)


class LenisWebhookSignatureError(Exception):
    """Raised when webhook HMAC-SHA256 signature verification fails.

    This is raised by ``client.webhooks.construct_event()`` whenever the
    ``X-Lenis-Signature`` header does not match the computed digest for the
    given payload and secret.

    Attributes:
        message: Human-readable description of why verification failed.
    """

    message: str

    def __init__(self, message: str) -> None:
        self.message = message
        super().__init__(message)
