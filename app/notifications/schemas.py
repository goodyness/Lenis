"""
Pydantic schemas for the Notifications service.
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class NotificationResponse(BaseModel):
    """Single in-app notification response."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    type: str
    title: str
    message: str
    link: Optional[str] = None
    is_read: bool
    created_at: datetime


class NotificationListResponse(BaseModel):
    """Paginated list of notifications with unread counter."""

    items: list[NotificationResponse]
    total: int
    unread_count: int
    page: int
    limit: int


class MarkReadResponse(BaseModel):
    """Response returned when notifications are marked read."""

    success: bool
    updated_count: int
