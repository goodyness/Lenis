"""
Celery task for delivering webhook events to registered endpoints.

Implements signed HTTP POST delivery with exponential backoff retry, per-attempt
audit rows, and auto-disable logic after 3 consecutive bad calendar days.

Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 13.5
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from datetime import UTC, datetime
from typing import Optional

import requests

from celery import Task

from app.core.celery_app import celery_app

logger = logging.getLogger(__name__)

# Retry delays in seconds between consecutive delivery attempts.
# Indexed by (attempt - 1), so:
#   after attempt 1 → 5 s, attempt 2 → 30 s, attempt 3 → 300 s,
#   attempt 4 → 1800 s, attempt 5 → 7200 s.
RETRY_DELAYS = [5, 30, 300, 1800, 7200]

# Maximum total attempts (1 initial + 5 retries = 6)
MAX_ATTEMPTS = 6

# HTTP timeout in seconds for each delivery attempt
DELIVERY_TIMEOUT = 30

# Maximum bytes of the response body to store
MAX_RESPONSE_BODY_BYTES = 4096


# ---------------------------------------------------------------------------
# Helpers — run async code from a synchronous Celery worker
# ---------------------------------------------------------------------------

def _run_async(coro):
    """Run an async coroutine from a synchronous context (Celery worker)."""
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as executor:
            future = executor.submit(asyncio.run, coro)
            return future.result()
    else:
        return asyncio.run(coro)


async def _get_session():
    """Return a fresh async database session."""
    from app.core.db import AsyncSessionLocal  # local import to avoid circular deps
    return AsyncSessionLocal()


# ---------------------------------------------------------------------------
# Async helpers for DB operations
# ---------------------------------------------------------------------------

async def _load_event_and_endpoint(event_id: str, endpoint_id: str):
    """Load WebhookEvent and WebhookEndpoint from the database.

    Returns (event, endpoint) or (None, None) on error / not found.
    """
    from app.core.models import WebhookEndpoint, WebhookEvent
    from sqlalchemy import select

    async with await _get_session() as db:
        event_result = await db.execute(
            select(WebhookEvent).where(WebhookEvent.id == event_id)
        )
        event: Optional[WebhookEvent] = event_result.scalar_one_or_none()

        if event is None:
            logger.error("deliver_webhook: WebhookEvent %r not found — skipping", event_id)
            return None, None

        ep_uuid = uuid.UUID(endpoint_id) if isinstance(endpoint_id, str) else endpoint_id
        ep_result = await db.execute(
            select(WebhookEndpoint).where(WebhookEndpoint.id == ep_uuid)
        )
        endpoint: Optional[WebhookEndpoint] = ep_result.scalar_one_or_none()

        if endpoint is None:
            logger.error(
                "deliver_webhook: WebhookEndpoint %r not found — skipping", endpoint_id
            )
            return None, None

        # Decrypt the current secret for signing.  Failures here are surfaced
        # to the caller so the delivery can be skipped gracefully rather than
        # crashing the worker.
        from app.webhooks.crypto import decrypt_secret

        try:
            secret_plaintext = decrypt_secret(endpoint.secret)
        except Exception as exc:
            logger.error(
                "_load_event_and_endpoint: failed to decrypt secret for "
                "endpoint %r: %s — skipping delivery",
                endpoint_id,
                exc,
            )
            return None, None

        # Also capture rotation fields so the caller can dual-sign during the
        # transition window (Req 23.3, 23.4).
        previous_secret_ciphertext = getattr(endpoint, "previous_secret", None)
        previous_secret_expires_at = getattr(endpoint, "previous_secret_expires_at", None)

        # Return plain dicts to avoid detached-instance issues outside the session
        event_data = {
            "id": event.id,
            "payload": event.payload,
            "enabled": None,  # not on event
        }
        endpoint_data = {
            "id": str(endpoint.id),
            "url": endpoint.url,
            "secret": endpoint.secret,
            "secret_plaintext": secret_plaintext,
            "enabled": endpoint.enabled,
            "previous_secret": previous_secret_ciphertext,
            "previous_secret_expires_at": previous_secret_expires_at,
        }
        return event_data, endpoint_data


async def _record_delivery(
    endpoint_id: str,
    event_id: str,
    status_code: Optional[int],
    response_body: Optional[str],
    duration_ms: Optional[int],
    attempt_number: int,
    success: bool,
    delivered_at: Optional[datetime],
) -> None:
    """Insert a WebhookDelivery audit row."""
    from app.core.models import WebhookDelivery
    from sqlalchemy import select

    ep_uuid = uuid.UUID(endpoint_id) if isinstance(endpoint_id, str) else endpoint_id

    async with await _get_session() as db:
        delivery = WebhookDelivery(
            endpoint_id=ep_uuid,
            event_id=event_id,
            status_code=status_code,
            response_body=response_body,
            duration_ms=duration_ms,
            attempt_number=attempt_number,
            success=success,
            delivered_at=delivered_at,
        )
        db.add(delivery)
        await db.commit()


async def _update_event_status(event_id: str, status: str) -> None:
    """Update WebhookEvent.status to 'delivered' or 'failed'."""
    from app.core.models import WebhookEvent
    from sqlalchemy import select

    async with await _get_session() as db:
        result = await db.execute(
            select(WebhookEvent).where(WebhookEvent.id == event_id)
        )
        event: Optional[WebhookEvent] = result.scalar_one_or_none()
        if event is not None:
            event.status = status
            await db.commit()


async def _check_auto_disable(endpoint_id: str) -> None:
    """Delegate to the async auto-disable helper in service.py."""
    from app.webhooks.service import check_endpoint_auto_disable

    ep_uuid = uuid.UUID(endpoint_id) if isinstance(endpoint_id, str) else endpoint_id

    async with await _get_session() as db:
        await check_endpoint_auto_disable(ep_uuid, db)
        # check_endpoint_auto_disable calls db.flush(); commit here.
        await db.commit()


async def _clear_previous_secret(endpoint_id: str) -> None:
    """Null out previous_secret and previous_secret_expires_at once the
    rotation window has passed (Req 23.4)."""
    from app.core.models import WebhookEndpoint
    from sqlalchemy import select

    ep_uuid = uuid.UUID(endpoint_id) if isinstance(endpoint_id, str) else endpoint_id

    async with await _get_session() as db:
        result = await db.execute(
            select(WebhookEndpoint).where(WebhookEndpoint.id == ep_uuid)
        )
        endpoint: Optional[WebhookEndpoint] = result.scalar_one_or_none()
        if endpoint is not None:
            endpoint.previous_secret = None
            endpoint.previous_secret_expires_at = None
            await db.commit()


# ---------------------------------------------------------------------------
# Celery task
# ---------------------------------------------------------------------------

@celery_app.task(
    bind=True,
    name="app.webhooks.delivery.deliver_webhook",
    max_retries=5,
)
def deliver_webhook(
    self: Task,
    event_id: str,
    endpoint_id: str,
    attempt: int = 1,
) -> None:
    """Deliver a webhook event to a registered endpoint.

    Lifecycle
    ---------
    1. Load ``WebhookEvent`` and ``WebhookEndpoint`` from the database.
    2. Skip if ``endpoint.enabled`` is ``False`` — no ``WebhookDelivery`` row
       is created (Req 13.5).
    3. Serialize the event payload to JSON and compute the HMAC-SHA256
       signature header via ``build_signature_header``.
    4. HTTP POST to ``endpoint.url`` with a 30-second timeout.
    5. Record a ``WebhookDelivery`` row for the attempt (Req 12.4).
    6. On 2xx: set ``WebhookEvent.status = "delivered"`` (Req 12.5).
    7. On non-2xx / timeout: schedule a retry using ``RETRY_DELAYS[attempt-1]``
       if ``attempt < 6``; otherwise set ``WebhookEvent.status = "failed"``
       (Req 12.6).
    8. After each failed delivery call ``check_endpoint_auto_disable`` (Req 10.4).

    Args:
        event_id:    ``WebhookEvent.id`` (``"evt_"`` prefixed string).
        endpoint_id: ``WebhookEndpoint.id`` (UUID string).
        attempt:     Current attempt number (1-indexed); max 6.
    """
    logger.info(
        "deliver_webhook: event=%r endpoint=%r attempt=%d",
        event_id,
        endpoint_id,
        attempt,
    )

    # ------------------------------------------------------------------
    # Step 1 — Load event + endpoint
    # ------------------------------------------------------------------
    try:
        event_data, endpoint_data = _run_async(
            _load_event_and_endpoint(event_id, endpoint_id)
        )
    except Exception as exc:
        logger.error(
            "deliver_webhook: failed to load event/endpoint "
            "(event=%r endpoint=%r): %s",
            event_id,
            endpoint_id,
            exc,
        )
        return

    if event_data is None or endpoint_data is None:
        return

    # ------------------------------------------------------------------
    # Step 2 — Skip disabled endpoints (Req 13.5)
    # ------------------------------------------------------------------
    if not endpoint_data["enabled"]:
        logger.info(
            "deliver_webhook: endpoint %r is disabled — skipping delivery "
            "for event %r",
            endpoint_id,
            event_id,
        )
        return

    # ------------------------------------------------------------------
    # Step 3 — Build payload JSON + signature header
    # ------------------------------------------------------------------
    from app.webhooks.signing import build_signature_header

    try:
        payload_json = json.dumps(event_data["payload"], separators=(",", ":"))
        sig_header, _ts = build_signature_header(
            secret=endpoint_data["secret_plaintext"],
            payload_json=payload_json,
        )

        # Dual-signing during a secret rotation window (Req 23.3, 23.4).
        # If a previous (pre-rotation) secret still exists and hasn't expired,
        # append a second v1= component so consumers verifying with either key
        # can accept the delivery.
        prev_ciphertext = endpoint_data.get("previous_secret")
        prev_expires_at = endpoint_data.get("previous_secret_expires_at")

        if prev_ciphertext and prev_expires_at:
            # Check expiry — prev_expires_at may be a timezone-aware datetime
            now_utc = datetime.now(UTC)
            # Ensure comparison is timezone-aware
            if prev_expires_at.tzinfo is None:
                from datetime import timezone
                prev_expires_at = prev_expires_at.replace(tzinfo=timezone.utc)

            if prev_expires_at > now_utc:
                # Still within dual-signing window — sign with previous key too
                from app.webhooks.crypto import decrypt_secret
                try:
                    prev_secret_plaintext = decrypt_secret(prev_ciphertext)
                    prev_sig_header, _prev_ts = build_signature_header(
                        secret=prev_secret_plaintext,
                        payload_json=payload_json,
                    )
                    # Extract the v1= component and append to the primary header
                    # Format: "t=<ts>,v1=<sig>" → extract the v1=<sig> part
                    prev_v1_part = next(
                        (part for part in prev_sig_header.split(",") if part.startswith("v1=")),
                        None,
                    )
                    if prev_v1_part:
                        sig_header = f"{sig_header},{prev_v1_part}"
                except Exception as exc:
                    logger.warning(
                        "deliver_webhook: failed to sign with previous secret "
                        "for endpoint %r (rotation dual-sign): %s",
                        endpoint_id,
                        exc,
                    )
            else:
                # Rotation window has expired — clear previous_secret columns
                # (best-effort, non-blocking; failure just leaves stale data)
                try:
                    _run_async(_clear_previous_secret(endpoint_data["id"]))
                except Exception as exc:
                    logger.warning(
                        "deliver_webhook: failed to clear expired previous_secret "
                        "for endpoint %r: %s",
                        endpoint_id,
                        exc,
                    )

    except Exception as exc:
        logger.error(
            "deliver_webhook: failed to build signature header "
            "(event=%r endpoint=%r): %s",
            event_id,
            endpoint_id,
            exc,
        )
        return

    # ------------------------------------------------------------------
    # Step 4 — HTTP POST to endpoint URL
    # ------------------------------------------------------------------
    status_code: Optional[int] = None
    response_body: Optional[str] = None
    duration_ms: Optional[int] = None
    success: bool = False
    delivered_at: Optional[datetime] = None

    start_time = time.monotonic()
    try:
        response = requests.post(
            url=endpoint_data["url"],
            data=payload_json.encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "X-Lenis-Signature": sig_header,
                "X-Lenis-Event": str(event_data["payload"].get("type", "")),
                "User-Agent": "Lenis-Webhooks/1.0",
            },
            timeout=DELIVERY_TIMEOUT,
        )
        elapsed = time.monotonic() - start_time
        duration_ms = int(elapsed * 1000)
        status_code = response.status_code

        # Store only the first 4096 bytes of the response body (Req 12.4)
        raw_body = response.content[:MAX_RESPONSE_BODY_BYTES]
        try:
            response_body = raw_body.decode("utf-8", errors="replace")
        except Exception:
            response_body = None

        # 2xx → success (Req 12.5)
        if 200 <= status_code < 300:
            success = True
            delivered_at = datetime.now(UTC)

    except requests.exceptions.Timeout:
        elapsed = time.monotonic() - start_time
        duration_ms = int(elapsed * 1000)
        logger.warning(
            "deliver_webhook: timeout after %.1fs (event=%r endpoint=%r attempt=%d)",
            elapsed,
            event_id,
            endpoint_id,
            attempt,
        )
    except requests.exceptions.RequestException as exc:
        elapsed = time.monotonic() - start_time
        duration_ms = int(elapsed * 1000)
        logger.warning(
            "deliver_webhook: request error (event=%r endpoint=%r attempt=%d): %s",
            event_id,
            endpoint_id,
            attempt,
            exc,
        )

    # ------------------------------------------------------------------
    # Step 5 — Record WebhookDelivery row (Req 12.4)
    # ------------------------------------------------------------------
    try:
        _run_async(
            _record_delivery(
                endpoint_id=endpoint_id,
                event_id=event_id,
                status_code=status_code,
                response_body=response_body,
                duration_ms=duration_ms,
                attempt_number=attempt,
                success=success,
                delivered_at=delivered_at,
            )
        )
    except Exception as exc:
        logger.error(
            "deliver_webhook: failed to record WebhookDelivery "
            "(event=%r endpoint=%r attempt=%d): %s",
            event_id,
            endpoint_id,
            attempt,
            exc,
        )

    # ------------------------------------------------------------------
    # Step 6 — On success: update event status to "delivered" (Req 12.5)
    # ------------------------------------------------------------------
    if success:
        try:
            _run_async(_update_event_status(event_id, "delivered"))
        except Exception as exc:
            logger.error(
                "deliver_webhook: failed to update event status to 'delivered' "
                "(event=%r): %s",
                event_id,
                exc,
            )
        logger.info(
            "deliver_webhook: successfully delivered event=%r to endpoint=%r "
            "(attempt=%d, status=%d, duration=%dms)",
            event_id,
            endpoint_id,
            attempt,
            status_code,
            duration_ms or 0,
        )
        return

    # ------------------------------------------------------------------
    # Step 7 — On failure: retry or mark event as failed (Req 12.2, 12.6)
    # ------------------------------------------------------------------
    logger.warning(
        "deliver_webhook: delivery failed (event=%r endpoint=%r attempt=%d "
        "status=%s)",
        event_id,
        endpoint_id,
        attempt,
        status_code,
    )

    if attempt < MAX_ATTEMPTS:
        # Schedule the next retry
        countdown = RETRY_DELAYS[attempt - 1]
        logger.info(
            "deliver_webhook: scheduling retry attempt=%d in %ds "
            "(event=%r endpoint=%r)",
            attempt + 1,
            countdown,
            event_id,
            endpoint_id,
        )
        celery_app.send_task(
            "app.webhooks.delivery.deliver_webhook",
            args=[event_id, endpoint_id],
            kwargs={"attempt": attempt + 1},
            countdown=countdown,
        )
    else:
        # All 6 attempts exhausted — mark event as failed (Req 12.6)
        logger.error(
            "deliver_webhook: all %d attempts exhausted, marking event "
            "%r as failed",
            MAX_ATTEMPTS,
            event_id,
        )
        try:
            _run_async(_update_event_status(event_id, "failed"))
        except Exception as exc:
            logger.error(
                "deliver_webhook: failed to update event status to 'failed' "
                "(event=%r): %s",
                event_id,
                exc,
            )

    # ------------------------------------------------------------------
    # Step 8 — Always run auto-disable check after a failed delivery (Req 10.4)
    # ------------------------------------------------------------------
    try:
        _run_async(_check_auto_disable(endpoint_id))
    except Exception as exc:
        logger.error(
            "deliver_webhook: check_endpoint_auto_disable failed "
            "(endpoint=%r): %s",
            endpoint_id,
            exc,
        )
