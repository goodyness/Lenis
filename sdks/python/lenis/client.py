"""
lenis.client — LenisClient: the main entry point for the Lenis Python SDK.

Usage::

    from lenis import LenisClient

    client = LenisClient(api_key="sk_live_...")
    payment = client.payments.create(
        amount="100.00",
        token_symbol="USDC",
        network="base",
        accepted_tokens=[{"token_symbol": "USDC", "network": "base"}],
    )

Raises LenisAuthError immediately if api_key is None or an empty string.
"""

from __future__ import annotations

from types import TracebackType
from typing import Optional, Type

from lenis._http import HttpClient
from lenis.exceptions import LenisAuthError
from lenis.resources.payment_links import PaymentLinksResource
from lenis.resources.payments import PaymentsResource
from lenis.resources.webhooks import WebhooksResource


class LenisClient:
    """Main entry point for the Lenis Python SDK.

    Instantiating with a ``None`` or empty ``api_key`` raises
    :class:`~lenis.exceptions.LenisAuthError` immediately, before any
    network request is made.

    Args:
        api_key:  Lenis secret key (``sk_test_*`` or ``sk_live_*``).
        base_url: Root URL for the Lenis API.
                  Defaults to ``https://api.lenis.io``.

    Attributes:
        payments:      :class:`~lenis.resources.payments.PaymentsResource`
        payment_links: :class:`~lenis.resources.payment_links.PaymentLinksResource`
        webhooks:      :class:`~lenis.resources.webhooks.WebhooksResource`

    Raises:
        LenisAuthError: If ``api_key`` is ``None`` or an empty string.
    """

    payments: PaymentsResource
    payment_links: PaymentLinksResource
    webhooks: WebhooksResource

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://api.lenis.io",
    ) -> None:
        if not api_key:
            raise LenisAuthError(
                status_code=0,
                error="api_key is required and cannot be empty.",
            )

        self._http = HttpClient(api_key=api_key, base_url=base_url)

        self.payments = PaymentsResource(self._http)
        self.payment_links = PaymentLinksResource(self._http)
        self.webhooks = WebhooksResource(self._http)

    # ------------------------------------------------------------------
    # Cleanup helpers
    # ------------------------------------------------------------------

    def close(self) -> None:
        """Close the underlying synchronous HTTP client."""
        self._http.close()

    async def async_close(self) -> None:
        """Close the underlying asynchronous HTTP client."""
        await self._http.async_close()

    # ------------------------------------------------------------------
    # Sync context-manager
    # ------------------------------------------------------------------

    def __enter__(self) -> "LenisClient":
        return self

    def __exit__(
        self,
        exc_type: Optional[Type[BaseException]],
        exc_val: Optional[BaseException],
        exc_tb: Optional[TracebackType],
    ) -> None:
        self.close()

    # ------------------------------------------------------------------
    # Async context-manager
    # ------------------------------------------------------------------

    async def __aenter__(self) -> "LenisClient":
        return self

    async def __aexit__(
        self,
        exc_type: Optional[Type[BaseException]],
        exc_val: Optional[BaseException],
        exc_tb: Optional[TracebackType],
    ) -> None:
        await self.async_close()
