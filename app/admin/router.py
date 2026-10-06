"""
FastAPI router for the Admin service.

Registers admin-facing endpoints under the ``/admin`` prefix applied in
``app/main.py``.

All endpoints require an admin or superadmin session via the
``require_admin`` dependency (Requirement 7.11). The suspension,
reactivation, and promotion endpoints additionally require a superadmin
session via ``require_superadmin`` (Requirements 7.5, 7.9).

Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 7.8, 7.9
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.admin.dependencies import (
    require_admin,
    require_admin_flexible,
    require_superadmin,
)
from app.admin.schemas import (
    AdminPayerDetailResponse,
    AuditLogItem,
    DashboardSummaryResponse,
    KYCApproveRequest,
    KYCDocumentsResponse,
    KYCRejectRequest,
    MerchantDetailResponse,
    OkResponse,
    PaginatedAdminPayersResponse,
    PaginatedAuditLogResponse,
    PaginatedAppealsResponse,
    PaginatedMerchantsResponse,
    PaginatedUsersResponse,
    PaginatedVerificationRequestsResponse,
    ReviewAppealRequest,
    RevokeKYCRequest,
    SectionRejectRequest,
    SuspendRequest,
    SuspendWithReasonRequest,
    UnsuspendRequest,
    VerificationRequestDetail,
)
from app.users.schemas import APIKeyHistoryResponse
from app.merchant.schemas import (
    PayerDirectoryResponse,
    TransactionListResponse,
)
from app.admin.service import AdminService
from app.core.db import get_db
from app.core.models import User
from app.subscriptions.schemas import (
    PlatformWalletCreate,
    PlatformWalletListResponse,
    PlatformWalletResponse,
    PlatformWalletUpdate,
    SubscriptionPaymentListResponse,
)
from app.subscriptions.service import SubscriptionService
from app.verification.schemas import ApproveRejectResponse, RejectRequestPayload
from app.verification.service import VerificationService

router = APIRouter()


# ---------------------------------------------------------------------------
# GET /admin/dashboard
# ---------------------------------------------------------------------------


@router.get(
    "/dashboard",
    response_model=DashboardSummaryResponse,
    status_code=status.HTTP_200_OK,
    summary="Admin dashboard summary",
    description=(
        "Returns summary counts for the admin dashboard: total users, pending "
        "verification requests, verified developers, and active merchants. "
        "Requires an admin or superadmin session. "
        "Requirement: 7.1"
    ),
)
async def get_dashboard_summary(
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> DashboardSummaryResponse:
    """Return aggregate metric counts for the admin dashboard overview.

    Returns HTTP 200 with ``{ total_users, pending_verification_requests,
    verified_developers, active_merchants }`` on success.
    Returns HTTP 401 if the Bearer token is missing, invalid, or expired.
    Returns HTTP 403 if the session does not have admin or superadmin role.
    """
    return await AdminService.get_dashboard_summary(db=db)


# ---------------------------------------------------------------------------
# GET /admin/users
# ---------------------------------------------------------------------------


@router.get(
    "/users",
    response_model=PaginatedUsersResponse,
    status_code=status.HTTP_200_OK,
    summary="Paginated list of all platform users",
    description=(
        "Returns a paginated list of all users with optional filtering by "
        "status and account_type. Default page size is 20, maximum is 100. "
        "Results are ordered by creation date descending. "
        "Requires an admin or superadmin session. "
        "Requirement: 7.2"
    ),
)
async def list_users(
    page: Annotated[int, Query(ge=1, description="Page number (1-based)")] = 1,
    page_size: Annotated[
        int,
        Query(ge=1, le=100, description="Records per page (max 100)"),
    ] = 20,
    status_filter: Annotated[
        str | None,
        Query(
            alias="status",
            description=(
                "Filter by account status: unverified, active, suspended, verified"
            ),
        ),
    ] = None,
    account_type: Annotated[
        str | None,
        Query(
            description=(
                "Filter by account type: merchant, developer, admin, superadmin"
            ),
        ),
    ] = None,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> PaginatedUsersResponse:
    """Return a paginated, optionally filtered list of platform users.

    Returns HTTP 200 with ``{ items, total, page, page_size, pages }``
    on success.
    Returns HTTP 401 if the Bearer token is missing, invalid, or expired.
    Returns HTTP 403 if the session does not have admin or superadmin role.
    """
    return await AdminService.list_users(
        db=db,
        page=page,
        page_size=page_size,
        status=status_filter,
        account_type=account_type,
    )


# ---------------------------------------------------------------------------
# POST /admin/users/{user_id}/suspend
# ---------------------------------------------------------------------------


@router.post(
    "/users/{user_id}/suspend",
    response_model=OkResponse,
    status_code=status.HTTP_200_OK,
    summary="Suspend a user account",
    description=(
        "Suspends the specified user account and revokes all of their active "
        "refresh tokens. An admin may not suspend a superadmin account. "
        "Requires a superadmin session. "
        "Requirements: 7.3, 7.5, 7.8"
    ),
)
async def suspend_user(
    user_id: uuid.UUID,
    body: SuspendWithReasonRequest = SuspendWithReasonRequest(),
    current_user: User = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
) -> OkResponse:
    """Suspend a platform user.

    Returns HTTP 200 on success.
    Returns HTTP 403 if the target is a superadmin and the caller is not.
    Returns HTTP 404 if the target user does not exist.
    Returns HTTP 401 if the Bearer token is missing, invalid, or expired.
    Returns HTTP 403 if the session does not have superadmin role.
    """
    return await AdminService.suspend_user(
        db=db,
        actor_id=current_user.id,
        target_id=user_id,
        reason=body.reason,
        message=body.message,
    )


# ---------------------------------------------------------------------------
# POST /admin/users/{user_id}/reactivate
# ---------------------------------------------------------------------------


@router.post(
    "/users/{user_id}/reactivate",
    response_model=OkResponse,
    status_code=status.HTTP_200_OK,
    summary="Reactivate a suspended user account",
    description=(
        "Reactivates a previously suspended user account. An admin may not "
        "reactivate a superadmin account. "
        "Requires a superadmin session. "
        "Requirements: 7.4, 7.5, 7.9"
    ),
)
async def reactivate_user(
    user_id: uuid.UUID,
    current_user: User = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
) -> OkResponse:
    """Reactivate a suspended platform user.

    Returns HTTP 200 on success.
    Returns HTTP 403 if the target is a superadmin and the caller is not.
    Returns HTTP 404 if the target user does not exist.
    Returns HTTP 401 if the Bearer token is missing, invalid, or expired.
    Returns HTTP 403 if the session does not have superadmin role.
    """
    return await AdminService.reactivate_user(
        db=db,
        actor_id=current_user.id,
        target_id=user_id,
    )


# ---------------------------------------------------------------------------
# POST /admin/users/{user_id}/promote-admin
# ---------------------------------------------------------------------------


@router.post(
    "/users/{user_id}/promote-admin",
    response_model=OkResponse,
    status_code=status.HTTP_200_OK,
    summary="Promote a user to the admin role",
    description=(
        "Promotes the specified user to the admin role. "
        "Only superadmins may perform this action. "
        "Requirements: 7.5, 7.9"
    ),
)
async def promote_to_admin(
    user_id: uuid.UUID,
    current_user: User = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
) -> OkResponse:
    """Promote a platform user to the admin role.

    Returns HTTP 200 on success.
    Returns HTTP 404 if the target user does not exist.
    Returns HTTP 401 if the Bearer token is missing, invalid, or expired.
    Returns HTTP 403 if the session does not have superadmin role.
    """
    return await AdminService.promote_to_admin(
        db=db,
        actor_id=current_user.id,
        target_id=user_id,
    )


# ---------------------------------------------------------------------------
# GET /admin/verification-requests
# ---------------------------------------------------------------------------


@router.get(
    "/verification-requests",
    response_model=PaginatedVerificationRequestsResponse,
    status_code=status.HTTP_200_OK,
    summary="Paginated list of all developer verification requests",
    description=(
        "Returns a paginated list of developer verification requests with "
        "optional filtering by status (pending, approved, rejected). "
        "Default page size is 20, maximum is 100. "
        "Results are ordered by creation date descending. "
        "Requires an admin or superadmin session. "
        "Requirement: 7.6"
    ),
)
async def list_verification_requests(
    page: Annotated[int, Query(ge=1, description="Page number (1-based)")] = 1,
    page_size: Annotated[
        int,
        Query(ge=1, le=100, description="Records per page (max 100)"),
    ] = 20,
    status_filter: Annotated[
        str | None,
        Query(
            alias="status",
            description="Filter by status: pending, approved, rejected",
        ),
    ] = None,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> PaginatedVerificationRequestsResponse:
    """Return a paginated, optionally filtered list of developer verification requests.

    Returns HTTP 200 with ``{ items, total, page, page_size, pages }`` on success.
    Returns HTTP 401 if the Bearer token is missing, invalid, or expired.
    Returns HTTP 403 if the session does not have admin or superadmin role.
    """
    return await AdminService.list_verification_requests(
        db=db,
        page=page,
        page_size=page_size,
        status_filter=status_filter,
    )


# ---------------------------------------------------------------------------
# GET /admin/verification-requests/{request_id}
# ---------------------------------------------------------------------------


@router.get(
    "/verification-requests/{request_id}",
    response_model=VerificationRequestDetail,
    status_code=status.HTTP_200_OK,
    summary="Get verification request detail",
    description=(
        "Returns full detail for a single developer verification request, "
        "including all submitted fields and review metadata. "
        "Requires an admin or superadmin session. "
        "Requirement: 7.7"
    ),
)
async def get_verification_request(
    request_id: uuid.UUID,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> VerificationRequestDetail:
    """Return full detail for a single developer verification request.

    Returns HTTP 200 with the full request detail on success.
    Returns HTTP 404 if the verification request does not exist.
    Returns HTTP 401 if the Bearer token is missing, invalid, or expired.
    Returns HTTP 403 if the session does not have admin or superadmin role.
    """
    return await AdminService.get_verification_request(db=db, request_id=request_id)


# ---------------------------------------------------------------------------
# POST /admin/verification-requests/{request_id}/approve
# ---------------------------------------------------------------------------


@router.post(
    "/verification-requests/{request_id}/approve",
    response_model=ApproveRejectResponse,
    status_code=status.HTTP_200_OK,
    summary="Approve a developer verification request",
    description=(
        "Approves a pending developer verification request. Sets the request "
        "status to 'approved' and the developer's account status to 'verified'. "
        "Requires an admin or superadmin session. "
        "Requirement: 7.6"
    ),
)
async def approve_verification_request(
    request_id: uuid.UUID,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> ApproveRejectResponse:
    """Approve a pending developer verification request.

    Returns HTTP 200 on success.
    Returns HTTP 400 if the request is not in 'pending' status.
    Returns HTTP 404 if the verification request does not exist.
    Returns HTTP 401 if the Bearer token is missing, invalid, or expired.
    Returns HTTP 403 if the session does not have admin or superadmin role.
    """
    return await VerificationService.approve_request(
        request_id=request_id,
        admin_id=current_user.id,
        db=db,
    )


# ---------------------------------------------------------------------------
# POST /admin/verification-requests/{request_id}/reject
# ---------------------------------------------------------------------------


@router.post(
    "/verification-requests/{request_id}/reject",
    response_model=ApproveRejectResponse,
    status_code=status.HTTP_200_OK,
    summary="Reject a developer verification request",
    description=(
        "Rejects a pending developer verification request with a mandatory "
        "rejection reason. Enqueues a notification email to the developer. "
        "Requires an admin or superadmin session. "
        "Requirement: 7.6"
    ),
)
async def reject_verification_request(
    request_id: uuid.UUID,
    payload: RejectRequestPayload,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> ApproveRejectResponse:
    """Reject a pending developer verification request.

    Returns HTTP 200 on success.
    Returns HTTP 400 if the request is not in 'pending' status or if the
    reason is missing/empty.
    Returns HTTP 404 if the verification request does not exist.
    Returns HTTP 401 if the Bearer token is missing, invalid, or expired.
    Returns HTTP 403 if the session does not have admin or superadmin role.
    """
    return await VerificationService.reject_request(
        request_id=request_id,
        admin_id=current_user.id,
        reason=payload.reason,
        db=db,
    )


# ---------------------------------------------------------------------------
# GET /admin/audit-log
# ---------------------------------------------------------------------------


@router.get(
    "/audit-log",
    response_model=PaginatedAuditLogResponse,
    status_code=status.HTTP_200_OK,
    summary="Paginated, filterable audit log",
    description=(
        "Returns a paginated list of audit log entries ordered by creation "
        "timestamp descending. Supports filtering by actor_id, event_type, "
        "and a UTC date range (date_from / date_to). Default page size is 50, "
        "maximum is 200. "
        "Requires an admin or superadmin session. "
        "Requirement: 8.4"
    ),
)
async def list_audit_log(
    page: Annotated[int, Query(ge=1, description="Page number (1-based)")] = 1,
    page_size: Annotated[
        int,
        Query(ge=1, le=200, description="Records per page (max 200)"),
    ] = 50,
    actor_id: Annotated[
        Optional[uuid.UUID],
        Query(description="Filter by the UUID of the actor who triggered the event"),
    ] = None,
    event_type: Annotated[
        Optional[str],
        Query(description="Filter by event type string, e.g. user.login.success"),
    ] = None,
    date_from: Annotated[
        Optional[datetime],
        Query(description="Lower bound on created_at (UTC, inclusive)"),
    ] = None,
    date_to: Annotated[
        Optional[datetime],
        Query(description="Upper bound on created_at (UTC, inclusive)"),
    ] = None,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> PaginatedAuditLogResponse:
    """Return a paginated, optionally filtered audit log.

    Returns HTTP 200 with ``{ items, total, page, page_size, pages }`` on success.
    Returns HTTP 401 if the Bearer token is missing, invalid, or expired.
    Returns HTTP 403 if the session does not have admin or superadmin role.
    """
    return await AdminService.list_audit_log(
        db=db,
        page=page,
        page_size=page_size,
        actor_id=actor_id,
        event_type=event_type,
        date_from=date_from,
        date_to=date_to,
    )


# ---------------------------------------------------------------------------
# GET /admin/merchants
# ---------------------------------------------------------------------------


@router.get(
    "/merchants",
    response_model=PaginatedMerchantsResponse,
    status_code=status.HTTP_200_OK,
    summary="Paginated list of merchants",
    description=(
        "Returns a paginated list of all merchant accounts with onboarding "
        "status, KYC status, and active wallet count. Default page size is 20, "
        "maximum is 100. Results are ordered by creation date descending. "
        "Requires an admin or superadmin session. "
        "Requirement: 14.1"
    ),
)
async def list_merchants(
    page: Annotated[int, Query(ge=1, description="Page number (1-based)")] = 1,
    page_size: Annotated[
        int,
        Query(ge=1, le=100, description="Records per page (max 100)"),
    ] = 20,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> PaginatedMerchantsResponse:
    """Return a paginated list of merchant accounts.

    Returns HTTP 200 with ``{ items, total, page, page_size, pages }`` on success.
    Returns HTTP 401 if the Bearer token is missing, invalid, or expired.
    Returns HTTP 403 if the session does not have admin or superadmin role.
    """
    return await AdminService.list_merchants(db=db, page=page, page_size=page_size)


# ---------------------------------------------------------------------------
# GET /admin/merchants/{user_id}
# ---------------------------------------------------------------------------


@router.get(
    "/merchants/{user_id}",
    response_model=MerchantDetailResponse,
    status_code=status.HTTP_200_OK,
    summary="Full merchant profile detail",
    description=(
        "Returns the complete merchant profile including personal info, business "
        "info, KYC status, wallets, payment link count, invoice count, and total "
        "confirmed payment volume. "
        "Requires an admin or superadmin session. "
        "Requirements: 14.2, 14.3"
    ),
)
async def get_merchant_detail(
    user_id: uuid.UUID,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> MerchantDetailResponse:
    """Return full detail for a single merchant account.

    Returns HTTP 200 with the full merchant detail on success.
    Returns HTTP 404 if the merchant does not exist.
    Returns HTTP 401 if the Bearer token is missing, invalid, or expired.
    Returns HTTP 403 if the session does not have admin or superadmin role.
    """
    return await AdminService.get_merchant_detail(db=db, user_id=user_id)


# ---------------------------------------------------------------------------
# GET /admin/merchants/{user_id}/api-keys
# ---------------------------------------------------------------------------


@router.get(
    "/merchants/{user_id}/api-keys",
    response_model=APIKeyHistoryResponse,
    status_code=status.HTTP_200_OK,
    summary="Merchant API keys credentials and rotation history",
    description="Returns all active and historical revoked API keys for the specified merchant.",
)
async def get_merchant_api_keys(
    user_id: uuid.UUID,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> APIKeyHistoryResponse:
    """Return API keys credentials and rotation history for a merchant."""
    return await AdminService.get_merchant_api_keys(db=db, user_id=user_id)


# ---------------------------------------------------------------------------
# GET /admin/merchants/{user_id}/kyc-documents
# ---------------------------------------------------------------------------


@router.get(
    "/merchants/{user_id}/kyc-documents",
    response_model=KYCDocumentsResponse,
    status_code=status.HTTP_200_OK,
    summary="Presigned KYC and registration document download URLs",
    description=(
        "Returns presigned download URLs (expiring in 15 minutes) for the "
        "merchant's KYC identity document and optional business registration "
        "document. A URL field is null when no document has been uploaded. "
        "Requires an admin or superadmin session. "
        "Requirements: 14.4, 15.6"
    ),
)
async def get_kyc_documents(
    user_id: uuid.UUID,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> KYCDocumentsResponse:
    """Return presigned document download URLs for a merchant's KYC submission.

    Returns HTTP 200 with signed URLs on success.
    Returns HTTP 404 if the merchant does not exist.
    Returns HTTP 401 if the Bearer token is missing, invalid, or expired.
    Returns HTTP 403 if the session does not have admin or superadmin role.
    """
    return await AdminService.get_kyc_documents(db=db, user_id=user_id)


# ---------------------------------------------------------------------------
# GET /admin/merchants/{user_id}/documents/{doc_type}
# ---------------------------------------------------------------------------


@router.get(
    "/merchants/{user_id}/documents/{doc_type}",
    summary="Download or stream merchant document file",
    description=(
        "Streams the raw bytes of the KYC or business registration document "
        "with the correct Content-Type and inline Content-Disposition for browser display. "
        "Requires an admin or superadmin session (Bearer header or query token)."
    ),
)
async def get_merchant_document_file(
    user_id: uuid.UUID,
    doc_type: str,
    token: Optional[str] = Query(None),
    current_user: User = Depends(require_admin_flexible),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Return raw document file bytes for KYC or business registration."""
    from sqlalchemy import select
    from app.core.models import MerchantProfile
    from app.core.storage import get_storage_backend

    if doc_type not in {"kyc", "registration"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "detail": "Invalid doc_type. Must be 'kyc' or 'registration'.",
                "code": "INVALID_DOC_TYPE",
            },
        )

    result = await db.execute(
        select(MerchantProfile).where(MerchantProfile.user_id == user_id)
    )
    profile = result.scalar_one_or_none()
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"detail": "Merchant not found.", "code": "MERCHANT_NOT_FOUND"},
        )

    path = profile.kyc_document_path if doc_type == "kyc" else profile.registration_doc_path
    if not path:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "detail": f"No {doc_type} document uploaded for this merchant.",
                "code": "DOCUMENT_NOT_FOUND",
            },
        )

    storage = get_storage_backend()
    try:
        content, content_type = await storage.get_file(path)
    except FileNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"detail": "Document file not found in storage.", "code": "FILE_NOT_FOUND"},
        )

    filename = path.split("/")[-1]
    return Response(
        content=content,
        media_type=content_type,
        headers={
            "Content-Disposition": f'inline; filename="{filename}"',
            "Cache-Control": "private, max-age=300",
        },
    )


# ---------------------------------------------------------------------------
# POST /admin/merchants/{user_id}/kyc/approve
# ---------------------------------------------------------------------------


@router.post(
    "/merchants/{user_id}/kyc/approve",
    response_model=OkResponse,
    status_code=status.HTTP_200_OK,
    summary="Approve a merchant's KYC submission",
    description=(
        "Approves a merchant's pending KYC submission. Transitions kyc_status "
        "from 'pending' to 'approved', records the reviewing admin, writes an "
        "audit log entry, and dispatches a KYC approval email to the merchant. "
        "Requires an admin or superadmin session. "
        "Requirements: 14.5, 12.6"
    ),
)
async def approve_kyc(
    user_id: uuid.UUID,
    payload: Optional[KYCApproveRequest] = None,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> OkResponse:
    """Approve a merchant's KYC submission.

    Returns HTTP 200 on success.
    Returns HTTP 404 if the merchant does not exist.
    Returns HTTP 409 if kyc_status is not 'pending'.
    Returns HTTP 401 if the Bearer token is missing, invalid, or expired.
    Returns HTTP 403 if the session does not have admin or superadmin role.
    """
    return await AdminService.approve_kyc(
        db=db,
        admin_id=current_user.id,
        merchant_id=user_id,
    )


# ---------------------------------------------------------------------------
# POST /admin/merchants/{user_id}/kyc/reject
# ---------------------------------------------------------------------------


@router.post(
    "/merchants/{user_id}/kyc/reject",
    response_model=OkResponse,
    status_code=status.HTTP_200_OK,
    summary="Reject a merchant's KYC submission",
    description=(
        "Rejects a merchant's pending KYC submission with a mandatory rejection "
        "reason (1–500 characters). Transitions kyc_status to 'rejected', stores "
        "the reason, records the reviewing admin, writes an audit log entry, and "
        "dispatches a KYC rejection email to the merchant. "
        "Requires an admin or superadmin session. "
        "Requirements: 14.6, 12.7"
    ),
)
async def reject_kyc(
    user_id: uuid.UUID,
    payload: KYCRejectRequest,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> OkResponse:
    """Reject a merchant's KYC submission with a mandatory reason.

    Returns HTTP 200 on success.
    Returns HTTP 400 if rejection_reason is missing or out of bounds.
    Returns HTTP 404 if the merchant does not exist.
    Returns HTTP 409 if kyc_status is not 'pending'.
    Returns HTTP 401 if the Bearer token is missing, invalid, or expired.
    Returns HTTP 403 if the session does not have admin or superadmin role.
    """
    return await AdminService.reject_kyc(
        db=db,
        admin_id=current_user.id,
        merchant_id=user_id,
        rejection_reason=payload.rejection_reason,
    )


# ---------------------------------------------------------------------------
# POST /admin/merchants/{user_id}/kyc/didit/check
# ---------------------------------------------------------------------------


@router.post(
    "/merchants/{user_id}/kyc/didit/check",
    status_code=status.HTTP_200_OK,
    summary="Admin query and sync Didit KYC verification status",
)
async def admin_check_didit_kyc(
    user_id: uuid.UUID,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Admin endpoint to check and sync Didit automated KYC status for a merchant."""
    from app.merchant.service import check_didit_session_status
    return await check_didit_session_status(user_id=user_id, session_id=None, db=db)


# ---------------------------------------------------------------------------
# POST /admin/merchants/{user_id}/kyc/didit/session
# ---------------------------------------------------------------------------


@router.post(
    "/merchants/{user_id}/kyc/didit/session",
    status_code=status.HTTP_200_OK,
    summary="Admin create Didit KYC verification session for a merchant",
)
async def admin_create_didit_session(
    user_id: uuid.UUID,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
):
    """Admin endpoint to initiate a Didit automated KYC session for a merchant."""
    from app.merchant.service import create_didit_session
    return await create_didit_session(user_id=user_id, callback_url=None, db=db)


# ---------------------------------------------------------------------------
# POST /admin/merchants/{user_id}/kyc/revoke
# ---------------------------------------------------------------------------


@router.post(
    "/merchants/{user_id}/kyc/revoke",
    response_model=OkResponse,
    status_code=status.HTTP_200_OK,
    summary="Revoke merchant KYC approval and request updates",
    description=(
        "Revokes an approved or existing KYC status and prompts the merchant to "
        "re-submit specified sections (personal, business, kyc) with an admin explanation."
    ),
)
async def revoke_kyc(
    user_id: uuid.UUID,
    payload: RevokeKYCRequest,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> OkResponse:
    """Revoke merchant KYC approval and request specific section updates."""
    return await AdminService.revoke_kyc_approval(
        db=db,
        admin_id=current_user.id,
        merchant_id=user_id,
        rejection_reason=payload.rejection_reason,
        sections=payload.sections,
    )


# ---------------------------------------------------------------------------
# POST /admin/merchants/{user_id}/sections/reject
# ---------------------------------------------------------------------------


@router.post(
    "/merchants/{user_id}/sections/reject",
    response_model=OkResponse,
    status_code=status.HTTP_200_OK,
    summary="Reject a specific merchant onboarding section",
    description=(
        "Rejects a specific section (personal, business, or kyc) of a merchant's "
        "profile with a mandatory rejection reason. Merchants will see this feedback "
        "and be guided directly to fix that section. Requires admin session."
    ),
)
async def reject_merchant_section(
    user_id: uuid.UUID,
    payload: SectionRejectRequest,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> OkResponse:
    """Reject a specific section of a merchant profile with actionable feedback."""
    return await AdminService.reject_merchant_section(
        db=db,
        admin_id=current_user.id,
        merchant_id=user_id,
        section=payload.section,
        rejection_reason=payload.rejection_reason,
    )


# ---------------------------------------------------------------------------
# POST /admin/merchants/{user_id}/suspend
# ---------------------------------------------------------------------------


@router.post(
    "/merchants/{user_id}/suspend",
    response_model=OkResponse,
    status_code=status.HTTP_200_OK,
    summary="Suspend a merchant account",
    description=(
        "Suspends the merchant account and bulk-pauses all their active payment "
        "links (status → 'suspended_by_admin'). Writes an audit log entry. "
        "All changes are committed in a single transaction. "
        "Requires an admin or superadmin session. "
        "Requirements: 14.7, 14.8"
    ),
)
async def suspend_merchant(
    user_id: uuid.UUID,
    payload: Optional[SuspendRequest] = None,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> OkResponse:
    """Suspend a merchant account.

    Returns HTTP 200 on success.
    Returns HTTP 404 if the merchant does not exist.
    Returns HTTP 409 if the merchant is already suspended.
    Returns HTTP 401 if the Bearer token is missing, invalid, or expired.
    Returns HTTP 403 if the session does not have admin or superadmin role.
    """
    return await AdminService.suspend_merchant(
        db=db,
        admin_id=current_user.id,
        merchant_id=user_id,
    )


# ---------------------------------------------------------------------------
# POST /admin/merchants/{user_id}/unsuspend
# ---------------------------------------------------------------------------


@router.post(
    "/merchants/{user_id}/unsuspend",
    response_model=OkResponse,
    status_code=status.HTTP_200_OK,
    summary="Unsuspend a merchant account",
    description=(
        "Reactivates a suspended merchant account and restores all payment links "
        "that were paused during the most recent suspension "
        "('suspended_by_admin' → 'active'). Writes an audit log entry. "
        "Requires an admin or superadmin session. "
        "Requirements: 14.9, 14.10"
    ),
)
async def unsuspend_merchant(
    user_id: uuid.UUID,
    payload: Optional[UnsuspendRequest] = None,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> OkResponse:
    """Unsuspend a merchant account.

    Returns HTTP 200 on success.
    Returns HTTP 404 if the merchant does not exist.
    Returns HTTP 401 if the Bearer token is missing, invalid, or expired.
    Returns HTTP 403 if the session does not have admin or superadmin role.
    """
    return await AdminService.unsuspend_merchant(
        db=db,
        admin_id=current_user.id,
        merchant_id=user_id,
    )

# ---------------------------------------------------------------------------
# GET /admin/suspended-users
# ---------------------------------------------------------------------------


@router.get(
    "/suspended-users",
    response_model=PaginatedUsersResponse,
    status_code=status.HTTP_200_OK,
    summary="Paginated list of all suspended users",
    description=(
        "Returns a paginated list of all users with status 'suspended'. "
        "Requires an admin or superadmin session."
    ),
)
async def list_suspended_users(
    page: Annotated[int, Query(ge=1, description="Page number (1-based)")] = 1,
    page_size: Annotated[
        int,
        Query(ge=1, le=100, description="Records per page (max 100)"),
    ] = 20,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> PaginatedUsersResponse:
    """Return paginated list of suspended users.

    Returns HTTP 200 with ``{ items, total, page, page_size, pages }`` on success.
    Returns HTTP 401 if the Bearer token is missing, invalid, or expired.
    Returns HTTP 403 if the session does not have admin or superadmin role.
    """
    return await AdminService.list_suspended_users(
        db=db,
        page=page,
        page_size=page_size,
    )


# ---------------------------------------------------------------------------
# GET /admin/appeals
# ---------------------------------------------------------------------------


@router.get(
    "/appeals",
    response_model=PaginatedAppealsResponse,
    status_code=status.HTTP_200_OK,
    summary="Paginated list of suspension appeals",
    description=(
        "Returns a paginated list of all suspension appeals. "
        "Optionally filter by status (pending, approved, rejected). "
        "Requires an admin or superadmin session."
    ),
)
async def list_appeals(
    page: Annotated[int, Query(ge=1, description="Page number (1-based)")] = 1,
    page_size: Annotated[
        int,
        Query(ge=1, le=100, description="Records per page (max 100)"),
    ] = 20,
    status_filter: Annotated[
        str | None,
        Query(
            alias="status",
            description="Filter by appeal status: pending, approved, rejected",
        ),
    ] = None,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> PaginatedAppealsResponse:
    """Return paginated suspension appeals.

    Returns HTTP 200 with ``{ items, total, page, page_size, pages }`` on success.
    Returns HTTP 401 if the Bearer token is missing, invalid, or expired.
    Returns HTTP 403 if the session does not have admin or superadmin role.
    """
    return await AdminService.list_appeals(
        db=db,
        page=page,
        page_size=page_size,
        status_filter=status_filter,
    )


# ---------------------------------------------------------------------------
# PATCH /admin/appeals/{appeal_id}
# ---------------------------------------------------------------------------


@router.patch(
    "/appeals/{appeal_id}",
    response_model=OkResponse,
    status_code=status.HTTP_200_OK,
    summary="Approve or reject a suspension appeal",
    description=(
        "Reviews a pending suspension appeal. Setting decision to 'approved' "
        "also reactivates the user account. "
        "Requires a superadmin session."
    ),
)
async def review_appeal(
    appeal_id: uuid.UUID,
    body: ReviewAppealRequest,
    current_user: User = Depends(require_superadmin),
    db: AsyncSession = Depends(get_db),
) -> OkResponse:
    """Approve or reject a suspension appeal.

    Returns HTTP 200 on success.
    Returns HTTP 404 if the appeal does not exist.
    Returns HTTP 409 if the appeal has already been reviewed.
    Returns HTTP 401 if the Bearer token is missing, invalid, or expired.
    Returns HTTP 403 if the session does not have superadmin role.
    """
    return await AdminService.review_appeal(
        db=db,
        actor_id=current_user.id,
        appeal_id=appeal_id,
        decision=body.decision,
        admin_note=body.admin_note,
    )


# ---------------------------------------------------------------------------
# Global Payer Directory & Merchant Transaction History (Admin)
# ---------------------------------------------------------------------------


@router.get(
    "/payers",
    response_model=PaginatedAdminPayersResponse,
    status_code=status.HTTP_200_OK,
    summary="List all platform payers and customers",
    description="Returns global aggregated payer directory with merchant attribution, total volume, and metrics.",
)
async def list_global_payers(
    page: int = 1,
    page_size: int = 20,
    search: Optional[str] = None,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> PaginatedAdminPayersResponse:
    """Return platform-wide payer directory for administrators."""
    return await AdminService.list_global_payers(
        db=db,
        page=page,
        page_size=page_size,
        search=search,
    )


@router.get(
    "/payers/{payer_email:path}",
    response_model=AdminPayerDetailResponse,
    status_code=status.HTTP_200_OK,
    summary="Get detailed payer profile and history for admin",
    description="Returns customer details, merchant breakdown, status breakdown, and chronological logs.",
)
async def get_global_payer_detail(
    payer_email: str,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> AdminPayerDetailResponse:
    """Return detailed global payer profile and history."""
    return await AdminService.get_global_payer_detail(
        payer_email,
        db,
    )


@router.get(
    "/merchants/{user_id}/payers",
    response_model=PayerDirectoryResponse,
    status_code=status.HTTP_200_OK,
    summary="List payer directory for a specific merchant",
    description="Returns customer directory and payment statistics for the specified merchant.",
)
async def list_merchant_payers_admin(
    user_id: uuid.UUID,
    page: int = 1,
    page_size: int = 20,
    search: Optional[str] = None,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> PayerDirectoryResponse:
    """Return payer directory for a specific merchant."""
    return await AdminService.list_merchant_payers(
        user_id,
        db,
        page=page,
        page_size=page_size,
        search=search,
    )


@router.get(
    "/merchants/{user_id}/transactions",
    response_model=TransactionListResponse,
    status_code=status.HTTP_200_OK,
    summary="List transaction history for a specific merchant",
    description="Returns transaction history, on-chain hashes, and settlement details for the specified merchant.",
)
async def list_merchant_transactions_admin(
    user_id: uuid.UUID,
    page: int = 1,
    page_size: int = 20,
    status_filter: Optional[str] = None,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> TransactionListResponse:
    """Return transaction history for a specific merchant."""
    return await AdminService.list_merchant_transactions(
        user_id,
        db,
        page=page,
        page_size=page_size,
        status_filter=status_filter,
    )


# ---------------------------------------------------------------------------
# Platform Wallets (Treasury EVM with Load Balancing)
# ---------------------------------------------------------------------------


@router.get(
    "/platform-wallets",
    response_model=PlatformWalletListResponse,
    status_code=status.HTTP_200_OK,
    summary="List all platform EVM treasury wallets",
    description="Returns all platform wallets with load balancing stats (usage count) and status.",
)
async def list_platform_wallets_admin(
    active_only: bool = False,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> PlatformWalletListResponse:
    """List platform wallets for subscription upgrade load balancing."""
    return await SubscriptionService.list_platform_wallets(db, active_only=active_only)


@router.post(
    "/platform-wallets",
    response_model=PlatformWalletResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new platform treasury EVM wallet",
    description="Adds an EVM address to the load-balancing pool for subscription upgrades.",
)
async def create_platform_wallet_admin(
    payload: PlatformWalletCreate,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> PlatformWalletResponse:
    """Create platform wallet."""
    return await SubscriptionService.create_platform_wallet(db, payload)


@router.patch(
    "/platform-wallets/{wallet_id}",
    response_model=PlatformWalletResponse,
    status_code=status.HTTP_200_OK,
    summary="Update platform treasury wallet",
    description="Updates label, network, or active status of a platform wallet.",
)
async def update_platform_wallet_admin(
    wallet_id: uuid.UUID,
    payload: PlatformWalletUpdate,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> PlatformWalletResponse:
    """Update platform wallet."""
    return await SubscriptionService.update_platform_wallet(db, wallet_id, payload)


@router.delete(
    "/platform-wallets/{wallet_id}",
    response_model=OkResponse,
    status_code=status.HTTP_200_OK,
    summary="Delete platform treasury wallet",
    description="Deletes a platform treasury wallet from the pool.",
)
async def delete_platform_wallet_admin(
    wallet_id: uuid.UUID,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> OkResponse:
    """Delete platform wallet."""
    await SubscriptionService.delete_platform_wallet(db, wallet_id)
    return OkResponse(message="Platform wallet removed successfully.", code="PLATFORM_WALLET_DELETED")


@router.get(
    "/subscriptions/payments",
    response_model=SubscriptionPaymentListResponse,
    status_code=status.HTTP_200_OK,
    summary="List all subscription crypto payments",
    description="Returns chronological audit logs of user subscription upgrade and renewal payments.",
)
async def list_subscription_payments_admin(
    limit: int = 50,
    offset: int = 0,
    current_user: User = Depends(require_admin),
    db: AsyncSession = Depends(get_db),
) -> SubscriptionPaymentListResponse:
    """List subscription payments."""
    return await SubscriptionService.list_all_payments(db, limit=limit, offset=offset)



# ---------------------------------------------------------------------------
# Email Dead-Letter Queue endpoints (Req 15.3, 15.4, 15.5)
# ---------------------------------------------------------------------------


@router.get(
    "/email-dead-letters",
    tags=["admin"],
    summary="List all unprocessed dead-letter email records",
    description=(
        "Scans Redis for keys matching ``email_dead_letter:*`` and returns "
        "a list of undelivered email records. Requires an admin session. "
        "Requirements: 15.3"
    ),
)
async def list_email_dead_letters(
    current_user: User = Depends(require_admin),
) -> list[dict]:
    """List all unprocessed dead-letter email records from Redis."""
    import json

    import redis.asyncio as aioredis

    from app.core.redis_client import _get_pool

    r = aioredis.Redis(connection_pool=_get_pool())
    results = []
    async for key in r.scan_iter("email_dead_letter:*"):
        raw = await r.get(key)
        if raw:
            try:
                data = json.loads(raw)
                results.append(
                    {
                        "key": key,
                        "to": data.get("to"),
                        "subject": data.get("subject"),
                        "template": data.get("template"),
                    }
                )
            except Exception:
                pass
    return results


@router.post(
    "/email-dead-letters/{key}/retry",
    tags=["admin"],
    summary="Re-enqueue a dead-letter email",
    description=(
        "Fetches the dead-letter record from Redis, re-enqueues the email "
        "via Celery, and deletes the key on success. "
        "Returns HTTP 404 if the key does not exist. "
        "Requires an admin session. "
        "Requirements: 15.4"
    ),
)
async def retry_email_dead_letter(
    key: str,
    current_user: User = Depends(require_admin),
) -> dict:
    """Re-enqueue a dead-letter email and remove it from Redis."""
    import json

    import redis.asyncio as aioredis

    from app.core.email import send_email_task
    from app.core.redis_client import _get_pool

    r = aioredis.Redis(connection_pool=_get_pool())
    raw = await r.get(key)
    if raw is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Dead-letter key not found",
        )

    data = json.loads(raw)
    send_email_task.delay(
        to=data["to"],
        subject=data["subject"],
        template=data["template"],
        context=data.get("context", {}),
    )
    await r.delete(key)
    return {"status": "requeued"}


@router.delete(
    "/email-dead-letters/{key}",
    tags=["admin"],
    summary="Delete a dead-letter email record",
    description=(
        "Removes the dead-letter email record from Redis without retrying. "
        "Requires an admin session. "
        "Requirements: 15.5"
    ),
)
async def delete_email_dead_letter(
    key: str,
    current_user: User = Depends(require_admin),
) -> dict:
    """Remove a dead-letter email record without retrying."""
    import redis.asyncio as aioredis

    from app.core.redis_client import _get_pool

    r = aioredis.Redis(connection_pool=_get_pool())
    await r.delete(key)
    return {"status": "deleted"}
