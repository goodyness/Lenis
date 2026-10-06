"""
Celery tasks for the Web3 Indexer, Confirmation Tracker, and Payment Reconciliation.

Defines background tasks:
1. ``index_evm_blocks_task`` — polls configured EVM networks for incoming merchant payments.
2. ``reconcile_payments_task`` — checks confirmation progression and finalizes payments.
3. ``expire_stale_payments_task`` — expires pending payments older than timeout window.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import UTC, datetime, timedelta

from celery import Task
from sqlalchemy import and_, select

from app.core.celery_app import celery_app
from app.core.networks import network_registry
from app.web3.indexer import EVMIndexer, EVMRpcClient
from app.web3.reconciliation import PaymentReconciliationService
from app.web3.state_machine import PaymentStateMachine

logger = logging.getLogger(__name__)


async def _get_session():
    """Yield a fresh async database session for Celery workers."""
    from app.core.db import AsyncSessionLocal

    return AsyncSessionLocal()


# ---------------------------------------------------------------------------
# Task 1: Reconcile payments (confirmation tracker & settlement)
# ---------------------------------------------------------------------------


@celery_app.task(
    name="app.web3.tasks.reconcile_payments_task",
    ignore_result=True,
)
def reconcile_payments_task() -> None:
    """Periodic Celery Beat task that reconciles all detected and confirming payments."""
    asyncio.run(_reconcile_payments_async())


async def _reconcile_payments_async() -> int:
    async with await _get_session() as db:
        updated = await PaymentReconciliationService.reconcile_active_payments(db)
        if updated > 0:
            await db.commit()
            logger.info("reconcile_payments_task: updated %d payment(s)", updated)
        return updated


# ---------------------------------------------------------------------------
# Task 2: Index EVM blocks for all active networks
# ---------------------------------------------------------------------------


@celery_app.task(
    name="app.web3.tasks.index_evm_blocks_task",
    ignore_result=True,
)
def index_evm_blocks_task() -> None:
    """Periodic task polling active EVM networks for recent blocks and transfers."""
    asyncio.run(_index_evm_blocks_async())


async def _index_evm_blocks_async() -> None:
    import redis.asyncio as aioredis
    from app.core.redis_client import _get_pool

    networks = network_registry.get_active_networks()
    if not networks:
        return

    redis_client = None
    try:
        redis_client = aioredis.Redis(connection_pool=_get_pool())
    except Exception as r_exc:
        logger.debug("Redis unavailable for block checkpointing: %s", r_exc)

    async with await _get_session() as db:
        for net in networks:
            try:
                client = EVMRpcClient(net.rpc_url)
                current_block = await client.get_block_number()

                # Fetch last checkpoint from Redis if available
                checkpoint_key = f"lenis:indexer:last_block:{net.display_name.lower()}"
                last_block_str = None
                if redis_client:
                    try:
                        last_block_str = await redis_client.get(checkpoint_key)
                    except Exception:
                        pass

                if last_block_str:
                    from_block = int(last_block_str) + 1
                    # Cap batch scan to at most 100 blocks per iteration to prevent RPC overload
                    to_block = min(current_block, from_block + 99)
                else:
                    # Initial scan window: last 10 blocks
                    from_block = max(1, current_block - 10)
                    to_block = current_block

                if from_block <= to_block:
                    await EVMIndexer.scan_network(
                        network=net,
                        from_block=from_block,
                        to_block=to_block,
                        db=db,
                    )
                    # Persist new checkpoint
                    if redis_client:
                        try:
                            await redis_client.set(checkpoint_key, str(to_block))
                        except Exception:
                            pass
            except Exception as exc:
                logger.debug("Indexing task error on %s: %s", net.display_name, exc)
        await db.commit()
    
    if redis_client:
        try:
            await redis_client.aclose()
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Task 3: Expire stale payments
# ---------------------------------------------------------------------------


@celery_app.task(
    name="app.web3.tasks.expire_stale_payments_task",
    ignore_result=True,
)
def expire_stale_payments_task(max_age_minutes: int = 120) -> None:
    """Mark un-broadcast pending payments older than max_age_minutes as expired."""
    asyncio.run(_expire_stale_payments_async(max_age_minutes))


async def _expire_stale_payments_async(max_age_minutes: int) -> int:
    from app.core.models import Payment

    cutoff = datetime.now(UTC) - timedelta(minutes=max_age_minutes)
    async with await _get_session() as db:
        stmt = select(Payment).where(
            and_(
                Payment.status == "pending",
                Payment.created_at < cutoff,
            )
        )
        result = await db.execute(stmt)
        stale_payments = list(result.scalars().all())

        for p in stale_payments:
            await PaymentStateMachine.expire_payment(p, db)

        if stale_payments:
            await db.commit()
            logger.info("Expired %d stale pending payment(s)", len(stale_payments))
        return len(stale_payments)


# ---------------------------------------------------------------------------
# Celery Beat schedule registrations
# ---------------------------------------------------------------------------

celery_app.conf.beat_schedule.update(
    {
        "reconcile-web3-payments": {
            "task": "app.web3.tasks.reconcile_payments_task",
            "schedule": 15,  # every 15 seconds
        },
        "index-evm-blocks": {
            "task": "app.web3.tasks.index_evm_blocks_task",
            "schedule": 20,  # every 20 seconds
        },
        "expire-stale-payments": {
            "task": "app.web3.tasks.expire_stale_payments_task",
            "schedule": 300,  # every 5 minutes
        },
    }
)
