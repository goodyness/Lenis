"""
Pydantic request/response schemas for the Verification service.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, field_validator


class VerificationRequestPayload(BaseModel):
    """Payload for POST /verification/requests (Requirement 4.1)."""

    full_legal_name: str
    country: str
    business_type: str
    website_url: str
    intended_use: str


class VerificationRequestResponse(BaseModel):
    """Response body returned on successful verification request submission (HTTP 201)."""

    request_id: uuid.UUID
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class VerificationStatusResponse(BaseModel):
    """Response body for GET /verification/requests/mine."""

    request_id: uuid.UUID
    status: str
    full_legal_name: str
    country: str
    business_type: str
    website_url: str
    intended_use: str
    rejection_reason: str | None = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ApproveRejectResponse(BaseModel):
    """Response body for approve/reject actions (HTTP 200)."""

    message: str


class RejectRequestPayload(BaseModel):
    """Payload for rejecting a verification request (Requirement 4.5)."""

    reason: str

    @field_validator("reason")
    @classmethod
    def reason_must_not_be_empty(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("reason must be at least 1 character.")
        return v
