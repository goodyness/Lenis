"""
FastAPI router for the Webhook subsystem.

Registers all webhook management and delivery endpoints under the ``/v1``
prefix applied in ``app/main.py`` via ``_include_router_if_available``.

All endpoints require a valid API key authenticated via ``get_api_key_org``
from ``app/developer/auth.py``.

Routes:
    POST   /v1/webhooks                          — Register webhook endpoint (9.1)
    GET    /v1/webhooks                          — List webhook endpoints (9.4)
    DELETE /v1/webhooks/{endpoint_id}            — Delete webhook endpoint (9.5, 9.6)
    GET    /v1/webhooks/{endpoint_id}/deliveries — List delivery attempts (9.7)
    POST   /v1/webhooks/{endpoint_id}/test       — Fire synthetic test delivery (9.8)

Requirements: 9.1–9.9, 20.1–20.5
"""
from __future__ import annotations

import json
import secrets
import time
import uuid
from datetime import UTC, datetime
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.models import WebhookDelivery, WebhookEndpoint
from app.developer.auth import get_api_key_org
from app.webhooks import service as webhook_service
from app.webhooks.schemas import (
    WebhookDeliveryResponse,
    WebhookEndpointCreate,
    WebhookEndpointResponse,
    WebhookEventResponse,
    WebhookTestResponse,
)
from app.webhooks.signing import build_signature_header
from sqlalchemy import select

router = APIRouter()


# ---------------------------------------------------------------------------
# Helper: X-Request-ID injection
# ---------------------------------------------------------------------------


def _with_request_id(response: Response) -> Response:
    """Inject a unique X-Request-ID header into a response."""
    response.headers["X-Request-ID"] = str(uuid.uuid4())
    return response


# ---------------------------------------------------------------------------
# POST /v1/webhooks — Create webhook endpoint
# ---------------------------------------------------------------------------


class WebhookEndpointCreateResponse(WebhookEndpointResponse):
    """Extended response returned ONLY at creation time; includes the plaintext secret.

    The secret is never included in list responses (WebhookEndpointResponse omits it).
    Requirement: 9.1
    """

    secret: str


@router.post(
    "/v1/webhooks",
    response_model=WebhookEndpointCreateResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a webhook endpoint",
    description=(
        "Creates a new webhook endpoint for the authenticated organization. "
        "The secret is returned exactly once in this response and never again. "
        "Requirements: 9.1, 9.2, 9.3, 9.9"
    ),
)
async def create_webhook_endpoint(
    data: WebhookEndpointCreate,
    request: Request,
    response: Response,
    auth: tuple = Depends(get_api_key_org),
    db: AsyncSession = Depends(get_db),
) -> WebhookEndpointCreateResponse:
    """Register a new webhook endpoint and return the secret once."""
    organization, user, api_key_id = auth

    endpoint, secret = await webhook_service.create_webhook_endpoint(
        org_id=organization.id,
        url=data.url,
        events=data.events,
        db=db,
    )

    response.headers["X-Request-ID"] = str(uuid.uuid4())

    return WebhookEndpointCreateResponse(
        id=endpoint.id,
        organization_id=endpoint.organization_id,
        url=endpoint.url,
        events=endpoint.events,
        enabled=endpoint.enabled,
        disabled_at=endpoint.disabled_at,
        created_at=endpoint.created_at,
        updated_at=endpoint.updated_at,
        secret=secret,
    )


# ---------------------------------------------------------------------------
# GET /v1/webhooks — List webhook endpoints
# ---------------------------------------------------------------------------


@router.get(
    "/v1/webhooks",
    response_model=list[WebhookEndpointResponse],
    status_code=status.HTTP_200_OK,
    summary="List webhook endpoints",
    description=(
        "Returns all webhook endpoints for the authenticated organization. "
        "The secret field is excluded from all entries. "
        "Requirement: 9.4"
    ),
)
async def list_webhook_endpoints(
    request: Request,
    response: Response,
    auth: tuple = Depends(get_api_key_org),
    db: AsyncSession = Depends(get_db),
) -> list[WebhookEndpointResponse]:
    """Return all webhook endpoints for the organization (no secret)."""
    organization, user, api_key_id = auth

    endpoints = await webhook_service.list_webhook_endpoints(
        org_id=organization.id,
        db=db,
    )

    response.headers["X-Request-ID"] = str(uuid.uuid4())

    return [
        WebhookEndpointResponse.model_validate(ep)
        for ep in endpoints
    ]


# ---------------------------------------------------------------------------
# DELETE /v1/webhooks/{endpoint_id} — Delete webhook endpoint
# ---------------------------------------------------------------------------


@router.delete(
    "/v1/webhooks/{endpoint_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Delete a webhook endpoint",
    description=(
        "Deletes the webhook endpoint. Returns HTTP 404 if it does not belong "
        "to the authenticated organization. "
        "Requirements: 9.5, 9.6"
    ),
)
async def delete_webhook_endpoint(
    endpoint_id: uuid.UUID,
    request: Request,
    response: Response,
    auth: tuple = Depends(get_api_key_org),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Delete a webhook endpoint owned by the organization."""
    organization, user, api_key_id = auth

    await webhook_service.delete_webhook_endpoint(
        org_id=organization.id,
        endpoint_id=endpoint_id,
        db=db,
    )

    return Response(
        status_code=status.HTTP_204_NO_CONTENT,
        headers={"X-Request-ID": str(uuid.uuid4())},
    )


# ---------------------------------------------------------------------------
# POST /v1/webhooks/{endpoint_id}/rotate-secret — Rotate webhook secret
# ---------------------------------------------------------------------------


@router.post(
    "/v1/webhooks/{endpoint_id}/rotate-secret",
    response_model=dict,
    status_code=status.HTTP_200_OK,
    summary="Rotate a webhook endpoint secret",
    description=(
        "Generates a new secret for the webhook endpoint and stores the old secret "
        "for a 24-hour dual-signing window so in-flight deliveries can still be "
        "verified. The new plaintext secret is returned exactly once in this response. "
        "Returns 409 if a rotation is already in progress. "
        "Requirements: 23.1, 23.2, 23.5, 23.6"
    ),
)
async def rotate_webhook_secret(
    endpoint_id: uuid.UUID,
    request: Request,
    response: Response,
    auth: tuple = Depends(get_api_key_org),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Rotate the signing secret for a webhook endpoint.

    The old secret remains valid for 24 hours to cover in-flight deliveries
    (dual-signing window). The new plaintext secret is shown once and never
    stored in plaintext.
    """
    organization, user, api_key_id = auth

    result = await webhook_service.rotate_webhook_secret(
        org_id=organization.id,
        endpoint_id=endpoint_id,
        db=db,
    )

    response.headers["X-Request-ID"] = str(uuid.uuid4())
    return result


# ---------------------------------------------------------------------------
# GET /v1/webhooks/{endpoint_id}/deliveries — List delivery attempts
# ---------------------------------------------------------------------------


@router.get(
    "/v1/webhooks/{endpoint_id}/deliveries",
    response_model=dict,
    status_code=status.HTTP_200_OK,
    summary="List delivery attempts for a webhook endpoint",
    description=(
        "Returns a paginated list of delivery attempts for the endpoint. "
        "Supports ``page`` (default 1) and ``page_size`` (default 20, max 100) "
        "query parameters. "
        "Requirement: 9.7"
    ),
)
async def list_webhook_deliveries(
    endpoint_id: uuid.UUID,
    request: Request,
    response: Response,
    page: int = 1,
    page_size: int = 20,
    auth: tuple = Depends(get_api_key_org),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Return paginated delivery attempts for a webhook endpoint."""
    organization, user, api_key_id = auth

    # Clamp page_size to 100
    page_size = min(page_size, 100)
    if page < 1:
        page = 1

    deliveries, total = await webhook_service.list_webhook_deliveries(
        org_id=organization.id,
        endpoint_id=endpoint_id,
        page=page,
        page_size=page_size,
        db=db,
    )

    response.headers["X-Request-ID"] = str(uuid.uuid4())

    data = [WebhookDeliveryResponse.model_validate(d) for d in deliveries]
    has_more = (page * page_size) < total

    return {
        "data": [d.model_dump() for d in data],
        "total": total,
        "page": page,
        "page_size": page_size,
        "has_more": has_more,
    }


# ---------------------------------------------------------------------------
# POST /v1/webhooks/{endpoint_id}/test — Fire synthetic test delivery
# ---------------------------------------------------------------------------


@router.post(
    "/v1/webhooks/{endpoint_id}/test",
    response_model=WebhookTestResponse,
    status_code=status.HTTP_200_OK,
    summary="Fire a synthetic test delivery to a webhook endpoint",
    description=(
        "Constructs a synthetic ``payment.confirmed`` event with id prefixed "
        "``evt_test_``, signs it with the endpoint secret, delivers it "
        "synchronously with a 30-second timeout, records a WebhookDelivery row "
        "with attempt_number=0, and returns the delivery result. "
        "Never propagates 5xx even on delivery failure. "
        "Requirements: 9.8, 20.1–20.5"
    ),
)
async def test_webhook_endpoint(
    endpoint_id: uuid.UUID,
    request: Request,
    response: Response,
    auth: tuple = Depends(get_api_key_org),
    db: AsyncSession = Depends(get_db),
) -> WebhookTestResponse:
    """Fire a synthetic test delivery to the endpoint and record the result."""
    organization, user, api_key_id = auth

    # ----------------------------------------------------------------
    # Look up the endpoint — verify ownership
    # ----------------------------------------------------------------
    ep_result = await db.execute(
        select(WebhookEndpoint).where(
            WebhookEndpoint.id == endpoint_id,
            WebhookEndpoint.organization_id == organization.id,
        )
    )
    endpoint: Optional[WebhookEndpoint] = ep_result.scalar_one_or_none()
    if endpoint is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "webhook_not_found"},
        )

    # ----------------------------------------------------------------
    # Determine livemode from request state (set by auth middleware)
    # ----------------------------------------------------------------
    test_mode: bool = getattr(request.state, "test_mode", False)
    livemode: bool = not test_mode

    # ----------------------------------------------------------------
    # Construct a synthetic payment.confirmed event
    # ----------------------------------------------------------------
    test_event_id = "evt_test_" + secrets.token_hex(14)
    now_ts = int(time.time())

    synthetic_payload: dict[str, Any] = {
        "id": test_event_id,
        "type": "payment.confirmed",
        "created": now_ts,
        "livemode": livemode,
        "data": {
            "payment_id": "pay_test_" + secrets.token_hex(8),
            "status": "confirmed",
            "amount": "10.00",
            "token_symbol": "USDT",
            "network": "ethereum",
            "is_test": test_mode,
            "note": "This is a synthetic test event.",
        },
    }

    payload_json: str = json.dumps(synthetic_payload, separators=(",", ":"))

    # ----------------------------------------------------------------
    # Sign the payload with the endpoint secret
    # ----------------------------------------------------------------
    sig_header, _ts = build_signature_header(
        secret=endpoint.secret,
        payload_json=payload_json,
    )

    # ----------------------------------------------------------------
    # Deliver synchronously with 30-second timeout
    # ----------------------------------------------------------------
    success: bool = False
    http_status_code: Optional[int] = None
    response_body_text: Optional[str] = None
    duration_ms: int = 0
    start_time = time.monotonic()

    try:
        with httpx.Client(timeout=30.0) as client:
            http_response = client.post(
                endpoint.url,
                content=payload_json.encode("utf-8"),
                headers={
                    "Content-Type": "application/json",
                    "X-Lenis-Signature": sig_header,
                    "X-Lenis-Event": "payment.confirmed",
                    "User-Agent": "Lenis-Webhooks/1.0",
                },
            )
        elapsed_ms = int((time.monotonic() - start_time) * 1000)
        duration_ms = elapsed_ms
        http_status_code = http_response.status_code
        response_body_text = http_response.text[:4096] if http_response.text else None
        success = 200 <= http_response.status_code < 300

    except Exception:  # noqa: BLE001 — never propagate 5xx
        elapsed_ms = int((time.monotonic() - start_time) * 1000)
        duration_ms = elapsed_ms
        success = False

    # ----------------------------------------------------------------
    # Record WebhookDelivery with attempt_number=0 (test delivery)
    # ----------------------------------------------------------------
    try:
        delivery = WebhookDelivery(
            endpoint_id=endpoint.id,
            event_id=test_event_id,
            status_code=http_status_code,
            response_body=response_body_text,
            duration_ms=duration_ms,
            attempt_number=0,  # distinguishes test deliveries from real ones
            success=success,
            delivered_at=datetime.now(UTC) if success else None,
        )
        db.add(delivery)
        await db.flush()
    except Exception:  # noqa: BLE001 — recording failure should not block response
        pass

    response.headers["X-Request-ID"] = str(uuid.uuid4())

    return WebhookTestResponse(
        success=success,
        status_code=http_status_code,
        duration_ms=duration_ms,
    )


# ---------------------------------------------------------------------------
# POST /v1/webhooks/events/{event_id}/replay — Replay a webhook event
# ---------------------------------------------------------------------------


@router.post(
    "/v1/webhooks/events/{event_id}/replay",
    response_model=dict,
    status_code=status.HTTP_200_OK,
    summary="Replay a webhook event",
    description=(
        "Resets the event status to 'pending' and re-enqueues it for delivery "
        "to all currently enabled, subscribed endpoints. "
        "Returns 404 if the event does not belong to the authenticated org. "
        "Returns 422 if the event has already been successfully delivered. "
        "Requirements: 14.1, 14.2, 14.3, 14.4"
    ),
)
async def replay_webhook_event(
    event_id: str,
    request: Request,
    response: Response,
    auth: tuple = Depends(get_api_key_org),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Replay a specific webhook event for the authenticated organization."""
    organization, user, api_key_id = auth

    result = await webhook_service.replay_webhook_event(
        event_id=event_id,
        org_id=organization.id,
        db=db,
    )

    response.headers["X-Request-ID"] = str(uuid.uuid4())
    return result


# ---------------------------------------------------------------------------
# GET /v1/webhooks/events — List webhook events (cursor-paginated)
# ---------------------------------------------------------------------------


@router.get(
    "/v1/webhooks/events",
    response_model=dict,
    status_code=status.HTTP_200_OK,
    summary="List webhook events",
    description=(
        "Returns a cursor-paginated list of webhook events for the authenticated "
        "organization, ordered newest-first. Supports optional 'status', 'type', "
        "'cursor' (ISO 8601 created_at of last item from previous page), and "
        "'limit' (default 20) query parameters. "
        "Requirement: 14.5"
    ),
)
async def list_webhook_events(
    request: Request,
    response: Response,
    status_filter: Optional[str] = None,
    type: Optional[str] = None,
    cursor: Optional[str] = None,
    limit: int = 20,
    auth: tuple = Depends(get_api_key_org),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Return a cursor-paginated list of webhook events for the organization."""
    organization, user, api_key_id = auth

    # Clamp limit to a sensible maximum.
    limit = min(max(limit, 1), 100)

    events, next_cursor = await webhook_service.list_webhook_events(
        org_id=organization.id,
        status=status_filter,
        type=type,
        cursor=cursor,
        limit=limit,
        db=db,
    )

    response.headers["X-Request-ID"] = str(uuid.uuid4())

    data = [WebhookEventResponse.model_validate(ev) for ev in events]

    return {
        "data": [ev.model_dump() for ev in data],
        "next_cursor": next_cursor,
    }
