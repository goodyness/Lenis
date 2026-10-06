"""
Notification service layer for querying and updating user in-app notifications.
"""
from __future__ import annotations

import logging
import uuid
from typing import Optional

from sqlalchemy import and_, func, select, update, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import Notification
from app.notifications.schemas import NotificationListResponse, NotificationResponse

logger = logging.getLogger(__name__)


class NotificationService:
    """Service handling notification retrieval and status updates."""

    @staticmethod
    async def get_user_notifications(
        db: AsyncSession,
        user_id: uuid.UUID,
        page: int = 1,
        limit: int = 20,
        unread_only: bool = False,
    ) -> NotificationListResponse:
        """Fetch paginated notifications and total unread count for user."""
        offset = (page - 1) * limit

        # Base filter
        conditions = [Notification.user_id == user_id]
        if unread_only:
            conditions.append(Notification.is_read == False)  # noqa: E712

        # Count total matching
        total_stmt = select(func.count(Notification.id)).where(and_(*conditions))
        total_res = await db.execute(total_stmt)
        total = total_res.scalar_one() or 0

        # Count unread overall
        unread_stmt = select(func.count(Notification.id)).where(
            and_(Notification.user_id == user_id, Notification.is_read == False)  # noqa: E712
        )
        unread_res = await db.execute(unread_stmt)
        unread_count = unread_res.scalar_one() or 0

        # Query items ordered by created_at DESC
        stmt = (
            select(Notification)
            .where(and_(*conditions))
            .order_by(Notification.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
        res = await db.execute(stmt)
        rows = res.scalars().all()

        return NotificationListResponse(
            items=[NotificationResponse.model_validate(row) for row in rows],
            total=total,
            unread_count=unread_count,
            page=page,
            limit=limit,
        )

    @staticmethod
    async def get_unread_count(
        db: AsyncSession,
        user_id: uuid.UUID,
    ) -> int:
        """Return raw unread notifications count for user."""
        stmt = select(func.count(Notification.id)).where(
            and_(Notification.user_id == user_id, Notification.is_read == False)  # noqa: E712
        )
        res = await db.execute(stmt)
        return res.scalar_one() or 0

    @staticmethod
    async def mark_as_read(
        db: AsyncSession,
        user_id: uuid.UUID,
        notification_id: uuid.UUID,
    ) -> bool:
        """Mark a single notification as read."""
        stmt = (
            update(Notification)
            .where(and_(Notification.id == notification_id, Notification.user_id == user_id))
            .values(is_read=True)
        )
        res = await db.execute(stmt)
        await db.commit()
        return res.rowcount > 0

    @staticmethod
    async def mark_all_as_read(
        db: AsyncSession,
        user_id: uuid.UUID,
    ) -> int:
        """Mark all unread notifications as read for a user."""
        stmt = (
            update(Notification)
            .where(and_(Notification.user_id == user_id, Notification.is_read == False))  # noqa: E712
            .values(is_read=True)
        )
        res = await db.execute(stmt)
        await db.commit()
        return res.rowcount

    @staticmethod
    async def delete_notification(
        db: AsyncSession,
        user_id: uuid.UUID,
        notification_id: uuid.UUID,
    ) -> bool:
        """Delete a notification belonging to the user."""
        stmt = delete(Notification).where(
            and_(Notification.id == notification_id, Notification.user_id == user_id)
        )
        res = await db.execute(stmt)
        await db.commit()
        return res.rowcount > 0
