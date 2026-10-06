"""
FastAPI router for the Verification service.

Registers verification endpoints under the ``/verification`` prefix applied
in ``app/main.py``.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.dependencies import get_current_user
from app.core.models import User
from app.verification.schemas import (
    VerificationRequestPayload,
    VerificationRequestResponse,
    VerificationStatusResponse,
)
from app.verification.service import VerificationService

router = APIRouter()


# ---------------------------------------------------------------------------
# POST /verification/requests
# ---------------------------------------------------------------------------


@router.post(
    "/requests",
    response_model=VerificationRequestResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Submit a developer KYC verification request",
    description=(
        "Allows a developer account to submit identity and business information "
        "for KYC-like review by an admin. The request is created with status "
        "'pending'. Only developer accounts may submit; a 409 is returned if a "
        "pending or approved request already exists. "
        "Requirements: 4.1, 4.2, 4.3, 4.7, 4.8, 4.9"
    ),
)
async def submit_verification_request(
    payload: VerificationRequestPayload,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> VerificationRequestResponse:
    """Submit a developer verification request.

    Requires a valid ``Authorization: Bearer <access_token>`` header.

    Returns HTTP 201 with ``{ request_id, status, created_at }`` on success.
    Returns HTTP 400 if any required field is missing, empty, or fails
    validation (website URL scheme, intended_use length).
    Returns HTTP 403 if the authenticated account is not a developer.
    Returns HTTP 409 if a pending or approved request already exists.
    """
    return await VerificationService.submit_request(
        payload=payload,
        user=current_user,
        db=db,
    )


# ---------------------------------------------------------------------------
# GET /verification/requests/mine
# ---------------------------------------------------------------------------


@router.get(
    "/requests/mine",
    response_model=VerificationStatusResponse,
    status_code=status.HTTP_200_OK,
    summary="Get own verification request status and details",
    description=(
        "Returns the most recent verification request for the authenticated "
        "developer, including all submitted fields and the current status. "
        "Returns 404 if no request has been submitted yet. "
        "Requirements: 4.2"
    ),
)
async def get_own_verification_request(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> VerificationStatusResponse:
    """Return the authenticated developer's most recent verification request.

    Requires a valid ``Authorization: Bearer <access_token>`` header.

    Returns HTTP 200 with the full request details and current status.
    Returns HTTP 403 if the authenticated account is not a developer.
    Returns HTTP 404 if no verification request has been submitted.
    """
    return await VerificationService.get_own_request(
        user=current_user,
        db=db,
    )
