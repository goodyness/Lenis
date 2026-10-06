"""
Property-based tests for app/webhooks/signing.py.

Properties tested:
  - Property 5: Webhook Signature Round-Trip
    For any payload string and secret string,
    verify_signature(payload.encode(), build_signature_header(secret, payload)[0], secret)
    MUST NOT raise any exception.

  - Property 5b: Wrong Secret Always Raises
    If secret_a != secret_b, calling verify_signature with secret_b on a header
    signed with secret_a MUST always raise LenisWebhookSignatureError.

Validates: Requirements 13.1, 13.2, 13.3, 13.4

Feature: developer-api-and-public-platform
"""
from __future__ import annotations

import json

import pytest
from hypothesis import assume, given, settings
from hypothesis import strategies as st

from app.webhooks.exceptions import LenisWebhookSignatureError
from app.webhooks.signing import build_signature_header, verify_signature


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _valid_json_payload(data: dict | str) -> str:
    """Ensure payload is a JSON-serialisable string (as in real webhook delivery)."""
    if isinstance(data, str):
        return json.dumps({"content": data})
    return json.dumps(data)


# ---------------------------------------------------------------------------
# Property 5: Webhook Signature Round-Trip
# Validates: Requirements 13.1, 13.2, 13.3, 13.4
# ---------------------------------------------------------------------------


@settings(max_examples=200)
@given(
    payload=st.text(min_size=0),
    secret=st.text(min_size=1),
)
def test_webhook_signature_round_trip(payload: str, secret: str) -> None:
    """**Validates: Requirements 13.1, 13.2, 13.3**

    Property 5: Webhook Signature Round-Trip.

    For any payload string and any non-empty secret string,
    signing a payload and then verifying it with the same secret
    must succeed without raising any exception.
    """
    payload_json = _valid_json_payload(payload)
    header, _ts = build_signature_header(secret, payload_json)
    # Should not raise
    result = verify_signature(payload_json.encode(), header, secret)
    assert isinstance(result, dict)


# ---------------------------------------------------------------------------
# Property 5b: Wrong Secret Always Raises
# Validates: Requirements 13.1, 13.3, 13.4
# ---------------------------------------------------------------------------


@settings(max_examples=200)
@given(
    payload=st.text(min_size=0),
    secret_a=st.text(min_size=1),
    secret_b=st.text(min_size=1),
)
def test_webhook_signature_wrong_secret_always_raises(
    payload: str, secret_a: str, secret_b: str
) -> None:
    """**Validates: Requirements 13.1, 13.3, 13.4**

    Property 5b: Wrong Secret Always Raises.

    If secret_a != secret_b, calling verify_signature with secret_b on a
    header signed with secret_a MUST always raise LenisWebhookSignatureError.
    """
    assume(secret_a != secret_b)

    payload_json = _valid_json_payload(payload)
    header, _ts = build_signature_header(secret_a, payload_json)

    with pytest.raises(LenisWebhookSignatureError):
        verify_signature(payload_json.encode(), header, secret_b)


# ---------------------------------------------------------------------------
# Additional edge-case unit tests (non-property)
# ---------------------------------------------------------------------------


class TestWebhookSigningEdgeCases:
    def test_missing_header_raises(self) -> None:
        """Empty signature header raises LenisWebhookSignatureError."""
        with pytest.raises(LenisWebhookSignatureError):
            verify_signature(b'{"id": "evt_test"}', "", "secret")

    def test_missing_v1_component_raises(self) -> None:
        """Header without v1= component raises LenisWebhookSignatureError."""
        with pytest.raises(LenisWebhookSignatureError):
            verify_signature(b'{"id": "evt_test"}', "t=1234567890", "secret")

    def test_missing_t_component_raises(self) -> None:
        """Header without t= component raises LenisWebhookSignatureError."""
        with pytest.raises(LenisWebhookSignatureError):
            verify_signature(b'{"id": "evt_test"}', "v1=abc123", "secret")

    def test_expired_timestamp_raises(self) -> None:
        """Timestamp older than tolerance window raises LenisWebhookSignatureError."""
        from app.webhooks.signing import compute_signature

        old_ts = 1000000000  # well in the past
        payload_json = '{"id": "evt_old"}'
        sig = compute_signature("mysecret", old_ts, payload_json)
        header = f"t={old_ts},v1={sig}"

        with pytest.raises(LenisWebhookSignatureError) as exc_info:
            verify_signature(payload_json.encode(), header, "mysecret", tolerance_seconds=300)
        assert "tolerance" in exc_info.value.message.lower() or "outside" in exc_info.value.message.lower()

    def test_tampered_payload_raises(self) -> None:
        """Modifying the payload after signing causes HMAC mismatch."""
        payload_json = '{"amount": "100"}'
        header, _ts = build_signature_header("secret", payload_json)

        tampered = b'{"amount": "9999"}'
        with pytest.raises(LenisWebhookSignatureError):
            verify_signature(tampered, header, "secret")

    def test_error_exposes_message_attribute(self) -> None:
        """LenisWebhookSignatureError exposes a .message attribute."""
        try:
            verify_signature(b"payload", "", "secret")
        except LenisWebhookSignatureError as exc:
            assert isinstance(exc.message, str)
            assert len(exc.message) > 0
