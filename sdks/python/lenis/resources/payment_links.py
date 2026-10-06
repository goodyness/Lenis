"""
lenis.resources.payment_links — PaymentLinksResource: CRUD for payment links.

Methods:
    create(**kwargs) -> dict
        Create a payment link. Required: title, amount_mode, accepted_tokens.
        Optional: amount (required for fixed mode), external_id, redirect_url,
        expires_in, max_uses, custom_message.

    retrieve(id: str) -> dict
        Retrieve a single payment link by ID.

    list(**filters) -> dict
        List payment links with optional filters: limit, cursor.
"""

from __future__ import annotations

from typing import Any

from lenis._http import HttpClient


class PaymentLinksResource:
    """Interact with the ``/v1/payment-links`` endpoints.

    Attributes:
        _http: Shared :class:`~lenis._http.HttpClient` instance.
    """

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def create(self, **kwargs: Any) -> dict[str, Any]:
        """Create a new payment link.

        Required keyword arguments:
            title (str): Link title (1–200 chars).
            amount_mode (str): ``"fixed"`` or ``"open"``.
            accepted_tokens (list): List of accepted token objects.

        Optional keyword arguments:
            amount (str | Decimal): Required when ``amount_mode="fixed"``.
            external_id (str): Your own reference ID (max 128 chars).
            redirect_url (str): HTTPS URL to redirect to after payment.
            expires_in (int): Seconds until expiry (300–86400).
            max_uses (int): Maximum number of times the link can be used.
            custom_message (str): Custom message shown on the checkout page.
            idempotency_key (str): Value for the ``Idempotency-Key`` header.

        Returns:
            Parsed ``PaymentLinkResponse`` dict from the API.

        Raises:
            LenisAuthError: On HTTP 401.
            LenisAPIError:  On any other non-2xx response.
        """
        idempotency_key: str | None = kwargs.pop("idempotency_key", None)

        extra_headers: dict[str, str] = {}
        if idempotency_key:
            extra_headers["Idempotency-Key"] = idempotency_key

        return self._http.request(
            "POST",
            "/v1/payment-links",
            json=kwargs,
            headers=extra_headers if extra_headers else None,
        )

    def retrieve(self, id: str) -> dict[str, Any]:
        """Retrieve a single payment link by ID.

        Args:
            id: The payment link's unique identifier.

        Returns:
            Parsed ``PaymentLinkResponse`` dict.

        Raises:
            LenisAuthError: On HTTP 401.
            LenisAPIError:  On any other non-2xx (including 404).
        """
        return self._http.request("GET", f"/v1/payment-links/{id}")

    def list(self, **filters: Any) -> dict[str, Any]:
        """List payment links, optionally filtered.

        Optional keyword arguments:
            limit (int): Maximum results per page (1–100).
            cursor (str): Pagination cursor from a previous response.

        Returns:
            Parsed ``ListResponse`` dict with ``data``, ``has_more``,
            ``next_cursor``, and ``total`` fields.

        Raises:
            LenisAuthError: On HTTP 401.
            LenisAPIError:  On any other non-2xx.
        """
        return self._http.request(
            "GET", "/v1/payment-links", params=filters if filters else None
        )
