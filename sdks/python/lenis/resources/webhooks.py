"""
lenis.resources.webhooks — WebhooksResource: webhook signature helpers.

Methods:
    construct_event(payload_bytes: bytes, sig_header: str, secret: str) -> dict
        Verify the X-Lenis-Signature header and return the parsed event dict.
        Delegates to lenis.signing.verify_signature.
        Raises LenisWebhookSignatureError on HMAC failure or timestamp drift.
"""

from __future__ import annotations

from typing import Any

from lenis._http import HttpClient
from lenis.exceptions import LenisWebhookSignatureError  # re-exported for convenience
from lenis.signing import verify_signature


class WebhooksResource:
    """Webhook signature verification helpers.

    This resource does **not** make HTTP requests — it is a stateless
    helper that verifies the ``X-Lenis-Signature`` header supplied on
    incoming webhook deliveries.

    Attributes:
        _http: Shared :class:`~lenis._http.HttpClient` instance (held for
               API consistency; not used by this resource).
    """

    def __init__(self, http: HttpClient) -> None:
        self._http = http

    def construct_event(
        self,
        payload_bytes: bytes,
        sig_header: str,
        secret: str,
    ) -> dict[str, Any]:
        """Verify a webhook delivery and return the parsed event dict.

        Call this method inside your webhook handler to verify that the
        request came from Lenis and to parse the event payload::

            @app.post("/webhook")
            async def handle_webhook(request: Request):
                payload = await request.body()
                sig = request.headers.get("X-Lenis-Signature", "")
                try:
                    event = client.webhooks.construct_event(
                        payload, sig, WEBHOOK_SECRET
                    )
                except LenisWebhookSignatureError as e:
                    return Response(status_code=400, content=str(e))

                # Process event["type"] …

        Args:
            payload_bytes: Raw request body bytes (do **not** parse before passing).
            sig_header:    Value of the ``X-Lenis-Signature`` HTTP header.
            secret:        The webhook endpoint's signing secret (from the
                           dashboard or ``client.webhooks.create()`` response).

        Returns:
            Parsed event dict, e.g.
            ``{"id": "evt_…", "type": "payment.confirmed", "data": {…}}``.

        Raises:
            LenisWebhookSignatureError: When the header is missing, malformed,
                the timestamp is outside the 5-minute tolerance window, or
                the HMAC does not match.
        """
        return verify_signature(payload_bytes, sig_header, secret)
