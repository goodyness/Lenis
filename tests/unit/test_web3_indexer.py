"""
Unit tests for Web3 Indexer, State Machine, and Decimal Calculations.
"""
import uuid
from decimal import Decimal
import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.db import Base
from app.core.models import Payment, PaymentLink, User
from app.web3.indexer import pad_address_to_topic, unpad_topic_to_address
from app.web3.state_machine import PaymentStateMachine, decimal_to_raw, raw_to_decimal


def test_token_decimals_conversion():
    # USDC (6 decimals)
    assert raw_to_decimal(1_000_000, "USDC") == Decimal("1.0")
    assert raw_to_decimal(50_000_000, "USDC") == Decimal("50.0")
    assert decimal_to_raw(Decimal("50.00"), "USDC") == 50_000_000

    # ETH / DAI (18 decimals)
    assert raw_to_decimal(1_000_000_000_000_000_000, "ETH") == Decimal("1.0")
    assert decimal_to_raw(Decimal("1.5"), "ETH") == 1_500_000_000_000_000_000


def test_topic_padding_and_unpadding():
    address = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
    padded = pad_address_to_topic(address)
    assert len(padded) == 66  # 0x + 64 hex chars
    assert padded.startswith("0x000000000000000000000000")

    unpadded = unpad_topic_to_address(padded)
    assert unpadded.lower() == address.lower()


@pytest.mark.asyncio
async def test_payment_state_transitions():
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    session_factory = async_sessionmaker(engine, expire_on_commit=False)

    async with session_factory() as db:
        # Create user & payment link
        user = User(
            id=uuid.uuid4(),
            email="merchant@example.com",
            password_hash="hashed",
            full_name="Test Merchant",
            account_type="merchant",
            status="active",
        )
        db.add(user)
        await db.flush()

        link = PaymentLink(
            id=uuid.uuid4(),
            merchant_id=user.id,
            title="Premium Order",
            slug="test-slug-123",
            amount_mode="fixed",
            amount=Decimal("100.00"),
            accepted_tokens=[{"network": "base", "token_symbol": "USDC"}],
            status="active",
        )
        db.add(link)
        await db.flush()

        # Step 1: Detect payment
        tx_hash = "0x" + "a" * 64
        payment = await PaymentStateMachine.record_detected_payment(
            payment_link_id=link.id,
            invoice_id=None,
            network="Base",
            token_symbol="USDC",
            contract_address="0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
            from_address="0x" + "1" * 40,
            to_address="0x" + "2" * 40,
            amount=Decimal("100.00"),
            tx_hash=tx_hash,
            block_number=1000,
            db=db,
        )
        assert payment.status == "detected"

        # Step 2: Confirmations 1 (confirming)
        status_1 = await PaymentStateMachine.update_confirmations(
            payment=payment,
            current_block=1000,
            db=db,
        )
        assert status_1 == "confirming"
        assert payment.confirmations == 1

        # Step 3: Confirmations 3+ (confirmed and paid)
        status_3 = await PaymentStateMachine.update_confirmations(
            payment=payment,
            current_block=1003,
            db=db,
        )
        assert status_3 == "paid"
        assert payment.status == "paid"
        assert payment.confirmed_at is not None

        # Check PaymentLink use_count & total_collected updated
        await db.refresh(link)
        assert link.use_count == 1
        assert link.total_collected == Decimal("100.00")
