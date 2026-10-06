"""
lenis.resources.payments — PaymentsResource: CRUD for payment intents.

Methods:
    create(**kwargs) -> dict
        Create a payment intent. Required: amount, token_symbol, network,
        accepted_tokens. Optional: customer_email, redirect_url, expires_in,
        metadata. Pass idempotency_key as a keyword arg to set the
        Idempotency-Key header.

    retrieve(payment_id: str) -> dict
        Retrieve a single payment by ID.

    list(**filters) -> dict
        List payments with optional filters: status, network, token_symbol,
        created_after, created_before, limit, cursor.
"""

from __future__ import annotations

from typing import Any

from lenis._http import HttpClient


class PaymentsResource:
    """Interact with the ``/v1/payments`` endpoints.

    Attributes:
        _http: Shared :class:`~lenis._http.HttpClient` instance.
    """

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def create(self, **kwargs: Any) -> dict[str, Any]:
        """Create a new payment intent.

        Required keyword arguments:
            amount (str | Decimal): Amount to charge.
            token_symbol (str): Primary token expected (e.g. ``"USDC"``).
            network (str): Chain to accept payment on (e.g. ``"base"``).
            accepted_tokens (list): List of accepted token objects.

        Optional keyword arguments:
            customer_email (str): Payer's email address.
            redirect_url (str): HTTPS URL to redirect to after payment.
            expires_in (int): Seconds until expiry (300–86400, default 3600).
            metadata (dict): Arbitrary key/value metadata (max 16 keys).
            idempotency_key (str): Value for the ``Idempotency-Key`` header.

        Returns:
            Parsed ``PaymentIntentResponse`` dict from the API.

        Raises:
            LenisAuthError: On HTTP 401.
            LenisAPIError:  On any other non-2xx response.
        """
        # Pull idempotency_key out of kwargs — it's a header, not a body field.
        idempotency_key: str | None = kwargs.pop("idempotency_key", None)

        extra_headers: dict[str, str] = {}
        if idempotency_key:
            extra_headers["Idempotency-Key"] = idempotency_key

        return self._http.request(
            "POST",
            "/v1/payments",
            json=kwargs,
            headers=extra_headers if extra_headers else None,
        )

    def retrieve(self, payment_id: str) -> dict[str, Any]:
        """Retrieve a single payment intent by ID.

        Args:
            payment_id: The payment's unique identifier.

        Returns:
            Parsed ``PaymentIntentResponse`` dict.

        Raises:
            LenisAuthError: On HTTP 401.
            LenisAPIError:  On any other non-2xx (including 404).
        """
        return self._http.request("GET", f"/v1/payments/{payment_id}")

    def list(self, **filters: Any) -> dict[str, Any]:
        """List payment intents, optionally filtered.

        Optional keyword arguments:
            status (str): Filter by payment status.
            network (str): Filter by network.
            token_symbol (str): Filter by token symbol.
            created_after (int): Unix timestamp lower bound.
            created_before (int): Unix timestamp upper bound.
            limit (int): Maximum results per page (1–100).
            cursor (str): Pagination cursor from a previous response.

        Returns:
            Parsed ``ListResponse`` dict with ``data``, ``has_more``,
            ``next_cursor``, and ``total`` fields.

        Raises:
            LenisAuthError: On HTTP 401.
            LenisAPIError:  On any other non-2xx.
        """
        return self._http.request("GET", "/v1/payments", params=filters if filters else None)
