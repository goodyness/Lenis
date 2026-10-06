"""
Pydantic response schemas for the Admin service.

Requirements: 7.1, 7.2, 7.6, 7.7
"""
from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel


# ---------------------------------------------------------------------------
# User list
# ---------------------------------------------------------------------------


class UserListItem(BaseModel):
    """A single user record returned by the paginated user list endpoint.

    The ``role`` field mirrors ``account_type`` for API consumers that use
    the ``role`` terminology; both fields carry the same value.

    Requirement 7.2
    """

    id: uuid.UUID
    email: str
    role: str
    account_type: str
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class PaginatedUsersResponse(BaseModel):
    """Paginated wrapper for the user list (Requirement 7.2).

    Shape: ``{ items, total, page, page_size, pages }``
    """

    items: list[UserListItem]
    total: int
    page: int
    page_size: int
    pages: int


# ---------------------------------------------------------------------------
# Generic action response
# ---------------------------------------------------------------------------


class OkResponse(BaseModel):
    """Generic success response for action endpoints (suspend, reactivate, promote).

    Returns a human-readable message and a machine-readable code.
    """

    message: str
    code: str = "ok"


# ---------------------------------------------------------------------------
# Verification request list / detail
# ---------------------------------------------------------------------------


class VerificationRequestListItem(BaseModel):
    """A single verification request record returned in the paginated list.

    Requirement 7.6
    """

    id: uuid.UUID
    developer_id: uuid.UUID
    status: str
    full_legal_name: str
    country: str
    business_type: str
    created_at: datetime

    model_config = {"from_attributes": True}


class VerificationRequestDetail(BaseModel):
    """Full detail for a single verification request (Requirement 7.7).

    Includes all submitted developer information plus review metadata.
    """

    id: uuid.UUID
    developer_id: uuid.UUID
    status: str
    full_legal_name: str
    country: str
    business_type: str
    website_url: str
    intended_use: str
    rejection_reason: Optional[str] = None
    reviewed_by: Optional[uuid.UUID] = None
    rejected_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class PaginatedVerificationRequestsResponse(BaseModel):
    """Paginated wrapper for the verification request list (Requirement 7.6).

    Shape: ``{ items, total, page, page_size, pages }``
    """

    items: list[VerificationRequestListItem]
    total: int
    page: int
    page_size: int
    pages: int


# ---------------------------------------------------------------------------
# Audit log
# ---------------------------------------------------------------------------


class AuditLogItem(BaseModel):
    """A single audit log record returned by the paginated audit log endpoint.

    All fields map directly to the ``audit_logs`` table columns. ``client_ip``
    may be ``None`` for events that have no associated HTTP client.

    Requirement 8.4
    """

    id: uuid.UUID
    event_type: str
    actor_id: uuid.UUID
    target_type: str
    target_id: uuid.UUID
    outcome: str
    client_ip: Optional[str] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class PaginatedAuditLogResponse(BaseModel):
    """Paginated wrapper for the audit log list (Requirement 8.4).

    Shape: ``{ items, total, page, page_size, pages }``
    """

    items: list[AuditLogItem]
    total: int
    page: int
    page_size: int
    pages: int


# ---------------------------------------------------------------------------
# Dashboard summary
# ---------------------------------------------------------------------------


class DashboardSummaryResponse(BaseModel):
    """Counts returned by GET /admin/dashboard (Requirement 7.1).

    Fields
    ------
    total_users:
        Total number of user records across all account types.
    pending_verification_requests:
        Number of VerificationRequest records with status "pending".
    verified_developers:
        Number of users with account_type "developer" and status "verified".
    active_merchants:
        Number of users with account_type "merchant" and status "active".
    """

    total_users: int
    pending_verification_requests: int
    verified_developers: int
    active_merchants: int


# ---------------------------------------------------------------------------
# Merchant management — imports needed for new schemas
# ---------------------------------------------------------------------------
# Note: `from __future__ import annotations` is not at the top of this file,
# so forward references use string literals where needed.
from decimal import Decimal

from pydantic import Field


# ---------------------------------------------------------------------------
# Merchant list
# ---------------------------------------------------------------------------


class MerchantListItem(BaseModel):
    """A single merchant record returned by the paginated merchant list endpoint.

    ``onboarding_status`` is a computed string derived from the merchant's
    current onboarding and KYC state — one of:
    ``incomplete``, ``pending_kyc_review``, ``kyc_approved``, ``kyc_rejected``.

    Requirements: 14.1, 14.2
    """

    user_id: uuid.UUID
    email: str
    full_name: str
    onboarding_status: str
    kyc_status: str
    wallet_count: int

    model_config = {"from_attributes": True}


class PaginatedMerchantsResponse(BaseModel):
    """Paginated wrapper for the merchant list.

    Shape: ``{ items, total, page, page_size, pages }``

    Requirements: 14.1
    """

    items: list[MerchantListItem]
    total: int
    page: int
    page_size: int
    pages: int


# ---------------------------------------------------------------------------
# Merchant detail
# ---------------------------------------------------------------------------


class WalletInfo(BaseModel):
    """A wallet record embedded in the merchant detail response.

    Requirements: 14.2, 14.3
    """

    id: uuid.UUID
    network: str
    address: str
    status: str
    created_at: datetime

    model_config = {"from_attributes": True}


class MerchantDetailResponse(BaseModel):
    """Full merchant profile returned by the merchant detail endpoint.

    Includes all ``MerchantProfile`` fields, the associated user's email,
    account status, embedded wallet records, and aggregate counts for payment
    links and invoices.

    ``kyc_doc_url`` and ``reg_doc_url`` are presigned download URLs populated
    by the service layer; they are ``None`` when no document has been uploaded.

    Requirements: 14.2, 14.3, 14.4
    """

    # Identity
    user_id: uuid.UUID
    email: str
    user_status: str

    # Step 1 — personal info
    full_name: str
    country: str
    phone_number: str
    personal_info_status: str = "pending"
    personal_info_rejection_reason: Optional[str] = None

    # Step 2 — business info
    business_name: Optional[str] = None
    business_address: Optional[str] = None
    business_description: Optional[str] = None
    business_category: Optional[str] = None
    monthly_volume_estimate: Optional[str] = None
    website_url: Optional[str] = None
    social_instagram: Optional[str] = None
    social_twitter: Optional[str] = None
    social_facebook: Optional[str] = None
    social_linkedin: Optional[str] = None
    social_tiktok: Optional[str] = None
    is_registered_business: bool
    registration_doc_path: Optional[str] = None
    business_info_status: str = "pending"
    business_info_rejection_reason: Optional[str] = None

    # Step 3 — KYC
    kyc_status: str
    kyc_document_path: Optional[str] = None
    kyc_document_type: Optional[str] = None
    nin: Optional[str] = None
    kyc_dojah_session_id: Optional[str] = None
    kyc_didit_session_id: Optional[str] = None
    kyc_reviewed_by: Optional[uuid.UUID] = None
    kyc_reviewed_at: Optional[datetime] = None
    kyc_rejection_reason: Optional[str] = None

    # Onboarding progress
    onboarding_complete: bool
    onboarding_step: int
    wallet_added: bool

    # Timestamps
    created_at: datetime
    updated_at: datetime

    # Embedded relations and aggregates
    wallets: list[WalletInfo]
    payment_link_count: int
    invoice_count: int
    total_confirmed_volume: Decimal

    # Presigned document URLs (populated by service layer)
    kyc_doc_url: Optional[str] = None
    reg_doc_url: Optional[str] = None

    model_config = {"from_attributes": True}


# ---------------------------------------------------------------------------
# KYC / Section review actions
# ---------------------------------------------------------------------------


class KYCApproveRequest(BaseModel):
    """Empty request body for POST /admin/merchants/{user_id}/kyc/approve.

    No fields required — the act of posting to the endpoint is sufficient.

    Requirements: 14.5
    """


class KYCRejectRequest(BaseModel):
    """Request body for POST /admin/merchants/{user_id}/kyc/reject.

    ``rejection_reason`` is mandatory and must be between 1 and 500 characters.
    It is stored on the merchant profile and included in the rejection email
    sent to the merchant.

    Requirements: 14.6
    """

    rejection_reason: str = Field(min_length=1, max_length=500)


class RevokeKYCRequest(BaseModel):
    """Request body for POST /admin/merchants/{user_id}/kyc/revoke."""

    rejection_reason: str = Field(min_length=1, max_length=500)
    sections: list[str] = Field(default_factory=lambda: ["personal", "business", "kyc"])


class SectionRejectRequest(BaseModel):
    """Request body for POST /admin/merchants/{user_id}/sections/reject.

    ``section`` must be one of 'personal', 'business', or 'kyc'.
    ``rejection_reason`` is mandatory and must be between 1 and 500 characters.
    """

    section: str = Field(description="'personal', 'business', or 'kyc'")
    rejection_reason: str = Field(min_length=1, max_length=500)


# ---------------------------------------------------------------------------
# Merchant suspension
# ---------------------------------------------------------------------------


class SuspendRequest(BaseModel):
    """Empty request body for POST /admin/merchants/{user_id}/suspend.

    Requirements: 14.7, 14.8
    """


class UnsuspendRequest(BaseModel):
    """Empty request body for POST /admin/merchants/{user_id}/unsuspend.

    Requirements: 14.9, 14.10
    """


# ---------------------------------------------------------------------------
# KYC documents
# ---------------------------------------------------------------------------


class KYCDocumentsResponse(BaseModel):
    """Response for GET /admin/merchants/{user_id}/kyc-documents.

    Both fields are presigned download URLs with a maximum 15-minute expiry.
    A field is ``None`` when the corresponding document has not been uploaded.

    Requirements: 14.4
    """

    kyc_document_url: Optional[str] = None
    registration_doc_url: Optional[str] = None


# ---------------------------------------------------------------------------
# Suspension with reason
# ---------------------------------------------------------------------------


class SuspendWithReasonRequest(BaseModel):
    """Request body for POST /admin/users/{user_id}/suspend.

    Both fields are optional — the admin may provide a reason category and/or
    a free-form message that will be shown to the suspended user.
    """

    reason: Optional[str] = Field(
        default=None,
        max_length=100,
        description=(
            "Short reason category, e.g. 'policy_violation', 'fraud', "
            "'spam', 'identity_verification_failed', 'other'."
        ),
    )
    message: Optional[str] = Field(
        default=None,
        max_length=2000,
        description="Free-form explanation shown to the user on the suspension page.",
    )


# ---------------------------------------------------------------------------
# Suspension appeals
# ---------------------------------------------------------------------------


class SuspensionAppealItem(BaseModel):
    """A single suspension appeal record returned in the admin list."""

    id: uuid.UUID
    user_id: uuid.UUID
    user_email: str
    user_full_name: str
    suspension_reason: Optional[str] = None
    suspension_message: Optional[str] = None
    message: str
    status: str
    admin_note: Optional[str] = None
    reviewed_by: Optional[uuid.UUID] = None
    reviewed_at: Optional[datetime] = None
    created_at: datetime

    model_config = {"from_attributes": True}


class PaginatedAppealsResponse(BaseModel):
    """Paginated wrapper for suspension appeal records."""

    items: list[SuspensionAppealItem]
    total: int
    page: int
    page_size: int
    pages: int


class ReviewAppealRequest(BaseModel):
    """Request body for PATCH /admin/appeals/{appeal_id}."""

    decision: str = Field(
        description="Must be 'approved' or 'rejected'.",
    )
    admin_note: Optional[str] = Field(
        default=None,
        max_length=2000,
        description="Optional note visible to the user after review.",
    )


# ---------------------------------------------------------------------------
# Global Payers Directory (Admin)
# ---------------------------------------------------------------------------


class AdminGlobalPayerItem(BaseModel):
    """Aggregated global payer info for admin directory."""

    email: str
    name: Optional[str] = None
    merchant_count: int
    merchants: list[str] = []
    total_payments: int
    successful_payments: int = 0
    pending_payments: int = 0
    expired_payments: int = 0
    status_breakdown: dict[str, int] = {}
    total_volume_usd: Decimal
    tokens_used: list[str]
    networks_used: list[str]
    last_payment_at: Optional[datetime] = None
    first_seen_at: datetime

    model_config = {"from_attributes": True}


class PaginatedAdminPayersResponse(BaseModel):
    """Paginated list of global payers for admin."""

    items: list[AdminGlobalPayerItem]
    total: int
    total_volume_usd: Decimal
    page: int
    page_size: int
    pages: int


class AdminPayerDetailResponse(BaseModel):
    """Platform-wide customer details, lifetime analytics, and payment session history."""

    email: str
    name: Optional[str] = None
    merchant_count: int
    merchants: list[str] = []
    total_attempts: int
    successful_payments: int
    pending_payments: int
    expired_payments: int
    total_volume_usd: Decimal
    tokens_used: list[str]
    networks_used: list[str]
    first_seen_at: datetime
    last_active_at: Optional[datetime] = None
    status_breakdown: dict[str, int]
    activity_logs: list[Any]

    model_config = {"from_attributes": True}

