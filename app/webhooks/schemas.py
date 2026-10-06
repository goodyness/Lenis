"""
Pydantic schemas for the webhook subsystem.

Covers endpoint registration/response, event envelope, event/delivery responses,
and the test-delivery response.  All response models use ``from_attributes=True``
for seamless ORM → schema conversion.

Requirements: 9.1, 9.3, 11.1, 11.4
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, field_validator, model_validator


# ---------------------------------------------------------------------------
# Supported event types (Requirement 11.1)
# ---------------------------------------------------------------------------

SUPPORTED_EVENT_TYPES: frozenset[str] = frozenset(
    {
        "payment.created",
        "payment.detected",
        "payment.confirming",
        "payment.confirmed",
        "payment.expired",
        "payment.underpaid",
        "payment.link.created",
        "payment.link.deactivated",
    }
)


# ---------------------------------------------------------------------------
# Webhook endpoint schemas
# ---------------------------------------------------------------------------


class WebhookEndpointCreate(BaseModel):
    """Request body for ``POST /v1/webhooks``.

    Validates that ``url`` is HTTPS and that every entry in ``events`` is a
    recognized event type.  Unrecognized event types are collected so the
    caller can return a detailed 422 payload listing all bad values.

    Requirements: 9.1, 9.3
    """

    url: str
    events: list[str]

    @field_validator("url")
    @classmethod
    def url_must_be_https(cls, v: str) -> str:
        if not v.startswith("https://"):
            raise ValueError("url must be an HTTPS URL (must start with 'https://').")
        return v

    @field_validator("events")
    @classmethod
    def events_must_be_non_empty(cls, v: list[str]) -> list[str]:
        if not v:
            raise ValueError("events must be a non-empty list.")
        return v

    @model_validator(mode="after")
    def validate_event_types(self) -> "WebhookEndpointCreate":
        """Collect unrecognized event types so the router can surface them."""
        unrecognized = [e for e in self.events if e not in SUPPORTED_EVENT_TYPES]
        if unrecognized:
            # Raise a ValueError that encodes the unrecognized list; the router
            # should catch this and return the structured 422 body described in
            # Requirement 9.3.
            raise ValueError(
                f"unrecognized_event_types:{','.join(unrecognized)}"
            )
        return self


class WebhookEndpointResponse(BaseModel):
    """Response model for a registered webhook endpoint.

    The ``secret`` field is intentionally excluded — it is returned only once,
    at creation time, via a dedicated creation response schema built in the
    router by extending this model with the plaintext secret.

    Requirement: 9.1
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    organization_id: uuid.UUID
    url: str
    events: list[str]
    enabled: bool
    disabled_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime


# ---------------------------------------------------------------------------
# Canonical event envelope (Requirement 11.4)
# ---------------------------------------------------------------------------


class WebhookEventEnvelope(BaseModel):
    """The canonical shape of every outbound webhook event payload.

    Mirrors the documented event object::

        {
          "id":       "evt_<32-char-hex>",
          "type":     "<event_type>",
          "created":  <unix_timestamp_integer>,
          "livemode": <boolean>,
          "data":     {}
        }

    Requirement: 11.4
    """

    id: str
    type: str
    created: int  # Unix timestamp
    livemode: bool
    data: dict[str, Any]


# ---------------------------------------------------------------------------
# Webhook event response (stored WebhookEvent records)
# ---------------------------------------------------------------------------


class WebhookEventResponse(BaseModel):
    """Response model for a persisted ``WebhookEvent`` record."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    organization_id: uuid.UUID
    type: str
    payload: dict[str, Any]
    livemode: bool
    status: str
    created_at: datetime


# ---------------------------------------------------------------------------
# Webhook delivery response (stored WebhookDelivery records)
# ---------------------------------------------------------------------------


class WebhookDeliveryResponse(BaseModel):
    """Response model for a single ``WebhookDelivery`` attempt record."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    endpoint_id: uuid.UUID
    event_id: str
    status_code: Optional[int] = None
    response_body: Optional[str] = None
    duration_ms: Optional[int] = None
    attempt_number: int
    success: bool
    delivered_at: Optional[datetime] = None
    created_at: datetime


# ---------------------------------------------------------------------------
# Webhook test delivery response
# ---------------------------------------------------------------------------


class WebhookTestResponse(BaseModel):
    """Response body for ``POST /v1/webhooks/{id}/test``.

    Reports the outcome of a synthetic test delivery.
    """

    success: bool
    status_code: Optional[int] = None
    duration_ms: int
