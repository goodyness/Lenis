"""
Developer API service layer.

Provides validation helpers and business-logic functions for the /v1/
endpoint handlers: create_payment_intent, get_payment, list_payments,
list_transactions, get_transaction, and the org-isolation filter builder.

Requirements: 5.1–5.11, 6.1–6.5, 8.1–8.4, 16.3, 16.4, 16.6
"""
from __future__ import annotations

import base64
import logging
import uuid
from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation
from typing import Optional

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.models import Organization, Payment, PaymentLink, User
from app.core.networks import NetworkConfig, TokenConfig, network_registry
from app.core.slugs import ensure_unique_slug
from app.developer.schemas import (
    AcceptedTokenEntry,
    ListResponse,
    PaymentIntentRequest,
    PaymentIntentResponse,
    PaymentLinkCreateRequest,
    PaymentLinkResponse,
)

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Known payment statuses (for filter validation)
# ---------------------------------------------------------------------------

_VALID_PAYMENT_STATUSES = frozenset(
    {
        "pending",
        "detected",
        "confirming",
        "confirmed",
        "paid",
        "expired",
        "abandoned",
        "failed",
        "underpaid",
    }
)

# ---------------------------------------------------------------------------
# Cursor helpers
# ---------------------------------------------------------------------------


def _encode_cursor(dt: datetime, row_id: uuid.UUID) -> str:
    """Encode a pagination cursor as base64url("{iso_datetime}:{id}")."""
    raw = f"{dt.isoformat()}:{row_id}"
    return base64.urlsafe_b64encode(raw.encode()).rstrip(b"=").decode()


def _decode_cursor(cursor: str) -> tuple[datetime, uuid.UUID]:
    """Decode a cursor back to (datetime, UUID). Raises HTTP 422 on invalid input."""
    try:
        # Restore stripped padding
        padding = (4 - len(cursor) % 4) % 4
        raw = base64.urlsafe_b64decode(cursor + "=" * padding).decode()
        ts_part, id_part = raw.rsplit(":", 1)
        dt = datetime.fromisoformat(ts_part)
        row_id = uuid.UUID(id_part)
        return dt, row_id
    except Exception:
        raise HTTPException(
            status_code=422,
            detail={"error": "invalid_cursor"},
        )


# ---------------------------------------------------------------------------
# Validation helpers (task 6.2)
# ---------------------------------------------------------------------------


def validate_amount(amount: Decimal) -> None:
    """Validate that amount is within 0.01–999,999,999.99 with at most 8 decimal places.

    Raises HTTP 422 {"error": "invalid_amount", "param": "amount"} on failure.
    """
    min_amount = Decimal("0.01")
    max_amount = Decimal("999999999.99")

    if amount < min_amount or amount > max_amount:
        raise HTTPException(
            status_code=422,
            detail={"error": "invalid_amount", "param": "amount"},
        )

    # Check decimal places: sign, digits, exponent
    sign, digits, exponent = amount.as_tuple()
    # exponent is negative for fractional amounts; e.g. Decimal("1.12345678")
    # has exponent=-8. We allow at most 8 decimal places.
    decimal_places = max(0, -exponent)
    if decimal_places > 8:
        raise HTTPException(
            status_code=422,
            detail={"error": "invalid_amount", "param": "amount"},
        )


def validate_network(network: str) -> NetworkConfig:
    """Look up the network in the registry by display_name or short identifier.

    Matches against:
    - Exact display_name (case-insensitive), e.g. "Ethereum Mainnet"
    - First word of display_name lowercase, e.g. "ethereum"
    - Exact match of network.lower() against display_name.lower()

    Raises HTTP 422 {"error": "unsupported_network"} if not found.
    Returns the matching NetworkConfig.
    """
    network_lower = network.lower().strip()
    for nc in network_registry.get_active_networks():
        dn_lower = nc.display_name.lower()
        dn_first_word = dn_lower.split()[0]
        if network_lower in (dn_lower, dn_first_word):
            return nc

    raise HTTPException(
        status_code=422,
        detail={"error": "unsupported_network"},
    )


def validate_token(network_config: NetworkConfig, token_symbol: str) -> TokenConfig:
    """Check that token_symbol exists in network_config.tokens.

    Raises HTTP 422 {"error": "unsupported_token"} if not found.
    Returns the matching TokenConfig.
    """
    for tc in network_config.tokens:
        if tc.symbol.upper() == token_symbol.upper():
            return tc

    raise HTTPException(
        status_code=422,
        detail={"error": "unsupported_token"},
    )


def validate_expires_in(expires_in: int) -> None:
    """Validate that expires_in is between 300 and 86400 seconds.

    Raises HTTP 422 {"error": "invalid_expires_in", "param": "expires_in"}.
    """
    if not (300 <= expires_in <= 86400):
        raise HTTPException(
            status_code=422,
            detail={"error": "invalid_expires_in", "param": "expires_in"},
        )


def validate_metadata(metadata: Optional[dict]) -> None:
    """Validate developer-supplied metadata dict.

    Rules:
    - At most 16 keys
    - Each key: max 64 characters
    - Each value (if a string): max 500 characters

    Raises HTTP 422 {"error": "invalid_metadata", "param": "metadata"} on failure.
    """
    if metadata is None:
        return

    if len(metadata) > 16:
        raise HTTPException(
            status_code=422,
            detail={"error": "invalid_metadata", "param": "metadata"},
        )

    for k, v in metadata.items():
        if len(str(k)) > 64:
            raise HTTPException(
                status_code=422,
                detail={"error": "invalid_metadata", "param": "metadata"},
            )
        if isinstance(v, str) and len(v) > 500:
            raise HTTPException(
                status_code=422,
                detail={"error": "invalid_metadata", "param": "metadata"},
            )


def build_org_payment_filter(org: Organization, test_mode: bool):
    """Return a SQLAlchemy WHERE clause tuple for org + mode isolation."""
    from sqlalchemy import and_

    return and_(
        Payment.organization_id == org.id,
        Payment.is_test == test_mode,
    )


# ---------------------------------------------------------------------------
# Helper: build PaymentIntentResponse dict from Payment + slug + extras
# ---------------------------------------------------------------------------


def _payment_to_response_dict(
    payment: Payment,
    checkout_url: str,
    expires_at: int,
) -> dict:
    """Build a dict compatible with PaymentIntentResponse."""
    return {
        "id": str(payment.id),
        "status": payment.status,
        "amount": payment.amount,
        "token_symbol": payment.token_symbol,
        "network": payment.network,
        "checkout_url": checkout_url,
        "created": int(payment.created_at.timestamp()),
        "expires_at": expires_at,
        "is_test": payment.is_test,
        "livemode": not payment.is_test,
        "fiat_amount_at_payment": getattr(payment, "fiat_amount_at_payment", None),
        "fiat_currency": getattr(payment, "fiat_currency", None),
    }


# ---------------------------------------------------------------------------
# Task 7.1 — create_payment_intent
# ---------------------------------------------------------------------------


async def create_payment_intent(
    org: Organization,
    user: User,
    test_mode: bool,
    data: PaymentIntentRequest,
    db: AsyncSession,
) -> PaymentIntentResponse:
    """Create a PaymentLink + Payment pair representing a payment intent.

    Steps:
    1. Validate amount, network, token, expires_in, metadata.
    2. Generate a unique slug for the PaymentLink.
    3. Create and flush PaymentLink + Payment.
    4. Emit payment.created webhook event.
    5. Return PaymentIntentResponse.

    Requirements: 5.1, 5.2, 5.6, 5.7, 5.8, 5.10, 5.11, 11.2
    """
    # ------------------------------------------------------------------
    # 1. Validate inputs
    # ------------------------------------------------------------------
    validate_amount(data.amount)
    validate_expires_in(data.expires_in)
    validate_metadata(data.metadata)

    # Network/token validation — we accept networks even if the registry is
    # empty in dev (no RPC URLs configured). If active networks are present
    # we enforce the token is supported.
    active_nets = network_registry.get_active_networks()
    token_config: Optional[TokenConfig] = None
    if active_nets:
        network_config = validate_network(data.network)
        token_config = validate_token(network_config, data.token_symbol)
    # If registry is empty (no RPC URLs configured), skip validation and
    # store whatever the caller supplied — callers in test environments need
    # to be able to create test-mode payments without a real node.

    # ------------------------------------------------------------------
    # 2. Generate unique slug
    # ------------------------------------------------------------------
    slug = await ensure_unique_slug(db)

    # ------------------------------------------------------------------
    # 3. Create PaymentLink
    # ------------------------------------------------------------------
    expires_at_dt = datetime.now(UTC) + timedelta(seconds=data.expires_in)

    payment_link = PaymentLink(
        merchant_id=user.id,
        title=f"Payment Intent {slug}",
        slug=slug,
        amount_mode="fixed",
        amount=data.amount,
        accepted_tokens=[e.model_dump() for e in data.accepted_tokens],
        status="active",
        is_test=test_mode,
        organization_id=org.id,
        redirect_url=data.redirect_url,
        expires_at=expires_at_dt,
    )
    db.add(payment_link)
    await db.flush()  # gives payment_link.id

    # ------------------------------------------------------------------
    # 4. Create Payment
    # ------------------------------------------------------------------
    contract_address: Optional[str] = (
        token_config.contract_address if token_config is not None else None
    )

    payment = Payment(
        payment_link_id=payment_link.id,
        network=data.network,
        token_symbol=data.token_symbol,
        contract_address=contract_address,
        # to_address is empty at creation — the indexer fills this in later.
        to_address="",
        payer_email=data.customer_email,
        amount=data.amount,
        status="pending",
        is_test=test_mode,
        organization_id=org.id,
        metadata_json=data.metadata,
    )
    db.add(payment)
    await db.flush()  # gives payment.id and payment.created_at

    # ------------------------------------------------------------------
    # 5. Build checkout_url
    # ------------------------------------------------------------------
    checkout_url = f"{settings.frontend_origin}/pay/{slug}"

    # ------------------------------------------------------------------
    # 6. Emit webhook event (non-fatal)
    # ------------------------------------------------------------------
    try:
        from app.webhooks.service import emit_webhook_event  # local to avoid circular

        payload_data = {
            "payment_id": str(payment.id),
            "amount": str(data.amount),
            "token_symbol": data.token_symbol,
            "network": data.network,
            "status": payment.status,
            "is_test": test_mode,
        }
        await emit_webhook_event(
            db=db,
            organization_id=org.id,
            event_type="payment.created",
            payload_data=payload_data,
            livemode=not test_mode,
        )
    except Exception as exc:
        logger.warning(
            "create_payment_intent: failed to emit payment.created webhook "
            "(payment_id=%s, org_id=%s): %s",
            payment.id,
            org.id,
            exc,
        )

    # ------------------------------------------------------------------
    # 7. Return response
    # ------------------------------------------------------------------
    return PaymentIntentResponse(
        id=str(payment.id),
        status=payment.status,
        amount=data.amount,
        token_symbol=data.token_symbol,
        network=data.network,
        checkout_url=checkout_url,
        created=int(payment.created_at.timestamp()),
        expires_at=int(expires_at_dt.timestamp()),
        is_test=test_mode,
        livemode=not test_mode,
    )


# ---------------------------------------------------------------------------
# Task 7.2 — get_payment
# ---------------------------------------------------------------------------


async def get_payment(
    org: Organization,
    payment_id: str,
    test_mode: bool,
    db: AsyncSession,
) -> PaymentIntentResponse:
    """Retrieve a single payment by ID, enforcing org + mode isolation.

    Requirements: 6.1, 16.3, 16.4
    """
    try:
        pid = uuid.UUID(payment_id)
    except ValueError:
        raise HTTPException(
            status_code=404,
            detail={"error": "payment_not_found"},
        )

    result = await db.execute(
        select(Payment)
        .where(
            Payment.id == pid,
            Payment.organization_id == org.id,
            Payment.is_test == test_mode,
        )
        .options(selectinload(Payment.payment_link))
    )
    payment: Optional[Payment] = result.scalar_one_or_none()

    if payment is None:
        raise HTTPException(
            status_code=404,
            detail={"error": "payment_not_found"},
        )

    checkout_url = _build_checkout_url(payment)
    expires_at = _get_expires_at(payment)

    return PaymentIntentResponse(
        **_payment_to_response_dict(payment, checkout_url, expires_at)
    )


# ---------------------------------------------------------------------------
# Task 7.2 — list_payments
# ---------------------------------------------------------------------------


async def list_payments(
    org: Organization,
    test_mode: bool,
    filters: dict,
    limit: int,
    cursor: Optional[str],
    db: AsyncSession,
) -> ListResponse:
    """List payments for an org, with optional filters and cursor pagination.

    Requirements: 6.2, 6.3, 6.4, 6.5, 16.3, 16.4, 16.6
    """
    limit = min(max(limit, 1), 100)

    stmt = (
        select(Payment)
        .where(
            Payment.organization_id == org.id,
            Payment.is_test == test_mode,
        )
        .options(selectinload(Payment.payment_link))
    )

    # ------------------------------------------------------------------
    # Apply optional filters
    # ------------------------------------------------------------------
    if filters.get("status"):
        status_val = filters["status"]
        if status_val not in _VALID_PAYMENT_STATUSES:
            raise HTTPException(
                status_code=422,
                detail={"error": "invalid_filter", "param": "status"},
            )
        stmt = stmt.where(Payment.status == status_val)

    if filters.get("network"):
        stmt = stmt.where(Payment.network == filters["network"])

    if filters.get("token_symbol"):
        stmt = stmt.where(Payment.token_symbol == filters["token_symbol"])

    if filters.get("created_after"):
        try:
            dt = datetime.fromisoformat(filters["created_after"])
        except (ValueError, TypeError):
            raise HTTPException(
                status_code=422,
                detail={"error": "invalid_filter", "param": "created_after"},
            )
        stmt = stmt.where(Payment.created_at >= dt)

    if filters.get("created_before"):
        try:
            dt = datetime.fromisoformat(filters["created_before"])
        except (ValueError, TypeError):
            raise HTTPException(
                status_code=422,
                detail={"error": "invalid_filter", "param": "created_before"},
            )
        stmt = stmt.where(Payment.created_at <= dt)

    # ------------------------------------------------------------------
    # Cursor-based pagination
    # ------------------------------------------------------------------
    if cursor:
        cursor_dt, cursor_id = _decode_cursor(cursor)
        stmt = stmt.where(
            (Payment.created_at < cursor_dt)
            | (
                (Payment.created_at == cursor_dt)
                & (Payment.id < cursor_id)
            )
        )

    stmt = stmt.order_by(Payment.created_at.desc(), Payment.id.desc())
    stmt = stmt.limit(limit + 1)

    result = await db.execute(stmt)
    rows: list[Payment] = list(result.scalars().all())

    has_more = len(rows) > limit
    if has_more:
        rows = rows[:limit]

    next_cursor: Optional[str] = None
    if has_more and rows:
        last = rows[-1]
        next_cursor = _encode_cursor(last.created_at, last.id)

    data = [
        PaymentIntentResponse(
            **_payment_to_response_dict(p, _build_checkout_url(p), _get_expires_at(p))
        )
        for p in rows
    ]

    return ListResponse(
        data=data,
        has_more=has_more,
        next_cursor=next_cursor,
        total=None,  # total count not computed for performance
    )


# ---------------------------------------------------------------------------
# Task 7.5 — get_transaction
# ---------------------------------------------------------------------------


async def get_transaction(
    org: Organization,
    transaction_id: str,
    test_mode: bool,
    db: AsyncSession,
) -> PaymentIntentResponse:
    """Retrieve a confirmed/paid payment as a transaction.

    Requirements: 8.1, 8.2
    """
    try:
        pid = uuid.UUID(transaction_id)
    except ValueError:
        raise HTTPException(
            status_code=404,
            detail={"error": "transaction_not_found"},
        )

    result = await db.execute(
        select(Payment)
        .where(
            Payment.id == pid,
            Payment.organization_id == org.id,
            Payment.is_test == test_mode,
            Payment.status.in_(("confirmed", "paid")),
        )
        .options(selectinload(Payment.payment_link))
    )
    payment: Optional[Payment] = result.scalar_one_or_none()

    if payment is None:
        raise HTTPException(
            status_code=404,
            detail={"error": "transaction_not_found"},
        )

    checkout_url = _build_checkout_url(payment)
    expires_at = _get_expires_at(payment)

    return PaymentIntentResponse(
        **_payment_to_response_dict(payment, checkout_url, expires_at)
    )


# ---------------------------------------------------------------------------
# Task 7.5 — list_transactions
# ---------------------------------------------------------------------------


async def list_transactions(
    org: Organization,
    test_mode: bool,
    filters: dict,
    limit: int,
    cursor: Optional[str],
    db: AsyncSession,
) -> ListResponse:
    """List confirmed/paid payments as transactions with cursor pagination.

    Requirements: 8.1, 8.2, 8.3, 8.4
    """
    limit = min(max(limit, 1), 100)

    stmt = (
        select(Payment)
        .where(
            Payment.organization_id == org.id,
            Payment.is_test == test_mode,
            Payment.status.in_(("confirmed", "paid")),
        )
        .options(selectinload(Payment.payment_link))
    )

    # ------------------------------------------------------------------
    # Apply optional filters
    # ------------------------------------------------------------------
    if filters.get("network"):
        stmt = stmt.where(Payment.network == filters["network"])

    if filters.get("token_symbol"):
        stmt = stmt.where(Payment.token_symbol == filters["token_symbol"])

    if filters.get("min_amount"):
        try:
            min_amt = Decimal(str(filters["min_amount"]))
        except (InvalidOperation, TypeError):
            raise HTTPException(
                status_code=422,
                detail={"error": "invalid_filter", "param": "min_amount"},
            )
        stmt = stmt.where(Payment.amount >= min_amt)

    if filters.get("max_amount"):
        try:
            max_amt = Decimal(str(filters["max_amount"]))
        except (InvalidOperation, TypeError):
            raise HTTPException(
                status_code=422,
                detail={"error": "invalid_filter", "param": "max_amount"},
            )
        stmt = stmt.where(Payment.amount <= max_amt)

    if filters.get("confirmed_after"):
        try:
            dt = datetime.fromisoformat(filters["confirmed_after"])
        except (ValueError, TypeError):
            raise HTTPException(
                status_code=422,
                detail={"error": "invalid_filter", "param": "confirmed_after"},
            )
        stmt = stmt.where(Payment.confirmed_at >= dt)

    if filters.get("confirmed_before"):
        try:
            dt = datetime.fromisoformat(filters["confirmed_before"])
        except (ValueError, TypeError):
            raise HTTPException(
                status_code=422,
                detail={"error": "invalid_filter", "param": "confirmed_before"},
            )
        stmt = stmt.where(Payment.confirmed_at <= dt)

    # ------------------------------------------------------------------
    # Cursor-based pagination (ordered by confirmed_at desc)
    # ------------------------------------------------------------------
    if cursor:
        cursor_dt, cursor_id = _decode_cursor(cursor)
        stmt = stmt.where(
            (Payment.confirmed_at < cursor_dt)
            | (
                (Payment.confirmed_at == cursor_dt)
                & (Payment.id < cursor_id)
            )
        )

    stmt = stmt.order_by(Payment.confirmed_at.desc(), Payment.id.desc())
    stmt = stmt.limit(limit + 1)

    result = await db.execute(stmt)
    rows: list[Payment] = list(result.scalars().all())

    has_more = len(rows) > limit
    if has_more:
        rows = rows[:limit]

    next_cursor: Optional[str] = None
    if has_more and rows:
        last = rows[-1]
        # Use confirmed_at for the transactions cursor; fall back to created_at
        ts_field = last.confirmed_at or last.created_at
        next_cursor = _encode_cursor(ts_field, last.id)

    data = [
        PaymentIntentResponse(
            **_payment_to_response_dict(p, _build_checkout_url(p), _get_expires_at(p))
        )
        for p in rows
    ]

    return ListResponse(
        data=data,
        has_more=has_more,
        next_cursor=next_cursor,
        total=None,
    )


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


def _build_checkout_url(payment: Payment) -> str:
    """Build checkout_url from the payment's linked PaymentLink slug."""
    pl: Optional[PaymentLink] = payment.payment_link
    if pl is not None and pl.slug:
        return f"{settings.frontend_origin}/pay/{pl.slug}"
    # Fallback: use payment id as path segment if link is unavailable
    return f"{settings.frontend_origin}/pay/{payment.id}"


def _get_expires_at(payment: Payment) -> int:
    """Return Unix timestamp of the payment link's expiry, or 0 if unknown."""
    pl: Optional[PaymentLink] = payment.payment_link
    if pl is not None and pl.expires_at is not None:
        return int(pl.expires_at.timestamp())
    # Return 0 as a sentinel when no expiry is set
    return 0


# ---------------------------------------------------------------------------
# Payment Link service functions (task 8.1 prerequisite — defined here so
# the router can import them in one place)
# ---------------------------------------------------------------------------


async def create_developer_payment_link(
    org: Organization,
    user: User,
    test_mode: bool,
    data: PaymentLinkCreateRequest,
    db: AsyncSession,
) -> PaymentLinkResponse:
    """Create a developer-managed payment link.

    Requirements: 7.1, 7.2, 7.3, 7.4, 7.5
    """
    # Validate
    if data.expires_in is not None:
        validate_expires_in(data.expires_in)

    if data.amount_mode == "fixed" and data.amount is None:
        raise HTTPException(
            status_code=422,
            detail={"error": "amount_required_for_fixed_mode", "param": "amount"},
        )

    if data.amount is not None:
        validate_amount(data.amount)

    slug = await ensure_unique_slug(db)

    expires_at_dt: Optional[datetime] = None
    if data.expires_in is not None:
        expires_at_dt = datetime.now(UTC) + timedelta(seconds=data.expires_in)

    payment_link = PaymentLink(
        merchant_id=user.id,
        title=data.title,
        slug=slug,
        amount_mode=data.amount_mode,
        amount=data.amount,
        accepted_tokens=[e.model_dump() for e in data.accepted_tokens],
        status="active",
        is_test=test_mode,
        organization_id=org.id,
        redirect_url=data.redirect_url,
        expires_at=expires_at_dt,
        max_uses=data.max_uses,
        custom_message=data.custom_message,
        external_id=data.external_id,
    )
    db.add(payment_link)
    await db.flush()

    checkout_url = f"{settings.frontend_origin}/pay/{slug}"

    # Emit webhook event
    try:
        from app.webhooks.service import emit_webhook_event

        await emit_webhook_event(
            db=db,
            organization_id=org.id,
            event_type="payment.link.created",
            payload_data={
                "payment_link_id": str(payment_link.id),
                "title": payment_link.title,
                "slug": slug,
                "is_test": test_mode,
            },
            livemode=not test_mode,
        )
    except Exception as exc:
        logger.warning(
            "create_developer_payment_link: failed to emit webhook "
            "(link_id=%s): %s",
            payment_link.id,
            exc,
        )

    return PaymentLinkResponse(
        id=str(payment_link.id),
        title=payment_link.title,
        amount_mode=payment_link.amount_mode,
        amount=payment_link.amount,
        accepted_tokens=payment_link.accepted_tokens,
        status=payment_link.status,
        checkout_url=checkout_url,
        external_id=payment_link.external_id,
        is_test=test_mode,
        created=int(payment_link.created_at.timestamp()),
        expires_at=int(expires_at_dt.timestamp()) if expires_at_dt else None,
    )


async def get_developer_payment_link(
    org: Organization,
    link_id: str,
    test_mode: bool,
    db: AsyncSession,
) -> PaymentLinkResponse:
    """Retrieve a payment link by ID with org + mode isolation.

    Requirements: 7.2
    """
    try:
        lid = uuid.UUID(link_id)
    except ValueError:
        raise HTTPException(
            status_code=404,
            detail={"error": "payment_link_not_found"},
        )

    result = await db.execute(
        select(PaymentLink).where(
            PaymentLink.id == lid,
            PaymentLink.organization_id == org.id,
            PaymentLink.is_test == test_mode,
        )
    )
    pl: Optional[PaymentLink] = result.scalar_one_or_none()

    if pl is None:
        raise HTTPException(
            status_code=404,
            detail={"error": "payment_link_not_found"},
        )

    checkout_url = f"{settings.frontend_origin}/pay/{pl.slug}"
    return PaymentLinkResponse(
        id=str(pl.id),
        title=pl.title,
        amount_mode=pl.amount_mode,
        amount=pl.amount,
        accepted_tokens=pl.accepted_tokens,
        status=pl.status,
        checkout_url=checkout_url,
        external_id=pl.external_id,
        is_test=pl.is_test,
        created=int(pl.created_at.timestamp()),
        expires_at=int(pl.expires_at.timestamp()) if pl.expires_at else None,
    )


async def list_developer_payment_links(
    org: Organization,
    test_mode: bool,
    limit: int,
    cursor: Optional[str],
    db: AsyncSession,
) -> ListResponse:
    """List payment links for org with cursor pagination (max 100).

    Requirements: 7.3, 7.4
    """
    limit = min(max(limit, 1), 100)

    stmt = (
        select(PaymentLink)
        .where(
            PaymentLink.organization_id == org.id,
            PaymentLink.is_test == test_mode,
        )
    )

    if cursor:
        cursor_dt, cursor_id = _decode_cursor(cursor)
        stmt = stmt.where(
            (PaymentLink.created_at < cursor_dt)
            | (
                (PaymentLink.created_at == cursor_dt)
                & (PaymentLink.id < cursor_id)
            )
        )

    stmt = stmt.order_by(PaymentLink.created_at.desc(), PaymentLink.id.desc())
    stmt = stmt.limit(limit + 1)

    result = await db.execute(stmt)
    rows: list[PaymentLink] = list(result.scalars().all())

    has_more = len(rows) > limit
    if has_more:
        rows = rows[:limit]

    next_cursor: Optional[str] = None
    if has_more and rows:
        last = rows[-1]
        next_cursor = _encode_cursor(last.created_at, last.id)

    data = [
        PaymentLinkResponse(
            id=str(pl.id),
            title=pl.title,
            amount_mode=pl.amount_mode,
            amount=pl.amount,
            accepted_tokens=pl.accepted_tokens,
            status=pl.status,
            checkout_url=f"{settings.frontend_origin}/pay/{pl.slug}",
            external_id=pl.external_id,
            is_test=pl.is_test,
            created=int(pl.created_at.timestamp()),
            expires_at=int(pl.expires_at.timestamp()) if pl.expires_at else None,
        )
        for pl in rows
    ]

    return ListResponse(
        data=data,
        has_more=has_more,
        next_cursor=next_cursor,
        total=None,
    )
