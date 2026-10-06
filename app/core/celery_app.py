"""
Celery application instance for the Lenis platform.

Background tasks (email delivery, audit log writes) are defined in their
respective modules and registered by importing this instance. Redis serves
as both the broker and the result backend.

Usage in a task module::

    from app.core.celery_app import celery_app

    @celery_app.task(bind=True, max_retries=3)
    def my_task(self, ...):
        ...
"""
from __future__ import annotations

from celery import Celery
from celery.schedules import crontab

from app.core.config import settings

# ---------------------------------------------------------------------------
# Application instance
# ---------------------------------------------------------------------------

celery_app = Celery(
    "lenis",
    broker=settings.celery_broker_url,
    backend=settings.celery_result_backend,
    include=[
        "app.core.email",
        "app.core.tasks",
        "app.web3.tasks",
        "app.web3.indexer",
        "app.webhooks.delivery",
    ],
)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

celery_app.conf.update(
    # Serialisation
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    # Timezone
    timezone="UTC",
    enable_utc=True,
    # Task behaviour
    task_acks_late=True,          # acknowledge only after the task completes
    task_reject_on_worker_lost=True,  # re-queue if the worker dies mid-task
    # Result expiry: keep results for 24 hours then discard
    result_expires=86_400,
    # Windows: prefork pool doesn't work; solo is used for local dev
    # Override at startup with --pool=threads for concurrency
    worker_pool='solo',
    # In development run tasks synchronously (inline) so no Celery worker
    # process is needed. In production this must be False.
    task_always_eager=(settings.app_env != 'production'),
    task_eager_propagates=True,  # surface exceptions immediately in dev
    # ---------------------------------------------------------------------------
    # Celery Beat schedule
    # ---------------------------------------------------------------------------
    beat_schedule={
        "poll-blockchain-events": {
            "task": "app.web3.indexer.poll_blockchain_events",
            "schedule": 15.0,  # seconds
        },
        "monitor-subscription-expirations": {
            "task": "app.core.tasks.monitor_subscription_expirations",
            "schedule": 60.0,  # runs every 1 minute
        },
        "reset-monthly-tx-counts": {
            "task": "app.core.tasks.reset_monthly_tx_counts",
            "schedule": crontab(hour=0, minute=5),  # 00:05 UTC on the 1st of each month
        },
        "check-stablecoin-pegs": {
            "task": "app.core.tasks.check_stablecoin_pegs",
            "schedule": 300.0,  # every 5 minutes
        },
    },
)
