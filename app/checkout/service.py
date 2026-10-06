"""
Checkout service for the Lenis platform.

Provides public (unauthenticated) access to payment link data and payment
status for the customer-facing checkout page at ``/pay/{slug}``.

This module is intentionally kept stateless — both functions perform
read-only database queries with no side effects, making them safe for
frequent polling (Requirement 11.9).

Error codes used by this module:
  - ``PAYMENT_LINK_NOT_FOUND`` — HTTP 404, slug not in ``payment_links`` table
  - ``PAYMENT_LINK_GONE``      — HTTP 410, link is inactive/expired/exhausted

Requirements: 11.1–11.11, 9.4, 9.5
"""
from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Optional

from fastapi import HTTPException, status
from sqlalchemy import and_, desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.checkout.schemas import (
    CheckoutExpireRequest,
    CheckoutLinkResponse,
    CheckoutSessionRequest,
    CheckoutSessionResponse,
    PaymentBroadcastRequest,
    PaymentStatusResponse,
    TokenInfo,
    WalletInfo,
)
from app.core.models import MerchantProfile, MerchantWallet, Payment, PaymentLink, User
from app.core.networks import network_registry
from app.web3.state_machine import PaymentStateMachine

logger = logging.getLogger(__name__)


async def get_checkout_data(slug: str, db: AsyncSession) -> CheckoutLinkResponse:
    """Return public checkout data for the given payment link slug.

    Lookup sequence:

    1. Find ``PaymentLink`` by slug — HTTP 404 ``PAYMENT_LINK_NOT_FOUND``
       if not found.
    2. Dead-link checks — HTTP 410 ``PAYMENT_LINK_GONE`` when any of:
       - ``status != 'active'`` (inactive or suspended by admin)
       - ``expires_at`` is not ``None`` and ``expires_at < now()`` (expired)
       - ``max_uses`` is not ``None`` and ``use_count >= max_uses`` (exhausted)
    3. Fetch the merchant's ``full_name`` and profile/branding.
    4. Fetch all active/pending ``MerchantWallet`` records for the merchant.
    5. Parse ``accepted_tokens`` JSON into ``TokenInfo`` objects.
    6. Build and return ``CheckoutLinkResponse``.

    Args:
        slug: The URL-safe slug identifying the payment link.
        db: The active async SQLAlchemy session.

    Returns:
        ``CheckoutLinkResponse`` with full checkout data for the customer.

    Raises:
        HTTPException(404): Slug does not match any payment link.
        HTTPException(410): Link is inactive, expired, or exhausted.

    Requirements: 11.1–11.5, 9.4, 9.5
    """
    # Step 1 — Resolve slug to a PaymentLink record.
    link_result = await db.execute(
        select(PaymentLink).where(PaymentLink.slug == slug)
    )
    link: Optional[PaymentLink] = link_result.scalar_one_or_none()

    if link is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "detail": "Payment link not found.",
                "code": "PAYMENT_LINK_NOT_FOUND",
            },
        )

    # Step 2 — Dead-link checks (Req 9.4, 9.5).
    now = datetime.now(UTC)
    is_dead = (
        link.status != "active"
        or (link.expires_at is not None and link.expires_at < now)
        or (link.max_uses is not None and link.use_count >= link.max_uses)
    )
    if is_dead:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail={
                "detail": "This payment link is no longer available.",
                "code": "PAYMENT_LINK_GONE",
            },
        )

    # Step 3 — Fetch merchant user and profile for branding
    user_result = await db.execute(
        select(User).where(User.id == link.merchant_id)
    )
    merchant: Optional[User] = user_result.scalar_one_or_none()
    merchant_name = merchant.full_name if merchant is not None else ""

    profile_result = await db.execute(
        select(MerchantProfile).where(MerchantProfile.user_id == link.merchant_id)
    )
    profile: Optional[MerchantProfile] = profile_result.scalar_one_or_none()

    if profile and profile.business_name:
        merchant_name = profile.business_name

    brand_logo = profile.brand_logo_url if profile else None
    brand_color = profile.brand_color if (profile and profile.brand_color) else "#4F46E5"
    brand_tagline = profile.brand_tagline if profile else None
    support_email = profile.support_email if profile else None
    support_phone = profile.support_phone if profile else None

    # Step 4 — Fetch all active/pending wallets for this merchant.
    wallets_result = await db.execute(
        select(MerchantWallet).where(
            and_(
                MerchantWallet.merchant_id == link.merchant_id,
                MerchantWallet.status.in_(["active", "pending"]),
            )
        )
    )
    wallets = wallets_result.scalars().all()

    # Step 5 — Parse accepted_tokens JSON column into TokenInfo objects.
    raw_tokens: list[dict] = link.accepted_tokens or []
    token_infos = [
        TokenInfo(
            network=t.get("network", ""),
            token_symbol=t.get("token_symbol", ""),
            contract_address=t.get("contract_address"),
        )
        for t in raw_tokens
    ]

    wallet_infos = [
        WalletInfo(network=w.network, address=w.address)
        for w in wallets
    ]

    logger.debug(
        "Checkout data fetched: slug=%r merchant_id=%s tokens=%d wallets=%d",
        slug,
        link.merchant_id,
        len(token_infos),
        len(wallet_infos),
    )

    return CheckoutLinkResponse(
        merchant_name=merchant_name,
        title=link.title,
        amount_mode=link.amount_mode,
        amount=link.amount,
        currency=link.currency,
        accepted_tokens=token_infos,
        wallets=wallet_infos,
        slug=link.slug,
        brand_logo_url=brand_logo,
        brand_color=brand_color,
        brand_tagline=brand_tagline,
        support_email=support_email,
        support_phone=support_phone,
        redirect_url=link.redirect_url,
        custom_message=link.custom_message,
        collect_phone=bool(link.collect_phone),
        collect_address=bool(link.collect_address),
    )


async def get_payment_status(slug: str, db: AsyncSession) -> PaymentStatusResponse:
    """Return the current payment status and confirmation details for the most recent payment on a link."""
    # Resolve slug to payment_link
    link_result = await db.execute(
        select(PaymentLink).where(PaymentLink.slug == slug)
    )
    link: Optional[PaymentLink] = link_result.scalar_one_or_none()

    if link is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "detail": "Payment link not found.",
                "code": "PAYMENT_LINK_NOT_FOUND",
            },
        )

    # Fetch the single most recent payment for this link.
    payment_result = await db.execute(
        select(Payment)
        .where(Payment.payment_link_id == link.id)
        .order_by(desc(Payment.created_at))
        .limit(1)
    )
    payment: Optional[Payment] = payment_result.scalar_one_or_none()

    if payment is None:
        return PaymentStatusResponse(
            status="pending",
            confirmations=0,
            required_confirmations=3,
        )

    # Determine required confirmations
    req_confirmations = 3
    for n in network_registry.get_active_networks():
        if n.display_name.lower() == payment.network.lower() or str(n.chain_id) == payment.network:
            req_confirmations = n.confirmation_count
            break

    return PaymentStatusResponse(
        status=payment.status,
        tx_hash=payment.tx_hash,
        confirmations=payment.confirmations,
        required_confirmations=req_confirmations,
        block_number=payment.block_number,
        amount=payment.amount,
        token_symbol=payment.token_symbol,
        network=payment.network,
        from_address=payment.from_address,
        to_address=payment.to_address,
        payer_email=payment.payer_email,
        payer_phone=payment.payer_phone,
        payer_address=payment.payer_address,
        confirmed_at=payment.confirmed_at.isoformat() if payment.confirmed_at else None,
    )


async def broadcast_payment(
    slug: str,
    data: PaymentBroadcastRequest,
    db: AsyncSession,
) -> PaymentStatusResponse:
    """Record a newly broadcasted transaction hash from the customer checkout session."""
    link_result = await db.execute(
        select(PaymentLink).where(PaymentLink.slug == slug)
    )
    link: Optional[PaymentLink] = link_result.scalar_one_or_none()

    if link is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "detail": "Payment link not found.",
                "code": "PAYMENT_LINK_NOT_FOUND",
            },
        )

    payment = await PaymentStateMachine.record_detected_payment(
        payment_link_id=link.id,
        invoice_id=None,
        network=data.network,
        token_symbol=data.token_symbol,
        contract_address=data.contract_address,
        from_address=data.from_address,
        to_address=data.to_address,
        amount=data.amount,
        tx_hash=data.tx_hash,
        block_number=None,
        payer_email=data.payer_email,
        db=db,
    )

    if data.payer_phone or data.payer_address:
        if data.payer_phone:
            payment.payer_phone = data.payer_phone
        if data.payer_address:
            payment.payer_address = data.payer_address
        await db.flush()

    req_confirmations = 3
    for n in network_registry.get_active_networks():
        if n.display_name.lower() == payment.network.lower() or str(n.chain_id) == payment.network:
            req_confirmations = n.confirmation_count
            break

    return PaymentStatusResponse(
        status=payment.status,
        tx_hash=payment.tx_hash,
        confirmations=payment.confirmations,
        required_confirmations=req_confirmations,
        block_number=payment.block_number,
        amount=payment.amount,
        token_symbol=payment.token_symbol,
        network=payment.network,
        from_address=payment.from_address,
        to_address=payment.to_address,
        payer_email=payment.payer_email,
        payer_phone=payment.payer_phone,
        payer_address=payment.payer_address,
        confirmed_at=payment.confirmed_at.isoformat() if payment.confirmed_at else None,
    )


async def create_or_get_checkout_session(
    slug: str,
    data: CheckoutSessionRequest,
    db: AsyncSession,
) -> CheckoutSessionResponse:
    """Create or refresh a 20-minute checkout session and track customer payment attempt."""
    link_result = await db.execute(
        select(PaymentLink).where(PaymentLink.slug == slug)
    )
    link: Optional[PaymentLink] = link_result.scalar_one_or_none()

    if link is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "detail": "Payment link not found.",
                "code": "PAYMENT_LINK_NOT_FOUND",
            },
        )

    # Resolve active merchant wallet address with multi-wallet load balancing
    target_network = (data.network or (link.accepted_tokens[0].get("network") if link.accepted_tokens else "base")).lower()
    wallet_result = await db.execute(
        select(MerchantWallet).where(
            and_(
                MerchantWallet.merchant_id == link.merchant_id,
                MerchantWallet.status.in_(["active", "pending"]),
            )
        )
    )
    wallets = wallet_result.scalars().all()
    
    # Multi-wallet routing: select across active wallets for this network
    matching_wallets = [w for w in wallets if w.network.lower() == target_network]
    if matching_wallets:
        import random
        to_addr = random.choice(matching_wallets).address
    elif wallets:
        to_addr = wallets[0].address
    else:
        to_addr = "0x0000000000000000000000000000000000000000"

    email = data.payer_email.strip().lower() if data.payer_email else None
    token_symbol = (data.token_symbol or (link.accepted_tokens[0].get("token_symbol") if link.accepted_tokens else "USDC")).upper()
    
    # Enforce amount requirements
    if link.amount_mode == "fixed":
        amount = Decimal(str(link.amount)) if link.amount is not None else Decimal("0")
    else:
        # Flexible amount mode requires positive amount
        if data.amount is not None:
            if data.amount <= Decimal("0"):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                    detail={"detail": "Flexible checkout amount must be greater than zero.", "code": "INVALID_AMOUNT"},
                )
            amount = data.amount
        else:
            amount = Decimal("1.0")  # sensible baseline default for session initiation

    # Find if there is an active pending payment for this link & email
    pending_payment: Optional[Payment] = None
    if email:
        existing_res = await db.execute(
            select(Payment)
            .where(
                and_(
                    Payment.payment_link_id == link.id,
                    Payment.payer_email == email,
                    Payment.status == "pending",
                )
            )
            .order_by(desc(Payment.created_at))
            .limit(1)
        )
        pending_payment = existing_res.scalar_one_or_none()

    now = datetime.now(UTC)
    if pending_payment is not None:
        # If created within last 20 mins, update and return
        delta_sec = (now - pending_payment.created_at).total_seconds()
        if delta_sec < 1200:
            if data.amount is not None:
                pending_payment.amount = amount
            if data.token_symbol:
                pending_payment.token_symbol = token_symbol
            if data.network:
                pending_payment.network = target_network
            if data.payer_phone:
                pending_payment.payer_phone = data.payer_phone
            if data.payer_address:
                pending_payment.payer_address = data.payer_address
            pending_payment.updated_at = now
            await db.flush()
            return CheckoutSessionResponse(
                session_id=str(pending_payment.id),
                status=pending_payment.status,
                expires_in_seconds=max(10, int(1200 - delta_sec)),
                created_at=pending_payment.created_at,
            )

    # Create a fresh pending session
    new_payment = Payment(
        payment_link_id=link.id,
        invoice_id=None,
        network=target_network,
        token_symbol=token_symbol,
        contract_address=None,
        from_address=data.from_address.strip().lower() if data.from_address else None,
        to_address=to_addr,
        payer_email=email,
        payer_phone=data.payer_phone,
        payer_address=data.payer_address,
        amount=amount,
        tx_hash=None,
        status="pending",
        created_at=now,
        updated_at=now,
    )
    db.add(new_payment)
    await db.flush()

    return CheckoutSessionResponse(
        session_id=str(new_payment.id),
        status="pending",
        expires_in_seconds=1200,
        created_at=new_payment.created_at,
    )


async def expire_checkout_session(
    slug: str,
    data: CheckoutExpireRequest,
    db: AsyncSession,
) -> dict[str, str]:
    """Mark an unfulfilled checkout session as expired upon 20-minute timeout."""
    link_result = await db.execute(
        select(PaymentLink).where(PaymentLink.slug == slug)
    )
    link: Optional[PaymentLink] = link_result.scalar_one_or_none()

    if link is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "detail": "Payment link not found.",
                "code": "PAYMENT_LINK_NOT_FOUND",
            },
        )

    payment: Optional[Payment] = None
    if data.session_id:
        try:
            sess_uuid = uuid.UUID(data.session_id)
            res = await db.execute(
                select(Payment).where(
                    and_(
                        Payment.id == sess_uuid,
                        Payment.payment_link_id == link.id,
                        Payment.status == "pending",
                    )
                )
            )
            payment = res.scalar_one_or_none()
        except ValueError:
            pass

    if payment is None and data.payer_email:
        email = data.payer_email.strip().lower()
        res = await db.execute(
            select(Payment)
            .where(
                and_(
                    Payment.payment_link_id == link.id,
                    Payment.payer_email == email,
                    Payment.status == "pending",
                )
            )
            .order_by(desc(Payment.created_at))
            .limit(1)
        )
        payment = res.scalar_one_or_none()

    if payment is not None:
        payment.status = "expired"
        payment.updated_at = datetime.now(UTC)
        await db.flush()
        return {"status": "expired", "detail": "Checkout session expired."}

    return {"status": "noop", "detail": "No pending session found to expire."}

