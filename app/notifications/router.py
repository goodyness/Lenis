"""
FastAPI router for user in-app notifications.
"""
from __future__ import annotations

import uuid
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.dependencies import get_current_user
from app.core.models import User
from app.notifications.schemas import (
    MarkReadResponse,
    NotificationListResponse,
    NotificationResponse,
)
from app.notifications.service import NotificationService

router = APIRouter()


@router.get(
    "",
    response_model=NotificationListResponse,
    summary="List current user notifications",
)
async def list_notifications(
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=100),
    unread_only: bool = Query(default=False),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> NotificationListResponse:
    """Fetch paginated notifications for the authenticated user."""
    return await NotificationService.get_user_notifications(
        db=db,
        user_id=current_user.id,
        page=page,
        limit=limit,
        unread_only=unread_only,
    )


@router.get(
    "/unread-count",
    summary="Get unread notifications count",
)
async def get_unread_count(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict[str, int]:
    """Get count of unread notifications for badge display."""
    count = await NotificationService.get_unread_count(db=db, user_id=current_user.id)
    return {"unread_count": count}


@router.patch(
    "/{notification_id}/read",
    response_model=MarkReadResponse,
    summary="Mark a single notification as read",
)
async def mark_notification_read(
    notification_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MarkReadResponse:
    """Mark a specific notification as read."""
    success = await NotificationService.mark_as_read(
        db=db,
        user_id=current_user.id,
        notification_id=notification_id,
    )
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notification not found",
        )
    return MarkReadResponse(success=True, updated_count=1)


@router.post(
    "/mark-all-read",
    response_model=MarkReadResponse,
    summary="Mark all notifications as read",
)
async def mark_all_notifications_read(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MarkReadResponse:
    """Mark all unread notifications as read for current user."""
    count = await NotificationService.mark_all_as_read(
        db=db,
        user_id=current_user.id,
    )
    return MarkReadResponse(success=True, updated_count=count)


@router.delete(
    "/{notification_id}",
    response_model=MarkReadResponse,
    summary="Delete a notification",
)
async def delete_notification(
    notification_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> MarkReadResponse:
    """Delete a notification from user list."""
    success = await NotificationService.delete_notification(
        db=db,
        user_id=current_user.id,
        notification_id=notification_id,
    )
    if not success:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Notification not found",
        )
    return MarkReadResponse(success=True, updated_count=1)
