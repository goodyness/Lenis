"""
Unit tests for the notification and email templates subsystems.
"""
from __future__ import annotations

import uuid
from decimal import Decimal
import pytest
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

from app.core.db import Base
from app.core.email import EmailClient
from app.core.models import Notification, User
from app.core.notifications import create_in_app_notification
from app.notifications.service import NotificationService


@pytest.fixture
async def async_session():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:", echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async_session_factory = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with async_session_factory() as session:
        yield session

    await engine.dispose()


@pytest.mark.asyncio
async def test_notification_creation_and_querying(async_session: AsyncSession):
    user_id = uuid.uuid4()
    
    # 1. Create in-app notification
    notif = await create_in_app_notification(
        db=async_session,
        user_id=user_id,
        title="Payment Received",
        message="Received 50.00 USDT on Polygon",
        type="payment_received",
        link="/dashboard/transactions",
    )
    assert notif.id is not None
    assert notif.is_read is False
    assert notif.type == "payment_received"

    # 2. Query unread count
    count = await NotificationService.get_unread_count(async_session, user_id)
    assert count == 1

    # 3. Mark single as read
    marked = await NotificationService.mark_as_read(async_session, user_id, notif.id)
    assert marked is True
    assert (await NotificationService.get_unread_count(async_session, user_id)) == 0

    # 4. Create another and test mark all read
    await create_in_app_notification(
        db=async_session,
        user_id=user_id,
        title="Security Alert",
        message="2FA enabled",
        type="security_alert",
    )
    assert (await NotificationService.get_unread_count(async_session, user_id)) == 1

    updated_count = await NotificationService.mark_all_as_read(async_session, user_id)
    assert updated_count == 1
    assert (await NotificationService.get_unread_count(async_session, user_id)) == 0


def test_email_template_rendering():
    client = EmailClient()

    # 1. Payment receipt customer
    html = client._render(
        "payment_receipt_customer",
        {
            "customer_name": "Alice",
            "merchant_name": "ACME Store",
            "amount": "100.00",
            "token_symbol": "USDC",
            "network": "Ethereum",
            "tx_hash": "0x123abc",
            "title": "Pro Subscription",
            "date_str": "Oct 04, 2026",
        },
    )
    assert "ACME Store" in html
    assert "100.00 USDC" in html
    assert "0x123abc" in html

    # 2. Payment underpaid merchant
    html = client._render(
        "payment_underpaid_merchant",
        {
            "merchant_name": "Bob",
            "expected_amount": "50.00",
            "received_amount": "25.00",
            "token_symbol": "USDT",
            "network": "Polygon",
            "tx_hash": "0x456def",
            "title": "Widget",
            "payer_email": "payer@example.com",
            "date_str": "Oct 04, 2026",
            "dashboard_url": "http://localhost:5173/dashboard/transactions",
        },
    )
    assert "Bob" in html
    assert "25.00 USDT" in html
    assert "50.00 USDT" in html

    # 3. Invoice paid merchant
    html = client._render(
        "invoice_paid_merchant",
        {
            "merchant_name": "Carol",
            "customer_name": "Dave",
            "customer_email": "dave@example.com",
            "invoice_id": "inv_123456789",
            "amount": "250.00",
            "token_symbol": "USDC",
            "network": "Arbitrum",
            "tx_hash": "0x789ghi",
            "date_str": "Oct 04, 2026",
            "dashboard_url": "http://localhost:5173/dashboard/invoices",
        },
    )
    assert "Carol" in html
    assert "250.00 USDC" in html

    # 4. Wallet added alert
    html = client._render(
        "wallet_added_alert",
        {
            "merchant_name": "Eve",
            "address": "0x9999999999999999999999999999999999999999",
            "network": "Base",
            "label": "Cold Storage",
            "date_str": "Oct 04, 2026",
            "security_url": "http://localhost:5173/dashboard/wallets",
        },
    )
    assert "Eve" in html
    assert "0x9999999999999999999999999999999999999999" in html
    assert "Base" in html

    # 5. Two factor alert
    html = client._render(
        "two_factor_alert",
        {
            "name": "Frank",
            "action": "enabled",
            "client_ip": "127.0.0.1",
            "user_agent": "Mozilla/5.0",
            "date_str": "Oct 04, 2026",
            "security_url": "http://localhost:5173/dashboard/security",
        },
    )
    assert "Frank" in html
    assert "enabled" in html

    # 6. Account status changed
    html = client._render(
        "account_status_changed",
        {
            "name": "Grace",
            "status": "suspended",
            "reason": "Policy violation",
            "date_str": "Oct 04, 2026",
            "support_email": "support@lenis.io",
            "appeal_url": "http://localhost:5173/appeal",
        },
    )
    assert "Grace" in html
    assert "suspended" in html

    # 7. Invoice overdue merchant
    html = client._render(
        "invoice_overdue_merchant",
        {
            "merchant_name": "Heidi",
            "customer_name": "Ivan",
            "customer_email": "ivan@example.com",
            "invoice_id": "inv_987654321",
            "amount": "400.00",
            "due_date": "2026-10-01",
            "dashboard_url": "http://localhost:5173/dashboard/invoices",
        },
    )
    assert "Heidi" in html
    assert "400.00" in html
