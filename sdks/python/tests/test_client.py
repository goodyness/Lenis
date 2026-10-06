"""
Tests for lenis.client — LenisClient high-level interface.

Covers:
1. Successful payment creation returns correct fields
2. Idempotency-Key header is correctly passed through when creating a payment
3. HTTP 401 raises LenisAuthError
4. HTTP 422 raises LenisAPIError with param
5. Webhook construct_event succeeds with valid signature
6. Webhook construct_event raises LenisWebhookSignatureError with wrong secret
7. Constructing LenisClient with empty key raises LenisAuthError
"""

from __future__ import annotations

import json
import time
from unittest.mock import MagicMock, call

import httpx
import pytest

from lenis.client import LenisClient
from lenis.exceptions import LenisAPIError, LenisAuthError, LenisWebhookSignatureError
from lenis.signing import build_signature_header


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _mock_response(status_code: int, json_body: dict) -> httpx.Response:
    """Build a minimal httpx.Response without a real network call."""
    return httpx.Response(
        status_code=status_code,
        headers={"Content-Type": "application/json"},
        content=json.dumps(json_body).encode(),
    )


def _make_client(api_key: str = "sk_test_abc123456789012345678901234567") -> LenisClient:
    return LenisClient(api_key=api_key, base_url="https://api.lenis.io")


# ---------------------------------------------------------------------------
# 1. Successful payment creation returns correct fields
# ---------------------------------------------------------------------------

class TestPaymentCreation:
    def test_create_payment_returns_correct_fields(self):
        client = _make_client()
        expected = {
            "id": "pay_abc123",
            "status": "pending",
            "amount": "100.00",
            "token_symbol": "USDC",
            "network": "base",
            "checkout_url": "https://checkout.lenis.io/pay/abc123",
            "created": 1700000000,
            "expires_at": 1700003600,
            "is_test": True,
            "livemode": False,
        }
        client._http._sync_client.request = MagicMock(
            return_value=_mock_response(201, expected)
        )

        result = client.payments.create(
            amount="100.00",
            token_symbol="USDC",
            network="base",
            accepted_tokens=[{"token_symbol": "USDC", "network": "base"}],
        )

        assert result["id"] == "pay_abc123"
        assert result["status"] == "pending"
        assert result["amount"] == "100.00"
        assert result["token_symbol"] == "USDC"
        assert result["network"] == "base"
        assert result["checkout_url"] == "https://checkout.lenis.io/pay/abc123"
        assert result["is_test"] is True
        assert result["livemode"] is False

    def test_create_payment_sends_correct_body(self):
        client = _make_client()
        client._http._sync_client.request = MagicMock(
            return_value=_mock_response(201, {"id": "pay_xyz"})
        )

        client.payments.create(
            amount="50.00",
            token_symbol="ETH",
            network="ethereum",
            accepted_tokens=[{"token_symbol": "ETH", "network": "ethereum"}],
            customer_email="user@example.com",
        )

        _, call_kwargs = client._http._sync_client.request.call_args
        body = call_kwargs.get("json", {})
        assert body["amount"] == "50.00"
        assert body["token_symbol"] == "ETH"
        assert body["customer_email"] == "user@example.com"


# ---------------------------------------------------------------------------
# 2. Idempotency-Key header is correctly passed in the request
# ---------------------------------------------------------------------------

class TestIdempotency:
    def test_idempotency_key_is_sent_as_header(self):
        client = _make_client()
        client._http._sync_client.request = MagicMock(
            return_value=_mock_response(201, {"id": "pay_idem"})
        )

        client.payments.create(
            amount="25.00",
            token_symbol="USDC",
            network="base",
            accepted_tokens=[{"token_symbol": "USDC", "network": "base"}],
            idempotency_key="unique-key-abc-123",
        )

        _, call_kwargs = client._http._sync_client.request.call_args
        # The idempotency key should appear in the headers passed to httpx
        headers = call_kwargs.get("headers", {})
        assert headers.get("Idempotency-Key") == "unique-key-abc-123"

    def test_idempotency_key_not_in_request_body(self):
        """The idempotency_key must be stripped from the JSON body."""
        client = _make_client()
        client._http._sync_client.request = MagicMock(
            return_value=_mock_response(201, {"id": "pay_idem2"})
        )

        client.payments.create(
            amount="10.00",
            token_symbol="USDC",
            network="base",
            accepted_tokens=[],
            idempotency_key="should-not-be-in-body",
        )

        _, call_kwargs = client._http._sync_client.request.call_args
        body = call_kwargs.get("json", {})
        assert "idempotency_key" not in body

    def test_no_idempotency_key_sends_no_extra_header(self):
        """When no idempotency_key is passed, no Idempotency-Key header is sent."""
        client = _make_client()
        client._http._sync_client.request = MagicMock(
            return_value=_mock_response(201, {"id": "pay_no_idem"})
        )

        client.payments.create(
            amount="10.00",
            token_symbol="USDC",
            network="base",
            accepted_tokens=[],
        )

        _, call_kwargs = client._http._sync_client.request.call_args
        # headers kwarg should either be absent or None when no idempotency key is given
        headers = call_kwargs.get("headers")
        assert not headers or "Idempotency-Key" not in headers


# ---------------------------------------------------------------------------
# 3. HTTP 401 raises LenisAuthError
# ---------------------------------------------------------------------------

class TestAuthErrors:
    def test_401_on_payment_create_raises_lenis_auth_error(self):
        client = _make_client()
        client._http._sync_client.request = MagicMock(
            return_value=_mock_response(401, {"error": "invalid_api_key"})
        )

        with pytest.raises(LenisAuthError) as exc_info:
            client.payments.create(
                amount="10.00",
                token_symbol="USDC",
                network="base",
                accepted_tokens=[],
            )

        err = exc_info.value
        assert err.status_code == 401
        assert err.error == "invalid_api_key"

    def test_401_on_payment_retrieve_raises_lenis_auth_error(self):
        client = _make_client()
        client._http._sync_client.request = MagicMock(
            return_value=_mock_response(401, {"error": "api_key_revoked"})
        )

        with pytest.raises(LenisAuthError) as exc_info:
            client.payments.retrieve("pay_123")

        err = exc_info.value
        assert err.status_code == 401
        assert err.error == "api_key_revoked"

    def test_401_on_payment_link_create_raises_lenis_auth_error(self):
        client = _make_client()
        client._http._sync_client.request = MagicMock(
            return_value=_mock_response(401, {"error": "api_key_expired"})
        )

        with pytest.raises(LenisAuthError) as exc_info:
            client.payment_links.create(
                title="Test Link",
                amount_mode="fixed",
                accepted_tokens=[],
            )

        assert exc_info.value.status_code == 401


# ---------------------------------------------------------------------------
# 4. HTTP 422 raises LenisAPIError with param
# ---------------------------------------------------------------------------

class TestAPIErrors:
    def test_422_raises_lenis_api_error_with_param(self):
        client = _make_client()
        client._http._sync_client.request = MagicMock(
            return_value=_mock_response(
                422, {"error": "invalid_amount", "param": "amount"}
            )
        )

        with pytest.raises(LenisAPIError) as exc_info:
            client.payments.create(
                amount="-1.00",
                token_symbol="USDC",
                network="base",
                accepted_tokens=[],
            )

        err = exc_info.value
        assert err.status_code == 422
        assert err.error == "invalid_amount"
        assert err.param == "amount"

    def test_422_with_network_param(self):
        client = _make_client()
        client._http._sync_client.request = MagicMock(
            return_value=_mock_response(
                422, {"error": "unsupported_network", "param": "network"}
            )
        )

        with pytest.raises(LenisAPIError) as exc_info:
            client.payments.create(
                amount="10.00",
                token_symbol="USDC",
                network="unknown_chain",
                accepted_tokens=[],
            )

        err = exc_info.value
        assert err.status_code == 422
        assert err.param == "network"

    def test_404_raises_lenis_api_error_without_param(self):
        client = _make_client()
        client._http._sync_client.request = MagicMock(
            return_value=_mock_response(404, {"error": "payment_not_found"})
        )

        with pytest.raises(LenisAPIError) as exc_info:
            client.payments.retrieve("pay_nonexistent")

        err = exc_info.value
        assert err.status_code == 404
        assert err.error == "payment_not_found"
        assert err.param is None


# ---------------------------------------------------------------------------
# 5. Webhook construct_event succeeds with valid signature
# ---------------------------------------------------------------------------

class TestWebhookConstructEvent:
    def test_construct_event_succeeds_with_valid_signature(self):
        secret = "whsec_test_secret_key_abc123"
        payload = {
            "id": "evt_abc123",
            "type": "payment.confirmed",
            "created": int(time.time()),
            "livemode": False,
            "data": {"payment_id": "pay_xyz"},
        }
        payload_json = json.dumps(payload)
        payload_bytes = payload_json.encode()

        sig_header, _ts = build_signature_header(secret, payload_json)

        client = _make_client()
        event = client.webhooks.construct_event(payload_bytes, sig_header, secret)

        assert event["id"] == "evt_abc123"
        assert event["type"] == "payment.confirmed"
        assert event["data"]["payment_id"] == "pay_xyz"

    def test_construct_event_returns_parsed_dict(self):
        secret = "another_secret_32byteslong_xyz12"
        payload = {"id": "evt_001", "type": "payment.created", "data": {}}
        payload_json = json.dumps(payload)

        sig_header, _ = build_signature_header(secret, payload_json)

        client = _make_client()
        result = client.webhooks.construct_event(
            payload_json.encode(), sig_header, secret
        )

        assert isinstance(result, dict)
        assert result["id"] == "evt_001"


# ---------------------------------------------------------------------------
# 6. Webhook construct_event raises LenisWebhookSignatureError with wrong secret
# ---------------------------------------------------------------------------

class TestWebhookSignatureErrors:
    def test_construct_event_raises_with_wrong_secret(self):
        correct_secret = "correct_secret_32byteslong_xyz12"
        wrong_secret = "wrong_secret_32_byteslong_xyz123"

        payload_json = json.dumps({"id": "evt_test", "type": "payment.confirmed"})
        sig_header, _ = build_signature_header(correct_secret, payload_json)

        client = _make_client()
        with pytest.raises(LenisWebhookSignatureError) as exc_info:
            client.webhooks.construct_event(
                payload_json.encode(), sig_header, wrong_secret
            )

        assert exc_info.value.message  # non-empty error message

    def test_construct_event_raises_with_missing_header(self):
        client = _make_client()
        with pytest.raises(LenisWebhookSignatureError):
            client.webhooks.construct_event(
                b'{"id": "evt_test"}',
                "",  # empty header
                "some_secret",
            )

    def test_construct_event_raises_with_malformed_header(self):
        client = _make_client()
        with pytest.raises(LenisWebhookSignatureError):
            client.webhooks.construct_event(
                b'{"id": "evt_test"}',
                "not_a_valid_header_format",
                "some_secret",
            )

    def test_construct_event_raises_with_tampered_payload(self):
        secret = "test_secret_32_byteslong_abcdefg"
        original_payload = json.dumps({"amount": "100.00"})
        sig_header, _ = build_signature_header(secret, original_payload)

        tampered_payload = json.dumps({"amount": "999.99"})

        client = _make_client()
        with pytest.raises(LenisWebhookSignatureError):
            client.webhooks.construct_event(
                tampered_payload.encode(), sig_header, secret
            )


# ---------------------------------------------------------------------------
# 7. Constructing LenisClient with empty key raises LenisAuthError
# ---------------------------------------------------------------------------

class TestClientConstruction:
    def test_empty_string_api_key_raises_lenis_auth_error(self):
        with pytest.raises(LenisAuthError) as exc_info:
            LenisClient(api_key="")

        err = exc_info.value
        assert err.status_code == 0
        assert err.error  # non-empty error message

    def test_none_api_key_raises_lenis_auth_error(self):
        with pytest.raises(LenisAuthError) as exc_info:
            LenisClient(api_key=None)  # type: ignore[arg-type]

        err = exc_info.value
        assert err.status_code == 0

    def test_valid_test_key_constructs_successfully(self):
        client = LenisClient(api_key="sk_test_abc123456789012345678901234567")
        assert client.payments is not None
        assert client.payment_links is not None
        assert client.webhooks is not None
        client.close()

    def test_valid_live_key_constructs_successfully(self):
        client = LenisClient(api_key="sk_live_abc123456789012345678901234567")
        assert client is not None
        client.close()

    def test_exposes_payments_resource(self):
        from lenis.resources.payments import PaymentsResource
        client = _make_client()
        assert isinstance(client.payments, PaymentsResource)
        client.close()

    def test_exposes_payment_links_resource(self):
        from lenis.resources.payment_links import PaymentLinksResource
        client = _make_client()
        assert isinstance(client.payment_links, PaymentLinksResource)
        client.close()

    def test_exposes_webhooks_resource(self):
        from lenis.resources.webhooks import WebhooksResource
        client = _make_client()
        assert isinstance(client.webhooks, WebhooksResource)
        client.close()
