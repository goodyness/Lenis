"""
FastAPI router for the public checkout module.

Registers unauthenticated endpoints under the ``/pay`` path prefix applied
in ``app/main.py``, plus a public receipt endpoint under ``/api/v1/receipt``:

- ``GET /pay/{slug}``                  — returns full checkout data for the customer
- ``GET /pay/{slug}/status``           — returns current payment status (poll-safe)
- ``GET /api/v1/receipt/{tx_hash}``   — returns proof-of-payment for confirmed payments

Neither checkout endpoint requires authentication.  Both are intentionally
side-effect free; the status endpoint in particular is designed for
high-frequency polling (up to every 10 seconds) from the customer's browser.

Error behaviour:
  - HTTP 404 ``PAYMENT_LINK_NOT_FOUND`` — slug does not match any record
  - HTTP 410 ``PAYMENT_LINK_GONE``      — link is inactive, expired,
                                          exhausted, or suspended by admin
  - HTTP 404 ``Receipt not found``      — tx_hash has no confirmed/paid payment

Requirements: 11.1, 11.9, 18.2, 18.3, 18.4, 18.6
"""
from __future__ import annotations

from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.checkout import service
from app.checkout.schemas import (
    CheckoutExpireRequest,
    CheckoutLinkResponse,
    CheckoutSessionRequest,
    CheckoutSessionResponse,
    PaymentBroadcastRequest,
    PaymentStatusResponse,
)
from app.core.db import get_db
from app.core.models import Payment, PaymentLink, User
from app.core.networks import network_registry

router = APIRouter()

# ---------------------------------------------------------------------------
# Block explorer base URLs keyed by chain ID.
# For is_test=True payments, block_explorer_url is set to None.
# Requirements: 18.2, 18.6
# ---------------------------------------------------------------------------
BLOCK_EXPLORERS: dict[int, str] = {
    1: "https://etherscan.io/tx/",
    8453: "https://basescan.org/tx/",
    137: "https://polygonscan.com/tx/",
    42161: "https://arbiscan.io/tx/",
    10: "https://optimistic.etherscan.io/tx/",
    56: "https://bscscan.com/tx/",
}


# ---------------------------------------------------------------------------
# Receipt response schema
# ---------------------------------------------------------------------------


class ReceiptResponse(BaseModel):
    """Response for GET /api/v1/receipt/{tx_hash} — public payment receipt.

    Requirements: 18.2, 18.3, 18.4, 18.6
    """

    from_address: Optional[str]
    merchant_name: str
    to_address: str
    amount: Decimal
    token_symbol: str
    network_display_name: str
    confirmed_at: str  # ISO 8601 UTC
    block_number: Optional[int]
    confirmations: int
    tx_hash: str
    block_explorer_url: Optional[str]
    is_test: bool


@router.post(
    "/pay/{slug}/session",
    response_model=CheckoutSessionResponse,
    summary="Initiate or refresh a 20-minute checkout session",
    description=(
        "Initiates or extends a 20-minute countdown checkout session, guaranteeing "
        "the crypto exchange rate and recording customer intent."
    ),
)
async def create_checkout_session(
    slug: str,
    data: CheckoutSessionRequest,
    db: AsyncSession = Depends(get_db),
) -> CheckoutSessionResponse:
    """Create or refresh a 20-minute checkout session."""
    return await service.create_or_get_checkout_session(slug, data, db)


@router.post(
    "/pay/{slug}/expire",
    summary="Mark an expired checkout session",
    description="Marks a 20-minute checkout session as expired upon timer completion.",
)
async def expire_checkout_session(
    slug: str,
    data: CheckoutExpireRequest,
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Expire a timed-out checkout session."""
    return await service.expire_checkout_session(slug, data, db)


@router.post(
    "/pay/{slug}/broadcast",
    response_model=PaymentStatusResponse,
    summary="Notify backend of a newly broadcasted transaction",
    description=(
        "Immediately creates a Payment record in 'detected' status upon wallet "
        "transaction broadcast from checkout, enabling instant UI feedback."
    ),
)
async def broadcast_payment(
    slug: str,
    data: PaymentBroadcastRequest,
    db: AsyncSession = Depends(get_db),
) -> PaymentStatusResponse:
    """Record a newly broadcasted transaction hash from the checkout page."""
    return await service.broadcast_payment(slug, data, db)


@router.get(
    "/pay/{slug}",
    response_model=CheckoutLinkResponse,
    summary="Get public checkout data for a payment link",
    description=(
        "Returns merchant name, payment title, amount, accepted tokens, and "
        "wallet addresses for the customer checkout page. "
        "Returns HTTP 404 when the slug is not found. "
        "Returns HTTP 410 (PAYMENT_LINK_GONE) when the link is inactive, "
        "expired, exhausted, or suspended by an admin. "
        "No authentication required. "
        "Requirements: 11.1–11.5, 9.4, 9.5"
    ),
)
async def get_checkout_data(
    slug: str,
    db: AsyncSession = Depends(get_db),
) -> CheckoutLinkResponse:
    """Return public checkout data for the given payment link slug.

    Raises:
        HTTPException(404): Slug does not match any payment link.
        HTTPException(410): Link is inactive, expired, exhausted, or
            suspended (``PAYMENT_LINK_GONE``).
    """
    return await service.get_checkout_data(slug, db)


@router.get(
    "/pay/{slug}/status",
    response_model=PaymentStatusResponse,
    summary="Poll the current payment status for a payment link",
    description=(
        "Returns the status of the most recent payment on this link. "
        "Returns 'pending' when no payment record exists yet. "
        "This endpoint has no side effects and is safe for polling at "
        "intervals up to every 10 seconds. "
        "Returns HTTP 404 when the slug is not found. "
        "No authentication required. "
        "Requirements: 11.9"
    ),
)
async def get_payment_status(
    slug: str,
    db: AsyncSession = Depends(get_db),
) -> PaymentStatusResponse:
    """Return the current payment status for the given slug.

    Raises:
        HTTPException(404): Slug does not match any payment link.
    """
    return await service.get_payment_status(slug, db)


@router.get(
    "/api/v1/receipt/{tx_hash}",
    response_model=ReceiptResponse,
    summary="Get a public payment receipt by transaction hash",
    description=(
        "Returns proof-of-payment for a confirmed or paid on-chain transaction. "
        "No authentication required. "
        "Returns HTTP 404 when no confirmed/paid Payment matches the tx_hash. "
        "For test-mode payments, block_explorer_url is null. "
        "Requirements: 18.2, 18.3, 18.4, 18.6"
    ),
    tags=["receipt"],
)
async def get_payment_receipt(
    tx_hash: str,
    db: AsyncSession = Depends(get_db),
) -> ReceiptResponse:
    """Return a public payment receipt for the given transaction hash.

    Queries for a Payment with the given tx_hash (case-insensitive) and status
    in ('confirmed', 'paid').  Loads the associated PaymentLink and merchant
    User to build the receipt response.

    Raises:
        HTTPException(404): No confirmed/paid payment found for the tx_hash.
    """
    normalized_hash = tx_hash.lower()

    result = await db.execute(
        select(Payment).where(
            Payment.tx_hash == normalized_hash,
            Payment.status.in_(["confirmed", "paid"]),
        )
    )
    payment: Optional[Payment] = result.scalar_one_or_none()

    if payment is None:
        raise HTTPException(
            status_code=404,
            detail="Receipt not found",
        )

    # Load the associated PaymentLink to get merchant_id
    link_result = await db.execute(
        select(PaymentLink).where(PaymentLink.id == payment.payment_link_id)
    )
    payment_link: Optional[PaymentLink] = link_result.scalar_one_or_none()

    # Load the merchant User for the display name
    merchant_name = "Unknown Merchant"
    if payment_link is not None:
        user_result = await db.execute(
            select(User).where(User.id == payment_link.merchant_id)
        )
        merchant: Optional[User] = user_result.scalar_one_or_none()
        if merchant is not None:
            merchant_name = merchant.full_name

    # Resolve network display name — payment.network may already be a display
    # name or a chain_id string, so normalise via the registry.
    network_display_name = payment.network  # fallback to raw value
    resolved_chain_id: Optional[int] = None
    for net in network_registry.get_active_networks():
        if (
            net.display_name.lower() == payment.network.lower()
            or str(net.chain_id) == payment.network
        ):
            network_display_name = net.display_name
            resolved_chain_id = net.chain_id
            break

    # Build block explorer URL — None for test-mode payments
    block_explorer_url: Optional[str] = None
    if not payment.is_test and resolved_chain_id is not None:
        base_url = BLOCK_EXPLORERS.get(resolved_chain_id)
        if base_url is not None:
            block_explorer_url = f"{base_url}{normalized_hash}"

    # confirmed_at is guaranteed non-null for confirmed/paid payments; guard
    # defensively in case of data inconsistency.
    confirmed_at_iso = (
        payment.confirmed_at.strftime("%Y-%m-%dT%H:%M:%SZ")
        if payment.confirmed_at is not None
        else ""
    )

    return ReceiptResponse(
        from_address=payment.from_address,
        merchant_name=merchant_name,
        to_address=payment.to_address,
        amount=Decimal(str(payment.amount)),
        token_symbol=payment.token_symbol,
        network_display_name=network_display_name,
        confirmed_at=confirmed_at_iso,
        block_number=payment.block_number,
        confirmations=payment.confirmations,
        tx_hash=payment.tx_hash or normalized_hash,
        block_explorer_url=block_explorer_url,
        is_test=payment.is_test,
    )
