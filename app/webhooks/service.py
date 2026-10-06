"""
Webhook service layer for the Lenis platform.

Provides CRUD operations on WebhookEndpoint records, event emission, delivery
enqueueing, and the auto-disable logic that turns off endpoints with 3
consecutive bad delivery days.

Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.9, 10.4, 11.2, 11.3, 11.5, 11.6
"""
from __future__ import annotations

import logging
import secrets
import time
import uuid
from datetime import UTC, datetime, timedelta
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import WebhookDelivery, WebhookEndpoint, WebhookEvent
from app.webhooks.schemas import SUPPORTED_EVENT_TYPES

logger = logging.getLogger(__name__)

# Maximum number of active webhook endpoints per organisation (Requirement 9.9)
MAX_ENDPOINTS_PER_ORG = 20


# ---------------------------------------------------------------------------
# Endpoint management
# ---------------------------------------------------------------------------


async def create_webhook_endpoint(
    org_id: uuid.UUID,
    url: str,
    events: list[str],
    db: AsyncSession,
) -> tuple[WebhookEndpoint, str]:
    """Create a new webhook endpoint for an organisation.

    Validates:
    - ``url`` must start with ``https://``
    - every entry in ``events`` must be a recognised event type
    - the organisation must have fewer than 20 active endpoints

    Generates a 32-byte hex secret (64 hex chars) and stores it in plaintext
    on the record so the delivery task can use it for HMAC signing.  The full
    secret is returned **only at creation time** as the second tuple element;
    it is not included in subsequent list responses.

    Returns:
        (WebhookEndpoint ORM instance, plaintext_secret)

    Raises:
        HTTPException 422 — ``webhook_url_must_be_https``
        HTTPException 422 — ``unrecognized_event_types``
        HTTPException 422 — ``webhook_endpoint_limit_reached``
    """
    # Validate HTTPS
    if not url.startswith("https://"):
        raise HTTPException(
            status_code=422,
            detail={"error": "webhook_url_must_be_https"},
        )

    # Validate event types
    unrecognized = [e for e in events if e not in SUPPORTED_EVENT_TYPES]
    if unrecognized:
        raise HTTPException(
            status_code=422,
            detail={
                "error": "unrecognized_event_types",
                "unrecognized": unrecognized,
            },
        )

    # Enforce per-org limit
    count_result = await db.execute(
        select(func.count(WebhookEndpoint.id)).where(
            WebhookEndpoint.organization_id == org_id
        )
    )
    endpoint_count: int = count_result.scalar_one()
    if endpoint_count >= MAX_ENDPOINTS_PER_ORG:
        raise HTTPException(
            status_code=422,
            detail={"error": "webhook_endpoint_limit_reached"},
        )

    # Generate a 32-byte hex plaintext secret and encrypt it for storage.
    # The plaintext is returned to the caller for one-time display; only the
    # AES-256-GCM ciphertext is persisted. (Req 8.1, 8.3)
    from app.webhooks.crypto import encrypt_secret  # local import to avoid circular deps

    secret_plaintext = secrets.token_hex(32)  # 64 hex chars
    secret_ciphertext = encrypt_secret(secret_plaintext)

    endpoint = WebhookEndpoint(
        organization_id=org_id,
        url=url,
        secret=secret_ciphertext,
        events=events,
        enabled=True,
    )
    db.add(endpoint)
    await db.flush()

    return endpoint, secret_plaintext


async def list_webhook_endpoints(
    org_id: uuid.UUID,
    db: AsyncSession,
) -> list[WebhookEndpoint]:
    """Return all webhook endpoints for an organisation.

    The ``secret`` column is present on the returned ORM instances but the
    router's response schema (``WebhookEndpointResponse``) deliberately omits
    it so it is never serialised into list responses.

    Requirement: 9.4
    """
    result = await db.execute(
        select(WebhookEndpoint)
        .where(WebhookEndpoint.organization_id == org_id)
        .order_by(WebhookEndpoint.created_at.desc())
    )
    return list(result.scalars().all())


async def delete_webhook_endpoint(
    org_id: uuid.UUID,
    endpoint_id: uuid.UUID,
    db: AsyncSession,
) -> None:
    """Delete a webhook endpoint that belongs to the given organisation.

    Raises:
        HTTPException 404 — ``webhook_not_found`` if the endpoint does not
        exist or belongs to a different organisation.

    Requirement: 9.5, 9.6
    """
    result = await db.execute(
        select(WebhookEndpoint).where(
            WebhookEndpoint.id == endpoint_id,
            WebhookEndpoint.organization_id == org_id,
        )
    )
    endpoint: Optional[WebhookEndpoint] = result.scalar_one_or_none()
    if endpoint is None:
        raise HTTPException(
            status_code=404,
            detail={"error": "webhook_not_found"},
        )

    await db.delete(endpoint)
    await db.flush()


async def list_webhook_deliveries(
    org_id: uuid.UUID,
    endpoint_id: uuid.UUID,
    page: int,
    page_size: int,
    db: AsyncSession,
) -> tuple[list[WebhookDelivery], int]:
    """Return a paginated list of delivery attempts for an endpoint.

    Verifies that the endpoint belongs to the given organisation before
    returning any rows.

    Args:
        org_id:      owning organisation UUID
        endpoint_id: target endpoint UUID
        page:        1-based page index
        page_size:   maximum rows per page (clamped to 100 by the router)
        db:          async database session

    Returns:
        (list[WebhookDelivery], total_count)

    Raises:
        HTTPException 404 — ``webhook_not_found`` if the endpoint is absent or
        belongs to a different organisation.

    Requirement: 9.7
    """
    # Verify ownership
    ep_result = await db.execute(
        select(WebhookEndpoint).where(
            WebhookEndpoint.id == endpoint_id,
            WebhookEndpoint.organization_id == org_id,
        )
    )
    if ep_result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=404,
            detail={"error": "webhook_not_found"},
        )

    # Count total
    count_result = await db.execute(
        select(func.count(WebhookDelivery.id)).where(
            WebhookDelivery.endpoint_id == endpoint_id
        )
    )
    total: int = count_result.scalar_one()

    # Fetch page
    offset = (page - 1) * page_size
    rows_result = await db.execute(
        select(WebhookDelivery)
        .where(WebhookDelivery.endpoint_id == endpoint_id)
        .order_by(WebhookDelivery.created_at.desc())
        .offset(offset)
        .limit(page_size)
    )
    deliveries = list(rows_result.scalars().all())

    return deliveries, total


# ---------------------------------------------------------------------------
# Event emission
# ---------------------------------------------------------------------------


async def emit_webhook_event(
    db: AsyncSession,
    organization_id: uuid.UUID,
    event_type: str,
    payload_data: dict,
    livemode: bool,
) -> Optional[WebhookEvent]:
    """Create a ``WebhookEvent`` record and enqueue delivery to all active
    subscribed endpoints for the organisation.

    The event ``id`` uses the format ``"evt_" + secrets.token_hex(14)``
    which produces a 32-character string (4-char prefix + 28 hex chars).

    The full event envelope stored in ``WebhookEvent.payload`` follows the
    canonical shape:
    ::

        {
          "id":       "evt_<28-hex>",
          "type":     "<event_type>",
          "created":  <unix_timestamp_integer>,
          "livemode": <boolean>,
          "data":     { ...payload_data... }
        }

    On database error: logs the event type + org id and returns ``None``
    without attempting any delivery (Requirement 11.6).

    Delivery is enqueued via Celery's ``send_task`` using the fully-qualified
    task name so we avoid a circular import with ``app.webhooks.delivery``.

    Requirements: 9.2, 11.2, 11.3, 11.5, 11.6
    """
    event_id = "evt_" + secrets.token_hex(14)
    now_ts = int(time.time())

    envelope: dict = {
        "id": event_id,
        "type": event_type,
        "created": now_ts,
        "livemode": livemode,
        "data": payload_data,
    }

    try:
        event = WebhookEvent(
            id=event_id,
            organization_id=organization_id,
            type=event_type,
            payload=envelope,
            livemode=livemode,
            status="pending",
        )
        db.add(event)
        await db.flush()
    except Exception as exc:  # noqa: BLE001
        logger.error(
            "emit_webhook_event: failed to persist WebhookEvent "
            "(event_type=%r, org_id=%s): %s",
            event_type,
            organization_id,
            exc,
        )
        return None

    # Query active endpoints subscribed to this event type.
    # Fetch all enabled endpoints for the org, then filter in Python to avoid
    # cross-DB JSON containment syntax issues (Requirement 11.2).
    try:
        ep_result = await db.execute(
            select(WebhookEndpoint).where(
                WebhookEndpoint.organization_id == organization_id,
                WebhookEndpoint.enabled == True,  # noqa: E712
            )
        )
        endpoints: list[WebhookEndpoint] = list(ep_result.scalars().all())
    except Exception as exc:  # noqa: BLE001
        logger.error(
            "emit_webhook_event: failed to query WebhookEndpoints "
            "(event_type=%r, org_id=%s): %s",
            event_type,
            organization_id,
            exc,
        )
        return event

    # Enqueue delivery for each subscribed endpoint
    from app.core.celery_app import celery_app  # local import to avoid circular deps

    for endpoint in endpoints:
        subscribed_events: list[str] = endpoint.events or []
        if event_type not in subscribed_events:
            continue
        try:
            celery_app.send_task(
                "app.webhooks.delivery.deliver_webhook",
                args=[event_id, str(endpoint.id)],
            )
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "emit_webhook_event: failed to enqueue deliver_webhook "
                "(event_id=%r, endpoint_id=%s): %s",
                event_id,
                endpoint.id,
                exc,
            )

    return event


# ---------------------------------------------------------------------------
# Event replay and listing (Requirements 14.1–14.5)
# ---------------------------------------------------------------------------


async def replay_webhook_event(
    event_id: str,
    org_id: uuid.UUID,
    db: AsyncSession,
) -> dict:
    """Re-enqueue a non-delivered webhook event for delivery.

    Resets the event status to ``pending`` and dispatches delivery Celery tasks
    for all currently enabled endpoints that subscribe to the event type.

    Args:
        event_id: The ``evt_*`` string ID of the event to replay.
        org_id:   The calling organisation's UUID — used to verify ownership.
        db:       Async database session.

    Returns:
        ``{"event_id": event_id, "status": "pending", "enqueued_to": N}``

    Raises:
        HTTPException 404 — ``event_not_found`` if no matching event exists for
            the organisation.
        HTTPException 422 — ``event_already_delivered`` if the event has already
            been successfully delivered (prevents no-op replays).

    Requirements: 14.1, 14.2, 14.3, 14.4
    """
    # Fetch the event and verify ownership in one query.
    event_result = await db.execute(
        select(WebhookEvent).where(WebhookEvent.id == event_id)
    )
    event: Optional[WebhookEvent] = event_result.scalar_one_or_none()

    if event is None or event.organization_id != org_id:
        raise HTTPException(
            status_code=404,
            detail={"error": "event_not_found"},
        )

    if event.status == "delivered":
        raise HTTPException(
            status_code=422,
            detail={"error": "event_already_delivered"},
        )

    # Reset status to pending so delivery workers can pick it up again.
    event.status = "pending"
    await db.flush()

    # Query all enabled endpoints for the org that subscribe to this event type.
    # Filter in Python to avoid cross-database JSON containment syntax issues,
    # matching the existing pattern used in emit_webhook_event above.
    ep_result = await db.execute(
        select(WebhookEndpoint).where(
            WebhookEndpoint.organization_id == org_id,
            WebhookEndpoint.enabled == True,  # noqa: E712
        )
    )
    all_endpoints: list[WebhookEndpoint] = list(ep_result.scalars().all())
    subscribed_endpoints = [
        ep for ep in all_endpoints if event.type in (ep.events or [])
    ]

    # Enqueue delivery for each subscribed endpoint.
    from app.core.celery_app import celery_app  # local import to avoid circular deps

    for ep in subscribed_endpoints:
        try:
            celery_app.send_task(
                "app.webhooks.delivery.deliver_webhook",
                args=[event_id, str(ep.id)],
            )
        except Exception as exc:  # noqa: BLE001
            logger.error(
                "replay_webhook_event: failed to enqueue deliver_webhook "
                "(event_id=%r, endpoint_id=%s): %s",
                event_id,
                ep.id,
                exc,
            )

    return {
        "event_id": event_id,
        "status": "pending",
        "enqueued_to": len(subscribed_endpoints),
    }


async def list_webhook_events(
    org_id: uuid.UUID,
    status: Optional[str],
    type: Optional[str],
    cursor: Optional[str],
    limit: int,
    db: AsyncSession,
) -> tuple[list[WebhookEvent], Optional[str]]:
    """Return a cursor-paginated list of webhook events for an organisation.

    Results are ordered newest-first (``created_at DESC``).  The cursor is the
    ISO 8601 ``created_at`` timestamp of the **last item** returned in the
    previous page.  Passing the cursor in the next request returns events older
    than that timestamp.

    Args:
        org_id:  The organisation whose events to list.
        status:  Optional filter — ``"pending"``, ``"delivered"``, or ``"failed"``.
        type:    Optional filter — event type string, e.g. ``"payment.confirmed"``.
        cursor:  ISO 8601 string of the previous page's oldest item's ``created_at``.
        limit:   Maximum number of records to return (caller should clamp to ≤ 100).
        db:      Async database session.

    Returns:
        ``(events, next_cursor)`` where ``next_cursor`` is the ISO 8601 string of
        the last item's ``created_at`` when there may be more results, else ``None``.

    Requirement: 14.5
    """
    stmt = (
        select(WebhookEvent)
        .where(WebhookEvent.organization_id == org_id)
        .order_by(WebhookEvent.created_at.desc())
        .limit(limit)
    )

    if status is not None:
        stmt = stmt.where(WebhookEvent.status == status)

    if type is not None:
        stmt = stmt.where(WebhookEvent.type == type)

    if cursor is not None:
        # Parse the cursor timestamp and return only events older than it.
        try:
            from datetime import timezone
            cursor_dt = datetime.fromisoformat(cursor)
            # Ensure timezone-aware for comparison with tz-aware DB column.
            if cursor_dt.tzinfo is None:
                cursor_dt = cursor_dt.replace(tzinfo=timezone.utc)
            stmt = stmt.where(WebhookEvent.created_at < cursor_dt)
        except (ValueError, TypeError) as exc:
            logger.warning(
                "list_webhook_events: invalid cursor value %r: %s", cursor, exc
            )
            # Ignore malformed cursor and return from the beginning.

    rows_result = await db.execute(stmt)
    events: list[WebhookEvent] = list(rows_result.scalars().all())

    # Derive next_cursor from the last item's created_at only when we returned
    # a full page (suggesting more rows exist beyond the cursor).
    next_cursor: Optional[str] = None
    if len(events) == limit and events:
        last_created_at: datetime = events[-1].created_at
        # Emit as UTC ISO 8601 with explicit +00:00 suffix.
        if last_created_at.tzinfo is None:
            last_created_at = last_created_at.replace(tzinfo=timezone.utc)
        next_cursor = last_created_at.isoformat()

    return events, next_cursor


# ---------------------------------------------------------------------------
# Auto-disable logic
# ---------------------------------------------------------------------------


async def check_endpoint_auto_disable(
    endpoint_id: uuid.UUID,
    db: AsyncSession,
) -> None:
    """Disable a webhook endpoint if all deliveries over the last 3 calendar
    days have failed.

    Algorithm:
    1. Fetch all ``WebhookDelivery`` rows for the endpoint created within the
       last 3 calendar days (using ``datetime.now(UTC) - timedelta(days=3)``).
    2. Group rows by calendar date.
    3. A day is "bad" if every delivery row for that day has ``success=False``.
    4. If there are deliveries on **at least 3 distinct days** AND all such
       days are bad → set ``enabled=False`` and record ``disabled_at``.

    No exception is raised if the endpoint is already disabled or not found;
    this function is called defensively after each failed delivery.

    Requirement: 10.4
    """
    three_days_ago = datetime.now(UTC) - timedelta(days=3)

    # Fetch all deliveries in the window
    rows_result = await db.execute(
        select(WebhookDelivery).where(
            WebhookDelivery.endpoint_id == endpoint_id,
            WebhookDelivery.created_at >= three_days_ago,
        )
    )
    deliveries: list[WebhookDelivery] = list(rows_result.scalars().all())

    if not deliveries:
        return

    # Group by calendar day (date component only)
    days: dict[object, list[bool]] = {}
    for d in deliveries:
        day_key = d.created_at.date() if d.created_at else None
        if day_key is None:
            continue
        days.setdefault(day_key, []).append(d.success)

    if len(days) < 3:
        return

    # Check that every day in the window is a "bad" day
    all_bad = all(not any(successes) for successes in days.values())
    if not all_bad:
        return

    # Disable the endpoint
    ep_result = await db.execute(
        select(WebhookEndpoint).where(WebhookEndpoint.id == endpoint_id)
    )
    endpoint: Optional[WebhookEndpoint] = ep_result.scalar_one_or_none()
    if endpoint is None or not endpoint.enabled:
        return

    endpoint.enabled = False
    endpoint.disabled_at = datetime.now(UTC)
    await db.flush()

    logger.warning(
        "check_endpoint_auto_disable: endpoint %s has been automatically "
        "disabled after 3 consecutive calendar days of failed deliveries.",
        endpoint_id,
    )


# ---------------------------------------------------------------------------
# Webhook secret rotation (Requirements 23.1, 23.2, 23.5, 23.6)
# ---------------------------------------------------------------------------


async def rotate_webhook_secret(
    org_id: uuid.UUID,
    endpoint_id: uuid.UUID,
    db: AsyncSession,
) -> dict:
    """Rotate the secret for a webhook endpoint.

    Generates a new 32-byte hex secret, encrypts it, and stores it as the
    active secret.  The current secret is preserved in ``previous_secret`` with
    a 24-hour expiry so that in-flight deliveries (signed with the old key) can
    still be verified during the transition window.

    If a rotation is already in progress (``previous_secret_expires_at`` is in
    the future) the request is rejected so callers don't inadvertently
    overwrite an incomplete rotation.

    The new plaintext secret is returned exactly once in the response body and
    is never stored in the database.

    Args:
        org_id:      UUID of the calling organisation — used to verify ownership.
        endpoint_id: UUID of the ``WebhookEndpoint`` to rotate.
        db:          Async database session.

    Returns:
        ``{"new_secret": "<plaintext>", "expires_old_secret_at": "<ISO 8601>"}``

    Raises:
        HTTPException 404 — ``webhook_not_found`` if the endpoint does not
            exist or belongs to a different organisation.
        HTTPException 409 — ``rotation_already_in_progress`` if a previous
            rotation is still within its 24-hour dual-signing window.

    Requirements: 23.1, 23.2, 23.5, 23.6
    """
    # Load the endpoint and verify ownership.
    ep_result = await db.execute(
        select(WebhookEndpoint).where(
            WebhookEndpoint.id == endpoint_id,
            WebhookEndpoint.organization_id == org_id,
        )
    )
    endpoint: Optional[WebhookEndpoint] = ep_result.scalar_one_or_none()
    if endpoint is None:
        raise HTTPException(
            status_code=404,
            detail={"error": "webhook_not_found"},
        )

    # Reject if a rotation window is already active.
    now = datetime.now(UTC)
    if endpoint.previous_secret_expires_at is not None and endpoint.previous_secret_expires_at > now:
        raise HTTPException(
            status_code=409,
            detail={
                "error": "rotation_already_in_progress",
                "expires_at": endpoint.previous_secret_expires_at.isoformat(),
            },
        )

    # Generate the new plaintext secret and encrypt it for storage.
    from app.webhooks.crypto import encrypt_secret  # local import — avoids circular deps

    new_secret_plaintext = secrets.token_hex(32)  # 64-char hex string
    new_secret_ciphertext = encrypt_secret(new_secret_plaintext)

    # Shift current secret → previous_secret and set expiry to 24 hours.
    endpoint.previous_secret = endpoint.secret
    endpoint.previous_secret_expires_at = now + timedelta(hours=24)
    endpoint.secret = new_secret_ciphertext

    await db.flush()

    return {
        "new_secret": new_secret_plaintext,
        "expires_old_secret_at": endpoint.previous_secret_expires_at.isoformat(),
    }
