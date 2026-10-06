"""Subscription & Platform Wallet service layer with load balancing, crypto calculation, and expiration monitoring."""
from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any, Optional

from fastapi import HTTPException, status
from sqlalchemy import and_, func, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.email import EmailClient, send_email_task
from app.core.models import Notification, PlatformWallet, SubscriptionPayment, User
from app.subscriptions.schemas import (
    CreateCryptoPaymentRequest,
    CreateCryptoPaymentResponse,
    PlatformWalletCreate,
    PlatformWalletListResponse,
    PlatformWalletResponse,
    PlatformWalletUpdate,
    SubscriptionPaymentListResponse,
    SubscriptionPaymentResponse,
)

logger = logging.getLogger(__name__)

FALLBACK_TREASURY_WALLET = "0x742d35Cc6634C0532925a3b844Bc454e4438f44e"

TIER_PRICING = {
    "growth": {"monthly": 29.0, "yearly": 290.0, "name": "Growth Pro"},
    "scale": {"monthly": 99.0, "yearly": 990.0, "name": "Scale Business"},
    "enterprise": {"monthly": 299.0, "yearly": 2990.0, "name": "Enterprise"},
}

CRYPTO_USD_RATES = {
    "USDC": 1.0,
    "USDT": 1.0,
    "ETH": 2500.0,
    "POL": 0.35,
    "BNB": 600.0,
}


def dispatch_email_safe(to: str, subject: str, template: str, context: dict[str, Any]) -> None:
    try:
        send_email_task.delay(to=to, subject=subject, template=template, context=context)
    except Exception:
        try:
            EmailClient().send(to=to, subject=subject, template=template, context=context)
        except Exception as exc:
            logger.warning("Failed to dispatch email '%s' to %s: %s", template, to, exc)


def _build_payment_response(payment: SubscriptionPayment) -> SubscriptionPaymentResponse:
    now = datetime.now(UTC)
    exp = payment.expires_at
    if exp.tzinfo is None:
        exp = exp.replace(tzinfo=UTC)
    
    diff_sec = max(0, int((exp - now).total_seconds()))
    is_expired = now > exp and payment.status == "pending"

    tier_info = TIER_PRICING.get(payment.tier, {"name": payment.tier.capitalize()})
    tier_name = tier_info.get("name", payment.tier.capitalize())

    # Calculate remaining balance if underpaid
    remaining = None
    if payment.amount_received and payment.status == "underpaid":
        try:
            expected = float(payment.crypto_amount)
            recv = float(payment.amount_received)
            rem_val = max(0.0, expected - recv)
            remaining = f"{rem_val:.4f}"
        except Exception:
            remaining = None

    return SubscriptionPaymentResponse(
        id=payment.id,
        user_id=payment.user_id,
        tier=payment.tier,
        tier_name=tier_name,
        period=payment.period,
        usd_amount=payment.usd_amount,
        crypto_token=payment.crypto_token,
        crypto_network=payment.crypto_network,
        crypto_amount=payment.crypto_amount,
        amount_received=payment.amount_received,
        remaining_balance=remaining,
        assigned_wallet_address=payment.assigned_wallet_address,
        tx_hash=payment.tx_hash,
        status="failed" if is_expired else payment.status,
        is_expired=is_expired,
        time_remaining_seconds=diff_sec,
        confirmed_at=payment.confirmed_at,
        expires_at=payment.expires_at,
        created_at=payment.created_at,
        user_email=payment.user.email if payment.user else None,
    )


class SubscriptionService:
    """Service managing platform wallets, crypto upgrades, and expiration lifecycles."""

    # -----------------------------------------------------------------------
    # Admin Platform Wallets
    # -----------------------------------------------------------------------

    @staticmethod
    async def list_platform_wallets(
        db: AsyncSession,
        active_only: bool = False,
    ) -> PlatformWalletListResponse:
        stmt = select(PlatformWallet)
        if active_only:
            stmt = stmt.where(PlatformWallet.is_active == True)  # noqa: E712
        stmt = stmt.order_by(PlatformWallet.usage_count.asc(), PlatformWallet.created_at.asc())
        res = await db.execute(stmt)
        wallets = res.scalars().all()
        return PlatformWalletListResponse(
            wallets=[PlatformWalletResponse.model_validate(w) for w in wallets],
            total=len(wallets),
        )

    @staticmethod
    async def create_platform_wallet(
        db: AsyncSession,
        payload: PlatformWalletCreate,
    ) -> PlatformWalletResponse:
        existing_stmt = select(PlatformWallet).where(
            func.lower(PlatformWallet.wallet_address) == payload.wallet_address.lower()
        )
        existing_res = await db.execute(existing_stmt)
        if existing_res.scalar_one_or_none():
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Platform wallet {payload.wallet_address} is already registered.",
            )

        wallet = PlatformWallet(
            id=uuid.uuid4(),
            wallet_address=payload.wallet_address,
            label=payload.label,
            network=payload.network,
            is_active=payload.is_active,
            usage_count=0,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        db.add(wallet)
        await db.commit()
        await db.refresh(wallet)
        return PlatformWalletResponse.model_validate(wallet)

    @staticmethod
    async def update_platform_wallet(
        db: AsyncSession,
        wallet_id: uuid.UUID,
        payload: PlatformWalletUpdate,
    ) -> PlatformWalletResponse:
        stmt = select(PlatformWallet).where(PlatformWallet.id == wallet_id)
        res = await db.execute(stmt)
        wallet = res.scalar_one_or_none()
        if not wallet:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Platform wallet not found.")

        if payload.label is not None:
            wallet.label = payload.label
        if payload.network is not None:
            wallet.network = payload.network
        if payload.is_active is not None:
            wallet.is_active = payload.is_active
        wallet.updated_at = datetime.now(UTC)

        await db.commit()
        await db.refresh(wallet)
        return PlatformWalletResponse.model_validate(wallet)

    @staticmethod
    async def delete_platform_wallet(
        db: AsyncSession,
        wallet_id: uuid.UUID,
    ) -> bool:
        stmt = select(PlatformWallet).where(PlatformWallet.id == wallet_id)
        res = await db.execute(stmt)
        wallet = res.scalar_one_or_none()
        if not wallet:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Platform wallet not found.")

        await db.delete(wallet)
        await db.commit()
        return True

    # -----------------------------------------------------------------------
    # Platform Wallet Selection (Load Balancing Algorithm)
    # -----------------------------------------------------------------------

    @staticmethod
    async def get_load_balanced_wallet(
        db: AsyncSession,
        network: str,
    ) -> tuple[Optional[PlatformWallet], str]:
        stmt = (
            select(PlatformWallet)
            .where(
                and_(
                    PlatformWallet.is_active == True,  # noqa: E712
                    or_(
                        PlatformWallet.network == "all_evm",
                        func.lower(PlatformWallet.network) == network.lower(),
                    ),
                )
            )
            .order_by(PlatformWallet.usage_count.asc(), PlatformWallet.created_at.asc())
            .limit(1)
        )
        res = await db.execute(stmt)
        wallet = res.scalar_one_or_none()

        if wallet:
            wallet.usage_count += 1
            wallet.updated_at = datetime.now(UTC)
            await db.flush()
            return wallet, wallet.wallet_address

        any_stmt = (
            select(PlatformWallet)
            .where(PlatformWallet.is_active == True)  # noqa: E712
            .order_by(PlatformWallet.usage_count.asc(), PlatformWallet.created_at.asc())
            .limit(1)
        )
        any_res = await db.execute(any_stmt)
        any_wallet = any_res.scalar_one_or_none()
        if any_wallet:
            any_wallet.usage_count += 1
            any_wallet.updated_at = datetime.now(UTC)
            await db.flush()
            return any_wallet, any_wallet.wallet_address

        return None, FALLBACK_TREASURY_WALLET

    # -----------------------------------------------------------------------
    # User Crypto Upgrade Intent & Payment
    # -----------------------------------------------------------------------

    @staticmethod
    async def create_crypto_payment_intent(
        db: AsyncSession,
        user: User,
        payload: CreateCryptoPaymentRequest,
    ) -> CreateCryptoPaymentResponse:
        tier_info = TIER_PRICING.get(payload.tier)
        if not tier_info:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid tier.")

        usd_price = tier_info["yearly"] if payload.period == "yearly" else tier_info["monthly"]
        rate = CRYPTO_USD_RATES.get(payload.crypto_token, 1.0)

        raw_crypto = usd_price / rate
        if payload.crypto_token in ("USDC", "USDT"):
            crypto_amount_str = f"{raw_crypto:.2f}"
        elif payload.crypto_token in ("ETH", "BNB"):
            crypto_amount_str = f"{raw_crypto:.6f}"
        else:
            crypto_amount_str = f"{raw_crypto:.4f}"

        platform_wallet, assigned_address = await SubscriptionService.get_load_balanced_wallet(
            db, network=payload.crypto_network
        )

        expires_at = datetime.now(UTC) + timedelta(minutes=20)
        payment = SubscriptionPayment(
            id=uuid.uuid4(),
            user_id=user.id,
            platform_wallet_id=platform_wallet.id if platform_wallet else None,
            tier=payload.tier,
            period=payload.period,
            usd_amount=usd_price,
            crypto_token=payload.crypto_token,
            crypto_network=payload.crypto_network,
            crypto_amount=crypto_amount_str,
            assigned_wallet_address=assigned_address,
            status="pending",
            expires_at=expires_at,
            created_at=datetime.now(UTC),
        )
        db.add(payment)
        await db.commit()
        await db.refresh(payment)

        return CreateCryptoPaymentResponse(
            payment_id=payment.id,
            tier=payment.tier,
            tier_name=tier_info["name"],
            period=payment.period,
            usd_amount=payment.usd_amount,
            crypto_token=payment.crypto_token,
            crypto_network=payment.crypto_network,
            crypto_amount=payment.crypto_amount,
            assigned_wallet_address=payment.assigned_wallet_address,
            expires_at=payment.expires_at,
        )

    @staticmethod
    async def get_payment_status(
        db: AsyncSession,
        user: User,
        payment_id: uuid.UUID,
    ) -> SubscriptionPaymentResponse:
        """Poll and check payment status."""
        stmt = (
            select(SubscriptionPayment)
            .options(selectinload(SubscriptionPayment.user))
            .where(and_(SubscriptionPayment.id == payment_id, SubscriptionPayment.user_id == user.id))
        )
        res = await db.execute(stmt)
        payment = res.scalar_one_or_none()
        if not payment:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payment record not found.")

        now = datetime.now(UTC)
        exp = payment.expires_at
        if exp.tzinfo is None:
            exp = exp.replace(tzinfo=UTC)

        # Check if expired
        if payment.status in ("pending", "underpaid") and now > exp:
            payment.status = "failed"
            await db.commit()
            await db.refresh(payment)

            tier_info = TIER_PRICING.get(payment.tier, {"name": payment.tier.capitalize()})
            tier_name = tier_info["name"]

            # In-app notification
            notif = Notification(
                id=uuid.uuid4(),
                user_id=user.id,
                title="Subscription Upgrade Window Expired",
                message=f"The 20-minute payment lock window for your {tier_name} upgrade has expired.",
                type="subscription_payment_failed",
                is_read=False,
                link="/dashboard/settings?tab=billing",
                created_at=now,
            )
            db.add(notif)
            await db.commit()

            # Send failed email
            dispatch_email_safe(
                to=user.email,
                subject=f"Lenis — Upgrade to {tier_name} Session Expired",
                template="subscription_payment_failed",
                context={
                    "name": user.full_name or user.email,
                    "tier_name": tier_name,
                    "crypto_amount": payment.crypto_amount,
                    "crypto_token": payment.crypto_token,
                    "retry_url": "http://localhost:5173/dashboard/settings?tab=billing",
                },
            )
        elif payment.status in ("pending", "underpaid") and not getattr(payment, "reminder_10m_sent", False):
            time_remaining = (exp - now).total_seconds()
            if 0 < time_remaining <= 600:  # 10 minutes or less remaining
                payment.reminder_10m_sent = True
                await db.commit()

                tier_info = TIER_PRICING.get(payment.tier, {"name": payment.tier.capitalize()})
                tier_name = tier_info["name"]

                notif = Notification(
                    id=uuid.uuid4(),
                    user_id=user.id,
                    title="10 Minutes Left to Complete Payment",
                    message=f"You have 10 minutes remaining to transfer {payment.crypto_amount} {payment.crypto_token} for your {tier_name} upgrade.",
                    type="subscription_reminder_10m",
                    is_read=False,
                    link="/dashboard/settings?tab=billing",
                    created_at=now,
                )
                db.add(notif)
                await db.commit()

                dispatch_email_safe(
                    to=user.email,
                    subject=f"Lenis — 10 Minutes Remaining to Complete Your {tier_name} Upgrade",
                    template="subscription_payment_reminder_10m",
                    context={
                        "name": user.full_name or user.email,
                        "tier_name": tier_name,
                        "crypto_amount": payment.crypto_amount,
                        "crypto_token": payment.crypto_token,
                        "crypto_network": payment.crypto_network,
                        "assigned_wallet_address": payment.assigned_wallet_address,
                        "resume_url": "http://localhost:5173/dashboard/settings?tab=billing",
                    },
                )

        return _build_payment_response(payment)

    @staticmethod
    async def submit_payment_tx(
        db: AsyncSession,
        user: User,
        payment_id: uuid.UUID,
        tx_hash: str,
        amount_received: Optional[str] = None,
    ) -> SubscriptionPaymentResponse:
        stmt = (
            select(SubscriptionPayment)
            .options(selectinload(SubscriptionPayment.user))
            .where(and_(SubscriptionPayment.id == payment_id, SubscriptionPayment.user_id == user.id))
        )
        res = await db.execute(stmt)
        payment = res.scalar_one_or_none()
        if not payment:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Payment intent not found.")

        if payment.status == "confirmed":
            return _build_payment_response(payment)

        now = datetime.now(UTC)
        tier_info = TIER_PRICING.get(payment.tier, {"name": payment.tier.capitalize()})
        tier_name = tier_info["name"]

        # Check underpaid scenario if amount_received is specified and less than expected
        if amount_received:
            try:
                expected_amt = float(payment.crypto_amount)
                recv_amt = float(amount_received)
                if recv_amt < (expected_amt * 0.99):  # Allow 1% rounding tolerance
                    payment.status = "underpaid"
                    payment.amount_received = str(amount_received)
                    payment.tx_hash = tx_hash
                    await db.commit()
                    await db.refresh(payment)

                    rem_bal = f"{max(0.0, expected_amt - recv_amt):.4f}"

                    # In-app notif for underpayment
                    notif = Notification(
                        id=uuid.uuid4(),
                        user_id=user.id,
                        title="Partial Payment Detected",
                        message=f"Received {amount_received} {payment.crypto_token} of {payment.crypto_amount} required for {tier_name}. Please transfer the remaining balance to activate.",
                        type="subscription_underpaid",
                        is_read=False,
                        link="/dashboard/settings?tab=billing",
                        created_at=now,
                    )
                    db.add(notif)
                    await db.commit()

                    # Email underpaid notification
                    dispatch_email_safe(
                        to=user.email,
                        subject=f"Lenis — Partial Payment Received for {tier_name}",
                        template="subscription_underpaid",
                        context={
                            "name": user.full_name or user.email,
                            "tier_name": tier_name,
                            "crypto_amount": payment.crypto_amount,
                            "amount_received": str(amount_received),
                            "remaining_balance": rem_bal,
                            "crypto_token": payment.crypto_token,
                            "balance_url": "http://localhost:5173/dashboard/settings?tab=billing",
                        },
                    )

                    return _build_payment_response(payment)
            except ValueError:
                pass

        # Full confirmed payment
        payment.tx_hash = tx_hash
        payment.amount_received = payment.crypto_amount
        payment.status = "confirmed"
        payment.confirmed_at = now

        tier_days = 365 if payment.period == "yearly" else 30
        expires_at = now + timedelta(days=tier_days)

        user_stmt = select(User).where(User.id == user.id)
        user_res = await db.execute(user_stmt)
        db_user = user_res.scalar_one()

        db_user.subscription_tier = payment.tier
        db_user.subscription_period = payment.period
        db_user.subscription_expires_at = expires_at
        db_user.subscription_grace_until = None
        db_user.subscription_last_reminder = None

        # User in-app notification
        user_notif = Notification(
            id=uuid.uuid4(),
            user_id=db_user.id,
            title="Subscription Upgraded",
            message=f"Your subscription has been successfully upgraded to {tier_name} ({payment.period.capitalize()}).",
            type="subscription_upgraded",
            is_read=False,
            link="/dashboard/settings?tab=billing",
            created_at=now,
        )
        db.add(user_notif)

        # Admin notifications
        admin_stmt = select(User).where(User.account_type.in_(["admin", "superadmin"]))
        admin_res = await db.execute(admin_stmt)
        admins = admin_res.scalars().all()
        for adm in admins:
            adm_notif = Notification(
                id=uuid.uuid4(),
                user_id=adm.id,
                title="New Subscription Payment",
                message=f"User {db_user.email} upgraded to {tier_name} via {payment.crypto_amount} {payment.crypto_token} ({payment.crypto_network.capitalize()}). Tx: {tx_hash[:10]}...",
                type="admin_subscription_payment",
                is_read=False,
                link="/admin/platform-wallets",
                created_at=now,
            )
            db.add(adm_notif)

        await db.commit()
        await db.refresh(payment)

        # Send confirmation email
        dispatch_email_safe(
            to=db_user.email,
            subject=f"Lenis — Plan Activated: {tier_name}",
            template="subscription_upgraded",
            context={
                "name": db_user.full_name or db_user.email,
                "tier_name": tier_name,
                "period": payment.period,
                "crypto_amount": payment.crypto_amount,
                "crypto_token": payment.crypto_token,
                "usd_amount": f"{payment.usd_amount:.2f}",
                "crypto_network": payment.crypto_network.capitalize(),
                "tx_hash": tx_hash,
                "expires_at_str": expires_at.strftime("%B %d, %Y"),
                "dashboard_url": "http://localhost:5173/dashboard",
            },
        )

        return _build_payment_response(payment)

    # -----------------------------------------------------------------------
    # User List Payments History
    # -----------------------------------------------------------------------

    @staticmethod
    async def list_user_payments(
        db: AsyncSession,
        user: User,
        limit: int = 50,
    ) -> SubscriptionPaymentListResponse:
        stmt = (
            select(SubscriptionPayment)
            .options(selectinload(SubscriptionPayment.user))
            .where(SubscriptionPayment.user_id == user.id)
            .order_by(SubscriptionPayment.created_at.desc())
            .limit(limit)
        )
        res = await db.execute(stmt)
        payments = res.scalars().all()

        return SubscriptionPaymentListResponse(
            payments=[_build_payment_response(p) for p in payments],
            total=len(payments),
        )

    # -----------------------------------------------------------------------
    # Admin View Subscription Payments
    # -----------------------------------------------------------------------

    @staticmethod
    async def list_all_payments(
        db: AsyncSession,
        limit: int = 50,
        offset: int = 0,
    ) -> SubscriptionPaymentListResponse:
        total_stmt = select(func.count(SubscriptionPayment.id))
        total_res = await db.execute(total_stmt)
        total = total_res.scalar_one() or 0

        stmt = (
            select(SubscriptionPayment)
            .options(selectinload(SubscriptionPayment.user))
            .order_by(SubscriptionPayment.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
        res = await db.execute(stmt)
        payments = res.scalars().all()

        return SubscriptionPaymentListResponse(
            payments=[_build_payment_response(p) for p in payments],
            total=total,
        )

    # -----------------------------------------------------------------------
    # Celery Beat Periodic Expiration Monitoring
    # -----------------------------------------------------------------------

    @staticmethod
    async def check_and_process_expirations(db: AsyncSession) -> dict[str, int]:
        now = datetime.now(UTC)
        stats = {
            "reminders_10m": 0,
            "reminders_7d": 0,
            "reminders_2d": 0,
            "grace_started": 0,
            "downgraded": 0,
            "expired_intents": 0,
        }

        # 1a. Check for 10-minute expiration warning on active payment intents
        ten_min_window = now + timedelta(minutes=10)
        reminder_stmt = (
            select(SubscriptionPayment)
            .options(selectinload(SubscriptionPayment.user))
            .where(
                and_(
                    SubscriptionPayment.status.in_(["pending", "underpaid"]),
                    SubscriptionPayment.reminder_10m_sent.is_(False),
                    SubscriptionPayment.expires_at > now,
                    SubscriptionPayment.expires_at <= ten_min_window,
                )
            )
        )
        r_res = await db.execute(reminder_stmt)
        remind_payments = r_res.scalars().all()
        for p in remind_payments:
            p.reminder_10m_sent = True
            stats["reminders_10m"] += 1
            if p.user and p.user.email:
                tier_info = TIER_PRICING.get(p.tier, {"name": p.tier.capitalize()})
                tier_name = tier_info["name"]

                notif = Notification(
                    id=uuid.uuid4(),
                    user_id=p.user_id,
                    title="10 Minutes Left to Complete Payment",
                    message=f"You have 10 minutes remaining to transfer {p.crypto_amount} {p.crypto_token} for your {tier_name} upgrade.",
                    type="subscription_reminder_10m",
                    is_read=False,
                    link="/dashboard/settings?tab=billing",
                    created_at=now,
                )
                db.add(notif)

                dispatch_email_safe(
                    to=p.user.email,
                    subject=f"Lenis — 10 Minutes Remaining to Complete Your {tier_name} Upgrade",
                    template="subscription_payment_reminder_10m",
                    context={
                        "name": p.user.full_name or p.user.email,
                        "tier_name": tier_name,
                        "crypto_amount": p.crypto_amount,
                        "crypto_token": p.crypto_token,
                        "crypto_network": p.crypto_network,
                        "assigned_wallet_address": p.assigned_wallet_address,
                        "resume_url": "http://localhost:5173/dashboard/settings?tab=billing",
                    },
                )
        await db.commit()

        # 1b. Clean up expired pending/underpaid payment intents & send failure notice
        pending_stmt = (
            select(SubscriptionPayment)
            .options(selectinload(SubscriptionPayment.user))
            .where(
                and_(
                    SubscriptionPayment.status.in_(["pending", "underpaid"]),
                    SubscriptionPayment.expires_at <= now,
                )
            )
        )
        p_res = await db.execute(pending_stmt)
        expired_payments = p_res.scalars().all()
        for p in expired_payments:
            p.status = "failed"
            stats["expired_intents"] += 1
            if p.user and p.user.email:
                tier_info = TIER_PRICING.get(p.tier, {"name": p.tier.capitalize()})
                tier_name = tier_info["name"]

                notif = Notification(
                    id=uuid.uuid4(),
                    user_id=p.user_id,
                    title="Subscription Upgrade Window Expired",
                    message=f"The 20-minute payment lock window for your {tier_name} upgrade has expired.",
                    type="subscription_payment_failed",
                    is_read=False,
                    link="/dashboard/settings?tab=billing",
                    created_at=now,
                )
                db.add(notif)

                dispatch_email_safe(
                    to=p.user.email,
                    subject=f"Lenis — Upgrade to {tier_name} Session Expired",
                    template="subscription_payment_failed",
                    context={
                        "name": p.user.full_name or p.user.email,
                        "tier_name": tier_name,
                        "crypto_amount": p.crypto_amount,
                        "crypto_token": p.crypto_token,
                        "retry_url": "http://localhost:5173/dashboard/settings?tab=billing",
                    },
                )
        await db.commit()

        # 2. Check active user subscription lifecycles
        stmt = select(User).where(
            and_(
                User.account_type == "merchant",
                User.subscription_tier != "free",
                User.subscription_expires_at.isnot(None),
            )
        )
        res = await db.execute(stmt)
        users = res.scalars().all()

        for user in users:
            expires_at = user.subscription_expires_at
            if expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=UTC)

            tier_info = TIER_PRICING.get(user.subscription_tier, {"name": user.subscription_tier.capitalize()})
            tier_name = tier_info["name"]

            delta_days = (expires_at - now).total_seconds() / 86400.0
            if 2.0 < delta_days <= 7.0 and user.subscription_last_reminder != "7_days":
                user.subscription_last_reminder = "7_days"
                stats["reminders_7d"] += 1

                notif = Notification(
                    id=uuid.uuid4(),
                    user_id=user.id,
                    title="Subscription Expiring Soon",
                    message=f"Your {tier_name} plan expires in {int(delta_days)} days ({expires_at.strftime('%b %d, %Y')}). Renew now to maintain uninterrupted access.",
                    type="subscription_reminder_7d",
                    is_read=False,
                    link="/dashboard/settings?tab=billing",
                    created_at=now,
                )
                db.add(notif)

                dispatch_email_safe(
                    to=user.email,
                    subject=f"Lenis — Your {tier_name} plan expires in 7 days",
                    template="subscription_expiring_reminder",
                    context={
                        "name": user.full_name or user.email,
                        "tier_name": tier_name,
                        "days_remaining": "7",
                        "expires_at_str": expires_at.strftime("%B %d, %Y"),
                        "renew_url": "http://localhost:5173/dashboard/settings?tab=billing",
                    },
                )

            elif 0.0 < delta_days <= 2.0 and user.subscription_last_reminder != "2_days":
                user.subscription_last_reminder = "2_days"
                stats["reminders_2d"] += 1

                notif = Notification(
                    id=uuid.uuid4(),
                    user_id=user.id,
                    title="Subscription Expiring in 2 Days",
                    message=f"Your {tier_name} plan expires in 2 days ({expires_at.strftime('%b %d, %Y')}). Please renew your plan.",
                    type="subscription_reminder_2d",
                    is_read=False,
                    link="/dashboard/settings?tab=billing",
                    created_at=now,
                )
                db.add(notif)

                dispatch_email_safe(
                    to=user.email,
                    subject=f"Lenis — Important: Your {tier_name} plan expires in 2 days",
                    template="subscription_expiring_reminder",
                    context={
                        "name": user.full_name or user.email,
                        "tier_name": tier_name,
                        "days_remaining": "2",
                        "expires_at_str": expires_at.strftime("%B %d, %Y"),
                        "renew_url": "http://localhost:5173/dashboard/settings?tab=billing",
                    },
                )

            elif expires_at <= now and user.subscription_grace_until is None:
                grace_until = now + timedelta(days=4)
                user.subscription_grace_until = grace_until
                user.subscription_last_reminder = "grace_started"
                stats["grace_started"] += 1

                notif = Notification(
                    id=uuid.uuid4(),
                    user_id=user.id,
                    title="Grace Period Active (4 Days)",
                    message=f"Your {tier_name} plan expired. You have entered a 4-day grace period until {grace_until.strftime('%b %d, %Y')} with full access retained.",
                    type="subscription_grace_started",
                    is_read=False,
                    link="/dashboard/settings?tab=billing",
                    created_at=now,
                )
                db.add(notif)

                dispatch_email_safe(
                    to=user.email,
                    subject=f"Lenis — Your {tier_name} plan has expired (4-Day Grace Period)",
                    template="subscription_grace_period",
                    context={
                        "name": user.full_name or user.email,
                        "tier_name": tier_name,
                        "grace_until_str": grace_until.strftime("%B %d, %Y"),
                        "renew_url": "http://localhost:5173/dashboard/settings?tab=billing",
                    },
                )

            elif user.subscription_grace_until is not None:
                grace_until = user.subscription_grace_until
                if grace_until.tzinfo is None:
                    grace_until = grace_until.replace(tzinfo=UTC)

                if now > grace_until:
                    old_tier_name = tier_name
                    user.subscription_tier = "free"
                    user.subscription_period = None
                    user.subscription_expires_at = None
                    user.subscription_grace_until = None
                    user.subscription_last_reminder = "downgraded"
                    stats["downgraded"] += 1

                    notif = Notification(
                        id=uuid.uuid4(),
                        user_id=user.id,
                        title="Subscription Transitioned to Free",
                        message=f"The grace period for your previous {old_tier_name} plan has expired. Your account has been transitioned to the Starter Free tier.",
                        type="subscription_downgraded",
                        is_read=False,
                        link="/dashboard/settings?tab=billing",
                        created_at=now,
                    )
                    db.add(notif)

                    dispatch_email_safe(
                        to=user.email,
                        subject="Lenis — Subscription Transitioned to Starter Free",
                        template="subscription_downgraded",
                        context={
                            "name": user.full_name or user.email,
                            "upgrade_url": "http://localhost:5173/dashboard/settings?tab=billing",
                        },
                    )

        await db.commit()
        return stats
