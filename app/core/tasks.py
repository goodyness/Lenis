
from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import UTC, date, datetime
from decimal import Decimal
from typing import Any

import kombu.exceptions

from celery import Task
from sqlalchemy import select, update
from sqlalchemy.orm import selectinload

from app.core.celery_app import celery_app
from app.core.config import settings

logger = logging.getLogger(__name__)


def _run_async(coro):
    """Run an async coroutine safely, even if called inside a running event loop."""
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
    """Yield a fresh async session (used inside asyncio blocks)."""
    from app.core.db import AsyncSessionLocal  # local import avoids circular deps

    return AsyncSessionLocal()


# ---------------------------------------------------------------------------
# Task 1 — send_kyc_decision_email
# ---------------------------------------------------------------------------


@celery_app.task(
    bind=True,
    name="app.core.tasks.send_kyc_decision_email",
    max_retries=3,
    default_retry_delay=60,
)
def send_kyc_decision_email(
    self: Task,
    merchant_id: str,
    decision: str,
    rejection_reason: str | None = None,
) -> None:

    try:
        _run_async(_send_kyc_decision_email_async(merchant_id, decision, rejection_reason))
    except Exception as exc:
        logger.error(
            "send_kyc_decision_email failed (attempt %d/%d) merchant=%s decision=%s: %s",
            self.request.retries + 1,
            self.max_retries + 1,
            merchant_id,
            decision,
            exc,
        )
        raise self.retry(exc=exc)


async def _send_kyc_decision_email_async(
    merchant_id: str,
    decision: str,
    rejection_reason: str | None,
) -> None:
    from app.core.email import send_email_task
    from app.core.models import MerchantProfile, User

    merchant_uuid = uuid.UUID(merchant_id) if isinstance(merchant_id, str) else merchant_id

    async with await _get_session() as db:
        # Fetch the user + profile in one query
        stmt = (
            select(User, MerchantProfile)
            .join(MerchantProfile, MerchantProfile.user_id == User.id)
            .where(User.id == merchant_uuid)
        )
        result = await db.execute(stmt)
        row = result.first()

    if row is None:
        logger.warning("send_kyc_decision_email: merchant %s not found — skipping", merchant_id)
        return

    user: User = row[0]

    dashboard_url = f"{settings.frontend_origin}/dashboard"
    resubmit_url = f"{settings.frontend_origin}/onboarding"

    if decision == "approved":
        try:
            send_email_task.delay(
                to=user.email,
                subject="Your Lenis KYC verification has been approved",
                template="kyc_approved",
                context={
                    "merchant_name": user.full_name,
                    "dashboard_url": dashboard_url,
                },
            )
        except (kombu.exceptions.OperationalError, Exception) as e:
            logger.error("Email dispatch failed for %s (%s): %s", user.email, "kyc_approved", e)
            raise
    elif decision == "rejected":
        try:
            send_email_task.delay(
                to=user.email,
                subject="Action required: Your Lenis KYC verification was not approved",
                template="kyc_rejected",
                context={
                    "merchant_name": user.full_name,
                    "rejection_reason": rejection_reason or "No reason provided.",
                    "resubmit_url": resubmit_url,
                },
            )
        except (kombu.exceptions.OperationalError, Exception) as e:
            logger.error("Email dispatch failed for %s (%s): %s", user.email, "kyc_rejected", e)
            raise
    else:
        logger.warning(
            "send_kyc_decision_email: unknown decision %r for merchant %s — skipping",
            decision,
            merchant_id,
        )


# ---------------------------------------------------------------------------
# Task 2 — send_invoice_email
# ---------------------------------------------------------------------------


@celery_app.task(
    bind=True,
    name="app.core.tasks.send_invoice_email",
    max_retries=3,
    default_retry_delay=60,
    link_error="app.core.tasks.send_invoice_email_failure_rollback",
)
def send_invoice_email(self: Task, invoice_id: str) -> None:

    try:
        _run_async(_send_invoice_email_async(invoice_id))
    except Exception as exc:
        logger.error(
            "send_invoice_email failed (attempt %d/%d) invoice=%s: %s",
            self.request.retries + 1,
            self.max_retries + 1,
            invoice_id,
            exc,
        )
        raise self.retry(exc=exc)


async def _send_invoice_email_async(invoice_id: str) -> None:
    from app.core.email import send_email_task
    from app.core.models import Invoice, PaymentLink, User

    inv_uuid = uuid.UUID(invoice_id) if isinstance(invoice_id, str) else invoice_id

    async with await _get_session() as db:
        stmt = (
            select(Invoice)
            .options(selectinload(Invoice.line_items))
            .where(Invoice.id == inv_uuid)
        )
        result = await db.execute(stmt)
        invoice: Invoice | None = result.scalar_one_or_none()

    if invoice is None:
        logger.warning("send_invoice_email: invoice %s not found — skipping", invoice_id)
        return

    # Fetch merchant user
    async with await _get_session() as db:
        merchant_result = await db.execute(
            select(User).where(User.id == invoice.merchant_id)
        )
        merchant: User | None = merchant_result.scalar_one_or_none()

    # Fetch payment link for the payment URL
    payment_url: str = f"{settings.frontend_origin}/dashboard/invoices"
    if invoice.payment_link_id is not None:
        async with await _get_session() as db:
            pl_result = await db.execute(
                select(PaymentLink).where(PaymentLink.id == invoice.payment_link_id)
            )
            payment_link: PaymentLink | None = pl_result.scalar_one_or_none()
        if payment_link is not None:
            payment_url = f"{settings.frontend_origin}/pay/{payment_link.slug}"

    merchant_name: str = merchant.full_name if merchant else "Your merchant"

    # Build line items list for the template
    line_items_data: list[dict[str, Any]] = [
        {
            "description": item.description,
            "amount": f"{Decimal(str(item.amount)):.2f}",
        }
        for item in sorted(invoice.line_items, key=lambda li: li.sort_order)
    ]

    total_amount = sum(Decimal(str(item.amount)) for item in invoice.line_items)

    due_date_display: str = (
        invoice.due_date.isoformat()
        if isinstance(invoice.due_date, (date, datetime))
        else str(invoice.due_date)
    )

    from app.core.email import send_email_task  # noqa: PLC0415 (already imported, idempotent)

    try:
        send_email_task.delay(
            to=invoice.customer_email,
            subject=f"Invoice from {merchant_name} — payment due {due_date_display}",
            template="invoice_email",
            context={
                "merchant_name": merchant_name,
                "customer_name": invoice.customer_name,
                "invoice_id": str(invoice.id),
                "line_items": line_items_data,
                "total_amount": f"{total_amount:.2f}",
                "due_date": due_date_display,
                "payment_url": payment_url,
                "notes": invoice.notes or "",
            },
        )
    except (kombu.exceptions.OperationalError, Exception) as e:
        logger.error("Email dispatch failed for %s (%s): %s", invoice.customer_email, "invoice_email", e)
        raise


# ---------------------------------------------------------------------------
# Task 3 — send_invoice_email_failure_rollback
# ---------------------------------------------------------------------------


@celery_app.task(
    bind=True,
    name="app.core.tasks.send_invoice_email_failure_rollback",
    ignore_result=True,
)
def send_invoice_email_failure_rollback(
    self: Task,
    request: Any,
    exc: Any,
    traceback: Any,
    invoice_id: str,
) -> None:
 
    logger.error(
        "send_invoice_email permanently failed for invoice %s — rolling back. exc=%s",
        invoice_id,
        exc,
    )
    try:
        _run_async(_rollback_invoice_async(invoice_id))
    except Exception as rollback_exc:
        # Log but do not retry — a failed rollback should be investigated
        # manually rather than looping indefinitely.
        logger.critical(
            "send_invoice_email_failure_rollback failed for invoice %s: %s",
            invoice_id,
            rollback_exc,
        )


async def _rollback_invoice_async(invoice_id: str) -> None:
    from app.core.models import Invoice, PaymentLink

    inv_uuid = uuid.UUID(invoice_id) if isinstance(invoice_id, str) else invoice_id

    async with await _get_session() as db:
        # Fetch invoice to get payment_link_id
        result = await db.execute(
            select(Invoice).where(Invoice.id == inv_uuid)
        )
        invoice: Invoice | None = result.scalar_one_or_none()

        if invoice is None:
            logger.warning(
                "_rollback_invoice_async: invoice %s not found — nothing to roll back",
                invoice_id,
            )
            return

        payment_link_id = invoice.payment_link_id

        # Revert invoice to draft
        await db.execute(
            update(Invoice)
            .where(Invoice.id == inv_uuid)
            .values(status="draft", payment_link_id=None)
        )

        # Deactivate the associated payment link
        if payment_link_id is not None:
            await db.execute(
                update(PaymentLink)
                .where(PaymentLink.id == payment_link_id)
                .values(status="inactive")
            )

        await db.commit()

    logger.info(
        "_rollback_invoice_async: invoice %s reverted to draft; payment link %s deactivated",
        invoice_id,
        payment_link_id,
    )


# ---------------------------------------------------------------------------
# Task 4 — mark_overdue_invoices (periodic)
# ---------------------------------------------------------------------------


@celery_app.task(
    name="app.core.tasks.mark_overdue_invoices",
    ignore_result=True,
)
def mark_overdue_invoices() -> None:

    updated = _run_async(_mark_overdue_invoices_async())
    if updated:
        logger.info("mark_overdue_invoices: marked %d invoice(s) as overdue", updated)


async def _mark_overdue_invoices_async() -> int:
    from sqlalchemy import and_, select
    from sqlalchemy.orm import selectinload
    from app.core.models import Invoice

    today = datetime.now(UTC).date()

    async with await _get_session() as db:
        stmt = (
            select(Invoice)
            .options(selectinload(Invoice.line_items))
            .where(
                and_(
                    Invoice.status.in_(["sent", "viewed"]),
                    Invoice.due_date < today,
                )
            )
        )
        res = await db.execute(stmt)
        overdue_invoices = res.scalars().all()

        if not overdue_invoices:
            return 0

        for inv in overdue_invoices:
            inv.status = "overdue"
            inv.updated_at = datetime.now(UTC)

            try:
                from app.core.notifications import create_in_app_notification
                total_due = sum(Decimal(str(item.amount)) for item in (inv.line_items or []))
                await create_in_app_notification(
                    db,
                    inv.merchant_id,
                    title="Invoice Past Due",
                    message=f"Invoice #{str(inv.id)[:8]} for {inv.customer_name or inv.customer_email or 'client'} is overdue (${total_due:.2f})",
                    type="invoice_overdue",
                    link="/dashboard/invoices",
                    commit=False,
                )
                from app.core.tasks import send_invoice_overdue_email
                send_invoice_overdue_email.delay(
                    merchant_id=str(inv.merchant_id),
                    invoice_id=str(inv.id),
                    customer_name=inv.customer_name,
                    customer_email=inv.customer_email,
                    amount=f"{total_due:.2f}",
                    due_date=inv.due_date.isoformat() if inv.due_date else "",
                )
            except Exception as notif_err:
                logger.warning("Could not dispatch overdue notification for invoice %s: %s", inv.id, notif_err)

        await db.commit()
        return len(overdue_invoices)

celery_app.conf.beat_schedule.update(
    {
        "mark-overdue-invoices": {
            "task": "app.core.tasks.mark_overdue_invoices",
            "schedule": 300,  # seconds (5 minutes)
        },
    }
)


@celery_app.task(
    bind=True,
    name="app.core.tasks.send_password_changed_email",
    max_retries=3,
    default_retry_delay=30,
)
def send_password_changed_email(
    self: Task,
    user_id: str,
    client_ip: str | None = None,
    user_agent: str | None = None,
) -> None:
    """Send an immediate security alert email when a user changes their password."""
    try:
        _run_async(_send_password_changed_email_async(user_id, client_ip, user_agent))
    except Exception as exc:
        logger.error(
            "send_password_changed_email failed (attempt %d/%d) user=%s: %s",
            self.request.retries + 1,
            self.max_retries + 1,
            user_id,
            exc,
        )
        raise self.retry(exc=exc)


async def _send_password_changed_email_async(
    user_id: str,
    client_ip: str | None,
    user_agent: str | None,
) -> None:
    from app.core.email import send_email_task
    from app.core.models import User

    async with await _get_session() as db:
        user_uuid = uuid.UUID(user_id) if isinstance(user_id, str) else user_id
        res = await db.execute(select(User).where(User.id == user_uuid))
        user = res.scalar_one_or_none()

    if user is None:
        logger.warning("send_password_changed_email: user %s not found — skipping", user_id)
        return

    now_str = datetime.now(UTC).strftime("%b %d, %Y, %I:%M %p UTC")
    reset_url = f"{settings.frontend_origin}/forgot-password"

    try:
        send_email_task.delay(
            to=user.email,
            subject="Security Alert: Your Lenis Password Was Changed",
            template="password_changed",
            context={
                "name": user.full_name,
                "email": user.email,
                "changed_at": now_str,
                "client_ip": client_ip,
                "user_agent": user_agent,
                "reset_url": reset_url,
            },
        )
    except (kombu.exceptions.OperationalError, Exception) as e:
        logger.error("Email dispatch failed for %s (%s): %s", user.email, "password_changed", e)
        raise


@celery_app.task(
    bind=True,
    name="app.core.tasks.send_merchant_payment_received_email",
    max_retries=3,
    default_retry_delay=30,
)
def send_merchant_payment_received_email(
    self: Task,
    merchant_id: str,
    payment_id: str,
    amount: str,
    token_symbol: str,
    network: str,
    to_address: str,
    tx_hash: str | None = None,
    payer_email: str | None = None,
    title: str | None = None,
) -> None:
    """Send an instant notification email to merchant upon confirmed payment receipt."""
    try:
        _run_async(
            _send_merchant_payment_received_email_async(
                merchant_id=merchant_id,
                payment_id=payment_id,
                amount=amount,
                token_symbol=token_symbol,
                network=network,
                to_address=to_address,
                tx_hash=tx_hash,
                payer_email=payer_email,
                title=title,
            )
        )
    except Exception as exc:
        logger.error(
            "send_merchant_payment_received_email failed (attempt %d/%d) merchant=%s: %s",
            self.request.retries + 1,
            self.max_retries + 1,
            merchant_id,
            exc,
        )
        raise self.retry(exc=exc)


async def _send_merchant_payment_received_email_async(
    merchant_id: str,
    payment_id: str,
    amount: str,
    token_symbol: str,
    network: str,
    to_address: str,
    tx_hash: str | None,
    payer_email: str | None,
    title: str | None,
) -> None:
    from app.core.email import send_email_task
    from app.core.models import User

    async with await _get_session() as db:
        m_uuid = uuid.UUID(merchant_id) if isinstance(merchant_id, str) else merchant_id
        res = await db.execute(select(User).where(User.id == m_uuid))
        merchant = res.scalar_one_or_none()

    if merchant is None or not merchant.email:
        logger.warning(
            "send_merchant_payment_received_email: merchant %s not found — skipping",
            merchant_id,
        )
        return

    now_str = datetime.now(UTC).strftime("%b %d, %Y, %I:%M %p UTC")
    dashboard_url = f"{settings.frontend_origin}/dashboard/transactions"

    try:
        send_email_task.delay(
            to=merchant.email,
            subject=f"Payment Received: +{amount} {token_symbol} ({network})",
            template="payment_receipt_merchant",
            context={
                "merchant_name": merchant.full_name or "Merchant",
                "amount": amount,
                "token_symbol": token_symbol,
                "network": network,
                "to_address": to_address,
                "tx_hash": tx_hash,
                "payer_email": payer_email,
                "title": title,
                "date_str": now_str,
                "dashboard_url": dashboard_url,
            },
        )
    except (kombu.exceptions.OperationalError, Exception) as e:
        logger.error("Email dispatch failed for %s (%s): %s", merchant.email, "payment_receipt_merchant", e)
        raise


@celery_app.task(
    bind=True,
    name="app.core.tasks.send_customer_payment_receipt_email",
    max_retries=3,
    default_retry_delay=30,
)
def send_customer_payment_receipt_email(
    self: Task,
    customer_email: str,
    merchant_name: str,
    amount: str,
    token_symbol: str,
    network: str,
    tx_hash: str | None = None,
    title: str | None = None,
    customer_name: str | None = None,
) -> None:
    """Send a transaction confirmation receipt email to the paying customer."""
    try:
        from app.core.email import send_email_task
        now_str = datetime.now(UTC).strftime("%b %d, %Y, %I:%M %p UTC")
        try:
            send_email_task.delay(
                to=customer_email,
                subject=f"Payment Confirmation: {amount} {token_symbol} to {merchant_name}",
                template="payment_receipt_customer",
                context={
                    "customer_name": customer_name,
                    "merchant_name": merchant_name,
                    "amount": amount,
                    "token_symbol": token_symbol,
                    "network": network,
                    "tx_hash": tx_hash,
                    "title": title,
                    "date_str": now_str,
                },
            )
        except (kombu.exceptions.OperationalError, Exception) as e:
            logger.error("Email dispatch failed for %s (%s): %s", customer_email, "payment_receipt_customer", e)
            raise
    except Exception as exc:
        logger.error("send_customer_payment_receipt_email failed for %s: %s", customer_email, exc)
        raise self.retry(exc=exc)


@celery_app.task(
    bind=True,
    name="app.core.tasks.send_merchant_underpaid_email",
    max_retries=3,
    default_retry_delay=30,
)
def send_merchant_underpaid_email(
    self: Task,
    merchant_id: str,
    expected_amount: str,
    received_amount: str,
    token_symbol: str,
    network: str,
    tx_hash: str | None = None,
    title: str | None = None,
    payer_email: str | None = None,
) -> None:
    """Send an underpaid transaction alert email to the merchant."""
    try:
        _run_async(
            _send_merchant_underpaid_email_async(
                merchant_id=merchant_id,
                expected_amount=expected_amount,
                received_amount=received_amount,
                token_symbol=token_symbol,
                network=network,
                tx_hash=tx_hash,
                title=title,
                payer_email=payer_email,
            )
        )
    except Exception as exc:
        logger.error("send_merchant_underpaid_email failed for merchant %s: %s", merchant_id, exc)
        raise self.retry(exc=exc)


async def _send_merchant_underpaid_email_async(
    merchant_id: str,
    expected_amount: str,
    received_amount: str,
    token_symbol: str,
    network: str,
    tx_hash: str | None,
    title: str | None,
    payer_email: str | None,
) -> None:
    from app.core.email import send_email_task
    from app.core.models import User

    async with await _get_session() as db:
        m_uuid = uuid.UUID(merchant_id) if isinstance(merchant_id, str) else merchant_id
        res = await db.execute(select(User).where(User.id == m_uuid))
        merchant = res.scalar_one_or_none()

    if merchant is None or not merchant.email:
        return

    now_str = datetime.now(UTC).strftime("%b %d, %Y, %I:%M %p UTC")
    dashboard_url = f"{settings.frontend_origin}/dashboard/transactions"

    try:
        send_email_task.delay(
            to=merchant.email,
            subject=f"Underpayment Alert: Received {received_amount} of {expected_amount} {token_symbol}",
            template="payment_underpaid_merchant",
            context={
                "merchant_name": merchant.full_name or "Merchant",
                "expected_amount": expected_amount,
                "received_amount": received_amount,
                "token_symbol": token_symbol,
                "network": network,
                "tx_hash": tx_hash,
                "title": title,
                "payer_email": payer_email,
                "date_str": now_str,
                "dashboard_url": dashboard_url,
            },
        )
    except (kombu.exceptions.OperationalError, Exception) as e:
        logger.error("Email dispatch failed for %s (%s): %s", merchant.email, "payment_underpaid_merchant", e)
        raise


@celery_app.task(
    bind=True,
    name="app.core.tasks.send_merchant_invoice_paid_email",
    max_retries=3,
    default_retry_delay=30,
)
def send_merchant_invoice_paid_email(
    self: Task,
    merchant_id: str,
    invoice_id: str,
    amount: str,
    token_symbol: str,
    network: str,
    tx_hash: str | None = None,
    customer_name: str | None = None,
    customer_email: str | None = None,
) -> None:
    """Send an invoice settlement notification to the merchant."""
    try:
        _run_async(
            _send_merchant_invoice_paid_email_async(
                merchant_id=merchant_id,
                invoice_id=invoice_id,
                amount=amount,
                token_symbol=token_symbol,
                network=network,
                tx_hash=tx_hash,
                customer_name=customer_name,
                customer_email=customer_email,
            )
        )
    except Exception as exc:
        logger.error("send_merchant_invoice_paid_email failed for %s: %s", invoice_id, exc)
        raise self.retry(exc=exc)


async def _send_merchant_invoice_paid_email_async(
    merchant_id: str,
    invoice_id: str,
    amount: str,
    token_symbol: str,
    network: str,
    tx_hash: str | None,
    customer_name: str | None,
    customer_email: str | None,
) -> None:
    from app.core.email import send_email_task
    from app.core.models import User

    async with await _get_session() as db:
        m_uuid = uuid.UUID(merchant_id) if isinstance(merchant_id, str) else merchant_id
        res = await db.execute(select(User).where(User.id == m_uuid))
        merchant = res.scalar_one_or_none()

    if merchant is None or not merchant.email:
        return

    now_str = datetime.now(UTC).strftime("%b %d, %Y, %I:%M %p UTC")
    dashboard_url = f"{settings.frontend_origin}/dashboard/invoices"

    try:
        send_email_task.delay(
            to=merchant.email,
            subject=f"Invoice Paid: #{invoice_id[:8]} settled ({amount} {token_symbol})",
            template="invoice_paid_merchant",
            context={
                "merchant_name": merchant.full_name or "Merchant",
                "invoice_id": invoice_id,
                "customer_name": customer_name,
                "customer_email": customer_email,
                "amount": amount,
                "token_symbol": token_symbol,
                "network": network,
                "tx_hash": tx_hash,
                "date_str": now_str,
                "dashboard_url": dashboard_url,
            },
        )
    except (kombu.exceptions.OperationalError, Exception) as e:
        logger.error("Email dispatch failed for %s (%s): %s", merchant.email, "invoice_paid_merchant", e)
        raise

@celery_app.task(
    bind=True,
    name="app.core.tasks.send_wallet_added_security_email",
    max_retries=3,
    default_retry_delay=30,
)
def send_wallet_added_security_email(
    self: Task,
    user_id: str,
    address: str,
    network: str,
    label: str | None = None,
) -> None:
    """Send a security alert when a new payout wallet address is configured."""
    try:
        _run_async(
            _send_wallet_added_security_email_async(
                user_id=user_id,
                address=address,
                network=network,
                label=label,
            )
        )
    except Exception as exc:
        logger.error("send_wallet_added_security_email failed for user %s: %s", user_id, exc)
        raise self.retry(exc=exc)


async def _send_wallet_added_security_email_async(
    user_id: str,
    address: str,
    network: str,
    label: str | None,
) -> None:
    from app.core.email import send_email_task
    from app.core.models import User

    async with await _get_session() as db:
        u_uuid = uuid.UUID(user_id) if isinstance(user_id, str) else user_id
        res = await db.execute(select(User).where(User.id == u_uuid))
        user = res.scalar_one_or_none()

    if user is None or not user.email:
        return

    now_str = datetime.now(UTC).strftime("%b %d, %Y, %I:%M %p UTC")
    security_url = f"{settings.frontend_origin}/dashboard/wallets"

    try:
        send_email_task.delay(
            to=user.email,
            subject=f"Security Alert: Payout Wallet Added ({network})",
            template="wallet_added_alert",
            context={
                "merchant_name": user.full_name or "Merchant",
                "address": address,
                "network": network,
                "label": label,
                "date_str": now_str,
                "security_url": security_url,
            },
        )
    except (kombu.exceptions.OperationalError, Exception) as e:
        logger.error("Email dispatch failed for %s (%s): %s", user.email, "wallet_added_alert", e)
        raise


@celery_app.task(
    bind=True,
    name="app.core.tasks.send_two_factor_alert_email",
    max_retries=3,
    default_retry_delay=30,
)
def send_two_factor_alert_email(
    self: Task,
    user_id: str,
    action: str,  # "enabled" or "disabled"
    client_ip: str | None = None,
    user_agent: str | None = None,
) -> None:
    """Send an instant security notification when 2FA is toggled."""
    try:
        _run_async(
            _send_two_factor_alert_email_async(
                user_id=user_id,
                action=action,
                client_ip=client_ip,
                user_agent=user_agent,
            )
        )
    except Exception as exc:
        logger.error("send_two_factor_alert_email failed for user %s: %s", user_id, exc)
        raise self.retry(exc=exc)


async def _send_two_factor_alert_email_async(
    user_id: str,
    action: str,
    client_ip: str | None,
    user_agent: str | None,
) -> None:
    from app.core.email import send_email_task
    from app.core.models import User

    async with await _get_session() as db:
        u_uuid = uuid.UUID(user_id) if isinstance(user_id, str) else user_id
        res = await db.execute(select(User).where(User.id == u_uuid))
        user = res.scalar_one_or_none()

    if user is None or not user.email:
        return

    now_str = datetime.now(UTC).strftime("%b %d, %Y, %I:%M %p UTC")
    security_url = f"{settings.frontend_origin}/dashboard/security"

    try:
        send_email_task.delay(
            to=user.email,
            subject=f"Security Alert: Two-Factor Authentication {action.capitalize()}",
            template="two_factor_alert",
            context={
                "name": user.full_name or user.email,
                "action": action,
                "client_ip": client_ip,
                "user_agent": user_agent,
                "date_str": now_str,
                "security_url": security_url,
            },
        )
    except (kombu.exceptions.OperationalError, Exception) as e:
        logger.error("Email dispatch failed for %s (%s): %s", user.email, "two_factor_alert", e)
        raise


@celery_app.task(
    bind=True,
    name="app.core.tasks.send_account_status_changed_email",
    max_retries=3,
    default_retry_delay=30,
)
def send_account_status_changed_email(
    self: Task,
    user_id: str,
    status: str,  # "suspended", "active", "verified"
    reason: str | None = None,
) -> None:
    """Send an email when a user account status is modified."""
    try:
        _run_async(
            _send_account_status_changed_email_async(
                user_id=user_id,
                status=status,
                reason=reason,
            )
        )
    except Exception as exc:
        logger.error("send_account_status_changed_email failed for user %s: %s", user_id, exc)
        raise self.retry(exc=exc)


async def _send_account_status_changed_email_async(
    user_id: str,
    status: str,
    reason: str | None,
) -> None:
    from app.core.email import send_email_task
    from app.core.models import User

    async with await _get_session() as db:
        u_uuid = uuid.UUID(user_id) if isinstance(user_id, str) else user_id
        res = await db.execute(select(User).where(User.id == u_uuid))
        user = res.scalar_one_or_none()

    if user is None or not user.email:
        return

    now_str = datetime.now(UTC).strftime("%b %d, %Y, %I:%M %p UTC")
    appeal_url = f"{settings.frontend_origin}/appeal"

    try:
        send_email_task.delay(
            to=user.email,
            subject=f"Lenis Account Status Update: {status.capitalize()}",
            template="account_status_changed",
            context={
                "name": user.full_name or user.email,
                "status": status,
                "reason": reason,
                "date_str": now_str,
                "support_email": settings.smtp_from_address,
                "appeal_url": appeal_url,
            },
        )
    except (kombu.exceptions.OperationalError, Exception) as e:
        logger.error("Email dispatch failed for %s (%s): %s", user.email, "account_status_changed", e)
        raise


@celery_app.task(
    bind=True,
    name="app.core.tasks.send_invoice_overdue_email",
    max_retries=3,
    default_retry_delay=30,
)
def send_invoice_overdue_email(
    self: Task,
    merchant_id: str,
    invoice_id: str,
    customer_name: str | None = None,
    customer_email: str | None = None,
    amount: str | None = None,
    due_date: str | None = None,
) -> None:
    """Send an overdue invoice notification email to the merchant."""
    try:
        _run_async(
            _send_invoice_overdue_email_async(
                merchant_id=merchant_id,
                invoice_id=invoice_id,
                customer_name=customer_name,
                customer_email=customer_email,
                amount=amount,
                due_date=due_date,
            )
        )
    except Exception as exc:
        logger.error("send_invoice_overdue_email failed for invoice %s: %s", invoice_id, exc)
        raise self.retry(exc=exc)


async def _send_invoice_overdue_email_async(
    merchant_id: str,
    invoice_id: str,
    customer_name: str | None,
    customer_email: str | None,
    amount: str | None,
    due_date: str | None,
) -> None:
    from app.core.email import send_email_task
    from app.core.models import User

    async with await _get_session() as db:
        m_uuid = uuid.UUID(merchant_id) if isinstance(merchant_id, str) else merchant_id
        res = await db.execute(select(User).where(User.id == m_uuid))
        merchant = res.scalar_one_or_none()

    if merchant is None or not merchant.email:
        return

    dashboard_url = f"{settings.frontend_origin}/dashboard/invoices"

    try:
        send_email_task.delay(
            to=merchant.email,
            subject=f"Invoice #{invoice_id[:8]} is now overdue",
            template="invoice_overdue_merchant",
            context={
                "merchant_name": merchant.full_name or "Merchant",
                "invoice_id": invoice_id,
                "customer_name": customer_name,
                "customer_email": customer_email,
                "amount": amount,
                "due_date": due_date,
                "dashboard_url": dashboard_url,
            },
        )
    except (kombu.exceptions.OperationalError, Exception) as e:
        logger.error("Email dispatch failed for %s (%s): %s", merchant.email, "invoice_overdue_merchant", e)
        raise


# ---------------------------------------------------------------------------
# Task: monitor_subscription_expirations
# ---------------------------------------------------------------------------


@celery_app.task(
    bind=True,
    name="app.core.tasks.monitor_subscription_expirations",
    max_retries=2,
    default_retry_delay=60,
)
def monitor_subscription_expirations(self: Task) -> dict[str, int]:
    """Celery beat periodic task: monitors expiring subscriptions, delivers reminders, and manages 4-day grace period."""
    from app.subscriptions.service import SubscriptionService

    async def _run():
        async with await _get_session() as db:
            return await SubscriptionService.check_and_process_expirations(db)

    return _run_async(_run())


# ---------------------------------------------------------------------------
# Task: check_stablecoin_pegs (periodic — runs every 5 minutes)
# ---------------------------------------------------------------------------


@celery_app.task(
    name="app.core.tasks.check_stablecoin_pegs",
    ignore_result=True,
)
def check_stablecoin_pegs() -> None:
    """Celery beat periodic task: checks USDC and USDT peg stability.

    If a stablecoin deviates more than 1% from $1.00, sends depeg alert
    notifications and emails to affected merchants (with 6-hour deduplication).
    When the price recovers to within 0.5% of $1.00, sends resolved notifications
    and clears the deduplication key.
    """
    _run_async(_check_stablecoin_pegs_async())


async def _check_stablecoin_pegs_async() -> None:
    from decimal import Decimal as _Decimal

    import redis.asyncio as _aioredis

    from app.core.price_oracle import get_token_usd_price
    from app.core.models import MerchantProfile, PaymentLink, User
    from app.core.notifications import create_in_app_notification
    from app.core.email import send_email_task
    from app.core.redis_client import _get_pool

    STABLECOINS = ["USDC", "USDT"]
    PEG = _Decimal("1.00")
    ALERT_THRESHOLD = _Decimal("0.01")    # depeg if |price - 1.00| > 0.01
    RESOLVED_THRESHOLD = _Decimal("0.005")  # resolved if |price - 1.00| <= 0.005
    ALERT_TTL = 21600  # 6 hours in seconds

    redis = _aioredis.Redis(connection_pool=_get_pool())

    for symbol in STABLECOINS:
        try:
            price = await get_token_usd_price(symbol)
        except Exception as exc:
            logger.warning("check_stablecoin_pegs: failed to fetch price for %s: %s", symbol, exc)
            continue

        if price is None:
            logger.warning("check_stablecoin_pegs: price unavailable for %s, skipping", symbol)
            continue

        deviation = abs(price - PEG)
        alert_key = f"depeg_alert_sent:{symbol}"

        if deviation > ALERT_THRESHOLD:
            # Price is depegged — check if we already sent an alert in the last 6h
            try:
                already_sent = await redis.exists(alert_key)
            except Exception as redis_exc:
                logger.warning("check_stablecoin_pegs: Redis read failed for %s: %s", alert_key, redis_exc)
                already_sent = False

            if not already_sent:
                logger.warning(
                    "check_stablecoin_pegs: %s depeg detected — price=%.4f deviation=%.4f",
                    symbol, price, deviation,
                )
                # Find affected merchants and notify them
                affected_merchant_ids = await _get_merchants_with_stablecoin(symbol)

                async with await _get_session() as db:
                    for merchant_id in affected_merchant_ids:
                        try:
                            # Fetch merchant user for email
                            from sqlalchemy import select as _select
                            res = await db.execute(_select(User).where(User.id == merchant_id))
                            merchant_user = res.scalar_one_or_none()
                            if merchant_user is None:
                                continue

                            # Create in-app notification
                            await create_in_app_notification(
                                db,
                                merchant_id,
                                title=f"{symbol} Depeg Alert",
                                message=(
                                    f"{symbol} is currently trading at ${price:.4f} USD, "
                                    f"which deviates {deviation * 100:.2f}% from the $1.00 peg. "
                                    f"Consider temporarily disabling {symbol} on your payment links."
                                ),
                                type="depeg_alert",
                                link="/dashboard/payment-links",
                                commit=False,
                            )

                            # Dispatch email
                            try:
                                send_email_task.delay(
                                    to=merchant_user.email,
                                    subject=f"Alert: {symbol} Stablecoin Depeg Detected",
                                    template="stablecoin_depeg_alert",
                                    context={
                                        "merchant_name": merchant_user.full_name or "Merchant",
                                        "symbol": symbol,
                                        "price": f"{price:.4f}",
                                        "deviation_pct": f"{deviation * 100:.2f}",
                                        "dashboard_url": f"{settings.frontend_origin}/dashboard/payment-links",
                                    },
                                )
                            except (kombu.exceptions.OperationalError, Exception) as e:
                                logger.error(
                                    "Email dispatch failed for %s (stablecoin_depeg_alert): %s",
                                    merchant_user.email, e,
                                )

                        except Exception as merchant_exc:
                            logger.warning(
                                "check_stablecoin_pegs: error notifying merchant %s for %s depeg: %s",
                                merchant_id, symbol, merchant_exc,
                            )

                    await db.commit()

                # Set deduplication key with 6-hour TTL
                try:
                    await redis.set(alert_key, "1", ex=ALERT_TTL)
                except Exception as redis_exc:
                    logger.warning(
                        "check_stablecoin_pegs: failed to set dedup key %s: %s", alert_key, redis_exc
                    )

        elif deviation <= RESOLVED_THRESHOLD:
            # Price has recovered — check if we previously sent an alert
            try:
                was_alerted = await redis.exists(alert_key)
            except Exception as redis_exc:
                logger.warning("check_stablecoin_pegs: Redis read failed for %s: %s", alert_key, redis_exc)
                was_alerted = False

            if was_alerted:
                logger.info(
                    "check_stablecoin_pegs: %s peg restored — price=%.4f deviation=%.4f",
                    symbol, price, deviation,
                )

                # Clear the deduplication key
                try:
                    await redis.delete(alert_key)
                except Exception as redis_exc:
                    logger.warning(
                        "check_stablecoin_pegs: failed to delete dedup key %s: %s", alert_key, redis_exc
                    )

                # Notify previously-alerted merchants that the peg is restored
                affected_merchant_ids = await _get_merchants_with_stablecoin(symbol)

                async with await _get_session() as db:
                    for merchant_id in affected_merchant_ids:
                        try:
                            await create_in_app_notification(
                                db,
                                merchant_id,
                                title=f"{symbol} Peg Restored",
                                message=(
                                    f"{symbol} has returned to its $1.00 USD peg "
                                    f"(currently ${price:.4f}). "
                                    f"You may re-enable {symbol} on your payment links if it was paused."
                                ),
                                type="depeg_resolved",
                                link="/dashboard/payment-links",
                                commit=False,
                            )
                        except Exception as merchant_exc:
                            logger.warning(
                                "check_stablecoin_pegs: error sending resolved notification to merchant %s: %s",
                                merchant_id, merchant_exc,
                            )

                    await db.commit()


async def _get_merchants_with_stablecoin(token_symbol: str) -> list:
    """Return a list of merchant_ids (UUIDs) who have an active PaymentLink
    accepting *token_symbol* and whose MerchantProfile.onboarding_complete=True.
    """
    from sqlalchemy import select as _select
    from sqlalchemy.orm import selectinload as _selectinload
    from app.core.models import MerchantProfile, PaymentLink

    async with await _get_session() as db:
        # Fetch all active payment links
        stmt = (
            _select(PaymentLink)
            .where(PaymentLink.status == "active")
        )
        result = await db.execute(stmt)
        active_links = result.scalars().all()

        # Filter in Python — accepted_tokens is a JSON list of dicts
        symbol_upper = token_symbol.upper()
        merchant_ids_with_token: set = set()
        for link in active_links:
            tokens = link.accepted_tokens or []
            for t in tokens:
                if isinstance(t, dict) and t.get("token_symbol", "").upper() == symbol_upper:
                    merchant_ids_with_token.add(link.merchant_id)
                    break

        if not merchant_ids_with_token:
            return []

        # Filter to merchants with onboarding_complete=True
        from sqlalchemy import and_ as _and
        profile_stmt = (
            _select(MerchantProfile.user_id)
            .where(
                _and(
                    MerchantProfile.user_id.in_(list(merchant_ids_with_token)),
                    MerchantProfile.onboarding_complete == True,  # noqa: E712
                )
            )
        )
        profile_result = await db.execute(profile_stmt)
        onboarded_merchant_ids = [row[0] for row in profile_result.all()]

    return onboarded_merchant_ids


# ---------------------------------------------------------------------------
# Task: reset_monthly_tx_counts (periodic — runs at 00:05 on 1st of each month)
# ---------------------------------------------------------------------------


@celery_app.task(
    name="app.core.tasks.reset_monthly_tx_counts",
)
def reset_monthly_tx_counts() -> None:
    """Reset every user's monthly_tx_count to 0 at the start of each billing month."""
    _run_async(_reset_monthly_tx_counts_async())


async def _reset_monthly_tx_counts_async() -> None:
    from sqlalchemy import text

    async with await _get_session() as db:
        result = await db.execute(
            text("UPDATE users SET monthly_tx_count = 0 WHERE monthly_tx_count > 0")
        )
        await db.commit()
        logger.info(
            "reset_monthly_tx_counts: reset %d user(s) to 0",
            result.rowcount,
        )





