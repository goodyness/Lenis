import asyncio
import logging
import sys
from pathlib import Path
import uuid
from datetime import datetime, UTC

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.config import settings
from app.core.db import AsyncSessionLocal
from app.core.email import EmailClient
from app.core.models import Notification, User
from app.core.notifications import create_in_app_notification
from sqlalchemy import select

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("send_sample_notifications")

TARGET_EMAIL = "0x20dev@gmail.com"


async def seed_in_app_notifications():
    """Create sample in-app notifications in the database for users."""
    async with AsyncSessionLocal() as db:
        res = await db.execute(select(User))
        users = res.scalars().all()

        if not users:
            logger.warning("No users found in database to attach in-app notifications.")
            return

        sample_notifications = [
            {
                "title": "Payment Received 🎉",
                "message": "Received +250.00 USDC on Polygon from payer (0x3a...f91a)",
                "type": "payment_received",
                "link": "/dashboard/transactions",
            },
            {
                "title": "Underpaid Transaction Detected ⚠️",
                "message": "Received 45.00 USDT of expected 100.00 USDT on Ethereum for 'Web3 Dev Subscription'",
                "type": "payment_underpaid",
                "link": "/dashboard/transactions",
            },
            {
                "title": "Invoice Paid & Settled ✅",
                "message": "Invoice #88210492 for $1,200.00 was paid by enterprise client (client@acme.inc)",
                "type": "invoice_paid",
                "link": "/dashboard/invoices",
            },
            {
                "title": "KYC Verification Approved 🛡️",
                "message": "Your merchant identity verification has been approved. You have full settlement access.",
                "type": "kyc_decision",
                "link": "/dashboard",
            },
            {
                "title": "Payout Wallet Configured 🔑",
                "message": "Settlement wallet 0x71C...3a9F was added for Base Network.",
                "type": "wallet_added",
                "link": "/dashboard/wallets",
            },
            {
                "title": "Two-Factor Authentication Active 🔒",
                "message": "Two-Factor Authentication (TOTP) was successfully enabled on your account.",
                "type": "security_alert",
                "link": "/dashboard/security",
            },
            {
                "title": "Invoice Past Due ⏰",
                "message": "Invoice #77341902 for $450.00 has passed its payment due date.",
                "type": "invoice_overdue",
                "link": "/dashboard/invoices",
            },
        ]

        created_count = 0
        for user in users:
            for n in sample_notifications:
                notif = Notification(
                    user_id=user.id,
                    title=n["title"],
                    message=n["message"],
                    type=n["type"],
                    link=n["link"],
                    is_read=False,
                )
                db.add(notif)
                created_count += 1

        await db.commit()
        logger.info("Successfully seeded %d in-app notifications across %d users!", created_count, len(users))


def send_all_sample_emails():
    """Render and deliver samples of all email templates to TARGET_EMAIL."""
    client = EmailClient()
    now_str = datetime.now(UTC).strftime("%b %d, %Y, %I:%M %p UTC")

    templates = [
        (
            "email_verification",
            "Verify your email address - Lenis",
            {
                "name": "0x20dev",
                "token": "tok_demo_verify_9981249120491",
                "verification_url": f"{settings.frontend_origin}/verify-email?token=tok_demo_verify_9981249120491",
            },
        ),
        (
            "password_reset",
            "Reset your Lenis account password",
            {
                "name": "0x20dev",
                "reset_url": f"{settings.frontend_origin}/reset-password?token=tok_reset_sample_123",
                "token": "tok_reset_sample_123",
            },
        ),
        (
            "password_changed",
            "Security Alert: Your Lenis Password Was Changed",
            {
                "name": "0x20dev",
                "email": TARGET_EMAIL,
                "changed_at": now_str,
                "client_ip": "192.168.1.100",
                "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0",
                "reset_url": f"{settings.frontend_origin}/forgot-password",
            },
        ),
        (
            "payment_receipt_customer",
            "Payment Confirmation: 250.00 USDC to Acme Corp",
            {
                "customer_name": "Valued Customer",
                "merchant_name": "Acme Global Web3",
                "amount": "250.00",
                "token_symbol": "USDC",
                "network": "Polygon",
                "tx_hash": "0x8f28b49e18a092830f81d827394c8e1927389172938491829384918293849182",
                "title": "Annual Pro Subscription",
                "date_str": now_str,
            },
        ),
        (
            "payment_receipt_merchant",
            "Payment Received: +250.00 USDC (Polygon)",
            {
                "merchant_name": "Acme Global Web3",
                "amount": "250.00",
                "token_symbol": "USDC",
                "network": "Polygon",
                "to_address": "0x71C8363432aab345E678d9b1a134B290234a9F01",
                "tx_hash": "0x8f28b49e18a092830f81d827394c8e1927389172938491829384918293849182",
                "payer_email": "payer.customer@gmail.com",
                "title": "Annual Pro Subscription",
                "date_str": now_str,
                "dashboard_url": f"{settings.frontend_origin}/dashboard/transactions",
            },
        ),
        (
            "payment_underpaid_merchant",
            "Underpayment Alert: Received 45.00 of 100.00 USDT",
            {
                "merchant_name": "Acme Global Web3",
                "expected_amount": "100.00",
                "received_amount": "45.00",
                "token_symbol": "USDT",
                "network": "Ethereum",
                "tx_hash": "0x3344aae918471204918239019283401928340192834019283401928340192834",
                "title": "Digital Asset License",
                "payer_email": "client@web3client.xyz",
                "date_str": now_str,
                "dashboard_url": f"{settings.frontend_origin}/dashboard/transactions",
            },
        ),
        (
            "invoice_email",
            "Invoice #88210492 from Acme Global Web3 — payment due Oct 15, 2026",
            {
                "merchant_name": "Acme Global Web3",
                "customer_name": "0x20dev",
                "invoice_id": "88210492-49bf-4819-8120-192849102938",
                "line_items": [
                    {"description": "Smart Contract Audit & Formal Verification", "amount": "800.00"},
                    {"description": "Backend API Integration Support", "amount": "400.00"},
                ],
                "total_amount": "1200.00",
                "due_date": "2026-10-15",
                "payment_url": f"{settings.frontend_origin}/pay/inv_sample_slug_8821",
                "notes": "Thank you for your business. Payment accepted in USDC, USDT, and ETH.",
            },
        ),
        (
            "invoice_paid_merchant",
            "Invoice Paid: #88210492 settled (1,200.00 USDC)",
            {
                "merchant_name": "Acme Global Web3",
                "invoice_id": "88210492-49bf-4819-8120-192849102938",
                "customer_name": "Apex Enterprise Ltd",
                "customer_email": "billing@apexenterprise.io",
                "amount": "1200.00",
                "token_symbol": "USDC",
                "network": "Arbitrum",
                "tx_hash": "0x4455bbcc12938491029384019283401928340192834019283401928340192834",
                "date_str": now_str,
                "dashboard_url": f"{settings.frontend_origin}/dashboard/invoices",
            },
        ),
        (
            "invoice_overdue_merchant",
            "Invoice #77341902 is now overdue",
            {
                "merchant_name": "Acme Global Web3",
                "invoice_id": "77341902-8812-4912-9901-192849102938",
                "customer_name": "Legacy Tech Corp",
                "customer_email": "finance@legacytech.com",
                "amount": "450.00",
                "due_date": "2026-10-01",
                "dashboard_url": f"{settings.frontend_origin}/dashboard/invoices",
            },
        ),
        (
            "wallet_added_alert",
            "Security Alert: Payout Wallet Added (Base)",
            {
                "merchant_name": "Acme Global Web3",
                "address": "0x71C8363432aab345E678d9b1a134B290234a9F01",
                "network": "Base",
                "label": "Primary Base Cold Settlement",
                "date_str": now_str,
                "security_url": f"{settings.frontend_origin}/dashboard/wallets",
            },
        ),
        (
            "two_factor_alert",
            "Security Alert: Two-Factor Authentication Enabled",
            {
                "name": "0x20dev",
                "action": "enabled",
                "client_ip": "192.168.1.100",
                "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/128.0",
                "date_str": now_str,
                "security_url": f"{settings.frontend_origin}/dashboard/security",
            },
        ),
        (
            "account_status_changed",
            "Lenis Account Status Update: Active",
            {
                "name": "0x20dev",
                "status": "active",
                "reason": "Merchant underwriting checks cleared successfully.",
                "date_str": now_str,
                "support_email": settings.smtp_from_address,
                "appeal_url": f"{settings.frontend_origin}/appeal",
            },
        ),
        (
            "kyc_approved",
            "Your identity has been verified - Lenis",
            {
                "merchant_name": "0x20dev",
                "dashboard_url": f"{settings.frontend_origin}/dashboard",
            },
        ),
        (
            "kyc_rejected",
            "Action required: Your Lenis KYC verification was not approved",
            {
                "merchant_name": "0x20dev",
                "rejection_reason": "Proof of business address document is older than 90 days. Please upload a recent bank statement or utility bill.",
                "resubmit_url": f"{settings.frontend_origin}/onboarding",
            },
        ),
    ]

    logger.info("Sending %d sample emails to %s (SMTP Host: %s:%s)...", len(templates), TARGET_EMAIL, settings.smtp_host, settings.smtp_port)

    sent = 0
    for template_name, subject, ctx in templates:
        try:
            client.send(
                to=TARGET_EMAIL,
                subject=subject,
                template=template_name,
                context=ctx,
            )
            logger.info("✓ Sent [%s] -> %s", template_name, TARGET_EMAIL)
            sent += 1
        except Exception as e:
            logger.error("✗ Failed sending [%s]: %s", template_name, e)

    logger.info("Finished email delivery: %d/%d sent successfully.", sent, len(templates))


async def main():
    await seed_in_app_notifications()
    send_all_sample_emails()


if __name__ == "__main__":
    asyncio.run(main())
