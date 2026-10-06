"""
lenis-python — Official Python SDK for the Lenis Developer API.

Exposes:
    LenisClient       — main entry point
    LenisAuthError    — raised on HTTP 401 or missing API key
    LenisAPIError     — raised on any other non-2xx response
    LenisWebhookSignatureError — raised on HMAC verification failure
"""

from lenis.client import LenisClient
from lenis.exceptions import LenisAPIError, LenisAuthError, LenisWebhookSignatureError
from lenis.resources.payments import PaymentsResource
from lenis.resources.payment_links import PaymentLinksResource
from lenis.resources.webhooks import WebhooksResource

__all__ = [
    "LenisClient",
    "LenisAuthError",
    "LenisAPIError",
    "LenisWebhookSignatureError",
    "PaymentsResource",
    "PaymentLinksResource",
    "WebhooksResource",
]

__version__ = "0.1.0"
