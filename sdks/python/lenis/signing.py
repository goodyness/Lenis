"""
lenis.signing — Standalone HMAC-SHA256 webhook signature helpers.

This module is a dependency-free port of app/webhooks/signing.py.
It does NOT import anything from FastAPI or the Lenis backend.

Public API:
    compute_signature(secret, timestamp, payload_json) -> str
    build_signature_header(secret, payload_json) -> tuple[str, int]
    verify_signature(payload_bytes, sig_header, secret, tolerance_seconds) -> dict
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from typing import Any

from lenis.exceptions import LenisWebhookSignatureError


def compute_signature(secret: str, timestamp: int, payload_json: str) -> str:
    """Compute HMAC-SHA256 over ``f"t={timestamp}\\n{payload_json}"`` using *secret*.

    Args:
        secret:       The webhook endpoint's signing secret.
        timestamp:    Unix timestamp (integer) included in the header.
        payload_json: The raw JSON payload string.

    Returns:
        Hex-encoded HMAC-SHA256 digest.
    """
    message = f"t={timestamp}\n{payload_json}"
    return hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()


def build_signature_header(secret: str, payload_json: str) -> tuple[str, int]:
    """Build a ``X-Lenis-Signature`` header value for the given payload.

    Args:
        secret:       The webhook endpoint's signing secret.
        payload_json: The raw JSON payload string to sign.

    Returns:
        A 2-tuple of ``(header_value, timestamp)`` where
        ``header_value`` is ``"t={ts},v1={hex_sig}"`` and
        ``timestamp`` is the Unix second used in the signature.
    """
    ts = int(time.time())
    sig = compute_signature(secret, ts, payload_json)
    return f"t={ts},v1={sig}", ts


def verify_signature(
    payload_bytes: bytes,
    sig_header: str,
    secret: str,
    tolerance_seconds: int = 300,
) -> dict[str, Any]:
    """Verify a ``X-Lenis-Signature`` header and return the parsed event dict.

    Args:
        payload_bytes:      Raw request body bytes.
        sig_header:         Value of the ``X-Lenis-Signature`` header.
        secret:             The webhook endpoint's signing secret.
        tolerance_seconds:  Maximum age of the timestamp in seconds (default 300).

    Returns:
        Parsed event dict on successful verification.

    Raises:
        LenisWebhookSignatureError: When the header is missing, malformed,
            the timestamp is outside the tolerance window, or the HMAC
            does not match.
    """
    if not sig_header:
        raise LenisWebhookSignatureError("Missing X-Lenis-Signature header.")

    # Parse t= and v1= components from header like "t=1234567890,v1=abcdef..."
    parts: dict[str, str] = {}
    for part in sig_header.split(","):
        if "=" in part:
            key, _, value = part.partition("=")
            parts[key.strip()] = value.strip()

    if "t" not in parts:
        raise LenisWebhookSignatureError(
            "Malformed X-Lenis-Signature header: missing 't' timestamp component."
        )

    if "v1" not in parts:
        raise LenisWebhookSignatureError(
            "Malformed X-Lenis-Signature header: missing 'v1' signature component."
        )

    # Validate timestamp within tolerance
    try:
        timestamp = int(parts["t"])
    except ValueError:
        raise LenisWebhookSignatureError(
            "Malformed X-Lenis-Signature header: 't' is not a valid integer timestamp."
        )

    now = int(time.time())
    if abs(now - timestamp) > tolerance_seconds:
        raise LenisWebhookSignatureError(
            f"Webhook timestamp is outside tolerance window of {tolerance_seconds} seconds."
        )

    # Recompute HMAC and compare
    payload_json = payload_bytes.decode("utf-8")
    expected_sig = compute_signature(secret, timestamp, payload_json)

    received_sig = parts["v1"]
    if not hmac.compare_digest(expected_sig, received_sig):
        raise LenisWebhookSignatureError(
            "Webhook signature verification failed: HMAC mismatch."
        )

    return json.loads(payload_json)  # type: ignore[no-any-return]
