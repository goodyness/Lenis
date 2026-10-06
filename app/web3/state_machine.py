"""
Lenis Payment State Machine & Settlement Engine.

Manages state transitions:
  ``pending`` → ``detected`` → ``confirming`` → ``confirmed`` → ``paid``
and terminal/exception states:
  ``underpaid``, ``expired``, ``failed``

Handles decimal conversions, target confirmation requirements,
invoice settlement, and payment link statistics updates.
"""
from __future__ import annotations

import logging
import uuid
from datetime import UTC, datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import and_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import Invoice, MerchantWallet, Payment, PaymentLink
from app.core.networks import network_registry

logger = logging.getLogger(__name__)

# Token standard decimals map: {symbol: decimals}
TOKEN_DECIMALS: dict[str, int] = {
    "USDC": 6,
    "USDT": 6,
    "DAI": 18,
    "ETH": 18,
    "MATIC": 18,
    "BNB": 18,
}


def raw_to_decimal(raw_value: int, token_symbol: str) -> Decimal:
    """Convert raw blockchain integer value (wei / smallest unit) to decimal token units."""
    decimals = TOKEN_DECIMALS.get(token_symbol.upper(), 18)
    return Decimal(raw_value) / Decimal(10**decimals)


def decimal_to_raw(amount: Decimal, token_symbol: str) -> int:
    """Convert decimal token units to raw blockchain integer value."""
    decimals = TOKEN_DECIMALS.get(token_symbol.upper(), 18)
    return int(amount * Decimal(10**decimals))


def _build_payment_payload(payment: Payment) -> dict:
    """Build a minimal serialisable payload dict from a Payment ORM instance."""
    return {
        "id": str(payment.id),
        "status": payment.status,
        "network": payment.network,
        "token_symbol": payment.token_symbol,
        "contract_address": payment.contract_address,
        "from_address": payment.from_address,
        "to_address": payment.to_address,
        "amount": str(payment.amount),
        "tx_hash": payment.tx_hash,
        "block_number": payment.block_number,
        "confirmations": payment.confirmations,
        "payment_link_id": str(payment.payment_link_id) if payment.payment_link_id else None,
        "invoice_id": str(payment.invoice_id) if payment.invoice_id else None,
        "payer_email": payment.payer_email,
        "is_test": payment.is_test,
        "organization_id": str(payment.organization_id) if payment.organization_id else None,
        "confirmed_at": payment.confirmed_at.isoformat() if payment.confirmed_at else None,
        "created_at": payment.created_at.isoformat() if payment.created_at else None,
        "updated_at": payment.updated_at.isoformat() if payment.updated_at else None,
    }


async def _emit_payment_webhook(
    payment: Payment,
    event_type: str,
    db: AsyncSession,
) -> None:
    """Emit a webhook event for a payment status transition.

    Returns immediately if ``payment.organization_id`` is None (payments
    created outside the Developer API have no org context and therefore no
    subscribed webhook endpoints).  Any exception raised by the underlying
    ``emit_webhook_event`` call is caught and logged so that webhook failures
    never interrupt payment processing.

    Requirements: 11.2, 11.3
    """
    if payment.organization_id is None:
        return

    try:
        from app.webhooks.service import emit_webhook_event  # local import to avoid circular deps
        await emit_webhook_event(
            db=db,
            organization_id=payment.organization_id,
            event_type=event_type,
            payload_data=_build_payment_payload(payment),
            livemode=not payment.is_test,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "_emit_payment_webhook: failed to emit %r for payment %s: %s",
            event_type,
            payment.id,
            exc,
        )


class PaymentStateMachine:
    """Encapsulates all payment state transitions, validation, and settlement side effects."""

    @staticmethod
    async def record_detected_payment(
        *,
        payment_link_id: uuid.UUID,
        invoice_id: Optional[uuid.UUID],
        network: str,
        token_symbol: str,
        contract_address: Optional[str],
        from_address: str,
        to_address: str,
        amount: Decimal,
        tx_hash: str,
        block_number: Optional[int],
        payer_email: Optional[str] = None,
        db: AsyncSession,
    ) -> Payment:
        """Create or update a payment to ``detected`` status when seen on-chain or broadcast."""
        clean_tx = tx_hash.strip().lower()
        clean_from = from_address.strip().lower()
        clean_to = to_address.strip().lower()

        # Check if payment with this tx_hash already exists
        result = await db.execute(select(Payment).where(Payment.tx_hash == clean_tx))
        existing_payment: Optional[Payment] = result.scalar_one_or_none()

        if existing_payment:
            if existing_payment.status == "pending":
                existing_payment.status = "detected"
                existing_payment.from_address = clean_from
                existing_payment.block_number = block_number
                if payer_email and not existing_payment.payer_email:
                    existing_payment.payer_email = payer_email.strip().lower()
                existing_payment.updated_at = datetime.now(UTC)
                await db.flush()
                await _emit_payment_webhook(existing_payment, "payment.detected", db)
            return existing_payment

        # Create new payment record in detected status
        payment = Payment(
            payment_link_id=payment_link_id,
            invoice_id=invoice_id,
            network=network.lower(),
            token_symbol=token_symbol.upper(),
            contract_address=contract_address.lower() if contract_address else None,
            from_address=clean_from,
            to_address=clean_to,
            payer_email=payer_email.strip().lower() if payer_email else None,
            amount=amount,
            tx_hash=clean_tx,
            block_number=block_number,
            confirmations=0,
            status="detected",
        )
        db.add(payment)
        await db.flush()

        logger.info(
            "Payment detected: id=%s tx=%s network=%s amount=%s %s",
            payment.id,
            clean_tx,
            network,
            amount,
            token_symbol,
        )
        await _emit_payment_webhook(payment, "payment.detected", db)
        return payment

    @staticmethod
    async def update_confirmations(
        *,
        payment: Payment,
        current_block: int,
        db: AsyncSession,
    ) -> str:
        """Update block confirmations and transition status according to network target."""
        if not payment.block_number:
            return payment.status

        confirmations = max(0, current_block - payment.block_number + 1)
        payment.confirmations = confirmations
        payment.updated_at = datetime.now(UTC)

        # Look up network confirmation requirements.
        # For test-mode payments, resolve the testnet equivalent of each mainnet
        # network so the correct (typically lower) confirmation threshold is used.
        # Requirements: 9.1, 9.2, 9.5
        net_cfg = None
        for n in network_registry.get_active_networks():
            if n.display_name.lower() == payment.network.lower() or str(n.chain_id) == payment.network:
                if payment.is_test:
                    testnet_cfg = network_registry.get_testnet_equivalent(n.chain_id)
                    net_cfg = testnet_cfg if testnet_cfg is not None else n
                else:
                    net_cfg = n
                break

        req_confirmations = net_cfg.confirmation_count if net_cfg else 3

        if payment.status in ("pending", "detected") and confirmations >= 1:
            payment.status = "confirming"
            logger.info("Payment %s transitioned to 'confirming' (%d/%d)", payment.id, confirmations, req_confirmations)
            await _emit_payment_webhook(payment, "payment.confirming", db)

        if payment.status == "confirming" and confirmations >= req_confirmations:
            payment.status = "confirmed"
            payment.confirmed_at = datetime.now(UTC)
            logger.info("Payment %s transitioned to 'confirmed' (%d/%d)", payment.id, confirmations, req_confirmations)
            await _emit_payment_webhook(payment, "payment.confirmed", db)

            # Settle payment if amounts align
            await PaymentStateMachine.settle_payment(payment=payment, db=db)

        await db.flush()
        return payment.status

    @staticmethod
    async def settle_payment(
        *,
        payment: Payment,
        db: AsyncSession,
    ) -> None:
        """Advance a confirmed payment to ``paid`` (or ``underpaid``) and execute side-effects."""
        merchant_id = None
        title = None

        # 1. Verify PaymentLink amount requirement
        link: Optional[PaymentLink] = None
        if payment.payment_link_id:
            link_result = await db.execute(
                select(PaymentLink).where(PaymentLink.id == payment.payment_link_id)
            )
            link = link_result.scalar_one_or_none()
            if link:
                merchant_id = str(link.merchant_id)
                title = link.title
                if link.amount_mode == "fixed" and link.amount is not None:
                    expected_amount = Decimal(str(link.amount))
                    if Decimal(str(payment.amount)) < expected_amount * Decimal("0.999"):
                        payment.status = "underpaid"
                        payment.updated_at = datetime.now(UTC)
                        if merchant_id:
                            try:
                                from app.core.notifications import create_in_app_notification
                                await create_in_app_notification(
                                    db,
                                    merchant_id,
                                    title="Underpaid Payment Detected",
                                    message=f"Received {payment.amount} {payment.token_symbol} (expected {expected_amount}) on {payment.network}",
                                    type="payment_underpaid",
                                    link="/dashboard/transactions",
                                    commit=False,
                                )
                                from app.core.tasks import send_merchant_underpaid_email
                                send_merchant_underpaid_email.delay(
                                    merchant_id=merchant_id,
                                    expected_amount=str(expected_amount),
                                    received_amount=str(payment.amount),
                                    token_symbol=payment.token_symbol,
                                    network=payment.network,
                                    tx_hash=payment.tx_hash,
                                    title=title,
                                    payer_email=payment.payer_email,
                                )
                            except Exception as notif_err:
                                logger.warning("Could not dispatch underpaid notification: %s", notif_err)
                        await db.flush()
                        logger.warning(
                            "Payment %s is UNDERPAID: received %s, expected %s for link %s",
                            payment.id,
                            payment.amount,
                            expected_amount,
                            link.id,
                        )
                        await _emit_payment_webhook(payment, "payment.underpaid", db)
                        return

        # 2. Verify Invoice amount requirement if present
        invoice: Optional[Invoice] = None
        if payment.invoice_id:
            from sqlalchemy.orm import selectinload
            inv_result = await db.execute(
                select(Invoice)
                .options(selectinload(Invoice.line_items))
                .where(Invoice.id == payment.invoice_id)
            )
            invoice = inv_result.scalar_one_or_none()
            if invoice:
                merchant_id = str(invoice.merchant_id)
                total_due = sum(
                    Decimal(str(item.amount)) for item in (invoice.line_items or [])
                )
                if total_due > 0 and Decimal(str(payment.amount)) < total_due * Decimal("0.999"):
                    payment.status = "underpaid"
                    payment.updated_at = datetime.now(UTC)
                    if merchant_id:
                        try:
                            from app.core.notifications import create_in_app_notification
                            await create_in_app_notification(
                                db,
                                merchant_id,
                                title="Underpaid Invoice Detected",
                                message=f"Received {payment.amount} {payment.token_symbol} (total due {total_due}) for Invoice #{str(invoice.id)[:8]}",
                                type="payment_underpaid",
                                link="/dashboard/invoices",
                                commit=False,
                            )
                            from app.core.tasks import send_merchant_underpaid_email
                            send_merchant_underpaid_email.delay(
                                merchant_id=merchant_id,
                                expected_amount=str(total_due),
                                received_amount=str(payment.amount),
                                token_symbol=payment.token_symbol,
                                network=payment.network,
                                tx_hash=payment.tx_hash,
                                title=f"Invoice #{str(invoice.id)[:8]}",
                                payer_email=payment.payer_email,
                            )
                        except Exception as notif_err:
                            logger.warning("Could not dispatch invoice underpaid notification: %s", notif_err)
                    await db.flush()
                    logger.warning(
                        "Payment %s is UNDERPAID for invoice %s: received %s, expected %s",
                        payment.id,
                        invoice.id,
                        payment.amount,
                        total_due,
                    )
                    await _emit_payment_webhook(payment, "payment.underpaid", db)
                    return

        # Payment is fully paid
        payment.status = "paid"
        payment.updated_at = datetime.now(UTC)

        # Increment merchant's monthly transaction count (Requirement 20.2)
        if merchant_id:
            from app.core.models import User
            await db.execute(
                update(User)
                .where(User.id == uuid.UUID(merchant_id))
                .values(monthly_tx_count=User.monthly_tx_count + 1)
            )

        # Fiat equivalent at settlement time (Requirements 17.2, 17.4, 17.7)
        try:
            from app.core.price_oracle import get_token_usd_price
            from decimal import ROUND_HALF_UP
            rate = await get_token_usd_price(payment.token_symbol)
            if rate is not None:
                payment.fiat_amount_at_payment = (
                    Decimal(str(payment.amount)) * rate
                ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
                payment.fiat_currency = "USD"
            else:
                payment.fiat_amount_at_payment = None
        except Exception as exc:
            logger.warning("fiat_amount_at_payment: price oracle failed: %s", exc)
            payment.fiat_amount_at_payment = None

        # 3. Update associated PaymentLink metrics
        if link:
            link.use_count = (link.use_count or 0) + 1
            link.total_collected = Decimal(str(link.total_collected or 0)) + Decimal(str(payment.amount))
            link.updated_at = datetime.now(UTC)
            logger.info(
                "PaymentLink %s updated: use_count=%d total_collected=%s",
                link.id,
                link.use_count,
                link.total_collected,
            )

        # 4. Update associated Invoice if present
        if invoice and invoice.status not in ("paid", "cancelled"):
            invoice.status = "paid"
            invoice.updated_at = datetime.now(UTC)
            logger.info("Invoice %s marked as PAID", invoice.id)

        # 5. In-app notifications
        if merchant_id:
            try:
                from app.core.notifications import create_in_app_notification
                await create_in_app_notification(
                    db,
                    merchant_id,
                    title="Payment Received",
                    message=f"+{payment.amount} {payment.token_symbol} received on {payment.network}",
                    type="payment_received",
                    link="/dashboard/transactions",
                    commit=False,
                )
                if invoice:
                    await create_in_app_notification(
                        db,
                        merchant_id,
                        title="Invoice Settled",
                        message=f"Invoice #{str(invoice.id)[:8]} paid by {invoice.customer_name or invoice.customer_email or 'customer'}",
                        type="invoice_paid",
                        link="/dashboard/invoices",
                        commit=False,
                    )
            except Exception as in_app_err:
                logger.warning("Could not create in-app notification: %s", in_app_err)

        await db.flush()
        logger.info("Payment %s successfully SETTLED as PAID", payment.id)

        # 6. Dispatch emails
        if merchant_id:
            try:
                from app.core.tasks import send_merchant_payment_received_email
                send_merchant_payment_received_email.delay(
                    merchant_id=merchant_id,
                    payment_id=str(payment.id),
                    amount=str(payment.amount),
                    token_symbol=payment.token_symbol,
                    network=payment.network,
                    to_address=payment.to_address,
                    tx_hash=payment.tx_hash,
                    payer_email=payment.payer_email,
                    title=title or (f"Invoice #{str(invoice.id)[:8]}" if invoice else "Payment"),
                )
                if invoice:
                    from app.core.tasks import send_merchant_invoice_paid_email
                    send_merchant_invoice_paid_email.delay(
                        merchant_id=merchant_id,
                        invoice_id=str(invoice.id),
                        amount=str(payment.amount),
                        token_symbol=payment.token_symbol,
                        network=payment.network,
                        tx_hash=payment.tx_hash,
                        customer_name=invoice.customer_name,
                        customer_email=invoice.customer_email,
                    )
            except Exception as email_exc:
                logger.warning(
                    "Could not enqueue merchant payment receipt email for payment %s: %s",
                    payment.id,
                    email_exc,
                )

        # Customer receipt email if customer provided email
        if payment.payer_email:
            try:
                from app.core.tasks import send_customer_payment_receipt_email
                merchant_display_name = "Merchant"
                if merchant_id:
                    from app.core.models import User
                    u_res = await db.execute(select(User).where(User.id == uuid.UUID(merchant_id)))
                    u = u_res.scalar_one_or_none()
                    if u and u.full_name:
                        merchant_display_name = u.full_name
                send_customer_payment_receipt_email.delay(
                    customer_email=payment.payer_email,
                    merchant_name=merchant_display_name,
                    amount=str(payment.amount),
                    token_symbol=payment.token_symbol,
                    network=payment.network,
                    tx_hash=payment.tx_hash,
                    title=title or (f"Invoice #{str(invoice.id)[:8]}" if invoice else "Lenis Checkout"),
                )
            except Exception as cust_email_exc:
                logger.warning("Could not enqueue customer payment receipt email: %s", cust_email_exc)

    @staticmethod
    async def expire_payment(
        payment: Payment,
        db: AsyncSession,
    ) -> None:
        """Expire a stale pending payment."""
        if payment.status == "pending":
            payment.status = "expired"
            payment.updated_at = datetime.now(UTC)
            await db.flush()
            logger.info("Payment %s expired", payment.id)
            await _emit_payment_webhook(payment, "payment.expired", db)
