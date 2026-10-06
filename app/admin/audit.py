"""
Audit logging service for the Lenis platform.

``AuditLogService`` provides a non-blocking ``create_entry()`` method that
dispatches audit log writes to a Celery background task so that the
originating API response is never held waiting for a database write.

``write_audit_log_task`` performs the actual INSERT. On failure it retries up
to three times; after the third failure the payload is written to a Redis
dead-letter key (``audit_dead_letter:{uuid}``) rather than discarded,
satisfying Requirement 8.2.

Requirements addressed: 8.1, 8.2, 8.5
"""
from __future__ import annotations

import json
import uuid
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from typing import Optional

import redis
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.core.celery_app import celery_app
from app.core.config import settings

# ---------------------------------------------------------------------------
# AuditEntryPayload
# ---------------------------------------------------------------------------


@dataclass
class AuditEntryPayload:
    """Strongly-typed payload for a single audit log entry.

    All fields map directly to the ``audit_logs`` table columns defined in
    the design document. ``created_at`` defaults to the current UTC time at
    instantiation so callers do not need to supply it explicitly.

    Fields
    ------
    event_type:
        Machine-readable event identifier, e.g. ``"user.login.success"``.
    actor_id:
        UUID of the user (or system process) that triggered the event.
    target_type:
        The resource type the event targets, e.g. ``"user"`` or ``"api_key"``.
    target_id:
        UUID of the specific resource targeted by the event.
    outcome:
        Either ``"success"`` or ``"failure"``.
    client_ip:
        IPv4 or IPv6 address of the originating client, up to 45 characters.
        May be ``None`` for events without a direct HTTP client (e.g. system
        startup events).
    created_at:
        UTC timestamp accurate to the millisecond. Defaults to ``now(UTC)``.
    """

    event_type: str
    actor_id: uuid.UUID
    target_type: str
    target_id: uuid.UUID
    outcome: str
    client_ip: Optional[str] = None
    created_at: datetime = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if self.created_at is None:
            self.created_at = datetime.now(UTC)

    def to_dict(self) -> dict:
        """Return a JSON-serialisable dict for Celery task arguments.

        UUIDs are converted to strings and the datetime is serialised as an
        ISO 8601 string with timezone information.
        """
        return {
            "event_type": self.event_type,
            "actor_id": str(self.actor_id),
            "target_type": self.target_type,
            "target_id": str(self.target_id),
            "outcome": self.outcome,
            "client_ip": self.client_ip,
            "created_at": self.created_at.isoformat(),
        }


# ---------------------------------------------------------------------------
# AuditLogService
# ---------------------------------------------------------------------------


class AuditLogService:
    """Non-blocking audit log entry creation.

    ``create_entry()`` dispatches the DB write to the Celery worker so the
    API response is returned immediately after enqueueing, satisfying the
    "within 5ms without blocking" requirement (Req 8.2) and the "dispatched
    within the same request cycle" requirement (Req 8.5).
    """

    @staticmethod
    def create_entry(payload: AuditEntryPayload) -> None:
        """Enqueue an audit log write without blocking the calling coroutine.

        The Celery task is dispatched synchronously (``apply_async`` returns
        immediately after placing the message on the broker queue). The actual
        DB insert happens in a Celery worker process.

        Parameters
        ----------
        payload:
            The audit log data to persist.

        Requirements 8.2, 8.5
        """
        write_audit_log_task.apply_async(
            args=[payload.to_dict()],
        )


# ---------------------------------------------------------------------------
# Celery write task
# ---------------------------------------------------------------------------

# Synchronous SQLAlchemy engine and session factory used inside the Celery
# task. Celery workers are synchronous; we cannot use the async engine from
# app.core.db here. The DATABASE_URL for SQLite uses ``sqlite:///`` (no
# ``+aiosqlite``) so we strip the async driver if present.

def _sync_database_url(url: str) -> str:
    """Convert an async SQLAlchemy URL to its synchronous equivalent.

    Strips ``+aiosqlite`` and ``+asyncpg`` driver suffixes so the
    synchronous Celery worker can use the same DATABASE_URL setting.
    """
    return url.replace("+aiosqlite", "").replace("+asyncpg", "")


_sync_engine = create_engine(
    _sync_database_url(settings.database_url),
    connect_args={"check_same_thread": False}
    if "sqlite" in settings.database_url
    else {},
)

_SyncSessionLocal: sessionmaker[Session] = sessionmaker(
    bind=_sync_engine,
    autocommit=False,
    autoflush=False,
)


@celery_app.task(
    bind=True,
    name="app.admin.audit.write_audit_log_task",
    max_retries=3,
    default_retry_delay=1,
)
def write_audit_log_task(self, payload_dict: dict) -> None:  # type: ignore[override]
    """Celery task: insert a single audit log record into the database.

    Retries up to three times on any DB failure (exponential-ish delay via
    ``default_retry_delay``). After the third retry failure, the payload is
    written to a Redis dead-letter key rather than discarded, ensuring no
    audit entry is ever lost (Req 8.2).

    Parameters
    ----------
    self:
        Bound task instance (required for ``self.retry()``).
    payload_dict:
        JSON-serialisable dict produced by ``AuditEntryPayload.to_dict()``.
    """
    # Import here to avoid circular imports at module load time.
    from app.core.models import AuditLog

    try:
        with _SyncSessionLocal() as db:
            entry = AuditLog(
                event_type=payload_dict["event_type"],
                actor_id=uuid.UUID(payload_dict["actor_id"]),
                target_type=payload_dict["target_type"],
                target_id=uuid.UUID(payload_dict["target_id"]),
                outcome=payload_dict["outcome"],
                client_ip=payload_dict.get("client_ip"),
                created_at=datetime.fromisoformat(payload_dict["created_at"]),
            )
            db.add(entry)
            db.commit()
    except Exception as exc:
        # If we still have retries remaining, re-queue the task.
        if self.request.retries < self.max_retries:
            raise self.retry(exc=exc)

        # All retries exhausted: write to Redis dead-letter store so the
        # entry is not silently discarded (Req 8.2).
        _write_dead_letter(payload_dict)


def _write_dead_letter(payload_dict: dict) -> None:
    """Persist a failed audit log payload to the Redis dead-letter store.

    Uses the synchronous ``redis`` client because this function is called
    from inside a synchronous Celery task. The key pattern is
    ``audit_dead_letter:{uuid4}`` as specified in the design document.

    Parameters
    ----------
    payload_dict:
        The original payload that failed to be inserted into the database.
    """
    dead_letter_key = f"audit_dead_letter:{uuid.uuid4()}"
    sync_redis = redis.Redis.from_url(
        settings.redis_url,
        encoding="utf-8",
        decode_responses=True,
    )
    try:
        sync_redis.set(dead_letter_key, json.dumps(payload_dict))
    finally:
        sync_redis.close()
