"""
Merchant service for the Lenis platform.

``MerchantService`` contains the business logic for merchant onboarding,
wallet management, payment links, invoices, and the dashboard overview.

This module is structured in sections:

  1. Onboarding helpers — ``get_or_create_profile``, ``get_onboarding_status``,
     ``validate_step_access``
  2. Wizard step submissions — ``submit_step_1``, ``submit_step_2``
     (steps 3 & 4 are implemented in subsequent tasks)

Design decisions
----------------
- Profile lazy-creation: ``MerchantProfile`` is created on the first call to
  ``get_or_create_profile`` rather than at registration.  This avoids
  polluting the DB with empty rows for merchants who never start onboarding.
- Step-access guard: ``validate_step_access`` is a pure function with no DB
  I/O — it can be called from routers without a session.
- Country validation: African-country membership is enforced client-side via
  the Countries API.  The backend validates only that the submitted country
  string is non-empty, as specified in Requirement 2.8 (design note).
- File upload: registration documents are uploaded through the configured
  ``StorageBackend``; the returned storage key is persisted on the profile.

Requirements: 2.7–2.12, 3.1–3.13, 16.1–16.7
"""
from __future__ import annotations

import io
import logging
import math
import os
import re
import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any, Optional
from urllib.parse import urlparse

from fastapi import HTTPException, status
from sqlalchemy import and_, asc, desc, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

import qrcode

from app.core.config import settings
from app.core.models import Invoice, InvoiceLineItem, MerchantProfile, MerchantWallet, Payment, PaymentLink, User
from app.core.kyc import KYCService, can_transition_kyc
from app.core.slugs import ensure_unique_slug
from app.core.storage import get_storage_backend, kyc_path, reg_path, validate_upload
from app.merchant.schemas import (
    BrandingResponse,
    BrandingUpdateRequest,
    DailyVolumePoint,
    DashboardOverviewResponse,
    InvoiceCreate,
    InvoiceListResponse,
    InvoiceResponse,
    OnboardingStatusResponse,
    PayerActivityLogItem,
    PayerDetailResponse,
    PayerDirectoryItem,
    PayerDirectoryResponse,
    PaymentLinkCreate,
    PaymentLinkListResponse,
    PaymentLinkResponse,
    PaymentLinkAnalyticsResponse,
    RecentTransactionItem,
    RejectedSectionItem,
    ReportSummaryResponse,
    Step1Request,
    Step2Request,
    Step3Request,
    Step4Request,
    TokenBalanceItem,
    TopLinkItem,
    TransactionDetailItem,
    TransactionListResponse,
    WalletBalanceItem,
    WalletBalanceResponse,
    WalletChallengeResponse,
    WalletCreate,
    WalletResponse,
)
from app.web3.verifier import generate_wallet_challenge, verify_wallet_signature

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Internal validation constants
# ---------------------------------------------------------------------------

# Phone number regex — digits, spaces, hyphens, parentheses; 4–15 chars total.
# This is the canonical reference used by both the schema validator and the
# service layer.  Property 8 in design.md tests exactly this pattern.
_PHONE_RE = re.compile(r"^[0-9 \-()+]{4,15}$")

# Accepted URL schemes for website_url and redirect_url fields.
_ALLOWED_SCHEMES = ("http://", "https://")


def _normalize_dt(dt: Optional[datetime]) -> Optional[datetime]:
    """Ensure datetime is timezone-aware UTC datetime for safe comparisons across SQLite and Postgres."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


# ---------------------------------------------------------------------------
# Onboarding helpers
# ---------------------------------------------------------------------------


def _build_onboarding_status_response(profile: MerchantProfile) -> OnboardingStatusResponse:
    """Helper to construct OnboardingStatusResponse with section rejection items."""
    rejected_sections: list[RejectedSectionItem] = []
    if profile.personal_info_status == "rejected":
        rejected_sections.append(
            RejectedSectionItem(
                section="personal",
                step=1,
                title="Personal Information",
                reason=profile.personal_info_rejection_reason or "Personal details were marked for correction.",
            )
        )
    if profile.business_info_status == "rejected":
        rejected_sections.append(
            RejectedSectionItem(
                section="business",
                step=2,
                title="Business Information",
                reason=profile.business_info_rejection_reason or "Business details or documents were marked for correction.",
            )
        )
    if profile.kyc_status == "rejected":
        rejected_sections.append(
            RejectedSectionItem(
                section="kyc",
                step=3,
                title="KYC & Identity Verification",
                reason=profile.kyc_rejection_reason or "KYC documents were rejected. Please review and re-upload valid identification.",
            )
        )

    return OnboardingStatusResponse(
        current_step=profile.onboarding_step,
        onboarding_complete=profile.onboarding_complete,
        kyc_status=profile.kyc_status,
        wallet_added=profile.wallet_added,
        personal_info_status=profile.personal_info_status,
        personal_info_rejection_reason=profile.personal_info_rejection_reason,
        business_info_status=profile.business_info_status,
        business_info_rejection_reason=profile.business_info_rejection_reason,
        kyc_rejection_reason=profile.kyc_rejection_reason,
        rejected_sections=rejected_sections,
        full_name=profile.full_name or None,
        country=profile.country or None,
        phone_number=profile.phone_number or None,
        business_name=profile.business_name or None,
        business_address=profile.business_address or None,
        business_description=profile.business_description or None,
        business_category=profile.business_category or None,
        monthly_volume_estimate=profile.monthly_volume_estimate or None,
        website_url=profile.website_url or None,
        social_instagram=profile.social_instagram or None,
        social_twitter=profile.social_twitter or None,
        social_facebook=profile.social_facebook or None,
        social_linkedin=profile.social_linkedin or None,
        social_tiktok=profile.social_tiktok or None,
        is_registered_business=profile.is_registered_business,
        has_registration_doc=bool(profile.registration_doc_path),
        kyc_document_type=profile.kyc_document_type or None,
        nin=profile.nin or None,
        has_kyc_doc=bool(profile.kyc_document_path),
        kyc_didit_session_id=profile.kyc_didit_session_id or None,
    )


async def get_or_create_profile(
    user_id: uuid.UUID,
    db: AsyncSession,
) -> MerchantProfile:
    """Return the merchant's ``MerchantProfile``, creating one lazily if absent.

    On first call for a given ``user_id``, a new ``MerchantProfile`` row is
    inserted with all default values and flushed (not committed — the caller's
    unit of work controls the commit).

    Args:
        user_id: The authenticated merchant's User ID.
        db: The active async SQLAlchemy session.

    Returns:
        The existing or newly-created ``MerchantProfile`` instance.

    Requirements: 16.1 (lazy creation), 16.3 (no data in 401 response —
        the router handles auth; this function is only called after auth).
    """
    result = await db.execute(
        select(MerchantProfile).where(MerchantProfile.user_id == user_id)
    )
    profile = result.scalar_one_or_none()

    if profile is None:
        # Requirement 16.1 — profile does not exist yet; create with all defaults.
        # full_name, country, phone_number have non-null constraints on the model.
        # We store empty strings as placeholders until step 1 is submitted.
        profile = MerchantProfile(
            user_id=user_id,
            full_name="",
            country="",
            phone_number="",
            personal_info_status="pending",
            business_info_status="pending",
            kyc_status="not_started",
            onboarding_step=1,
            onboarding_complete=False,
            wallet_added=False,
        )
        db.add(profile)
        await db.flush()
        logger.debug(
            "MerchantProfile created for user_id=%s (id=%s)", user_id, profile.id
        )

    return profile


async def get_onboarding_status(
    user_id: uuid.UUID,
    db: AsyncSession,
) -> OnboardingStatusResponse:
    """Return the merchant's current onboarding state.

    Calls ``get_or_create_profile`` to ensure a profile row always exists,
    then maps the ORM fields to the response schema.

    Args:
        user_id: The authenticated merchant's User ID.
        db: The active async SQLAlchemy session.

    Returns:
        ``OnboardingStatusResponse`` with ``current_step``,
        ``onboarding_complete``, ``kyc_status``, and ``wallet_added``.

    Requirements: 16.1, 16.2
    """
    profile = await get_or_create_profile(user_id, db)

    return _build_onboarding_status_response(profile)


def validate_step_access(current_step: int, target_step: int) -> bool:
    """Return ``True`` when the target step is reachable; ``False`` otherwise.

    A merchant may only submit the next step in sequence or re-submit a
    previously completed step.  Jumping ahead (``target_step > current_step + 1``)
    is rejected.

    This is a pure function — it performs no database I/O and can be called
    from a router before acquiring a DB session.

    Args:
        current_step: The merchant's current ``onboarding_step`` value (1–4).
        target_step: The step number the merchant is trying to submit (1–4).

    Returns:
        ``True`` if ``target_step <= current_step + 1``, ``False`` otherwise.

    Requirements: 16.6, Property 9
    """
    return target_step <= current_step + 1


# ---------------------------------------------------------------------------
# Wizard step submissions
# ---------------------------------------------------------------------------


async def submit_step_1(
    user_id: uuid.UUID,
    data: Step1Request,
    db: AsyncSession,
) -> OnboardingStatusResponse:
    """Persist Step 1 (personal information) and advance the onboarding step.

    Validation (all enforced at the Pydantic schema layer; duplicated here
    for defence-in-depth and to produce structured error codes):

    - ``full_name``: stripped length must be 2–100 characters (Req 2.7).
    - ``country``: must be non-empty (Req 2.8; African-membership validated
      client-side via the Countries API).
    - ``phone_number``: must match ``^[0-9 \\-()+]{4,15}$`` (Req 2.9).

    On success, ``onboarding_step`` is advanced to ``max(current, 2)`` so that
    re-submission of step 1 does not regress a merchant who has already reached
    a later step (Req 1.7, 16.4).

    Args:
        user_id: The authenticated merchant's User ID.
        data: Validated ``Step1Request`` from the router.
        db: The active async SQLAlchemy session.

    Returns:
        Updated ``OnboardingStatusResponse``.

    Raises:
        HTTPException(422): Validation failure with field-level detail.

    Requirements: 2.7–2.12, 16.4, 16.7
    """
    profile = await get_or_create_profile(user_id, db)

    # --- Service-layer validation (defence-in-depth) ---------------------

    errors: dict[str, str] = {}

    # full_name: stripped length 2–100, at least 2 non-whitespace chars.
    stripped_name = data.full_name.strip()
    if len(stripped_name) < 2:
        errors["full_name"] = (
            "full_name must contain at least 2 non-whitespace characters."
        )
    elif len(stripped_name) > 100:
        errors["full_name"] = (
            "full_name must be at most 100 characters when trimmed."
        )

    # country: non-empty (Req 2.8 — African membership checked client-side).
    if not data.country.strip():
        errors["country"] = "country must not be empty."

    # phone_number: must match the canonical regex (Req 2.9).
    if not _PHONE_RE.fullmatch(data.phone_number):
        errors["phone_number"] = (
            "phone_number may only contain digits, spaces, hyphens, "
            "parentheses, and plus signs, and must be 4–15 characters."
        )

    if errors:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "detail": "Step 1 validation failed.",
                "code": "VALIDATION_ERROR",
                "fields": errors,
            },
        )

    # --- Persist --------------------------------------------------------

    profile.full_name = data.full_name.strip()
    profile.country = data.country.strip()
    profile.phone_number = data.phone_number
    profile.personal_info_status = "pending"
    profile.personal_info_rejection_reason = None
    profile.onboarding_step = max(profile.onboarding_step, 2)
    profile.updated_at = datetime.now(UTC)

    # Sync phone number to User table as primary contact if user.phone_number is not set yet
    user_res = await db.execute(select(User).where(User.id == user_id))
    user_obj = user_res.scalar_one_or_none()
    if user_obj and not user_obj.phone_number:
        user_obj.phone_number = data.phone_number

    await db.flush()

    logger.info(
        "Step 1 submitted for user_id=%s; onboarding_step now %d",
        user_id,
        profile.onboarding_step,
    )

    return _build_onboarding_status_response(profile)


async def submit_step_2(
    user_id: uuid.UUID,
    data: Step2Request,
    file_content: Optional[bytes],
    file_content_type: Optional[str],
    file_filename: Optional[str],
    db: AsyncSession,
) -> OnboardingStatusResponse:
    """Persist Step 2 (business information) and advance the onboarding step.

    Validation rules:

    - ``business_name``: trimmed length must be 2–200 chars (Req 3.1).
    - ``website_url``: if provided, must start with ``http://`` or ``https://``
      and have a non-empty host (Req 3.2).
    - Social handles: at least one must be non-empty after stripping (Req 3.4).
    - Registration document: required when ``is_registered_business=True``
      (Req 3.9); MIME type and size are validated via ``validate_upload``
      (Req 3.10, 3.11).

    File upload flow:
    1. If ``file_content`` is provided, call ``validate_upload()`` (raises on
       invalid MIME or oversized file).
    2. Build a storage path with ``reg_path(user_id, ext)``.
    3. Delegate to ``StorageBackend.upload_file()``; persist the returned key.

    On success, ``onboarding_step`` is advanced to ``max(current, 3)``.

    Args:
        user_id: The authenticated merchant's User ID.
        data: Validated ``Step2Request`` from the router.
        file_content: Raw bytes of the uploaded registration document, or
            ``None`` when no file was submitted.
        file_content_type: The declared MIME type from the multipart header
            (used only as metadata; server-side inspection determines validity).
        file_filename: Original filename from the upload (used to derive the
            file extension for the storage path).
        db: The active async SQLAlchemy session.

    Returns:
        Updated ``OnboardingStatusResponse``.

    Raises:
        HTTPException(422): Validation failure with field-level detail.
        FileTooLargeError (HTTP 400): File exceeds ``MAX_UPLOAD_SIZE_MB``.
        FileMimeInvalidError (HTTP 400): File MIME type is not accepted.
        StorageUnavailableError (HTTP 503): Storage backend is unreachable.

    Requirements: 3.1–3.13, 16.4, 16.7
    """
    profile = await get_or_create_profile(user_id, db)

    # --- Service-layer validation ----------------------------------------

    errors: dict[str, str] = {}

    # business_name: trimmed length 2–200 (Req 3.1).
    stripped_biz = data.business_name.strip()
    if len(stripped_biz) < 2:
        errors["business_name"] = (
            "business_name must contain at least 2 non-whitespace characters."
        )
    elif len(stripped_biz) > 200:
        errors["business_name"] = (
            "business_name must be at most 200 characters when trimmed."
        )

    # business_address: required, trimmed length 3–300
    stripped_addr = data.business_address.strip() if data.business_address else ""
    if len(stripped_addr) < 3:
        errors["business_address"] = "Physical business address must contain at least 3 characters."
    elif len(stripped_addr) > 300:
        errors["business_address"] = "Physical business address must be at most 300 characters."

    # business_description: required, trimmed length 5–1000
    stripped_desc = data.business_description.strip() if data.business_description else ""
    if len(stripped_desc) < 5:
        errors["business_description"] = "Business description must contain at least 5 characters."
    elif len(stripped_desc) > 1000:
        errors["business_description"] = "Business description must be at most 1000 characters."

    # website_url: if provided, scheme + non-empty host (Req 3.2).
    if data.website_url is not None:
        url_error = _validate_url(data.website_url)
        if url_error:
            errors["website_url"] = url_error

    # Social handles: at least one non-empty (Req 3.4).
    handles = [
        data.social_instagram,
        data.social_twitter,
        data.social_facebook,
        data.social_linkedin,
        data.social_tiktok,
    ]
    if not any(h and h.strip() for h in handles):
        errors["social_handles"] = (
            "At least one social media handle must be provided."
        )

    has_existing_reg_doc = bool(profile.registration_doc_path)

    # Registration doc required when is_registered_business=True (Req 3.9).
    if data.is_registered_business and not file_content and not has_existing_reg_doc:
        errors["registration_doc"] = (
            "A registration document is required when is_registered_business is True."
        )

    if errors:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "detail": "Step 2 validation failed.",
                "code": "VALIDATION_ERROR",
                "fields": errors,
            },
        )

    # --- File upload (Req 3.10, 3.11, 15.3) --------------------------------

    registration_doc_path: Optional[str] = profile.registration_doc_path

    if file_content:
        # validate_upload raises FileTooLargeError or FileMimeInvalidError on
        # failure — both are HTTPException subclasses, so FastAPI will handle
        # them correctly without extra wrapping.
        detected_mime = validate_upload(
            content=file_content,
            declared_content_type=file_content_type or "application/octet-stream",
            max_size_mb=settings.max_upload_size_mb,
        )

        # Derive file extension from the original filename; fall back to MIME.
        ext = _ext_from_filename_or_mime(file_filename, detected_mime)

        storage = get_storage_backend()
        storage_key = reg_path(user_id, ext)
        await storage.upload_file(
            content=file_content,
            path=storage_key,
            content_type=detected_mime,
        )
        registration_doc_path = storage_key
        logger.info(
            "Registration doc uploaded for user_id=%s → key=%s",
            user_id,
            storage_key,
        )

    # --- Persist --------------------------------------------------------

    profile.business_name = stripped_biz
    profile.business_address = data.business_address or None
    profile.business_description = data.business_description or None
    profile.business_category = data.business_category or None
    profile.monthly_volume_estimate = data.monthly_volume_estimate or None
    profile.website_url = data.website_url or None
    profile.social_instagram = data.social_instagram or None
    profile.social_twitter = data.social_twitter or None
    profile.social_facebook = data.social_facebook or None
    profile.social_linkedin = data.social_linkedin or None
    profile.social_tiktok = data.social_tiktok or None
    profile.is_registered_business = data.is_registered_business
    profile.registration_doc_path = registration_doc_path
    profile.business_info_status = "pending"
    profile.business_info_rejection_reason = None
    profile.onboarding_step = max(profile.onboarding_step, 3)
    profile.updated_at = datetime.now(UTC)

    await db.flush()

    logger.info(
        "Step 2 submitted for user_id=%s; onboarding_step now %d",
        user_id,
        profile.onboarding_step,
    )

    return _build_onboarding_status_response(profile)


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------


def _validate_url(url: str) -> Optional[str]:
    """Return an error string if *url* fails scheme/host validation, else None.

    Accepts only ``http://`` and ``https://`` schemes.  The host segment must
    be non-empty.

    Args:
        url: The URL string to validate.

    Returns:
        A human-readable error message, or ``None`` if the URL is valid.

    Requirements: 3.2
    """
    if not url.startswith(_ALLOWED_SCHEMES):
        return "URL must begin with 'http://' or 'https://'."

    try:
        parsed = urlparse(url)
    except Exception:
        return "URL is malformed."

    if not parsed.netloc:
        return "URL must contain a non-empty host segment."

    return None


def _ext_from_filename_or_mime(
    filename: Optional[str],
    mime_type: str,
) -> str:
    """Derive a file extension from *filename*, falling back to *mime_type*.

    Args:
        filename: The original uploaded filename (may be ``None``).
        mime_type: The server-side detected MIME type.

    Returns:
        A lowercase extension string without a leading dot (e.g. ``"pdf"``).
    """
    if filename:
        # Split on the last dot; discard everything before it.
        parts = filename.rsplit(".", 1)
        if len(parts) == 2 and parts[1]:
            return parts[1].lower()

    # Fallback mapping for accepted MIME types.
    _MIME_TO_EXT = {
        "application/pdf": "pdf",
        "image/jpeg": "jpg",
        "image/png": "png",
    }
    return _MIME_TO_EXT.get(mime_type, "bin")


# ---------------------------------------------------------------------------
# KYC step service methods
# ---------------------------------------------------------------------------

# Accepted non-Nigeria document types (Requirement 4.3)
_VALID_NON_NG_DOC_TYPES: frozenset[str] = frozenset(
    {"passport", "national_id", "drivers_license"}
)


async def submit_step_3_manual(
    user_id: uuid.UUID,
    data: Step3Request,
    file_content: Optional[bytes],
    file_content_type: Optional[str],
    file_filename: Optional[str],
    db: AsyncSession,
) -> OnboardingStatusResponse:
    """Persist Step 3 (KYC — manual document upload) and advance onboarding step.

    Branches on the merchant's registered country:

    **Nigerian merchants** (``profile.country.lower() == "nigeria"``)
    - ``data.nin`` must be a non-null 11-digit numeric string.
    - A KYC document file (``file_content``) is required.

    **Non-Nigerian merchants**
    - ``data.kyc_document_type`` must be one of ``'passport'``,
      ``'national_id'``, ``'drivers_license'``.
    - A KYC document file (``file_content``) is required.

    In both paths the uploaded file is validated via ``validate_upload``
    (raises ``FileTooLargeError`` or ``FileMimeInvalidError`` on failure),
    uploaded to the configured ``StorageBackend``, and its storage key
    is persisted on the profile.

    ``onboarding_step`` is advanced to ``max(current, 4)`` so re-submission
    of step 3 does not regress a merchant who has already reached step 4.

    Args:
        user_id: The authenticated merchant's User ID.
        data: Validated ``Step3Request`` from the router.
        file_content: Raw bytes of the uploaded identity document.
        file_content_type: Declared MIME type from multipart header (ignored
            for validation; server-side inspection is used instead).
        file_filename: Original filename (used to derive extension).
        db: The active async SQLAlchemy session.

    Returns:
        Updated ``OnboardingStatusResponse``.

    Raises:
        HTTPException(422): Validation failure with field-level detail.
        FileTooLargeError (HTTP 400): File exceeds ``MAX_UPLOAD_SIZE_MB``.
        FileMimeInvalidError (HTTP 400): File MIME type is not accepted.
        StorageUnavailableError (HTTP 503): Storage backend is unreachable.

    Requirements: 4.1–4.15
    """
    profile = await get_or_create_profile(user_id, db)

    is_nigeria = profile.country.strip().lower() == "nigeria"
    errors: dict[str, str] = {}
    has_existing_doc = bool(profile.kyc_document_path)

    if is_nigeria:
        # Nigeria path: NIN (11 digits) + document file required
        nin = data.nin
        if not nin:
            errors["nin"] = "NIN is required for Nigerian merchants."
        elif not re.fullmatch(r"\d{11}", nin):
            errors["nin"] = "NIN must be exactly 11 numeric digits."

        if not file_content and not has_existing_doc:
            errors["kyc_document"] = (
                "An identity document file is required for KYC verification."
            )
    else:
        # Non-Nigeria path: doc_type + document file required
        doc_type = data.kyc_document_type
        if not doc_type:
            errors["kyc_document_type"] = (
                "kyc_document_type is required for non-Nigerian merchants."
            )
        elif doc_type not in _VALID_NON_NG_DOC_TYPES:
            errors["kyc_document_type"] = (
                f"kyc_document_type must be one of: "
                f"{', '.join(sorted(_VALID_NON_NG_DOC_TYPES))}."
            )

        if not file_content and not has_existing_doc:
            errors["kyc_document"] = (
                "An identity document file is required for KYC verification."
            )

    if errors:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "detail": "Step 3 validation failed.",
                "code": "VALIDATION_ERROR",
                "fields": errors,
            },
        )

    # --- File upload --------------------------------------------------------

    storage_key = profile.kyc_document_path

    if file_content:
        # validate_upload raises FileTooLargeError or FileMimeInvalidError on failure.
        detected_mime = validate_upload(
            content=file_content,
            declared_content_type=file_content_type or "application/octet-stream",
            max_size_mb=settings.max_upload_size_mb,
        )

        ext = _ext_from_filename_or_mime(file_filename, detected_mime)
        storage = get_storage_backend()
        storage_key = kyc_path(user_id, ext)
        await storage.upload_file(
            content=file_content,
            path=storage_key,
            content_type=detected_mime,
        )

        logger.info(
            "KYC document uploaded for user_id=%s → key=%s", user_id, storage_key
        )

    # --- Persist ------------------------------------------------------------

    profile.kyc_document_path = storage_key
    profile.kyc_document_type = data.kyc_document_type or profile.kyc_document_type
    profile.nin = data.nin if is_nigeria else None
    profile.kyc_status = "pending"
    # Clear any previous rejection reason (Requirement 12.8)
    profile.kyc_rejection_reason = None
    profile.onboarding_step = max(profile.onboarding_step, 4)
    profile.updated_at = datetime.now(UTC)

    await db.flush()

    logger.info(
        "Step 3 (manual KYC) submitted for user_id=%s; onboarding_step now %d",
        user_id,
        profile.onboarding_step,
    )

    return _build_onboarding_status_response(profile)


async def submit_step_3_dojah(
    user_id: uuid.UUID,
    session_id: str,
    db: AsyncSession,
) -> OnboardingStatusResponse:
    """Persist Step 3 (KYC — Dojah widget flow) and advance onboarding step.

    Records the Dojah session ID and marks the KYC status as ``'approved'``.
    In the Dojah flow the widget only invokes the success callback when the
    verification succeeds; failures are handled by a widget-level timeout in
    the frontend and never reach this endpoint.

    ``onboarding_step`` is advanced to ``max(current, 4)``.

    Args:
        user_id: The authenticated merchant's User ID.
        session_id: The Dojah session ID returned by the widget on success.
        db: The active async SQLAlchemy session.

    Returns:
        Updated ``OnboardingStatusResponse``.

    Requirements: 4.2, 4.12–4.14
    """
    profile = await get_or_create_profile(user_id, db)

    profile.kyc_dojah_session_id = session_id
    profile.kyc_status = "approved"
    profile.kyc_rejection_reason = None
    profile.onboarding_step = max(profile.onboarding_step, 4)
    profile.updated_at = datetime.now(UTC)

    await db.flush()

    logger.info(
        "Step 3 (Dojah KYC) submitted for user_id=%s; session_id=%s; "
        "onboarding_step now %d",
        user_id,
        session_id,
        profile.onboarding_step,
    )

    return _build_onboarding_status_response(profile)


async def create_didit_session(
    user_id: uuid.UUID,
    callback_url: Optional[str],
    db: AsyncSession,
) -> dict[str, str]:
    """Create or retrieve a Didit automated KYC verification session for the merchant."""
    profile = await get_or_create_profile(user_id, db)
    session_data = await KYCService.initiate_didit_session(user_id, callback_url)
    profile.kyc_didit_session_id = session_data["session_id"]
    profile.updated_at = datetime.now(UTC)
    await db.flush()
    return session_data


async def check_didit_session_status(
    user_id: uuid.UUID,
    session_id: Optional[str],
    db: AsyncSession,
) -> dict[str, Any]:
    """Check decision of a Didit verification session and update profile / user status."""
    profile = await get_or_create_profile(user_id, db)
    effective_session_id = session_id or profile.kyc_didit_session_id

    if not effective_session_id:
        return {
            "session_id": None,
            "status": "not_started",
            "kyc_status": profile.kyc_status,
            "reason": "No Didit verification session has been initiated yet for this merchant.",
            "onboarding_step": profile.onboarding_step,
            "onboarding_complete": profile.onboarding_complete,
        }

    result = await KYCService.get_didit_session_decision(effective_session_id)

    if result.status == "approved":
        profile.kyc_status = "approved"
        profile.kyc_rejection_reason = None
        profile.onboarding_step = max(profile.onboarding_step, 4)
        if profile.wallet_added:
            profile.onboarding_complete = True
        profile.updated_at = datetime.now(UTC)

        user_res = await db.execute(select(User).where(User.id == user_id))
        user_obj = user_res.scalar_one_or_none()
        if user_obj and user_obj.status != "suspended":
            user_obj.status = "verified"

        await db.flush()
    elif result.status == "rejected":
        profile.kyc_status = "rejected"
        profile.kyc_rejection_reason = result.reason or "Identity verification failed"
        profile.updated_at = datetime.now(UTC)
        await db.flush()

    return {
        "session_id": effective_session_id,
        "status": result.status,
        "kyc_status": profile.kyc_status,
        "reason": result.reason,
        "onboarding_step": profile.onboarding_step,
        "onboarding_complete": profile.onboarding_complete,
    }


async def resubmit_kyc(
    user_id: uuid.UUID,
    data: Step3Request,
    file_content: Optional[bytes],
    file_content_type: Optional[str],
    file_filename: Optional[str],
    db: AsyncSession,
) -> OnboardingStatusResponse:
    """Re-submit KYC documents after a rejection.

    Only merchants whose current ``kyc_status`` is ``'rejected'`` may call
    this endpoint.  Any other status raises HTTP 409 with code
    ``INVALID_KYC_TRANSITION``.

    Follows the same validation and file-upload logic as
    :func:`submit_step_3_manual` but does **not** advance ``onboarding_step``
    — the merchant is already past step 3.

    On success:
    - ``kyc_rejection_reason`` is cleared.
    - The new document reference is stored on the profile.
    - ``kyc_status`` is set to ``'pending'``.

    Args:
        user_id: The authenticated merchant's User ID.
        data: Validated ``Step3Request`` from the router.
        file_content: Raw bytes of the replacement identity document.
        file_content_type: Declared MIME type from multipart header.
        file_filename: Original filename (used to derive extension).
        db: The active async SQLAlchemy session.

    Returns:
        Updated ``OnboardingStatusResponse``.

    Raises:
        HTTPException(404): Merchant profile does not exist.
        HTTPException(409): ``kyc_status != 'rejected'`` (code:
            ``INVALID_KYC_TRANSITION``).
        HTTPException(422): Validation failure with field-level detail.
        FileTooLargeError (HTTP 400): File exceeds ``MAX_UPLOAD_SIZE_MB``.
        FileMimeInvalidError (HTTP 400): File MIME type is not accepted.
        StorageUnavailableError (HTTP 503): Storage backend is unreachable.

    Requirements: 4.9, 4.10, 12.1, 12.8
    """
    from sqlalchemy import select as _select  # already imported at top; re-use alias

    result = await db.execute(
        _select(MerchantProfile).where(MerchantProfile.user_id == user_id)
    )
    profile: Optional[MerchantProfile] = result.scalar_one_or_none()

    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "detail": "Merchant profile not found.",
                "code": "PROFILE_NOT_FOUND",
            },
        )

    # Validate KYC state machine: only rejected → pending is valid here.
    if not can_transition_kyc(profile.kyc_status, "pending"):
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "detail": (
                    f"Cannot transition KYC status from "
                    f"'{profile.kyc_status}' to 'pending'."
                ),
                "code": "INVALID_KYC_TRANSITION",
            },
        )

    # --- Validate fields (same rules as submit_step_3_manual) ---------------

    is_nigeria = profile.country.strip().lower() == "nigeria"
    errors: dict[str, str] = {}

    if is_nigeria:
        nin = data.nin
        if not nin:
            errors["nin"] = "NIN is required for Nigerian merchants."
        elif not re.fullmatch(r"\d{11}", nin):
            errors["nin"] = "NIN must be exactly 11 numeric digits."

        if not file_content:
            errors["kyc_document"] = (
                "An identity document file is required for KYC verification."
            )
    else:
        doc_type = data.kyc_document_type
        if not doc_type:
            errors["kyc_document_type"] = (
                "kyc_document_type is required for non-Nigerian merchants."
            )
        elif doc_type not in _VALID_NON_NG_DOC_TYPES:
            errors["kyc_document_type"] = (
                f"kyc_document_type must be one of: "
                f"{', '.join(sorted(_VALID_NON_NG_DOC_TYPES))}."
            )

        if not file_content:
            errors["kyc_document"] = (
                "An identity document file is required for KYC verification."
            )

    if errors:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "detail": "KYC resubmission validation failed.",
                "code": "VALIDATION_ERROR",
                "fields": errors,
            },
        )

    # --- File upload --------------------------------------------------------

    detected_mime = validate_upload(
        content=file_content,  # type: ignore[arg-type]
        declared_content_type=file_content_type or "application/octet-stream",
        max_size_mb=settings.max_upload_size_mb,
    )

    ext = _ext_from_filename_or_mime(file_filename, detected_mime)
    storage = get_storage_backend()
    storage_key = kyc_path(user_id, ext)
    await storage.upload_file(
        content=file_content,  # type: ignore[arg-type]
        path=storage_key,
        content_type=detected_mime,
    )

    logger.info(
        "KYC resubmission document uploaded for user_id=%s → key=%s",
        user_id,
        storage_key,
    )

    # --- Persist ------------------------------------------------------------

    profile.kyc_rejection_reason = None
    profile.kyc_document_path = storage_key
    profile.kyc_document_type = data.kyc_document_type or None
    profile.nin = data.nin if is_nigeria else None
    profile.kyc_status = "pending"
    # NOTE: onboarding_step is intentionally NOT advanced here.
    profile.updated_at = datetime.now(UTC)

    await db.flush()

    logger.info(
        "KYC resubmitted for user_id=%s; kyc_status now 'pending'", user_id
    )

    return _build_onboarding_status_response(profile)


# ---------------------------------------------------------------------------
# Wallet step and wallet CRUD service methods
# ---------------------------------------------------------------------------

# EVM address regex — service-layer copy for defence-in-depth validation.
# The canonical pattern is also compiled in app.merchant.schemas._EVM_RE.
_EVM_ADDRESS_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")


async def submit_step_4(
    user_id: uuid.UUID,
    data: Step4Request,
    db: AsyncSession,
) -> OnboardingStatusResponse:
    """Persist Step 4 (wallet setup) and mark onboarding as complete.

    Validates the EVM address and network at the service layer (defence-in-depth
    — Pydantic already enforces both at the schema layer).  Upserts the
    ``MerchantWallet`` record: if an active/pending wallet already exists for
    the same merchant + network, its address is updated; otherwise a new wallet
    row is inserted.

    On success:
    - ``profile.wallet_added`` is set to ``True``.
    - ``profile.onboarding_complete`` is set to ``True``.
    - ``profile.onboarding_step`` is advanced to ``max(current, 5)`` — step 5
    signals that all four wizard steps have been completed.

    Args:
        user_id: The authenticated merchant's User ID.
        data: Validated ``Step4Request`` from the router.
        db: The active async SQLAlchemy session.

    Returns:
        Updated ``OnboardingStatusResponse`` with ``onboarding_complete=True``
        and ``wallet_added=True``.

    Raises:
        HTTPException(422): Service-layer validation failure.

    Requirements: 5.4, 5.6, 5.9, 5.10, 16.4
    """
    profile = await get_or_create_profile(user_id, db)

    # --- Service-layer validation (defence-in-depth) ------------------------

    errors: dict[str, str] = {}

    if not _EVM_ADDRESS_RE.fullmatch(data.address):
        errors["address"] = (
            "Invalid EVM address — must be '0x' followed by exactly 40 hex characters."
        )

    if not data.network.strip():
        errors["network"] = "network must not be empty."

    if errors:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "detail": "Step 4 validation failed.",
                "code": "VALIDATION_ERROR",
                "fields": errors,
            },
        )

    # --- Cryptographic verification (if signature provided) -----------------
    if data.signature and data.nonce:
        valid_sig = await verify_wallet_signature(
            address=data.address,
            signature=data.signature,
            nonce=data.nonce,
        )
        if not valid_sig:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "detail": "Cryptographic wallet signature verification failed or nonce expired.",
                    "code": "INVALID_WALLET_SIGNATURE",
                },
            )

    # --- Upsert MerchantWallet ----------------------------------------------

    result = await db.execute(
        select(MerchantWallet).where(
            and_(
                MerchantWallet.merchant_id == user_id,
                MerchantWallet.network == data.network,
                or_(
                    MerchantWallet.status == "active",
                    MerchantWallet.status == "pending",
                ),
            )
        )
    )
    existing_wallet = result.scalar_one_or_none()

    if existing_wallet is not None:
        existing_wallet.address = data.address
        existing_wallet.updated_at = datetime.now(UTC)
        wallet = existing_wallet
        logger.info(
            "Updated existing wallet id=%s for user_id=%s network=%r",
            wallet.id,
            user_id,
            data.network,
        )
    else:
        wallet = MerchantWallet(
            merchant_id=user_id,
            network=data.network,
            address=data.address,
            status="active",
        )
        db.add(wallet)
        logger.info(
            "Created new wallet for user_id=%s network=%r", user_id, data.network
        )

    # --- Advance profile ----------------------------------------------------

    profile.wallet_added = True
    profile.onboarding_complete = True
    profile.onboarding_step = max(profile.onboarding_step, 5)
    profile.updated_at = datetime.now(UTC)

    await db.flush()

    logger.info(
        "Step 4 submitted for user_id=%s; onboarding_complete=True wallet_added=True",
        user_id,
    )

    return _build_onboarding_status_response(profile)


async def list_wallets(
    user_id: uuid.UUID,
    db: AsyncSession,
) -> list[WalletResponse]:
    """Return all non-inactive wallets belonging to a merchant.

    Wallets with ``status='inactive'`` (soft-deleted) are excluded.  Results
    are ordered by ``created_at`` ascending so the earliest wallet appears
    first.

    Args:
        user_id: The authenticated merchant's User ID.
        db: The active async SQLAlchemy session.

    Returns:
        List of ``WalletResponse`` objects.

    Requirements: 13.1, 13.2
    """
    result = await db.execute(
        select(MerchantWallet)
        .where(
            and_(
                MerchantWallet.merchant_id == user_id,
                MerchantWallet.status != "inactive",
            )
        )
        .order_by(MerchantWallet.created_at.asc())
    )
    wallets = result.scalars().all()
    return [WalletResponse.model_validate(w) for w in wallets]


async def create_wallet_challenge(
    user_id: uuid.UUID,
    address: str,
) -> WalletChallengeResponse:
    """Generate an EIP-191 challenge for the merchant to sign with their wallet."""
    # Defence-in-depth EVM address check.
    if not _EVM_ADDRESS_RE.fullmatch(address):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "detail": "Invalid EVM address.",
                "code": "VALIDATION_ERROR",
                "fields": {
                    "address": (
                        "Invalid EVM address — must be '0x' followed by "
                        "exactly 40 hex characters."
                    )
                },
            },
        )

    res = await generate_wallet_challenge(merchant_id=user_id, address=address)
    return WalletChallengeResponse(
        challenge=str(res["challenge"]),
        nonce=str(res["nonce"]),
        address=str(res["address"]),
        expires_in=int(res["expires_in"]),
    )


async def add_wallet(
    user_id: uuid.UUID,
    data: WalletCreate,
    db: AsyncSession,
) -> WalletResponse:
    """Add a new wallet address for a merchant.

    Validates the EVM address (defence-in-depth) and checks that no
    active/pending wallet already exists for the same merchant + network.

    Args:
        user_id: The authenticated merchant's User ID.
        data: Validated ``WalletCreate`` from the router.
        db: The active async SQLAlchemy session.

    Returns:
        ``WalletResponse`` for the newly created wallet.

    Raises:
        HTTPException(422): Invalid EVM address.
        HTTPException(409): A wallet for this network already exists.

    Requirements: 13.3, 13.4
    """
    # Defence-in-depth EVM address check.
    if not _EVM_ADDRESS_RE.fullmatch(data.address):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "detail": "Invalid EVM address.",
                "code": "VALIDATION_ERROR",
                "fields": {
                    "address": (
                        "Invalid EVM address — must be '0x' followed by "
                        "exactly 40 hex characters."
                    )
                },
            },
        )

    # Duplicate-network guard.
    result = await db.execute(
        select(MerchantWallet).where(
            and_(
                MerchantWallet.merchant_id == user_id,
                MerchantWallet.network == data.network,
                or_(
                    MerchantWallet.status == "active",
                    MerchantWallet.status == "pending",
                ),
            )
        )
    )
    if result.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "detail": "A wallet for this network already exists.",
                "code": "WALLET_DUPLICATE_NETWORK",
            },
        )

    # Cryptographic signature validation (if provided)
    if data.signature and data.nonce:
        valid_sig = await verify_wallet_signature(
            address=data.address,
            signature=data.signature,
            nonce=data.nonce,
        )
        if not valid_sig:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail={
                    "detail": "Cryptographic wallet signature verification failed or nonce expired.",
                    "code": "INVALID_WALLET_SIGNATURE",
                },
            )

    wallet = MerchantWallet(
        merchant_id=user_id,
        network=data.network,
        address=data.address,
        status="active",
    )
    db.add(wallet)
    await db.flush()

    # In-app notification & security alert email
    try:
        from app.core.notifications import create_in_app_notification
        await create_in_app_notification(
            db,
            user_id,
            title="Payout Wallet Configured",
            message=f"Wallet {data.address[:6]}...{data.address[-4:]} added for {data.network}",
            type="wallet_added",
            link="/dashboard/wallets",
            commit=False,
        )
        from app.core.tasks import send_wallet_added_security_email
        send_wallet_added_security_email.delay(
            user_id=str(user_id),
            address=data.address,
            network=data.network,
            label=getattr(data, "label", None),
        )
    except Exception as notif_err:
        logger.warning("Could not dispatch wallet notification: %s", notif_err)

    logger.info(
        "Wallet added for user_id=%s network=%r id=%s", user_id, data.network, wallet.id
    )

    return WalletResponse.model_validate(wallet)


async def delete_wallet(
    user_id: uuid.UUID,
    wallet_id: uuid.UUID,
    db: AsyncSession,
) -> None:
    """Soft-delete a merchant wallet by setting its status to ``'inactive'``.

    The wallet must belong to the requesting merchant and must not already be
    inactive.  A conservative guard prevents removal of the last
    active/pending wallet when the merchant still has active payment links:
    if only one active/pending wallet remains across all networks and the
    merchant has at least one active ``PaymentLink``, the delete is blocked.

    Args:
        user_id: The authenticated merchant's User ID.
        wallet_id: The UUID of the wallet to delete.
        db: The active async SQLAlchemy session.

    Returns:
        ``None`` on success.

    Raises:
        HTTPException(404): Wallet not found or already inactive.
        HTTPException(409): Last active wallet with active payment links.

    Requirements: 13.5, 13.6
    """
    # Fetch the wallet owned by this merchant.
    result = await db.execute(
        select(MerchantWallet).where(
            and_(
                MerchantWallet.id == wallet_id,
                MerchantWallet.merchant_id == user_id,
            )
        )
    )
    wallet = result.scalar_one_or_none()

    if wallet is None or wallet.status == "inactive":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "detail": "Wallet not found.",
                "code": "WALLET_NOT_FOUND",
            },
        )

    # Conservative guard: if this is the last active/pending wallet and there
    # are active payment links, block the deletion.
    active_wallet_result = await db.execute(
        select(MerchantWallet).where(
            and_(
                MerchantWallet.merchant_id == user_id,
                or_(
                    MerchantWallet.status == "active",
                    MerchantWallet.status == "pending",
                ),
            )
        )
    )
    active_wallets = active_wallet_result.scalars().all()

    if len(active_wallets) == 1:
        # This is the only active/pending wallet — check for active payment links.
        link_result = await db.execute(
            select(PaymentLink).where(
                and_(
                    PaymentLink.merchant_id == user_id,
                    PaymentLink.status == "active",
                )
            )
        )
        active_link = link_result.scalars().first()
        if active_link is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "detail": (
                        "Cannot delete the last active wallet associated with "
                        "active payment links."
                    ),
                    "code": "WALLET_LAST_ACTIVE",
                },
            )

    # Soft-delete.
    wallet.status = "inactive"
    wallet.updated_at = datetime.now(UTC)
    await db.flush()

    logger.info(
        "Wallet soft-deleted: id=%s user_id=%s", wallet_id, user_id
    )


# ---------------------------------------------------------------------------
# Payment link service methods
# ---------------------------------------------------------------------------


def _build_payment_url(link: PaymentLink) -> str:
    """Return the full public URL for a payment link.

    Args:
        link: A ``PaymentLink`` ORM instance.

    Returns:
        The absolute URL customers use to reach the checkout page.
    """
    return f"{settings.frontend_origin}/pay/{link.slug}"


def _payment_link_response(link: PaymentLink) -> PaymentLinkResponse:
    """Construct a ``PaymentLinkResponse`` from an ORM instance.

    Args:
        link: A ``PaymentLink`` ORM instance.

    Returns:
        A fully-populated ``PaymentLinkResponse``.
    """
    base = PaymentLinkResponse.model_validate(link)
    base.payment_url = _build_payment_url(link)
    return base


async def create_payment_link(
    user_id: uuid.UUID,
    data: PaymentLinkCreate,
    db: AsyncSession,
) -> PaymentLinkResponse:
    """Create a new payment link for a merchant.

    Service-layer validation (defence-in-depth over the Pydantic schema):

    - ``title``: at least one non-whitespace character, ≤ 200 chars.
    - ``amount_mode``: must be ``'fixed'`` or ``'flexible'``.
    - ``amount``: required when ``amount_mode == 'fixed'``; must be positive,
      ≤ 999,999,999.99, and have at most 18 decimal places.
    - ``accepted_tokens``: at least one entry.
    - ``expires_at``: if provided, must be in the future.
    - ``max_uses``: if provided, must be a positive integer ≤ 1,000,000.
    - ``redirect_url``: if provided, must start with ``http://`` / ``https://``
      and have a non-empty host.

    A unique slug is generated via :func:`ensure_unique_slug`.  The new record
    is flushed (not committed — the caller's unit of work controls the commit).

    Args:
        user_id: The authenticated merchant's User ID.
        data: Validated ``PaymentLinkCreate`` from the router.
        db: The active async SQLAlchemy session.

    Returns:
        ``PaymentLinkResponse`` with ``payment_url`` injected.

    Raises:
        HTTPException(422): Validation failure with field-level detail.
        SlugCollisionError (HTTP 500): Unique slug could not be generated.

    Requirements: 8.1–8.18, 9.1–9.2
    """
    # KYC approval requirement
    profile = await get_or_create_profile(user_id, db)
    if profile.kyc_status != "approved":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Merchant KYC verification must be approved before creating payment links.",
        )

    errors: dict[str, str] = {}

    # title
    if not data.title.strip():
        errors["title"] = "title must contain at least one non-whitespace character."
    elif len(data.title) > 200:
        errors["title"] = "title must be at most 200 characters."

    # amount_mode
    if data.amount_mode not in ("fixed", "flexible"):
        errors["amount_mode"] = "amount_mode must be 'fixed' or 'flexible'."

    # amount (only validated when amount_mode is fixed)
    if data.amount_mode == "fixed":
        if data.amount is None:
            errors["amount"] = "amount is required when amount_mode is 'fixed'."
        else:
            if data.amount <= 0:
                errors["amount"] = "amount must be a positive value."
            elif data.amount > Decimal("999999999.99"):
                errors["amount"] = "amount must not exceed 999,999,999.99."
            else:
                sign, digits, exponent = data.amount.as_tuple()
                dp = -exponent if exponent < 0 else 0
                if dp > 18:
                    errors["amount"] = "amount must have at most 18 decimal places."

    # accepted_tokens
    if not data.accepted_tokens:
        errors["accepted_tokens"] = "At least one accepted token must be provided."

    # expires_at — must be in the future
    if data.expires_at is not None:
        if data.expires_at <= datetime.now(UTC):
            errors["expires_at"] = "expires_at must be a future date/time."

    # max_uses
    if data.max_uses is not None:
        if data.max_uses < 1:
            errors["max_uses"] = "max_uses must be a positive integer."
        elif data.max_uses > 1_000_000:
            errors["max_uses"] = "max_uses must not exceed 1,000,000."

    # redirect_url
    if data.redirect_url is not None:
        url_error = _validate_url(data.redirect_url)
        if url_error:
            errors["redirect_url"] = url_error

    if errors:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "detail": "Payment link validation failed.",
                "code": "VALIDATION_ERROR",
                "fields": errors,
            },
        )

    # Generate a unique slug.
    slug = await ensure_unique_slug(db)

    link = PaymentLink(
        merchant_id=user_id,
        title=data.title.strip(),
        slug=slug,
        amount_mode=data.amount_mode,
        amount=data.amount,
        currency=None,
        accepted_tokens=data.accepted_tokens,
        status="active",
        expires_at=data.expires_at,
        max_uses=data.max_uses,
        redirect_url=data.redirect_url,
        custom_message=data.custom_message,
        collect_phone=data.collect_phone,
        collect_address=data.collect_address,
    )
    db.add(link)
    await db.flush()

    logger.info(
        "PaymentLink created: id=%s slug=%r user_id=%s", link.id, slug, user_id
    )

    return _payment_link_response(link)


async def list_payment_links(
    user_id: uuid.UUID,
    db: AsyncSession,
    page: int = 1,
    page_size: int = 20,
) -> PaymentLinkListResponse:
    """Return a paginated list of payment links for a merchant.

    Results are ordered by ``created_at DESC`` (newest first).  The
    ``page_size`` is capped at 100.

    Args:
        user_id: The authenticated merchant's User ID.
        db: The active async SQLAlchemy session.
        page: 1-based page number.  Defaults to 1.
        page_size: Number of records per page.  Defaults to 20, max 100.

    Returns:
        ``PaymentLinkListResponse`` with ``items``, ``total``, ``page``,
        ``page_size``, and ``total_pages``.

    Requirements: 9.1, 9.3
    """
    # Clamp page_size.
    page_size = min(max(page_size, 1), 100)
    page = max(page, 1)
    offset = (page - 1) * page_size

    # Total count.
    count_result = await db.execute(
        select(func.count())
        .select_from(PaymentLink)
        .where(PaymentLink.merchant_id == user_id)
    )
    total: int = count_result.scalar_one()

    # Fetch page.
    rows_result = await db.execute(
        select(PaymentLink)
        .where(PaymentLink.merchant_id == user_id)
        .order_by(PaymentLink.created_at.desc())
        .limit(page_size)
        .offset(offset)
    )
    links = rows_result.scalars().all()

    total_pages = math.ceil(total / page_size) if total > 0 else 1

    return PaymentLinkListResponse(
        items=[_payment_link_response(lnk) for lnk in links],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


async def deactivate_payment_link(
    user_id: uuid.UUID,
    link_id: uuid.UUID,
    db: AsyncSession,
) -> PaymentLinkResponse:
    """Set a payment link's status to ``'inactive'``.

    The link must belong to the requesting merchant; otherwise HTTP 404 is
    raised.

    Args:
        user_id: The authenticated merchant's User ID.
        link_id: The UUID of the payment link to deactivate.
        db: The active async SQLAlchemy session.

    Returns:
        Updated ``PaymentLinkResponse``.

    Raises:
        HTTPException(404): Link not found or owned by a different merchant.

    Requirements: 9.4, 9.6
    """
    result = await db.execute(
        select(PaymentLink).where(
            and_(
                PaymentLink.id == link_id,
                PaymentLink.merchant_id == user_id,
            )
        )
    )
    link = result.scalar_one_or_none()

    if link is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "detail": "Payment link not found.",
                "code": "PAYMENT_LINK_NOT_FOUND",
            },
        )

    link.status = "inactive"
    link.updated_at = datetime.now(UTC)
    await db.flush()

    logger.info(
        "PaymentLink deactivated: id=%s user_id=%s", link_id, user_id
    )

    return _payment_link_response(link)


async def generate_qr_code(
    user_id: uuid.UUID,
    link_id: uuid.UUID,
    db: AsyncSession,
) -> bytes:
    """Generate a PNG QR code encoding the payment URL for a link.

    The QR code is generated in-memory using the ``qrcode`` library and
    returned as raw PNG bytes.  The caller (router) is responsible for
    returning these bytes with ``media_type='image/png'``.

    Args:
        user_id: The authenticated merchant's User ID.
        link_id: The UUID of the payment link.
        db: The active async SQLAlchemy session.

    Returns:
        Raw PNG image bytes.

    Raises:
        HTTPException(404): Link not found or owned by a different merchant.

    Requirements: 8.16, 9.6
    """
    result = await db.execute(
        select(PaymentLink).where(
            and_(
                PaymentLink.id == link_id,
                PaymentLink.merchant_id == user_id,
            )
        )
    )
    link = result.scalar_one_or_none()

    if link is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "detail": "Payment link not found.",
                "code": "PAYMENT_LINK_NOT_FOUND",
            },
        )

    url = _build_payment_url(link)

    qr = qrcode.QRCode(box_size=10, border=4)
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")

    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Invoice helpers
# ---------------------------------------------------------------------------


def _invoice_response(invoice: Invoice) -> InvoiceResponse:
    """Construct an ``InvoiceResponse`` from an ORM instance.

    The ``line_items`` relationship must already be loaded (eager or joined)
    before calling this helper.

    Args:
        invoice: A ``Invoice`` ORM instance with ``line_items`` loaded.

    Returns:
        A fully-populated ``InvoiceResponse``.
    """
    return InvoiceResponse.model_validate(invoice)


# ---------------------------------------------------------------------------
# Invoice service methods
# ---------------------------------------------------------------------------


async def create_invoice(
    user_id: uuid.UUID,
    data: InvoiceCreate,
    db: AsyncSession,
) -> InvoiceResponse:
    """Create a new invoice in ``draft`` status.

    Service-layer validation (defence-in-depth over the Pydantic schema):

    - ``customer_name``: 1–200 non-whitespace characters.
    - ``customer_email``: well-formed email (validated by schema, confirmed here).
    - ``line_items``: 1–50 items; each ``description`` ≤ 500 chars; each
      ``amount`` positive, ≤ 999,999.99, ≤ 2 decimal places.
    - ``due_date``: must be a future date (strictly after today).
    - ``accepted_tokens``: at least one entry.
    - ``notes``: if provided, must not exceed 2000 characters.

    No email is sent on creation — the invoice is persisted as ``draft`` only.

    Args:
        user_id: The authenticated merchant's User ID.
        data: Validated ``InvoiceCreate`` from the router.
        db: The active async SQLAlchemy session.

    Returns:
        ``InvoiceResponse`` for the newly created draft invoice.

    Raises:
        HTTPException(422): Validation failure with field-level detail.

    Requirements: 10.1–10.7
    """
    # KYC approval requirement
    profile = await get_or_create_profile(user_id, db)
    if profile.kyc_status != "approved":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Merchant KYC verification must be approved before creating invoices.",
        )

    errors: dict[str, str] = {}

    # customer_name — schema already validates length; service confirms non-whitespace.
    if not data.customer_name.strip():
        errors["customer_name"] = (
            "customer_name must contain at least one non-whitespace character."
        )

    # due_date — must be strictly after today.
    today = date.today()
    if data.due_date <= today:
        errors["due_date"] = "due_date must be a future date."

    # accepted_tokens — at least one entry.
    if not data.accepted_tokens:
        errors["accepted_tokens"] = "At least one accepted token must be provided."

    # notes — max 2000 chars (schema Field cap handles this; defensive check retained).
    if data.notes is not None and len(data.notes) > 2000:
        errors["notes"] = "notes must not exceed 2000 characters."

    # line_items — additional service-layer checks (schema covers min/max count and
    # amount range; we verify per-item constraints here for defence-in-depth).
    if not data.line_items:
        errors["line_items"] = "At least one line item is required."
    elif len(data.line_items) > 50:
        errors["line_items"] = "At most 50 line items are allowed."
    else:
        item_errors: list[str] = []
        for idx, item in enumerate(data.line_items):
            if not item.description.strip():
                item_errors.append(
                    f"Line item {idx + 1}: description must not be blank."
                )
            if len(item.description) > 500:
                item_errors.append(
                    f"Line item {idx + 1}: description must be at most 500 characters."
                )
        if item_errors:
            errors["line_items"] = "; ".join(item_errors)

    if errors:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "detail": "Invoice validation failed.",
                "code": "VALIDATION_ERROR",
                "fields": errors,
            },
        )

    # Persist the invoice.
    invoice = Invoice(
        merchant_id=user_id,
        customer_name=data.customer_name.strip(),
        customer_email=data.customer_email,
        due_date=data.due_date,
        status="draft",
        notes=data.notes,
        accepted_tokens=data.accepted_tokens,
    )
    db.add(invoice)
    await db.flush()  # populate invoice.id

    # Persist line items.
    for idx, item_data in enumerate(data.line_items):
        line_item = InvoiceLineItem(
            invoice_id=invoice.id,
            description=item_data.description,
            amount=item_data.amount,
            sort_order=item_data.sort_order if item_data.sort_order is not None else idx,
        )
        db.add(line_item)

    await db.flush()
    # Refresh to load the line_items relationship.
    await db.refresh(invoice, attribute_names=["line_items"])

    logger.info(
        "Invoice created (draft): id=%s merchant_id=%s customer=%r",
        invoice.id,
        user_id,
        invoice.customer_email,
    )

    return _invoice_response(invoice)


async def send_invoice(
    user_id: uuid.UUID,
    invoice_id: uuid.UUID,
    db: AsyncSession,
) -> InvoiceResponse:
    """Transition a draft invoice to ``sent``, create its PaymentLink, and dispatch email.

    Atomically:
    1. Verifies the invoice belongs to ``user_id`` (HTTP 404 if not).
    2. Verifies ``status == 'draft'`` (HTTP 400 ``INVOICE_NOT_DRAFT`` otherwise).
    3. Creates an associated ``PaymentLink`` (inheriting ``accepted_tokens``).
    4. Sets ``invoice.status = 'sent'`` and links the payment link.
    5. Commits the transaction.
    6. Dispatches the ``send_invoice_email`` Celery task post-commit.

    On permanent email-task failure, the ``send_invoice_email_failure_rollback``
    task (registered as ``link_error`` on the email task) reverts the invoice to
    ``draft`` and deactivates the payment link.

    Args:
        user_id: The authenticated merchant's User ID.
        invoice_id: The UUID of the invoice to send.
        db: The active async SQLAlchemy session.

    Returns:
        Updated ``InvoiceResponse`` with ``status = 'sent'``.

    Raises:
        HTTPException(404): Invoice not found or belongs to a different merchant.
        HTTPException(400): Invoice status is not ``'draft'``.

    Requirements: 10.8
    """
    from sqlalchemy.orm import selectinload

    result = await db.execute(
        select(Invoice)
        .options(selectinload(Invoice.line_items))
        .where(
            and_(
                Invoice.id == invoice_id,
                Invoice.merchant_id == user_id,
            )
        )
    )
    invoice = result.scalar_one_or_none()

    if invoice is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "detail": "Invoice not found.",
                "code": "INVOICE_NOT_FOUND",
            },
        )

    if invoice.status != "draft":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "detail": "Only draft invoices can be sent.",
                "code": "INVOICE_NOT_DRAFT",
            },
        )

    # Generate a unique slug for the auto-created payment link.
    slug = await ensure_unique_slug(db)

    # Create an associated payment link so customers have a checkout URL.
    link = PaymentLink(
        merchant_id=user_id,
        title=f"Invoice – {invoice.customer_name}",
        slug=slug,
        amount_mode="flexible",
        amount=None,
        currency=None,
        accepted_tokens=invoice.accepted_tokens,
        status="active",
        expires_at=None,
        max_uses=None,
        redirect_url=None,
    )
    db.add(link)
    await db.flush()  # populate link.id

    # Transition the invoice to 'sent' and associate the payment link.
    invoice.payment_link_id = link.id
    invoice.status = "sent"
    invoice.updated_at = datetime.now(UTC)
    await db.flush()

    logger.info(
        "Invoice sent: id=%s merchant_id=%s payment_link_id=%s",
        invoice_id,
        user_id,
        link.id,
    )

    # Dispatch the email task after the DB changes are flushed.  The router's
    # commit will occur after this returns; the task will fire post-commit via
    # the caller's commit boundary (the task is idempotent if the invoice is
    # already 'sent' when it runs).
    from app.core.tasks import send_invoice_email

    send_invoice_email.apply_async(
        args=[str(invoice_id)],
        link_error=None,  # link_error is set on the task definition itself
    )

    return _invoice_response(invoice)


async def cancel_invoice(
    user_id: uuid.UUID,
    invoice_id: uuid.UUID,
    db: AsyncSession,
) -> InvoiceResponse:
    """Cancel an invoice and deactivate its associated payment link.

    The invoice must belong to ``user_id`` (HTTP 404 if not) and its status
    must be one of ``{draft, sent, viewed, overdue}`` (HTTP 409
    ``INVOICE_NOT_CANCELLABLE`` otherwise).

    The associated ``PaymentLink`` (if any) is set to ``inactive`` in the same
    database transaction.

    Args:
        user_id: The authenticated merchant's User ID.
        invoice_id: The UUID of the invoice to cancel.
        db: The active async SQLAlchemy session.

    Returns:
        Updated ``InvoiceResponse`` with ``status = 'cancelled'``.

    Raises:
        HTTPException(404): Invoice not found or belongs to a different merchant.
        HTTPException(409): Invoice status is not cancellable.

    Requirements: 10.12, 10.13
    """
    from sqlalchemy.orm import selectinload

    result = await db.execute(
        select(Invoice)
        .options(selectinload(Invoice.line_items))
        .where(
            and_(
                Invoice.id == invoice_id,
                Invoice.merchant_id == user_id,
            )
        )
    )
    invoice = result.scalar_one_or_none()

    if invoice is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={
                "detail": "Invoice not found.",
                "code": "INVOICE_NOT_FOUND",
            },
        )

    _CANCELLABLE_STATUSES = {"draft", "sent", "viewed", "overdue"}
    if invoice.status not in _CANCELLABLE_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "detail": (
                    f"Invoices with status '{invoice.status}' cannot be cancelled."
                ),
                "code": "INVOICE_NOT_CANCELLABLE",
            },
        )

    # Deactivate the associated payment link if one exists.
    if invoice.payment_link_id is not None:
        link_result = await db.execute(
            select(PaymentLink).where(PaymentLink.id == invoice.payment_link_id)
        )
        link = link_result.scalar_one_or_none()
        if link is not None and link.status != "inactive":
            link.status = "inactive"
            link.updated_at = datetime.now(UTC)

    invoice.status = "cancelled"
    invoice.updated_at = datetime.now(UTC)
    await db.flush()

    logger.info(
        "Invoice cancelled: id=%s merchant_id=%s", invoice_id, user_id
    )

    return _invoice_response(invoice)


async def list_invoices(
    user_id: uuid.UUID,
    db: AsyncSession,
    page: int = 1,
    page_size: int = 20,
    status_filter: Optional[str] = None,
) -> InvoiceListResponse:
    """Return a paginated list of invoices for a merchant.

    Results are ordered by ``created_at DESC`` (newest first).  An optional
    ``status_filter`` narrows results to invoices matching that status.  The
    ``page_size`` is capped at 100.

    Args:
        user_id: The authenticated merchant's User ID.
        db: The active async SQLAlchemy session.
        page: 1-based page number.  Defaults to 1.
        page_size: Number of records per page.  Defaults to 20, max 100.
        status_filter: Optional invoice status to filter by (e.g. ``'draft'``).

    Returns:
        ``InvoiceListResponse`` with ``items``, ``total``, ``page``,
        ``page_size``, and ``total_pages``.

    Requirements: 10.14
    """
    from sqlalchemy.orm import selectinload

    # Clamp page_size.
    page_size = min(max(page_size, 1), 100)
    page = max(page, 1)
    offset = (page - 1) * page_size

    base_filter = Invoice.merchant_id == user_id
    if status_filter is not None:
        base_filter = and_(base_filter, Invoice.status == status_filter)

    # Total count.
    count_result = await db.execute(
        select(func.count()).select_from(Invoice).where(base_filter)
    )
    total: int = count_result.scalar_one()

    # Fetch page with line_items eagerly loaded.
    rows_result = await db.execute(
        select(Invoice)
        .options(selectinload(Invoice.line_items))
        .where(base_filter)
        .order_by(Invoice.created_at.desc())
        .limit(page_size)
        .offset(offset)
    )
    invoices = rows_result.scalars().all()

    total_pages = math.ceil(total / page_size) if total > 0 else 1

    return InvoiceListResponse(
        items=[_invoice_response(inv) for inv in invoices],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


# ---------------------------------------------------------------------------
# Dashboard overview service method
# ---------------------------------------------------------------------------


async def get_dashboard_overview(
    user_id: uuid.UUID,
    db: AsyncSession,
) -> DashboardOverviewResponse:
    """Return the merchant's dashboard overview metrics.

    Computes comprehensive analytics by querying all payments associated with
    the merchant's payment links and invoices:
    - Lifetime confirmed volume & representative token
    - Pending in-flight payments count
    - 30-day volume and conversion success rate
    - Active links count and open invoices count
    - Token & network breakdown distributions
    - 14-day daily volume trend series for visual charts
    - 10 most recent transactions with source titles, hashes, and dates
    """
    now = datetime.now(UTC)
    thirty_days_ago = now - timedelta(days=30)
    fourteen_days_ago = now - timedelta(days=14)

    # 1. Base query for all payments belonging to merchant (links or invoices)
    payments_stmt = (
        select(Payment, PaymentLink, Invoice)
        .outerjoin(PaymentLink, Payment.payment_link_id == PaymentLink.id)
        .outerjoin(Invoice, Payment.invoice_id == Invoice.id)
        .where(
            or_(
                PaymentLink.merchant_id == user_id,
                Invoice.merchant_id == user_id,
            )
        )
        .order_by(desc(Payment.created_at))
    )
    all_payment_rows = (await db.execute(payments_stmt)).all()

    lifetime_total = Decimal("0.00")
    volume_30d = Decimal("0.00")
    pending_count = 0
    confirmed_count = 0
    total_transactions = len(all_payment_rows)
    lifetime_total_token = ""
    network_breakdown: dict[str, Decimal] = {}
    token_breakdown: dict[str, Decimal] = {}

    # Initialize 14-day daily buckets so chart always has continuous dates
    daily_buckets: dict[str, dict[str, Any]] = {}
    for i in range(14):
        d_str = (fourteen_days_ago.date() + timedelta(days=i + 1)).isoformat()
        daily_buckets[d_str] = {
            "date": d_str,
            "volume_usd": Decimal("0.00"),
            "count": 0,
            "successful_count": 0,
        }

    for payment, link, invoice in all_payment_rows:
        amt = Decimal(str(payment.amount or 0))
        st = (payment.status or "").lower()
        tok = (payment.token_symbol or "USDT").upper()
        net = (payment.network or "unknown").lower()
        pay_dt = payment.created_at if payment.created_at else now

        if st in ("pending", "detected", "confirming"):
            pending_count += 1
        elif st in ("confirmed", "paid"):
            confirmed_count += 1
            lifetime_total += amt
            if not lifetime_total_token:
                lifetime_total_token = tok

            if pay_dt >= thirty_days_ago:
                volume_30d += amt

            network_breakdown[net] = network_breakdown.get(net, Decimal("0.00")) + amt
            token_breakdown[tok] = token_breakdown.get(tok, Decimal("0.00")) + amt

        date_key = pay_dt.date().isoformat()
        if date_key in daily_buckets:
            daily_buckets[date_key]["count"] += 1
            if st in ("confirmed", "paid"):
                daily_buckets[date_key]["successful_count"] += 1
                daily_buckets[date_key]["volume_usd"] += amt

    success_rate = (
        round((confirmed_count / total_transactions) * 100, 1)
        if total_transactions > 0
        else 100.0
    )

    daily_volume = [
        DailyVolumePoint(
            date=b["date"],
            volume_usd=round(b["volume_usd"], 2),
            count=b["count"],
            successful_count=b["successful_count"],
        )
        for b in sorted(daily_buckets.values(), key=lambda x: x["date"])
    ]

    # Active links count
    active_links_stmt = select(func.count(PaymentLink.id)).where(
        and_(
            PaymentLink.merchant_id == user_id,
            PaymentLink.status == "active",
        )
    )
    active_links_count = (await db.execute(active_links_stmt)).scalar_one()

    # Open invoices count
    open_invoices_stmt = select(func.count(Invoice.id)).where(
        and_(
            Invoice.merchant_id == user_id,
            Invoice.status.in_(["sent", "viewed", "pending", "draft"]),
        )
    )
    open_invoices_count = (await db.execute(open_invoices_stmt)).scalar_one()

    # 10 most recent transactions
    recent_transactions: list[RecentTransactionItem] = []
    for payment, link, invoice in all_payment_rows[:10]:
        p_type = "invoice" if (invoice is not None or payment.invoice_id is not None) else "link"
        src_title = invoice.customer_name if invoice else (link.title if link else None)
        p_email = invoice.customer_email if invoice else None

        recent_transactions.append(
            RecentTransactionItem(
                payment_type=p_type,
                type=p_type,
                amount=round(Decimal(str(payment.amount)), 2),
                token_symbol=payment.token_symbol,
                network=payment.network,
                status=payment.status,
                timestamp=payment.created_at or now,
                created_at=payment.created_at or now,
                tx_hash=payment.tx_hash,
                source_title=src_title,
                payer_email=p_email,
            )
        )

    logger.info(
        "Dashboard overview fetched for user_id=%s: "
        "lifetime_total=%s pending_count=%d recent_count=%d",
        user_id,
        lifetime_total,
        pending_count,
        len(recent_transactions),
    )

    return DashboardOverviewResponse(
        lifetime_total=round(lifetime_total, 2),
        lifetime_total_token=lifetime_total_token,
        pending_count=pending_count,
        confirmed_count=confirmed_count,
        total_transactions=total_transactions,
        success_rate=success_rate,
        volume_30d=round(volume_30d, 2),
        active_links_count=active_links_count,
        open_invoices_count=open_invoices_count,
        network_breakdown={k: round(v, 2) for k, v in network_breakdown.items()},
        token_breakdown={k: round(v, 2) for k, v in token_breakdown.items()},
        daily_volume=daily_volume,
        recent_transactions=recent_transactions,
    )


async def list_merchant_transactions(
    user_id: uuid.UUID,
    db: AsyncSession,
    page: int = 1,
    page_size: int = 20,
    status_filter: Optional[str] = None,
) -> TransactionListResponse:
    """Return paginated transaction history with source attribution and analytics."""
    offset = (page - 1) * page_size

    # Base query for all payments associated with merchant's links or invoices
    base_stmt = (
        select(Payment, PaymentLink, Invoice)
        .outerjoin(PaymentLink, Payment.payment_link_id == PaymentLink.id)
        .outerjoin(Invoice, Payment.invoice_id == Invoice.id)
        .where(
            or_(
                PaymentLink.merchant_id == user_id,
                Invoice.merchant_id == user_id,
            )
        )
    )

    if status_filter:
        base_stmt = base_stmt.where(Payment.status == status_filter)

    # Count total
    count_stmt = select(func.count()).select_from(base_stmt.subquery())
    total_count = (await db.execute(count_stmt)).scalar_one()

    # Query paginated items
    items_stmt = (
        base_stmt.order_by(desc(Payment.created_at))
        .offset(offset)
        .limit(page_size)
    )
    rows = (await db.execute(items_stmt)).all()

    # Total volume & token breakdown
    all_payments_stmt = (
        select(Payment.amount, Payment.token_symbol, Payment.status)
        .outerjoin(PaymentLink, Payment.payment_link_id == PaymentLink.id)
        .outerjoin(Invoice, Payment.invoice_id == Invoice.id)
        .where(
            and_(
                or_(
                    PaymentLink.merchant_id == user_id,
                    Invoice.merchant_id == user_id,
                ),
                Payment.status.in_(["confirmed", "paid"]),
            )
        )
    )
    all_rows = (await db.execute(all_payments_stmt)).all()

    total_volume_usd = Decimal("0.00")
    tokens_breakdown: dict[str, Decimal] = {}
    for amt, sym, _ in all_rows:
        d_amt = Decimal(str(amt))
        total_volume_usd += d_amt
        tokens_breakdown[sym] = tokens_breakdown.get(sym, Decimal("0.00")) + d_amt

    items: list[TransactionDetailItem] = []
    for payment, link, invoice in rows:
        source_type = "invoice" if invoice is not None else "payment_link"
        source_title = invoice.customer_name if invoice is not None else (link.title if link else None)
        source_id = invoice.id if invoice is not None else (link.id if link else None)
        source_slug = link.slug if link else None

        items.append(
            TransactionDetailItem(
                id=payment.id,
                tx_hash=payment.tx_hash,
                network=payment.network,
                token_symbol=payment.token_symbol,
                amount=Decimal(str(payment.amount)),
                from_address=payment.from_address,
                to_address=payment.to_address,
                payer_email=payment.payer_email,
                status=payment.status,
                confirmations=payment.confirmations,
                source_type=source_type,
                source_title=source_title,
                source_id=source_id,
                source_slug=source_slug,
                confirmed_at=payment.confirmed_at,
                created_at=payment.created_at,
            )
        )

    total_pages = max(1, (total_count + page_size - 1) // page_size)

    return TransactionListResponse(
        items=items,
        total=total_count,
        total_volume_usd=round(total_volume_usd, 2),
        tokens_breakdown={k: round(v, 4) for k, v in tokens_breakdown.items()},
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


_USD_STABLECOINS = {"USDC", "USDT", "DAI", "BUSD", "PYUSD", "USDC.E", "USDT.E"}


def _resolve_usd_amount(payment: Payment, link: Optional[PaymentLink], invoice: Optional[Invoice]) -> Optional[Decimal]:
    """Resolve the equivalent USD/USDT value for a payment transaction."""
    if link and link.amount is not None and Decimal(str(link.amount)) > 0:
        return Decimal(str(link.amount))
    if invoice and invoice.total_amount is not None and Decimal(str(invoice.total_amount)) > 0:
        return Decimal(str(invoice.total_amount))
    if payment.token_symbol and payment.token_symbol.upper() in _USD_STABLECOINS and payment.amount is not None:
        return Decimal(str(payment.amount))
    return None


async def list_merchant_payers(
    user_id: uuid.UUID,
    db: AsyncSession,
    page: int = 1,
    page_size: int = 20,
    search: Optional[str] = None,
) -> PayerDirectoryResponse:
    """Return aggregated payer / customer directory for the merchant."""
    # Query all payments and invoices for this merchant
    payments_stmt = (
        select(Payment, PaymentLink, Invoice)
        .outerjoin(PaymentLink, Payment.payment_link_id == PaymentLink.id)
        .outerjoin(Invoice, Payment.invoice_id == Invoice.id)
        .where(
            or_(
                PaymentLink.merchant_id == user_id,
                Invoice.merchant_id == user_id,
            )
        )
        .order_by(desc(Payment.created_at))
    )
    payments_rows = (await db.execute(payments_stmt)).all()

    invoices_stmt = (
        select(Invoice)
        .where(Invoice.merchant_id == user_id)
        .order_by(desc(Invoice.created_at))
    )
    invoices_rows = (await db.execute(invoices_stmt)).scalars().all()

    # Aggregate by email
    payers_map: dict[str, dict[str, Any]] = {}

    for inv in invoices_rows:
        email = inv.customer_email.strip().lower()
        if not email:
            continue
        inv_dt = _normalize_dt(inv.created_at) or datetime.now(UTC)
        if email not in payers_map:
            payers_map[email] = {
                "email": email,
                "name": inv.customer_name,
                "total_payments": 0,
                "successful_payments": 0,
                "pending_payments": 0,
                "expired_payments": 0,
                "status_breakdown": {},
                "total_volume": Decimal("0.00"),
                "tokens_used": set(),
                "networks_used": set(),
                "last_payment_at": None,
                "first_seen_at": inv_dt,
                "sources": set(),
            }
        p = payers_map[email]
        if not p["name"] and inv.customer_name:
            p["name"] = inv.customer_name
        p["sources"].add(f"Invoice: {inv.customer_name}")
        if inv_dt < p["first_seen_at"]:
            p["first_seen_at"] = inv_dt

    for payment, link, invoice in payments_rows:
        email = (payment.payer_email or (invoice.customer_email if invoice else None) or "").strip().lower()
        if not email:
            # Fallback to truncated from_address if no email
            email = f"wallet:{payment.from_address[:8]}...{payment.from_address[-4:]}" if payment.from_address else "anonymous"

        pay_dt = _normalize_dt(payment.created_at) or datetime.now(UTC)
        if email not in payers_map:
            payers_map[email] = {
                "email": email,
                "name": invoice.customer_name if invoice else None,
                "total_payments": 0,
                "successful_payments": 0,
                "pending_payments": 0,
                "expired_payments": 0,
                "status_breakdown": {},
                "total_volume": Decimal("0.00"),
                "tokens_used": set(),
                "networks_used": set(),
                "last_payment_at": None,
                "first_seen_at": pay_dt,
                "sources": set(),
            }

        p = payers_map[email]
        if invoice and not p["name"]:
            p["name"] = invoice.customer_name
        p["tokens_used"].add(payment.token_symbol)
        p["networks_used"].add(payment.network)

        if link:
            p["sources"].add(f"Payment Link: {link.title}")
        if invoice:
            p["sources"].add(f"Invoice: {invoice.customer_name}")

        p["total_payments"] += 1
        st = payment.status.lower()
        p["status_breakdown"][st] = p["status_breakdown"].get(st, 0) + 1

        usd_dec = _resolve_usd_amount(payment, link, invoice)
        if st in ["confirmed", "paid"]:
            p["successful_payments"] += 1
            p["total_volume"] += (usd_dec if usd_dec is not None else Decimal(str(payment.amount or 0)))
            if not p["last_payment_at"] or pay_dt > p["last_payment_at"]:
                p["last_payment_at"] = pay_dt
        elif st == "pending":
            p["pending_payments"] += 1
        elif st == "expired":
            p["expired_payments"] += 1

        if pay_dt < p["first_seen_at"]:
            p["first_seen_at"] = pay_dt

    # Convert to list and filter by search if requested
    payer_items: list[PayerDirectoryItem] = []
    total_vol = Decimal("0.00")

    for email, data in payers_map.items():
        if search:
            q = search.lower()
            if q not in email and (not data["name"] or q not in data["name"].lower()):
                continue

        total_vol += data["total_volume"]
        payer_items.append(
            PayerDirectoryItem(
                email=data["email"],
                name=data["name"],
                total_payments=data["total_payments"],
                successful_payments=data["successful_payments"],
                pending_payments=data["pending_payments"],
                expired_payments=data["expired_payments"],
                status_breakdown=data["status_breakdown"],
                total_volume=round(data["total_volume"], 2),
                tokens_used=sorted(list(data["tokens_used"])),
                networks_used=sorted(list(data["networks_used"])),
                last_payment_at=data["last_payment_at"],
                first_seen_at=data["first_seen_at"],
                sources=sorted(list(data["sources"])),
            )
        )

    # Sort by total_volume desc, then total_payments desc
    payer_items.sort(
        key=lambda x: (
            x.total_volume,
            x.successful_payments,
            x.total_payments,
            _normalize_dt(x.last_payment_at) or _normalize_dt(x.first_seen_at) or datetime.min.replace(tzinfo=UTC),
        ),
        reverse=True,
    )

    total_count = len(payer_items)
    total_pages = max(1, (total_count + page_size - 1) // page_size)
    paginated_items = payer_items[(page - 1) * page_size : page * page_size]

    return PayerDirectoryResponse(
        items=paginated_items,
        total=total_count,
        total_payers=total_count,
        total_volume=round(total_vol, 2),
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


async def get_merchant_payer_detail(
    merchant_id: uuid.UUID,
    payer_email: str,
    db: AsyncSession,
) -> PayerDetailResponse:
    """Return comprehensive customer profile, status analytics, and chronological activity history for a merchant."""
    clean_email = payer_email.strip().lower()

    # Query all payment sessions for this merchant and email
    stmt = (
        select(Payment, PaymentLink, Invoice)
        .outerjoin(PaymentLink, Payment.payment_link_id == PaymentLink.id)
        .outerjoin(Invoice, Payment.invoice_id == Invoice.id)
        .where(
            and_(
                or_(PaymentLink.merchant_id == merchant_id, Invoice.merchant_id == merchant_id),
                or_(
                    Payment.payer_email == clean_email,
                    Invoice.customer_email == clean_email,
                )
            )
        )
        .order_by(desc(Payment.created_at))
    )
    rows = (await db.execute(stmt)).all()

    # Also check standalone invoices for this customer
    inv_stmt = (
        select(Invoice)
        .where(
            and_(
                Invoice.merchant_id == merchant_id,
                Invoice.customer_email == clean_email,
            )
        )
        .order_by(desc(Invoice.created_at))
    )
    inv_rows = (await db.execute(inv_stmt)).scalars().all()

    if not rows and not inv_rows:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"detail": f"No customer record found for {payer_email}.", "code": "PAYER_NOT_FOUND"},
        )

    customer_name: Optional[str] = None
    tokens_used: set[str] = set()
    networks_used: set[str] = set()
    first_seen: datetime = datetime.now(UTC)
    last_active: Optional[datetime] = None
    total_volume: Decimal = Decimal("0.00")
    successful_count = 0
    pending_count = 0
    expired_count = 0
    status_breakdown: dict[str, int] = {}
    activity_logs: list[PayerActivityLogItem] = []

    seen_payment_ids = set()

    for payment, link, invoice in rows:
        seen_payment_ids.add(payment.id)
        if invoice and invoice.customer_name and not customer_name:
            customer_name = invoice.customer_name

        tokens_used.add(payment.token_symbol)
        networks_used.add(payment.network)

        pay_dt = _normalize_dt(payment.created_at) or datetime.now(UTC)
        pay_conf_dt = _normalize_dt(payment.confirmed_at)

        if pay_dt < first_seen:
            first_seen = pay_dt
        if not last_active or pay_dt > last_active:
            last_active = pay_dt

        st = payment.status.lower()
        status_breakdown[st] = status_breakdown.get(st, 0) + 1

        usd_dec = _resolve_usd_amount(payment, link, invoice)
        usd_val = str(round(usd_dec, 2)) if usd_dec is not None else None

        if st in ["confirmed", "paid"]:
            successful_count += 1
            total_volume += (usd_dec if usd_dec is not None else Decimal(str(payment.amount or 0)))
        elif st == "pending":
            pending_count += 1
        elif st == "expired":
            expired_count += 1

        log_type = "Invoice" if payment.invoice_id else "Payment Link"
        log_title = (link.title if link else (f"Invoice #{str(invoice.id)[:8]}" if invoice else "Payment Session"))
        checkout_url = f"/pay/{link.slug}" if link else None

        activity_logs.append(
            PayerActivityLogItem(
                id=str(payment.id),
                type=log_type,
                title=log_title,
                status=payment.status,
                amount_crypto=str(payment.amount) if payment.amount else None,
                token_symbol=payment.token_symbol,
                network=payment.network,
                usd_amount=usd_val,
                tx_hash=payment.tx_hash,
                created_at=pay_dt,
                confirmed_at=pay_conf_dt,
                merchant_name=None,
                merchant_id=str(merchant_id),
                checkout_url=checkout_url,
            )
        )

    # Add any standalone invoices not linked to payment rows
    for inv in inv_rows:
        if inv.customer_name and not customer_name:
            customer_name = inv.customer_name
        inv_dt = _normalize_dt(inv.created_at) or datetime.now(UTC)
        if inv_dt < first_seen:
            first_seen = inv_dt
        if not last_active or inv_dt > last_active:
            last_active = inv_dt

        # If invoice had a payment link with no payment records
        if inv.payment_link_id and not any(l.id == str(inv.id) for l in activity_logs):
            activity_logs.append(
                PayerActivityLogItem(
                    id=str(inv.id),
                    type="Invoice",
                    title=f"Invoice #{str(inv.id)[:8]}",
                    status=inv.status,
                    amount_crypto=None,
                    token_symbol=None,
                    network=None,
                    usd_amount=str(inv.total_amount),
                    tx_hash=None,
                    created_at=inv_dt,
                    confirmed_at=None,
                    merchant_name=None,
                    merchant_id=str(merchant_id),
                    checkout_url=None,
                )
            )

    activity_logs.sort(key=lambda x: _normalize_dt(x.created_at) or datetime.min.replace(tzinfo=UTC), reverse=True)

    return PayerDetailResponse(
        email=clean_email,
        name=customer_name,
        total_attempts=len(activity_logs),
        successful_payments=successful_count,
        pending_payments=pending_count,
        expired_payments=expired_count,
        total_volume_usd=round(total_volume, 2),
        tokens_used=sorted(list(tokens_used)),
        networks_used=sorted(list(networks_used)),
        first_seen_at=first_seen,
        last_active_at=last_active,
        status_breakdown=status_breakdown,
        activity_logs=activity_logs,
    )


# ---------------------------------------------------------------------------
# Store Branding (Phase 3)
# ---------------------------------------------------------------------------


async def get_merchant_branding(
    user_id: uuid.UUID,
    db: AsyncSession,
) -> BrandingResponse:
    """Fetch current store branding configuration for a merchant."""
    profile = await get_or_create_profile(user_id, db)
    return BrandingResponse(
        business_name=profile.business_name,
        brand_logo_url=profile.brand_logo_url,
        brand_color=profile.brand_color or "#4F46E5",
        brand_tagline=profile.brand_tagline,
        support_email=profile.support_email,
        support_phone=profile.support_phone,
    )


async def update_merchant_branding(
    user_id: uuid.UUID,
    data: BrandingUpdateRequest,
    db: AsyncSession,
) -> BrandingResponse:
    """Update store branding configuration for a merchant."""
    profile = await get_or_create_profile(user_id, db)
    if data.brand_color is not None:
        profile.brand_color = data.brand_color
    if data.brand_tagline is not None:
        profile.brand_tagline = data.brand_tagline.strip() if data.brand_tagline.strip() else None
    if data.support_email is not None:
        profile.support_email = data.support_email.strip().lower() if data.support_email.strip() else None
    if data.support_phone is not None:
        profile.support_phone = data.support_phone.strip() if data.support_phone.strip() else None
    if data.brand_logo_url is not None:
        profile.brand_logo_url = data.brand_logo_url.strip() if data.brand_logo_url.strip() else None

    profile.updated_at = datetime.now(UTC)
    await db.flush()

    return BrandingResponse(
        business_name=profile.business_name,
        brand_logo_url=profile.brand_logo_url,
        brand_color=profile.brand_color or "#4F46E5",
        brand_tagline=profile.brand_tagline,
        support_email=profile.support_email,
        support_phone=profile.support_phone,
    )


async def save_merchant_branding_logo(
    user_id: uuid.UUID,
    file_bytes: bytes,
    filename: str,
    content_type: str,
    db: AsyncSession,
) -> BrandingResponse:
    """Upload and set store branding logo."""
    backend = get_storage_backend()
    detected_mime = validate_upload(file_bytes, content_type, max_size_mb=5)

    safe_name = os.path.basename(filename) if filename else "logo.png"
    storage_key = f"branding/{user_id}/{uuid.uuid4().hex}_{safe_name}"
    await backend.upload_file(file_bytes, storage_key, detected_mime)

    profile = await get_or_create_profile(user_id, db)
    profile.brand_logo_url = f"/api/v1/uploads/{storage_key}"
    profile.updated_at = datetime.now(UTC)
    await db.flush()

    return BrandingResponse(
        business_name=profile.business_name,
        brand_logo_url=profile.brand_logo_url,
        brand_color=profile.brand_color or "#0052FF",
        brand_tagline=profile.brand_tagline,
        support_email=profile.support_email,
        support_phone=profile.support_phone,
    )


# ---------------------------------------------------------------------------
# Financial Reports & Analytics (Phase 4)
# ---------------------------------------------------------------------------


def _resolve_report_date_range(
    period: str,
    start_date_str: Optional[str] = None,
    end_date_str: Optional[str] = None,
) -> tuple[datetime, datetime]:
    """Calculate UTC start and end datetimes for a given period identifier."""
    now = datetime.now(UTC)
    today = now.date()

    if period == "7d":
        start_dt = datetime.combine(today - datetime.resolution * 0, datetime.min.time(), tzinfo=UTC)
        from datetime import timedelta
        start_dt = (now - timedelta(days=6)).replace(hour=0, minute=0, second=0, microsecond=0)
        end_dt = now
    elif period == "30d":
        from datetime import timedelta
        start_dt = (now - timedelta(days=29)).replace(hour=0, minute=0, second=0, microsecond=0)
        end_dt = now
    elif period == "90d":
        from datetime import timedelta
        start_dt = (now - timedelta(days=89)).replace(hour=0, minute=0, second=0, microsecond=0)
        end_dt = now
    elif period == "this_month":
        start_dt = datetime(today.year, today.month, 1, tzinfo=UTC)
        end_dt = now
    elif period == "last_month":
        first_this_month = datetime(today.year, today.month, 1, tzinfo=UTC)
        from datetime import timedelta
        last_day_prev = first_this_month - timedelta(days=1)
        start_dt = datetime(last_day_prev.year, last_day_prev.month, 1, tzinfo=UTC)
        end_dt = datetime(last_day_prev.year, last_day_prev.month, last_day_prev.day, 23, 59, 59, 999999, tzinfo=UTC)
    elif period == "ytd":
        start_dt = datetime(today.year, 1, 1, tzinfo=UTC)
        end_dt = now
    elif period == "all":
        start_dt = datetime(2020, 1, 1, tzinfo=UTC)
        end_dt = now
    elif period == "custom" and start_date_str:
        try:
            s_date = datetime.strptime(start_date_str, "%Y-%m-%d").date()
            start_dt = datetime.combine(s_date, datetime.min.time(), tzinfo=UTC)
        except Exception:
            from datetime import timedelta
            start_dt = (now - timedelta(days=29)).replace(hour=0, minute=0, second=0, microsecond=0)
        if end_date_str:
            try:
                e_date = datetime.strptime(end_date_str, "%Y-%m-%d").date()
                end_dt = datetime.combine(e_date, datetime.max.time(), tzinfo=UTC)
            except Exception:
                end_dt = now
        else:
            end_dt = now
    else:
        from datetime import timedelta
        start_dt = (now - timedelta(days=29)).replace(hour=0, minute=0, second=0, microsecond=0)
        end_dt = now

    return start_dt, end_dt


async def get_merchant_reports_summary(
    user_id: uuid.UUID,
    period: str,
    db: AsyncSession,
    start_date_str: Optional[str] = None,
    end_date_str: Optional[str] = None,
) -> ReportSummaryResponse:
    """Compute financial aggregates, daily volume time series, and breakdown statistics for reports."""
    from datetime import timedelta

    start_dt, end_dt = _resolve_report_date_range(period, start_date_str, end_date_str)

    payments_stmt = (
        select(Payment, PaymentLink, Invoice)
        .outerjoin(PaymentLink, Payment.payment_link_id == PaymentLink.id)
        .outerjoin(Invoice, Payment.invoice_id == Invoice.id)
        .where(
            or_(
                PaymentLink.merchant_id == user_id,
                Invoice.merchant_id == user_id,
            )
        )
        .order_by(asc(Payment.created_at))
    )
    payment_rows = (await db.execute(payments_stmt)).all()

    # Pre-populate daily series buckets between start and end date
    current_bucket_date = start_dt.date()
    end_bucket_date = end_dt.date()
    daily_buckets: dict[str, dict[str, Any]] = {}
    while current_bucket_date <= end_bucket_date:
        d_str = current_bucket_date.isoformat()
        daily_buckets[d_str] = {"date": d_str, "volume_usd": Decimal("0"), "count": 0, "successful_count": 0}
        current_bucket_date += timedelta(days=1)

    gross_revenue_usd = Decimal("0")
    total_transactions = 0
    successful_payments = 0
    pending_payments = 0
    expired_payments = 0
    failed_payments = 0

    token_breakdown: dict[str, Decimal] = {}
    network_breakdown: dict[str, Decimal] = {}
    link_aggregates: dict[str, dict[str, Any]] = {}

    for payment, link, invoice in payment_rows:
        pay_dt = _normalize_dt(payment.created_at) or datetime.now(UTC)
        if pay_dt < start_dt or pay_dt > end_dt:
            continue

        total_transactions += 1
        st = payment.status.lower()
        if st in ("paid", "confirmed"):
            successful_payments += 1
        elif st in ("pending", "detected", "confirming"):
            pending_payments += 1
        elif st == "expired":
            expired_payments += 1
        else:
            failed_payments += 1

        resolved_usd = _resolve_usd_amount(payment, link, invoice)
        pay_amount_usd = resolved_usd if resolved_usd is not None else Decimal("0")

        # Track daily bucket
        date_key = pay_dt.date().isoformat()
        if date_key in daily_buckets:
            daily_buckets[date_key]["count"] += 1
            if st in ("paid", "confirmed"):
                daily_buckets[date_key]["volume_usd"] += pay_amount_usd
                daily_buckets[date_key]["successful_count"] += 1

        if st in ("paid", "confirmed"):
            gross_revenue_usd += pay_amount_usd
            # Token breakdown
            tok = payment.token_symbol.upper() if payment.token_symbol else "UNKNOWN"
            token_breakdown[tok] = token_breakdown.get(tok, Decimal("0")) + pay_amount_usd
            # Network breakdown
            net = payment.network.capitalize() if payment.network else "Unknown"
            network_breakdown[net] = network_breakdown.get(net, Decimal("0")) + pay_amount_usd

        # Top link tracking
        if link:
            lid = str(link.id)
            if lid not in link_aggregates:
                link_aggregates[lid] = {
                    "id": lid,
                    "title": link.title,
                    "slug": link.slug,
                    "total_volume_usd": Decimal("0"),
                    "total_transactions": 0,
                    "successful_transactions": 0,
                }
            link_aggregates[lid]["total_transactions"] += 1
            if st in ("paid", "confirmed"):
                link_aggregates[lid]["successful_transactions"] += 1
                link_aggregates[lid]["total_volume_usd"] += pay_amount_usd

    daily_series = [
        DailyVolumePoint(
            date=d_data["date"],
            volume_usd=round(d_data["volume_usd"], 2),
            count=d_data["count"],
            successful_count=d_data["successful_count"],
        )
        for d_data in sorted(daily_buckets.values(), key=lambda x: x["date"])
    ]

    top_links_list = sorted(
        [
            TopLinkItem(
                id=item["id"],
                title=item["title"],
                slug=item["slug"],
                total_volume_usd=round(item["total_volume_usd"], 2),
                total_transactions=item["total_transactions"],
                successful_transactions=item["successful_transactions"],
            )
            for item in link_aggregates.values()
        ],
        key=lambda x: x.total_volume_usd,
        reverse=True,
    )[:5]

    aov = (
        round(gross_revenue_usd / Decimal(str(successful_payments)), 2)
        if successful_payments > 0
        else Decimal("0.00")
    )
    conversion_rate = (
        round((successful_payments / total_transactions) * 100, 1)
        if total_transactions > 0
        else 0.0
    )

    return ReportSummaryResponse(
        period=period,
        start_date=start_dt.date().isoformat(),
        end_date=end_dt.date().isoformat(),
        gross_revenue_usd=round(gross_revenue_usd, 2),
        total_transactions=total_transactions,
        successful_payments=successful_payments,
        pending_payments=pending_payments,
        expired_payments=expired_payments,
        failed_payments=failed_payments,
        average_order_value_usd=aov,
        conversion_rate=conversion_rate,
        daily_volume_series=daily_series,
        token_breakdown={k: round(v, 2) for k, v in token_breakdown.items()},
        network_breakdown={k: round(v, 2) for k, v in network_breakdown.items()},
        top_links=top_links_list,
    )


async def export_merchant_reports_csv(
    user_id: uuid.UUID,
    period: str,
    db: AsyncSession,
    start_date_str: Optional[str] = None,
    end_date_str: Optional[str] = None,
) -> str:
    """Generate standard RFC 4180 CSV report for export."""
    import csv

    start_dt, end_dt = _resolve_report_date_range(period, start_date_str, end_date_str)

    payments_stmt = (
        select(Payment, PaymentLink, Invoice)
        .outerjoin(PaymentLink, Payment.payment_link_id == PaymentLink.id)
        .outerjoin(Invoice, Payment.invoice_id == Invoice.id)
        .where(
            or_(
                PaymentLink.merchant_id == user_id,
                Invoice.merchant_id == user_id,
            )
        )
        .order_by(desc(Payment.created_at))
    )
    payment_rows = (await db.execute(payments_stmt)).all()

    output = io.StringIO()
    writer = csv.writer(output, quoting=csv.QUOTE_MINIMAL)
    
    # Standard accounting CSV header
    writer.writerow([
        "Payment ID",
        "Date (UTC)",
        "Type",
        "Title / Description",
        "Customer Email",
        "Customer Phone",
        "Customer Address",
        "Status",
        "Network",
        "Token",
        "Crypto Amount",
        "USD Value ($)",
        "Tx Hash",
    ])

    for payment, link, invoice in payment_rows:
        pay_dt = _normalize_dt(payment.created_at) or datetime.now(UTC)
        if pay_dt < start_dt or pay_dt > end_dt:
            continue

        item_type = "Invoice" if invoice else "Payment Link"
        title = link.title if link else (f"Invoice #{str(invoice.id)[:8]}" if invoice else "Direct Payment")
        resolved_usd = _resolve_usd_amount(payment, link, invoice)
        usd_str = f"{resolved_usd:.2f}" if resolved_usd is not None else ""
        crypto_amount = str(payment.amount) if payment.amount is not None else ""

        writer.writerow([
            str(payment.id),
            pay_dt.strftime("%Y-%m-%d %H:%M:%S"),
            item_type,
            title,
            payment.payer_email or "",
            payment.payer_phone or "",
            payment.payer_address or "",
            payment.status.upper(),
            payment.network.upper() if payment.network else "",
            payment.token_symbol.upper() if payment.token_symbol else "",
            crypto_amount,
            usd_str,
            payment.tx_hash or "",
        ])

    return output.getvalue()


# ---------------------------------------------------------------------------
# Wallet Balances & Link Analytics Functions
# ---------------------------------------------------------------------------


async def get_merchant_wallet_balances(
    user_id: uuid.UUID,
    db: AsyncSession,
) -> WalletBalanceResponse:
    """Fetch live RPC balances (native currency + ERC-20 tokens) across all merchant wallets."""
    from app.core.networks import network_registry
    from app.web3.indexer import EVMRpcClient
    from app.web3.state_machine import raw_to_decimal

    wallets_res = await db.execute(
        select(MerchantWallet)
        .where(MerchantWallet.merchant_id == user_id)
        .order_by(MerchantWallet.created_at.asc())
    )
    wallets = list(wallets_res.scalars().all())

    wallet_items: list[WalletBalanceItem] = []

    for w in wallets:
        net_cfg = None
        for n in network_registry.get_active_networks():
            if n.display_name.lower() == w.network.lower() or str(n.chain_id) == w.network:
                net_cfg = n
                break

        native_symbol = net_cfg.native_symbol if net_cfg else "ETH"
        native_bal = Decimal("0")
        token_items: list[TokenBalanceItem] = []

        if net_cfg and net_cfg.rpc_url:
            client = EVMRpcClient(net_cfg.rpc_url, timeout_seconds=5.0)
            # Query native balance
            try:
                res = await client._rpc_call("eth_getBalance", [w.address, "latest"])
                if res:
                    raw_native = int(res, 16)
                    native_bal = raw_to_decimal(raw_native, native_symbol)
            except Exception as exc:
                logger.debug("Failed querying native balance for wallet %s: %s", w.address, exc)

            # Query ERC-20 token balances
            for tok in (net_cfg.tokens or []):
                if tok.contract_address:
                    try:
                        # balanceOf(address) function selector: 0x70a08231
                        padded = w.address.lower().replace("0x", "")
                        data = f"0x70a08231{'0' * (64 - len(padded))}{padded}"
                        call_obj = {"to": tok.contract_address, "data": data}
                        call_res = await client._rpc_call("eth_call", [call_obj, "latest"])
                        if call_res and call_res != "0x":
                            raw_tok = int(call_res, 16)
                            tok_bal = raw_to_decimal(raw_tok, tok.symbol)
                            token_items.append(
                                TokenBalanceItem(
                                    token_symbol=tok.symbol,
                                    balance=tok_bal,
                                    contract_address=tok.contract_address,
                                )
                            )
                    except Exception as tok_exc:
                        logger.debug("Failed querying %s balance on %s: %s", tok.symbol, w.address, tok_exc)

        wallet_items.append(
            WalletBalanceItem(
                wallet_id=w.id,
                network=w.network,
                address=w.address,
                status=w.status,
                native_balance=native_bal,
                native_symbol=native_symbol,
                tokens=token_items,
            )
        )

    return WalletBalanceResponse(wallets=wallet_items)


async def get_payment_link_analytics(
    user_id: uuid.UUID,
    link_id: uuid.UUID,
    db: AsyncSession,
) -> PaymentLinkAnalyticsResponse:
    """Compute detailed conversion and duration metrics for a payment link."""
    # Ensure link belongs to merchant
    link_res = await db.execute(
        select(PaymentLink).where(
            and_(
                PaymentLink.id == link_id,
                PaymentLink.merchant_id == user_id,
            )
        )
    )
    link = link_res.scalar_one_or_none()
    if not link:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"detail": "Payment link not found.", "code": "PAYMENT_LINK_NOT_FOUND"},
        )

    # Fetch all payments/sessions associated with this link
    payments_res = await db.execute(
        select(Payment).where(Payment.payment_link_id == link_id)
    )
    payments = list(payments_res.scalars().all())

    total_sessions = len(payments)
    paid_payments = [p for p in payments if p.status == "paid"]
    underpaid_payments = [p for p in payments if p.status == "underpaid"]
    expired_payments = [p for p in payments if p.status in ("expired", "abandoned")]

    paid_count = len(paid_payments)
    underpaid_count = len(underpaid_payments)
    expired_count = len(expired_payments)

    conversion_rate = (paid_count / total_sessions * 100.0) if total_sessions > 0 else 0.0
    abandonment_rate = (expired_count / total_sessions * 100.0) if total_sessions > 0 else 0.0

    durations: list[float] = []
    for p in paid_payments:
        if p.created_at and p.confirmed_at:
            dur = (p.confirmed_at - p.created_at).total_seconds()
            if dur >= 0:
                durations.append(dur)
        elif p.created_at and p.updated_at:
            dur = (p.updated_at - p.created_at).total_seconds()
            if dur >= 0:
                durations.append(dur)

    avg_time = (sum(durations) / len(durations)) if durations else None

    return PaymentLinkAnalyticsResponse(
        link_id=link.id,
        title=link.title,
        slug=link.slug,
        total_sessions=total_sessions,
        paid_sessions=paid_count,
        underpaid_sessions=underpaid_count,
        expired_sessions=expired_count,
        conversion_rate=round(conversion_rate, 2),
        abandonment_rate=round(abandonment_rate, 2),
        avg_time_to_pay_seconds=round(avg_time, 1) if avg_time is not None else None,
        total_collected=Decimal(str(link.total_collected or 0)),
    )




# ---------------------------------------------------------------------------
# API Key management (Developer API — Requirements 1.1–1.8)
# ---------------------------------------------------------------------------

import secrets as _secrets
from app.core.models import APIKey, Organization
from app.core.security import hash_token


_VALID_KEY_TYPES: frozenset[str] = frozenset({"sk_test", "pk_test", "sk_live", "pk_live"})
_MAX_ACTIVE_KEYS: int = 10


async def _get_organization_for_user(user_id: uuid.UUID, db: AsyncSession) -> Organization:
    """Return the Organization owned by *user_id*, or raise 404 if none exists."""
    result = await db.execute(
        select(Organization).where(Organization.owner_id == user_id)
    )
    org = result.scalar_one_or_none()
    if org is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "organization_not_found", "message": "No organization found for this user."},
        )
    return org


async def create_api_key(
    merchant_id: uuid.UUID,
    key_type: str,
    db: AsyncSession,
) -> dict:
    """Create a new API key for the merchant's organization.

    Steps:
    1. Validate key_type is one of sk_test / pk_test / sk_live / pk_live.
    2. Fetch the merchant's Organization; raise 404 if absent.
    3. Count active keys for the org; raise 422 if already at limit (10).
    4. Generate a full plaintext key: ``{key_type}_{urlsafe_token}``.
    5. For secret keys (sk_*): store SHA-256 hash in key_hash, last-4 in suffix_display.
       For publishable keys (pk_*): store plaintext as key_hash, last-4 in suffix_display.
    6. Insert the APIKey record and flush.
    7. Return a dict with all key fields plus 'plaintext_key' (returned once).

    Requirements: 1.1, 1.2, 1.3, 1.7, 1.8
    """
    if key_type not in _VALID_KEY_TYPES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"error": "invalid_key_type", "message": f"key_type must be one of: {', '.join(sorted(_VALID_KEY_TYPES))}."},
        )

    org = await _get_organization_for_user(merchant_id, db)

    # Count active keys (Requirement 1.3, 1.8)
    count_result = await db.execute(
        select(func.count(APIKey.id)).where(
            APIKey.organization_id == org.id,
            APIKey.active == True,  # noqa: E712
        )
    )
    active_count = count_result.scalar_one()
    if active_count >= _MAX_ACTIVE_KEYS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"error": "api_key_limit_reached", "message": "Your organization already has 10 active API keys."},
        )

    # Generate plaintext token: prefix + _ + ~32 urlsafe chars (Requirement 1.2)
    # secrets.token_urlsafe(24) produces 32 base64url chars
    token_suffix = _secrets.token_urlsafe(24)
    plaintext_key = f"{key_type}_{token_suffix}"

    prefix = f"{key_type}_"
    suffix_display = plaintext_key[-4:]

    is_secret = key_type.startswith("sk_")

    if is_secret:
        # Secret keys: store SHA-256 hash only; never store plaintext (Req 1.2)
        stored_hash = hash_token(plaintext_key)
    else:
        # Publishable keys: public by design — store plaintext as key_hash
        stored_hash = plaintext_key

    api_key = APIKey(
        organization_id=org.id,
        key_type=key_type,
        prefix=prefix,
        suffix_display=suffix_display,
        key_hash=stored_hash,
        active=True,
    )
    db.add(api_key)
    await db.flush()

    logger.info(
        "API key created: id=%s type=%s org_id=%s",
        api_key.id,
        key_type,
        org.id,
    )

    return {
        "id": api_key.id,
        "key_type": api_key.key_type,
        "prefix": api_key.prefix,
        "suffix_display": api_key.suffix_display,
        "plaintext_key": plaintext_key,
        "active": api_key.active,
        "created_at": api_key.created_at,
    }


async def list_api_keys(
    merchant_id: uuid.UUID,
    db: AsyncSession,
) -> list[APIKey]:
    """Return all active APIKey records for the merchant's organization.

    Only id, key_type, prefix, suffix_display, active, created_at are
    meaningful in the response — the router schemas ensure key_hash is
    never serialised.

    Requirements: 1.4
    """
    org = await _get_organization_for_user(merchant_id, db)

    result = await db.execute(
        select(APIKey)
        .where(APIKey.organization_id == org.id, APIKey.active == True)  # noqa: E712
        .order_by(APIKey.created_at.desc())
    )
    return list(result.scalars().all())


async def revoke_api_key(
    merchant_id: uuid.UUID,
    key_id: uuid.UUID,
    db: AsyncSession,
) -> None:
    """Revoke an API key belonging to the merchant's organization.

    Sets active=False and records revoked_at. Raises HTTP 404 if the key
    does not belong to the merchant's org or is already revoked.

    Requirements: 1.5, 1.6, 1.7
    """
    org = await _get_organization_for_user(merchant_id, db)

    result = await db.execute(
        select(APIKey).where(
            APIKey.id == key_id,
            APIKey.organization_id == org.id,
        )
    )
    api_key = result.scalar_one_or_none()

    if api_key is None or not api_key.active:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "api_key_not_found", "message": "API key not found or already revoked."},
        )

    api_key.active = False
    api_key.revoked_at = datetime.now(UTC)
    await db.flush()

    logger.info(
        "API key revoked: id=%s org_id=%s by merchant_id=%s",
        api_key.id,
        org.id,
        merchant_id,
    )


async def update_api_key_allowed_ips(
    merchant_id: uuid.UUID,
    key_id: uuid.UUID,
    allowed_ips: str,
    db: AsyncSession,
) -> APIKey:
    """Update the IP allowlist for an API key belonging to the merchant's organization.

    *allowed_ips* is the already-validated comma-separated CIDR string (or empty
    string to remove the restriction).  Raises HTTP 404 if the key does not
    belong to this merchant's organization.

    Requirements: 22.5, 22.6, 22.7
    """
    org = await _get_organization_for_user(merchant_id, db)

    result = await db.execute(
        select(APIKey).where(
            APIKey.id == key_id,
            APIKey.organization_id == org.id,
            APIKey.active == True,  # noqa: E712
        )
    )
    api_key = result.scalar_one_or_none()

    if api_key is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "api_key_not_found", "message": "API key not found or already revoked."},
        )

    api_key.allowed_ips = allowed_ips if allowed_ips else None
    await db.flush()

    logger.info(
        "API key allowed_ips updated: id=%s org_id=%s by merchant_id=%s",
        api_key.id,
        org.id,
        merchant_id,
    )

    return api_key
