"""
Payment Reconciliation & Re-org Protection Service.

Periodically queries on-chain receipts for unconfirmed payments across all
configured EVM networks, validates execution status, updates block confirmations,
and triggers settlement once required confirmations are reached.
"""
from __future__ import annotations

import logging
from datetime import UTC, datetime
from typing import Optional

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import Payment
from app.core.networks import NetworkConfig, network_registry
from app.web3.indexer import EVMRpcClient
from app.web3.state_machine import PaymentStateMachine

logger = logging.getLogger(__name__)


class PaymentReconciliationService:
    """Reconciles payment records against on-chain transaction receipts."""

    @staticmethod
    def _find_network_config(network_name: str) -> Optional[NetworkConfig]:
        for n in network_registry.get_active_networks():
            if (
                n.display_name.lower() == network_name.lower()
                or str(n.chain_id) == str(network_name)
            ):
                return n
        return None

    @staticmethod
    async def reconcile_active_payments(db: AsyncSession) -> int:
        """Scan all payments in 'detected' or 'confirming' status and update on-chain status."""
        stmt = select(Payment).where(
            Payment.status.in_(["detected", "confirming"])
        )
        result = await db.execute(stmt)
        active_payments = list(result.scalars().all())

        if not active_payments:
            return 0

        logger.info("Reconciling %d active payment(s)", len(active_payments))
        updated_count = 0

        # Group by network to minimize RPC blockNumber calls
        rpc_clients: dict[str, EVMRpcClient] = {}
        block_numbers: dict[str, int] = {}

        for payment in active_payments:
            if not payment.tx_hash:
                continue

            net_cfg = PaymentReconciliationService._find_network_config(payment.network)
            if not net_cfg:
                logger.warning(
                    "Network %s for payment %s is not active or configured",
                    payment.network,
                    payment.id,
                )
                continue

            rpc_url = net_cfg.rpc_url
            if rpc_url not in rpc_clients:
                rpc_clients[rpc_url] = EVMRpcClient(rpc_url)

            client = rpc_clients[rpc_url]

            # Fetch current block number for network if not cached this run
            if rpc_url not in block_numbers:
                try:
                    block_numbers[rpc_url] = await client.get_block_number()
                except Exception as exc:
                    logger.warning("Failed to fetch block number from %s: %s", rpc_url, exc)
                    continue

            current_block = block_numbers[rpc_url]

            try:
                receipt = await client.get_transaction_receipt(payment.tx_hash)
                if receipt is None:
                    # Transaction not yet mined or dropped
                    logger.debug("Tx %s not yet mined on %s", payment.tx_hash, payment.network)
                    continue

                receipt_status = receipt.get("status")
                if receipt_status == "0x0" or receipt_status == 0:
                    # On-chain execution reverted/failed
                    logger.warning("Tx %s reverted on-chain on %s", payment.tx_hash, payment.network)
                    payment.status = "failed"
                    payment.updated_at = datetime.now(UTC)
                    await db.flush()
                    updated_count += 1
                    continue

                tx_block = int(receipt.get("blockNumber", "0x0"), 16)
                if not payment.block_number or payment.block_number != tx_block:
                    payment.block_number = tx_block

                # Update confirmations and advance state machine
                old_status = payment.status
                new_status = await PaymentStateMachine.update_confirmations(
                    payment=payment,
                    current_block=current_block,
                    db=db,
                )
                if old_status != new_status or payment.confirmations > 0:
                    updated_count += 1

            except Exception as exc:
                logger.error("Error reconciling payment %s (tx: %s): %s", payment.id, payment.tx_hash, exc)

        return updated_count
