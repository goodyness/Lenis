"""
In-app notification and email dispatch subsystem for Lenis.

Provides unified methods to persist in-app notifications and trigger
asynchronous email delivery via Celery.
"""
from __future__ import annotations

import logging
import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import Notification

logger = logging.getLogger(__name__)


async def create_in_app_notification(
    db: AsyncSession,
    user_id: uuid.UUID | str,
    title: str,
    message: str,
    type: str = "system",
    link: str | None = None,
    commit: bool = True,
) -> Notification:
    """Create and persist an in-app notification for a user.

    Parameters
    ----------
    db:
        Active SQLAlchemy async database session.
    user_id:
        Recipient user UUID.
    title:
        Short notification header.
    message:
        Detailed notification body.
    type:
        Category tag: "payment_received", "payment_underpaid", "invoice_paid",
        "kyc_decision", "wallet_added", "security_alert", "account_status", "system".
    link:
        Optional internal frontend route (e.g. "/dashboard/transactions").
    commit:
        Whether to commit the transaction immediately.
    """
    uid = uuid.UUID(str(user_id)) if not isinstance(user_id, uuid.UUID) else user_id

    notification = Notification(
        user_id=uid,
        title=title,
        message=message,
        type=type,
        link=link,
        is_read=False,
    )
    db.add(notification)
    if commit:
        await db.commit()
        await db.refresh(notification)

    logger.info("Created in-app notification for user %s: [%s] %s", uid, type, title)
    return notification
