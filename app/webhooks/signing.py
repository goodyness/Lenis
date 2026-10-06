import hashlib
import hmac
import json
import time

from app.webhooks.exceptions import LenisWebhookSignatureError


def compute_signature(secret: str, timestamp: int, payload_json: str) -> str:
    """HMAC-SHA256 over f"t={timestamp}\\n{payload_json}" using secret."""
    message = f"t={timestamp}\n{payload_json}"
    return hmac.new(secret.encode(), message.encode(), hashlib.sha256).hexdigest()


def build_signature_header(secret: str, payload_json: str) -> tuple[str, int]:
    """Returns (header_value, timestamp) where header = 't={ts},v1={hex}'."""
    ts = int(time.time())
    sig = compute_signature(secret, ts, payload_json)
    return f"t={ts},v1={sig}", ts


def verify_signature(
    payload_bytes: bytes,
    sig_header: str,
    secret: str,
    tolerance_seconds: int = 300,
) -> dict:
    """
    Verifies X-Lenis-Signature header.

    Raises LenisWebhookSignatureError on:
      - Missing or malformed header (no 'v1=' component)
      - Timestamp older than tolerance_seconds from now
      - HMAC mismatch

    Returns parsed event dict on success.
    """
    if not sig_header:
        raise LenisWebhookSignatureError(
            "Missing X-Lenis-Signature header."
        )

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

    # Return parsed event dict
    return json.loads(payload_json)
