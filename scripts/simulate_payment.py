"""
CLI Payment Simulator for Lenis local development and testing.

Simulates an on-chain transfer for a payment link:
  1. Finds an active PaymentLink by slug.
  2. Generates a random simulated tx_hash and from_address.
  3. Records the payment in 'detected' status.
  4. Simulates mined block confirmations (1, 2, 3+ blocks).
  5. Advances state to 'confirming', 'confirmed', and 'paid'.

Usage:
  python scripts/simulate_payment.py --slug <payment_link_slug> [--amount 50] [--token USDC]
"""
from __future__ import annotations

import argparse
import asyncio
import secrets
import sys
from decimal import Decimal
from typing import Optional

from sqlalchemy import select

from app.core.db import AsyncSessionLocal
from app.core.models import PaymentLink
from app.web3.state_machine import PaymentStateMachine


async def simulate(slug: str, amount_override: Optional[str], token: str, network: str) -> None:
    async with AsyncSessionLocal() as db:
        # Find link
        result = await db.execute(select(PaymentLink).where(PaymentLink.slug == slug))
        link: Optional[PaymentLink] = result.scalar_one_or_none()

        if not link:
            print(f"Error: Payment link with slug '{slug}' not found in database.")
            sys.exit(1)

        amount = (
            Decimal(amount_override)
            if amount_override
            else Decimal(str(link.amount or "10.00"))
        )

        sim_from = f"0x{secrets.token_hex(20)}"
        sim_to = f"0x{secrets.token_hex(20)}"
        sim_tx = f"0x{secrets.token_hex(32)}"
        start_block = 19_000_000

        print(f"\n🚀 Simulating Payment for '{link.title}' (slug: {slug})")
        print(f"   Amount: {amount} {token} on {network}")
        print(f"   From:   {sim_from}")
        print(f"   Tx:     {sim_tx}")

        # Step 1: Detected
        payment = await PaymentStateMachine.record_detected_payment(
            payment_link_id=link.id,
            invoice_id=None,
            network=network,
            token_symbol=token,
            contract_address=None,
            from_address=sim_from,
            to_address=sim_to,
            amount=amount,
            tx_hash=sim_tx,
            block_number=start_block,
            db=db,
        )
        await db.commit()
        print(f"\n[1/3] Status: {payment.status.upper()} (Block {start_block})")
        await asyncio.sleep(1.5)

        # Step 2: Confirming (1 confirmation)
        await PaymentStateMachine.update_confirmations(
            payment=payment,
            current_block=start_block,
            db=db,
        )
        await db.commit()
        print(f"[2/3] Status: {payment.status.upper()} (Confirmations: {payment.confirmations}/3)")
        await asyncio.sleep(1.5)

        # Step 3: Confirmed & Paid (3 confirmations)
        await PaymentStateMachine.update_confirmations(
            payment=payment,
            current_block=start_block + 3,
            db=db,
        )
        await db.commit()
        print(f"[3/3] Status: {payment.status.upper()} (Confirmations: {payment.confirmations}/3)")
        print(f"\n✨ Payment {payment.id} settled successfully as PAID!")


def main():
    parser = argparse.ArgumentParser(description="Simulate Web3 crypto payment settlement.")
    parser.add_argument("--slug", required=True, help="Payment link slug to pay")
    parser.add_argument("--amount", default=None, help="Amount to simulate (optional)")
    parser.add_argument("--token", default="USDC", help="Token symbol (default: USDC)")
    parser.add_argument("--network", default="Base", help="Network name (default: Base)")
    args = parser.parse_args()

    asyncio.run(simulate(args.slug, args.amount, args.token, args.network))


if __name__ == "__main__":
    main()
