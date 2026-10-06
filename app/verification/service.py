"""
Verification service for the Lenis platform.

``VerificationService`` contains the business logic for developer KYC
verification request submission and admin review actions.

Requirements addressed by this module: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.email import send_email_task
from app.core.models import AuditLog, User, VerificationRequest
from app.verification.schemas import (
    ApproveRejectResponse,
    VerificationRequestPayload,
    VerificationRequestResponse,
    VerificationStatusResponse,
)

# ---------------------------------------------------------------------------
# Validation constants
# ---------------------------------------------------------------------------

_INTENDED_USE_MIN = 50
_INTENDED_USE_MAX = 500
_FULL_LEGAL_NAME_MAX = 200
_VALID_URL_SCHEMES = ("http://", "https://")


class VerificationService:
    """Stateless service that holds all verification business logic.

    Every public method accepts an ``AsyncSession`` as its first argument so
    that all database operations participate in the same unit of work managed
    by the FastAPI dependency (``get_db()``).
    """

    # ------------------------------------------------------------------
    # Submit Verification Request (Requirements 4.1, 4.2, 4.3, 4.7, 4.8, 4.9)
    # ------------------------------------------------------------------

    @staticmethod
    async def submit_request(
        payload: VerificationRequestPayload,
        user: User,
        db: AsyncSession,
    ) -> VerificationRequestResponse:
        """Submit a developer KYC verification request.

        Validation rules
        ----------------
        - Caller must have ``account_type == "developer"`` (403 if not)
        - All required fields must be present and non-empty (400 per field)
        - ``full_legal_name`` must be between 1 and 200 characters
        - ``website_url`` must start with ``http://`` or ``https://`` (Requirement 4.7)
        - ``intended_use`` must be between 50 and 500 characters (Requirement 4.8)
        - No existing pending or approved request may exist for this developer (409)

        Returns
        -------
        VerificationRequestResponse
            The created request's ID, status ("pending"), and creation timestamp.

        Raises
        ------
        HTTPException(403)
            Caller is not a developer.
        HTTPException(400)
            Any field validation rule is violated.
        HTTPException(409)
            A pending or approved verification request already exists.
        """
        # Allow merchants and developers to access verification / developer tools
        if user.account_type not in ("developer", "merchant"):
            raise HTTPException(
                status_code=403,
                detail={
                    "detail": "Only registered user accounts can submit verification requests.",
                    "code": "INSUFFICIENT_PRIVILEGES",
                },
            )

        # Requirement 4.9 -- validate required fields are present and non-empty
        VerificationService._validate_required_fields(payload)

        # Requirement 4.7 -- website URL must begin with http:// or https://
        if not payload.website_url.startswith(_VALID_URL_SCHEMES):
            raise HTTPException(
                status_code=400,
                detail={
                    "detail": (
                        "The website_url field must include a valid scheme "
                        "(must begin with 'http://' or 'https://')."
                    ),
                    "code": "INVALID_WEBSITE_URL",
                },
            )

        # Requirement 4.8 -- intended_use must be 50-500 characters
        intended_use_len = len(payload.intended_use)
        if intended_use_len < _INTENDED_USE_MIN or intended_use_len > _INTENDED_USE_MAX:
            raise HTTPException(
                status_code=400,
                detail={
                    "detail": (
                        f"The intended_use field must be between {_INTENDED_USE_MIN} "
                        f"and {_INTENDED_USE_MAX} characters "
                        f"(currently {intended_use_len})."
                    ),
                    "code": "INVALID_INTENDED_USE_LENGTH",
                },
            )

        # Requirement 4.3 -- reject if a pending or approved request already exists
        existing_result = await db.execute(
            select(VerificationRequest).where(
                VerificationRequest.developer_id == user.id,
                VerificationRequest.status.in_(["pending", "approved"]),
            )
        )
        existing = existing_result.scalar_one_or_none()

        if existing is not None:
            raise HTTPException(
                status_code=409,
                detail={
                    "detail": (
                        "A pending or approved verification request already exists "
                        "for this account."
                    ),
                    "code": "VERIFICATION_REQUEST_EXISTS",
                },
            )

        # Requirement 4.6 -- enforce 24-hour cooldown after rejection
        rejected_result = await db.execute(
            select(VerificationRequest)
            .where(
                VerificationRequest.developer_id == user.id,
                VerificationRequest.status == "rejected",
            )
            .order_by(VerificationRequest.rejected_at.desc())
            .limit(1)
        )
        most_recent_rejection = rejected_result.scalar_one_or_none()

        if most_recent_rejection is not None and most_recent_rejection.rejected_at is not None:
            cooldown_end = most_recent_rejection.rejected_at + timedelta(hours=24)
            now = datetime.now(UTC)
            if cooldown_end > now:
                can_resubmit_at = cooldown_end.isoformat()
                raise HTTPException(
                    status_code=400,
                    detail={
                        "detail": (
                            f"You must wait 24 hours after a rejection before resubmitting. "
                            f"You can resubmit after {can_resubmit_at}."
                        ),
                        "code": "RESUBMISSION_COOLDOWN",
                        "can_resubmit_at": can_resubmit_at,
                    },
                )

        # Requirement 4.1 -- create the verification request with status "pending"
        verification_request = VerificationRequest(
            developer_id=user.id,
            full_legal_name=payload.full_legal_name,
            country=payload.country,
            business_type=payload.business_type,
            website_url=payload.website_url,
            intended_use=payload.intended_use,
            status="pending",
        )
        db.add(verification_request)
        await db.flush()

        return VerificationRequestResponse(
            request_id=verification_request.id,
            status=verification_request.status,
            created_at=verification_request.created_at,
        )

    # ------------------------------------------------------------------
    # Get Own Verification Request (Requirement 4.2)
    # ------------------------------------------------------------------

    @staticmethod
    async def get_own_request(
        user: User,
        db: AsyncSession,
    ) -> VerificationStatusResponse:
        """Return the caller's most recent VerificationRequest.

        Retrieves the single most recent ``VerificationRequest`` for the
        authenticated developer ordered by ``created_at`` descending.
        Only developer accounts may call this endpoint (403 if not).

        Returns the full submitted details along with the current status,
        supporting the developer in tracking their verification progress
        (Requirement 4.2).

        Raises
        ------
        HTTPException(403)
            Caller is not a developer.
        HTTPException(404)
            No verification request exists for this developer.
        """
        if user.account_type not in ("developer", "merchant"):
            raise HTTPException(
                status_code=403,
                detail={
                    "detail": "Only registered user accounts have verification requests.",
                    "code": "INSUFFICIENT_PRIVILEGES",
                },
            )

        result = await db.execute(
            select(VerificationRequest)
            .where(VerificationRequest.developer_id == user.id)
            .order_by(VerificationRequest.created_at.desc())
            .limit(1)
        )
        verification_request = result.scalar_one_or_none()

        if verification_request is None:
            raise HTTPException(
                status_code=404,
                detail={
                    "detail": "No verification request found for this account.",
                    "code": "VERIFICATION_REQUEST_NOT_FOUND",
                },
            )

        return VerificationStatusResponse(
            request_id=verification_request.id,
            status=verification_request.status,
            full_legal_name=verification_request.full_legal_name,
            country=verification_request.country,
            business_type=verification_request.business_type,
            website_url=verification_request.website_url,
            intended_use=verification_request.intended_use,
            rejection_reason=verification_request.rejection_reason,
            created_at=verification_request.created_at,
            updated_at=verification_request.updated_at,
        )

    # ------------------------------------------------------------------
    # Approve Verification Request (Requirement 4.4)
    # ------------------------------------------------------------------

    @staticmethod
    async def approve_request(
        request_id: uuid.UUID,
        admin_id: uuid.UUID,
        db: AsyncSession,
    ) -> ApproveRejectResponse:
        """Approve a pending developer verification request.

        Sets the request status to "approved", marks the developer's account
        status as "verified", and writes a ``verification.approve`` audit log
        entry within the same transaction.

        Parameters
        ----------
        request_id:
            UUID of the ``VerificationRequest`` to approve.
        admin_id:
            UUID of the approving admin/superadmin user.
        db:
            Active async database session.

        Returns
        -------
        ApproveRejectResponse
            A 200 response with a confirmation message.

        Raises
        ------
        HTTPException(404)
            Request not found.
        HTTPException(400)
            Request is not in pending status.
        """
        # Look up the verification request
        result = await db.execute(
            select(VerificationRequest).where(VerificationRequest.id == request_id)
        )
        vr = result.scalar_one_or_none()

        if vr is None:
            raise HTTPException(
                status_code=404,
                detail={
                    "detail": "Verification request not found.",
                    "code": "VERIFICATION_REQUEST_NOT_FOUND",
                },
            )

        if vr.status != "pending":
            raise HTTPException(
                status_code=400,
                detail={
                    "detail": (
                        f"Cannot approve a request with status '{vr.status}'. "
                        "Only pending requests can be approved."
                    ),
                    "code": "INVALID_STATUS",
                },
            )

        # Update the verification request
        vr.status = "approved"
        vr.reviewed_by = admin_id

        # Update the developer's account status to "verified"
        developer_result = await db.execute(
            select(User).where(User.id == vr.developer_id)
        )
        developer = developer_result.scalar_one_or_none()
        if developer is not None:
            developer.status = "verified"

        # Write audit log entry (direct ORM insert — Celery wiring in task 10.1)
        audit_entry = AuditLog(
            event_type="verification.approve",
            actor_id=admin_id,
            target_type="verification_request",
            target_id=request_id,
            outcome="success",
        )
        db.add(audit_entry)

        await db.flush()

        return ApproveRejectResponse(message="Verification request approved.")

    # ------------------------------------------------------------------
    # Reject Verification Request (Requirement 4.5)
    # ------------------------------------------------------------------

    @staticmethod
    async def reject_request(
        request_id: uuid.UUID,
        admin_id: uuid.UUID,
        reason: str,
        db: AsyncSession,
    ) -> ApproveRejectResponse:
        """Reject a pending developer verification request.

        Sets the request status to "rejected", stores the rejection reason and
        timestamp, enqueues a notification email to the developer, and writes a
        ``verification.reject`` audit log entry within the same transaction.

        Parameters
        ----------
        request_id:
            UUID of the ``VerificationRequest`` to reject.
        admin_id:
            UUID of the rejecting admin/superadmin user.
        reason:
            Human-readable rejection reason stored on the record and sent to
            the developer via email.
        db:
            Active async database session.

        Returns
        -------
        ApproveRejectResponse
            A 200 response with a confirmation message.

        Raises
        ------
        HTTPException(404)
            Request not found.
        HTTPException(400)
            Request is not in pending status.
        """
        # Look up the verification request
        result = await db.execute(
            select(VerificationRequest).where(VerificationRequest.id == request_id)
        )
        vr = result.scalar_one_or_none()

        if vr is None:
            raise HTTPException(
                status_code=404,
                detail={
                    "detail": "Verification request not found.",
                    "code": "VERIFICATION_REQUEST_NOT_FOUND",
                },
            )

        if vr.status != "pending":
            raise HTTPException(
                status_code=400,
                detail={
                    "detail": (
                        f"Cannot reject a request with status '{vr.status}'. "
                        "Only pending requests can be rejected."
                    ),
                    "code": "INVALID_STATUS",
                },
            )

        now = datetime.now(UTC)

        # Update the verification request
        vr.status = "rejected"
        vr.rejection_reason = reason
        vr.rejected_at = now
        vr.reviewed_by = admin_id

        # Load the developer to get their email for the notification
        developer_result = await db.execute(
            select(User).where(User.id == vr.developer_id)
        )
        developer = developer_result.scalar_one_or_none()

        # Write audit log entry (direct ORM insert — Celery wiring in task 10.1)
        audit_entry = AuditLog(
            event_type="verification.reject",
            actor_id=admin_id,
            target_type="verification_request",
            target_id=request_id,
            outcome="success",
        )
        db.add(audit_entry)

        await db.flush()

        # Enqueue rejection notification email (Requirement 4.5)
        # Dispatched after flush so request_id and data are confirmed persisted
        if developer is not None:
            send_email_task.delay(
                to=developer.email,
                subject="Your Lenis verification request has been reviewed",
                template="verification_rejected",
                context={
                    "full_legal_name": vr.full_legal_name,
                    "rejection_reason": reason,
                    "resubmit_after": (now + timedelta(hours=24)).isoformat(),
                },
            )

        return ApproveRejectResponse(message="Verification request rejected.")

    # ------------------------------------------------------------------
    # Private validation helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _validate_required_fields(payload: VerificationRequestPayload) -> None:
        """Raise HTTP 400 if any required field is absent or empty.

        Checks each field individually and collects all failing field names
        so that the error message identifies every offending field
        (Requirement 4.9).
        """
        missing_fields: list[str] = []

        if not payload.full_legal_name or not payload.full_legal_name.strip():
            missing_fields.append("full_legal_name")
        elif len(payload.full_legal_name) > _FULL_LEGAL_NAME_MAX:
            raise HTTPException(
                status_code=400,
                detail={
                    "detail": (
                        f"The full_legal_name field must not exceed "
                        f"{_FULL_LEGAL_NAME_MAX} characters."
                    ),
                    "code": "INVALID_FULL_LEGAL_NAME",
                },
            )

        if not payload.country or not payload.country.strip():
            missing_fields.append("country")

        if not payload.business_type or not payload.business_type.strip():
            missing_fields.append("business_type")

        if not payload.website_url or not payload.website_url.strip():
            missing_fields.append("website_url")

        if not payload.intended_use or not payload.intended_use.strip():
            missing_fields.append("intended_use")

        if missing_fields:
            field_list = ", ".join(missing_fields)
            raise HTTPException(
                status_code=400,
                detail={
                    "detail": (
                        f"The following required fields are missing or empty: "
                        f"{field_list}."
                    ),
                    "code": "MISSING_REQUIRED_FIELDS",
                    "fields": missing_fields,
                },
            )
