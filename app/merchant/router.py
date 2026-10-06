"""
FastAPI router for the Merchant service.

Registers all merchant API endpoints under the ``/merchant`` prefix applied in
``app/main.py`` via ``_include_router_if_available``.

All endpoints require a valid merchant JWT.  The ``require_merchant``
dependency validates the bearer token via ``get_current_user`` and raises
HTTP 403 if the account type is not ``'merchant'``.

Requirements: 2.7–2.12, 3.1–3.13, 4.1–4.15, 5.4–5.10,
              6.1–6.9, 8.1–8.18, 9.1–9.6, 10.1–10.14, 12.1–12.8,
              13.1–13.6, 15.3, 15.8, 16.1–16.7
"""
from __future__ import annotations

import json
import re
import uuid
from datetime import date, datetime, timedelta
from typing import List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, ValidationError
from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Query,
    Request,
    Response,
    UploadFile,
    status,
)
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.db import get_db
from app.core.dependencies import get_current_user
from app.core.kyc import KYCService
from app.core.models import OrgMember, Organization, User
from app.merchant import service, team_service
from app.merchant.schemas import (
    APIKeyCreateRequest,
    APIKeyCreateResponse,
    APIKeyListResponse,
    BrandingResponse,
    BrandingUpdateRequest,
    DashboardOverviewResponse,
    InvoiceCreate,
    InvoiceListResponse,
    InvoiceResponse,
    OnboardingStatusResponse,
    PayerDetailResponse,
    PayerDirectoryResponse,
    PaymentLinkCreate,
    PaymentLinkListResponse,
    PaymentLinkResponse,
    PaymentLinkAnalyticsResponse,
    ReportSummaryResponse,
    Step1Request,
    Step2Request,
    Step3Request,
    Step4Request,
    TransactionListResponse,
    WalletBalanceResponse,
    WalletChallengeRequest,
    WalletChallengeResponse,
    WalletCreate,
    WalletResponse,
)


def _first_validation_error(exc: Exception) -> str:
    """Extract the first human-readable message from a Pydantic ValidationError.

    Converts technical field names (snake_case) and Pydantic message prefixes
    into plain English, e.g.:
      loc=("business_name",), msg="Field required"  ->  "Business name is required"
      loc=("social_instagram",), msg="Value error, At least one..."  ->  "At least one..."
    """

    if isinstance(exc, ValidationError):
        errors = exc.errors(include_url=False)
        if errors:
            err = errors[0]
            loc_parts = [str(p) for p in err.get("loc", [])]
            raw_msg: str = err.get("msg", "") or str(exc)

            # Humanise the field name from the last loc segment
            field_name = ""
            if loc_parts:
                field_name = (
                    loc_parts[-1]
                    .replace("_", " ")
                    .capitalize()
                )

            # Strip Pydantic boilerplate prefixes
            clean_msg = re.sub(r"^[Vv]alue error,\s*", "", raw_msg)
            clean_msg = re.sub(r"^[Ss]tring should have at least \d+ character.*$", "is too short", clean_msg)
            clean_msg = re.sub(r"^[Ss]tring should have at most \d+ character.*$", "is too long", clean_msg)
            clean_msg = re.sub(r"^[Ff]ield required$", "is required", clean_msg)

            if field_name and clean_msg != raw_msg:
                # Pydantic boilerplate was stripped — compose "Field is required"
                return f"{field_name} {clean_msg}"
            if field_name:
                # Keep field name as context prefix for other messages
                return f"{field_name}: {clean_msg}"
            return clean_msg

    return str(exc)

router = APIRouter()


# ---------------------------------------------------------------------------
# Auth helper dependency
# ---------------------------------------------------------------------------


async def require_merchant(
    current_user: User = Depends(get_current_user),
) -> User:
    """Dependency that asserts the authenticated user is a merchant."""
    if current_user.account_type != "merchant":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "detail": "This endpoint is restricted to merchant accounts.",
                "code": "MERCHANT_REQUIRED",
            },
        )
    return current_user


# ---------------------------------------------------------------------------
# Onboarding
# ---------------------------------------------------------------------------


@router.get(
    "/onboarding-status",
    response_model=OnboardingStatusResponse,
    status_code=status.HTTP_200_OK,
    summary="Get merchant onboarding status",
    description=(
        "Returns the merchant current onboarding step, KYC status, wallet "
        "flag, and whether onboarding is complete. Creates the profile row on "
        "first call (lazy creation). "
        "Requirements: 16.1, 16.2"
    ),
)
async def get_onboarding_status(
    current_user: User = Depends(require_merchant),
    db: AsyncSession = Depends(get_db),
) -> OnboardingStatusResponse:
    """Return the current onboarding state for the authenticated merchant."""
    return await service.get_onboarding_status(current_user.id, db)


@router.patch(
    "/onboarding/1",
    response_model=OnboardingStatusResponse,
    status_code=status.HTTP_200_OK,
    summary="Submit onboarding Step 1 — personal information",
    description=(
        "Persists full_name, country, and phone_number. Advances "
        "onboarding_step to max(current, 2). "
        "Requirements: 2.7, 2.8, 2.9, 16.4"
    ),
)
async def submit_onboarding_step_1(
    data: Step1Request,
    current_user: User = Depends(require_merchant),
    db: AsyncSession = Depends(get_db),
) -> OnboardingStatusResponse:
    """Submit Step 1 (personal information)."""
    profile = await service.get_or_create_profile(current_user.id, db)

    if not service.validate_step_access(profile.onboarding_step, 1):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "detail": "Cannot skip onboarding steps.",
                "code": "ONBOARDING_STEP_SKIPPED",
            },
        )

    return await service.submit_step_1(current_user.id, data, db)


@router.patch(
    "/onboarding/2",
    response_model=OnboardingStatusResponse,
    status_code=status.HTTP_200_OK,
    summary="Submit onboarding Step 2 — business information",
    description=(
        "Multipart endpoint. Accepts business_name, website_url, social handles, "
        "is_registered_business, and an optional registration_doc file. "
        "Requirements: 3.1–3.13, 16.4"
    ),
)
async def submit_onboarding_step_2(
    business_name: str = Form(...),
    business_address: str = Form(...),
    business_description: str = Form(...),
    business_category: Optional[str] = Form(None),
    monthly_volume_estimate: Optional[str] = Form(None),
    website_url: Optional[str] = Form(None),
    social_instagram: Optional[str] = Form(None),
    social_twitter: Optional[str] = Form(None),
    social_facebook: Optional[str] = Form(None),
    social_linkedin: Optional[str] = Form(None),
    social_tiktok: Optional[str] = Form(None),
    is_registered_business: bool = Form(False),
    registration_doc: Optional[UploadFile] = File(None),
    current_user: User = Depends(require_merchant),
    db: AsyncSession = Depends(get_db),
) -> OnboardingStatusResponse:
    """Submit Step 2 (business information) with optional registration document."""
    profile = await service.get_or_create_profile(current_user.id, db)

    if not service.validate_step_access(profile.onboarding_step, 2):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "detail": "Cannot skip onboarding steps.",
                "code": "ONBOARDING_STEP_SKIPPED",
            },
        )

    try:
        data = Step2Request(
            business_name=business_name,
            business_address=business_address,
            business_description=business_description,
            business_category=business_category,
            monthly_volume_estimate=monthly_volume_estimate,
            website_url=website_url,
            social_instagram=social_instagram,
            social_twitter=social_twitter,
            social_facebook=social_facebook,
            social_linkedin=social_linkedin,
            social_tiktok=social_tiktok,
            is_registered_business=is_registered_business,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=_first_validation_error(exc),
        ) from exc

    file_content: Optional[bytes] = None
    file_content_type: Optional[str] = None
    file_filename: Optional[str] = None

    if registration_doc is not None and registration_doc.filename:
        file_content = await registration_doc.read()
        file_content_type = registration_doc.content_type
        file_filename = registration_doc.filename

    return await service.submit_step_2(
        current_user.id,
        data,
        file_content,
        file_content_type,
        file_filename,
        db,
    )


@router.patch(
    "/onboarding/3",
    response_model=OnboardingStatusResponse,
    status_code=status.HTTP_200_OK,
    summary="Submit onboarding Step 3 — KYC identity verification",
    description=(
        "Multipart endpoint. In manual flow: accepts nin (Nigeria) or "
        "kyc_document_type (non-Nigeria) plus an identity document file. "
        "In Dojah flow (USE_DOJAH=True): accepts kyc_dojah_session_id. "
        "Requirements: 4.1–4.15, 16.4"
    ),
)
async def submit_onboarding_step_3(
    nin: Optional[str] = Form(None),
    kyc_document_type: Optional[str] = Form(None),
    kyc_dojah_session_id: Optional[str] = Form(None),
    kyc_document: Optional[UploadFile] = File(None),
    current_user: User = Depends(require_merchant),
    db: AsyncSession = Depends(get_db),
) -> OnboardingStatusResponse:
    """Submit Step 3 (KYC). Routes to Dojah or manual flow based on settings."""
    profile = await service.get_or_create_profile(current_user.id, db)

    if not service.validate_step_access(profile.onboarding_step, 3):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "detail": "Cannot skip onboarding steps.",
                "code": "ONBOARDING_STEP_SKIPPED",
            },
        )

    if settings.use_dojah:
        if not kyc_dojah_session_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={
                    "detail": "kyc_dojah_session_id is required in Dojah mode.",
                    "code": "VALIDATION_ERROR",
                    "fields": {
                        "kyc_dojah_session_id": "This field is required when USE_DOJAH is enabled."
                    },
                },
            )
        return await service.submit_step_3_dojah(
            current_user.id, kyc_dojah_session_id, db
        )

    file_content: Optional[bytes] = None
    file_content_type: Optional[str] = None
    file_filename: Optional[str] = None

    if kyc_document is not None and kyc_document.filename:
        file_content = await kyc_document.read()
        file_content_type = kyc_document.content_type
        file_filename = kyc_document.filename

    try:
        data = Step3Request(
            nin=nin,
            kyc_document_type=kyc_document_type,
            kyc_dojah_session_id=None,
        )
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=_first_validation_error(exc),
        ) from exc

    return await service.submit_step_3_manual(
        current_user.id,
        data,
        file_content,
        file_content_type,
        file_filename,
        db,
    )


@router.patch(
    "/onboarding/4",
    response_model=OnboardingStatusResponse,
    status_code=status.HTTP_200_OK,
    summary="Submit onboarding Step 4 — wallet setup",
    description=(
        "Accepts network and EVM wallet address. Marks onboarding as complete. "
        "Requirements: 5.4, 5.6, 5.9, 5.10, 16.4"
    ),
)
async def submit_onboarding_step_4(
    data: Step4Request,
    current_user: User = Depends(require_merchant),
    db: AsyncSession = Depends(get_db),
) -> OnboardingStatusResponse:
    """Submit Step 4 (wallet setup) and complete onboarding."""
    profile = await service.get_or_create_profile(current_user.id, db)

    if not service.validate_step_access(profile.onboarding_step, 4):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "detail": "Cannot skip onboarding steps.",
                "code": "ONBOARDING_STEP_SKIPPED",
            },
        )

    return await service.submit_step_4(current_user.id, data, db)


# ---------------------------------------------------------------------------
# Didit Automated KYC
# ---------------------------------------------------------------------------


class DiditSessionRequest(BaseModel):
    callback_url: Optional[str] = None


class DiditCheckRequest(BaseModel):
    session_id: Optional[str] = None


@router.post(
    "/kyc/didit/session",
    status_code=status.HTTP_200_OK,
    summary="Create or retrieve Didit automated KYC verification session",
)
async def create_didit_kyc_session(
    body: Optional[DiditSessionRequest] = None,
    current_user: User = Depends(require_merchant),
    db: AsyncSession = Depends(get_db),
):
    """Create a Didit KYC session and return hosted verification link."""
    callback_url = body.callback_url if body else None
    return await service.create_didit_session(current_user.id, callback_url, db)


@router.post(
    "/kyc/didit/check",
    status_code=status.HTTP_200_OK,
    summary="Check and sync Didit automated KYC verification status",
)
async def check_didit_kyc_status(
    body: Optional[DiditCheckRequest] = None,
    current_user: User = Depends(require_merchant),
    db: AsyncSession = Depends(get_db),
):
    """Query Didit decision for the merchant's active session and update KYC status."""
    session_id = body.session_id if body else None
    return await service.check_didit_session_status(current_user.id, session_id, db)


@router.post(
    "/kyc/didit/webhook",
    status_code=status.HTTP_200_OK,
    summary="Inbound webhook callback from Didit",
)
async def didit_webhook_callback(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Handle asynchronous decision notification from Didit."""
    raw_body = await request.body()
    sig = request.headers.get("X-Signature-V2") or request.headers.get("x-signature-v2")
    try:
        payload = await request.json()
    except Exception:
        payload = {}

    session_id, vendor_user_id, result = KYCService.handle_didit_webhook(
        payload, signature=sig, raw_body=raw_body
    )

    if vendor_user_id:
        try:
            target_uid = uuid.UUID(str(vendor_user_id))
            await service.check_didit_session_status(target_uid, session_id, db)
        except Exception:
            pass

    return {"received": True}


# ---------------------------------------------------------------------------
# Wallets
# ---------------------------------------------------------------------------


@router.get(
    "/wallets",
    response_model=List[WalletResponse],
    status_code=status.HTTP_200_OK,
    summary="List merchant wallets",
    description=(
        "Returns all non-inactive wallet addresses for the authenticated merchant. "
        "Requirements: 13.1, 13.2"
    ),
)
async def list_wallets(
    current_user: User = Depends(require_merchant),
    db: AsyncSession = Depends(get_db),
) -> List[WalletResponse]:
    """List all active/pending wallets for the authenticated merchant."""
    return await service.list_wallets(current_user.id, db)


@router.post(
    "/wallets/challenge",
    response_model=WalletChallengeResponse,
    status_code=status.HTTP_200_OK,
    summary="Generate EIP-191 wallet verification challenge",
    description=(
        "Generates a unique cryptographic challenge nonce for the merchant to sign "
        "with their Web3 wallet (MetaMask, Coinbase, etc.) to prove ownership."
    ),
)
async def get_wallet_challenge(
    data: WalletChallengeRequest,
    current_user: User = Depends(require_merchant),
) -> WalletChallengeResponse:
    """Generate an EIP-191 challenge for the merchant's wallet."""
    return await service.create_wallet_challenge(current_user.id, data.address)


@router.post(
    "/wallets",
    response_model=WalletResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Add a wallet address",
    description=(
        "Creates a new wallet address for the given network. Returns HTTP 409 "
        "if an active/pending wallet already exists for that network. "
        "Requirements: 13.3, 13.4"
    ),
)
async def add_wallet(
    data: WalletCreate,
    current_user: User = Depends(require_merchant),
    db: AsyncSession = Depends(get_db),
) -> WalletResponse:
    """Add a new EVM wallet address for a merchant."""
    return await service.add_wallet(current_user.id, data, db)


@router.delete(
    "/wallets/{wallet_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a wallet address",
    description=(
        "Soft-deletes the wallet by setting its status to inactive. "
        "Returns HTTP 404 if not found. Returns HTTP 409 if this is the last "
        "active wallet and the merchant has active payment links. "
        "Requirements: 13.5, 13.6"
    ),
)
async def delete_wallet(
    wallet_id: uuid.UUID,
    current_user: User = Depends(require_merchant),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Soft-delete a merchant wallet."""
    await service.delete_wallet(current_user.id, wallet_id, db)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get(
    "/wallets/balances",
    response_model=WalletBalanceResponse,
    status_code=status.HTTP_200_OK,
    summary="Get merchant wallet balances summary",
    description="Returns live native and ERC-20 token balances for all registered merchant receiving wallets.",
)
async def get_wallet_balances(
    current_user: User = Depends(require_merchant),
    db: AsyncSession = Depends(get_db),
) -> WalletBalanceResponse:
    """Return live RPC balances across all merchant wallets."""
    return await service.get_merchant_wallet_balances(current_user.id, db)


@router.get(
    "/balances",
    status_code=status.HTTP_200_OK,
    summary="Get live on-chain balances for all merchant wallets",
    description=(
        "Returns live native and ERC-20 token balances for all registered "
        "merchant receiving wallets. Results are cached for 30 seconds. "
        "Requires completed merchant onboarding. "
        "Requirements: 25.1, 25.2, 25.3"
    ),
)
async def get_merchant_balances(
    current_user: User = Depends(require_merchant),
    db: AsyncSession = Depends(get_db),
):
    """Return live on-chain balances for all merchant wallets."""
    from app.merchant.balances import get_merchant_balances as _get_balances

    profile = await service.get_or_create_profile(current_user.id, db)
    if not profile.onboarding_complete:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": "ONBOARDING_REQUIRED"},
        )
    return await _get_balances(current_user.id, db)


# ---------------------------------------------------------------------------
# Payment links
# ---------------------------------------------------------------------------


@router.get(
    "/payment-links",
    response_model=PaymentLinkListResponse,
    status_code=status.HTTP_200_OK,
    summary="List payment links",
    description=(
        "Returns a paginated list of the merchant payment links, ordered by "
        "creation date descending. Default page size is 20, maximum is 100. "
        "Requirements: 9.1, 9.3"
    ),
)
async def list_payment_links(
    page: int = 1,
    page_size: int = 20,
    current_user: User = Depends(require_merchant),
    db: AsyncSession = Depends(get_db),
) -> PaymentLinkListResponse:
    """Return a paginated list of payment links."""
    return await service.list_payment_links(
        current_user.id, db, page=page, page_size=page_size
    )


@router.post(
    "/payment-links",
    response_model=PaymentLinkResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a payment link",
    description=(
        "Creates a new payment link with a unique slug. For fixed amount_mode, "
        "amount is required. At least one accepted_token must be provided. "
        "Requirements: 8.1–8.18"
    ),
)
async def create_payment_link(
    data: PaymentLinkCreate,
    current_user: User = Depends(require_merchant),
    db: AsyncSession = Depends(get_db),
) -> PaymentLinkResponse:
    """Create a new payment link."""
    from app.core.tier_limits import check_monthly_limit, get_effective_tier, TIER_LIMITS

    if not check_monthly_limit(current_user):
        tier = get_effective_tier(current_user)
        limit = TIER_LIMITS[tier].monthly_payments
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={
                "error": "monthly_limit_reached",
                "tier": tier,
                "limit": limit,
                "current": current_user.monthly_tx_count,
            },
        )

    return await service.create_payment_link(current_user.id, data, db)


@router.patch(
    "/payment-links/{link_id}",
    response_model=PaymentLinkResponse,
    status_code=status.HTTP_200_OK,
    summary="Deactivate a payment link",
    description=(
        "Sets the payment link status to inactive. Returns HTTP 404 if the "
        "link does not belong to the authenticated merchant. "
        "Requirements: 9.4, 9.6"
    ),
)
async def deactivate_payment_link(
    link_id: uuid.UUID,
    current_user: User = Depends(require_merchant),
    db: AsyncSession = Depends(get_db),
) -> PaymentLinkResponse:
    """Deactivate a payment link."""
    return await service.deactivate_payment_link(current_user.id, link_id, db)


@router.get(
    "/payment-links/{link_id}/qr",
    status_code=status.HTTP_200_OK,
    summary="Get payment link QR code",
    description=(
        "Returns a PNG QR code image encoding the checkout URL for the given "
        "payment link. Returns HTTP 404 if the link does not belong to the "
        "authenticated merchant. "
        "Requirements: 8.16, 9.6"
    ),
    response_class=Response,
    responses={
        200: {
            "content": {"image/png": {}},
            "description": "PNG QR code image",
        }
    },
)
async def get_payment_link_qr(
    link_id: uuid.UUID,
    current_user: User = Depends(require_merchant),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Return a PNG QR code for the payment link checkout URL."""
    png_bytes = await service.generate_qr_code(current_user.id, link_id, db)
    return Response(content=png_bytes, media_type="image/png")


@router.get(
    "/payment-links/{link_id}/analytics",
    response_model=PaymentLinkAnalyticsResponse,
    status_code=status.HTTP_200_OK,
    summary="Get payment link analytics",
    description="Returns session counts, conversion rate, abandonment rate, and average duration to pay.",
)
async def get_payment_link_analytics(
    link_id: uuid.UUID,
    current_user: User = Depends(require_merchant),
    db: AsyncSession = Depends(get_db),
) -> PaymentLinkAnalyticsResponse:
    """Return conversion and velocity analytics for a payment link."""
    return await service.get_payment_link_analytics(current_user.id, link_id, db)



# ---------------------------------------------------------------------------
# Invoices
# ---------------------------------------------------------------------------


@router.get(
    "/invoices",
    response_model=InvoiceListResponse,
    status_code=status.HTTP_200_OK,
    summary="List invoices",
    description=(
        "Returns a paginated list of invoices for the merchant, optionally "
        "filtered by status. Valid status values: draft, sent, viewed, paid, "
        "overdue, cancelled. Default page size is 20, maximum is 100. "
        "Requirements: 10.14"
    ),
)
async def list_invoices(
    page: int = 1,
    page_size: int = 20,
    status: Optional[str] = None,
    current_user: User = Depends(require_merchant),
    db: AsyncSession = Depends(get_db),
) -> InvoiceListResponse:
    """Return a paginated list of invoices with optional status filtering."""
    return await service.list_invoices(
        current_user.id,
        db,
        page=page,
        page_size=page_size,
        status_filter=status,
    )


@router.post(
    "/invoices",
    response_model=InvoiceResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a draft invoice",
    description=(
        "Creates a new invoice in draft status. Requires 1-50 line items, "
        "at least one accepted token, and a future due date. No email is sent "
        "on creation. "
        "Requirements: 10.1–10.7"
    ),
)
async def create_invoice(
    data: InvoiceCreate,
    current_user: User = Depends(require_merchant),
    db: AsyncSession = Depends(get_db),
) -> InvoiceResponse:
    """Create a draft invoice."""
    return await service.create_invoice(current_user.id, data, db)


@router.post(
    "/invoices/{invoice_id}/send",
    response_model=InvoiceResponse,
    status_code=status.HTTP_200_OK,
    summary="Send an invoice",
    description=(
        "Transitions the invoice from draft to sent, creates an associated "
        "payment link, and dispatches the invoice email via Celery. Returns "
        "HTTP 400 INVOICE_NOT_DRAFT if the invoice is not in draft status. "
        "Requirements: 10.8"
    ),
)
async def send_invoice(
    invoice_id: uuid.UUID,
    current_user: User = Depends(require_merchant),
    db: AsyncSession = Depends(get_db),
) -> InvoiceResponse:
    """Send a draft invoice to the customer."""
    return await service.send_invoice(current_user.id, invoice_id, db)


@router.post(
    "/invoices/{invoice_id}/cancel",
    response_model=InvoiceResponse,
    status_code=status.HTTP_200_OK,
    summary="Cancel an invoice",
    description=(
        "Cancels an invoice in draft, sent, viewed, or overdue status. Also "
        "deactivates the associated payment link if one exists. Returns "
        "HTTP 409 INVOICE_NOT_CANCELLABLE for paid or already-cancelled invoices. "
        "Requirements: 10.12, 10.13"
    ),
)
async def cancel_invoice(
    invoice_id: uuid.UUID,
    current_user: User = Depends(require_merchant),
    db: AsyncSession = Depends(get_db),
) -> InvoiceResponse:
    """Cancel an invoice."""
    return await service.cancel_invoice(current_user.id, invoice_id, db)


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------


@router.get(
    "/dashboard/overview",
    response_model=DashboardOverviewResponse,
    status_code=status.HTTP_200_OK,
    summary="Get dashboard overview metrics",
    description=(
        "Returns lifetime total received, pending payment count, and the 10 "
        "most recent payment transactions for the authenticated merchant. "
        "Requirements: 6.1–6.9"
    ),
)
async def get_dashboard_overview(
    current_user: User = Depends(require_merchant),
    db: AsyncSession = Depends(get_db),
) -> DashboardOverviewResponse:
    """Return the merchant dashboard overview."""
    return await service.get_dashboard_overview(current_user.id, db)


@router.get(
    "/transactions",
    response_model=TransactionListResponse,
    status_code=status.HTTP_200_OK,
    summary="List merchant transaction history",
    description="Returns full paginated payment transaction history with analytics for the merchant.",
)
async def list_transactions(
    page: int = 1,
    page_size: int = 20,
    status_filter: Optional[str] = None,
    current_user: User = Depends(require_merchant),
    db: AsyncSession = Depends(get_db),
) -> TransactionListResponse:
    """Return transaction history for the authenticated merchant."""
    return await service.list_merchant_transactions(
        current_user.id,
        db,
        page=page,
        page_size=page_size,
        status_filter=status_filter,
    )


@router.get(
    "/payers",
    response_model=PayerDirectoryResponse,
    status_code=status.HTTP_200_OK,
    summary="List merchant payer directory",
    description="Returns aggregated customer/payer directory with total payments, volume, and contact info.",
)
async def list_payers(
    page: int = 1,
    page_size: int = 20,
    search: Optional[str] = None,
    current_user: User = Depends(require_merchant),
    db: AsyncSession = Depends(get_db),
) -> PayerDirectoryResponse:
    """Return payer directory for the authenticated merchant."""
    return await service.list_merchant_payers(
        current_user.id,
        db,
        page=page,
        page_size=page_size,
        search=search,
    )


@router.get(
    "/customers",
    response_model=PayerDirectoryResponse,
    status_code=status.HTTP_200_OK,
    include_in_schema=False,
)
async def list_customers_alias(
    page: int = 1,
    page_size: int = 20,
    search: Optional[str] = None,
    current_user: User = Depends(require_merchant),
    db: AsyncSession = Depends(get_db),
) -> PayerDirectoryResponse:
    """Alias for /payers."""
    return await service.list_merchant_payers(
        current_user.id,
        db,
        page=page,
        page_size=page_size,
        search=search,
    )


@router.get(
    "/payers/{payer_email:path}",
    response_model=PayerDetailResponse,
    status_code=status.HTTP_200_OK,
    summary="Get detailed payer profile and history for merchant",
    description="Returns detailed customer stats, status breakdowns, and chronological activity history.",
)
async def get_payer_detail(
    payer_email: str,
    current_user: User = Depends(require_merchant),
    db: AsyncSession = Depends(get_db),
) -> PayerDetailResponse:
    """Return detailed payer analytics and history for the merchant."""
    return await service.get_merchant_payer_detail(
        current_user.id,
        payer_email,
        db,
    )


@router.get(
    "/customers/{payer_email:path}",
    response_model=PayerDetailResponse,
    status_code=status.HTTP_200_OK,
    include_in_schema=False,
)
async def get_customer_detail_alias(
    payer_email: str,
    current_user: User = Depends(require_merchant),
    db: AsyncSession = Depends(get_db),
) -> PayerDetailResponse:
    """Alias for get_payer_detail."""
    return await service.get_merchant_payer_detail(
        current_user.id,
        payer_email,
        db,
    )


# ---------------------------------------------------------------------------
# Store Branding Endpoints (Phase 3)
# ---------------------------------------------------------------------------


@router.get(
    "/branding",
    response_model=BrandingResponse,
    status_code=status.HTTP_200_OK,
    summary="Get merchant store branding configuration",
)
async def get_branding(
    current_user: User = Depends(require_merchant),
    db: AsyncSession = Depends(get_db),
) -> BrandingResponse:
    """Return the merchant's store branding configuration."""
    return await service.get_merchant_branding(current_user.id, db)


@router.post(
    "/branding",
    response_model=BrandingResponse,
    status_code=status.HTTP_200_OK,
    summary="Update merchant store branding configuration",
)
async def update_branding(
    payload: BrandingUpdateRequest,
    current_user: User = Depends(require_merchant),
    db: AsyncSession = Depends(get_db),
) -> BrandingResponse:
    """Update store branding configuration (brand colors, tagline, contacts, logo)."""
    return await service.update_merchant_branding(current_user.id, payload, db)


@router.post(
    "/branding/logo",
    response_model=BrandingResponse,
    status_code=status.HTTP_200_OK,
    summary="Upload store branding logo",
)
async def upload_branding_logo(
    file: UploadFile = File(...),
    current_user: User = Depends(require_merchant),
    db: AsyncSession = Depends(get_db),
) -> BrandingResponse:
    """Upload an image file as the merchant store branding logo."""
    file_bytes = await file.read()
    filename = file.filename or "logo.png"
    content_type = file.content_type or "image/png"
    return await service.save_merchant_branding_logo(
        current_user.id,
        file_bytes,
        filename,
        content_type,
        db,
    )


# ---------------------------------------------------------------------------
# Financial Reports & Export Endpoints (Phase 4)
# ---------------------------------------------------------------------------


@router.get(
    "/reports/summary",
    response_model=ReportSummaryResponse,
    status_code=status.HTTP_200_OK,
    summary="Get financial reports and analytics summary",
)
async def get_reports_summary(
    period: str = "30d",
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: User = Depends(require_merchant),
    db: AsyncSession = Depends(get_db),
) -> ReportSummaryResponse:
    """Compute financial summary, daily time-series revenue, and token/network breakdowns."""
    return await service.get_merchant_reports_summary(
        current_user.id,
        period,
        db,
        start_date_str=start_date,
        end_date_str=end_date,
    )


@router.get(
    "/reports/export/csv",
    status_code=status.HTTP_200_OK,
    summary="Export financial reports as RFC 4180 CSV spreadsheet",
)
async def export_reports_csv(
    period: str = "30d",
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    current_user: User = Depends(require_merchant),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Generate and download an RFC 4180 CSV spreadsheet of financial transactions."""
    csv_content = await service.export_merchant_reports_csv(
        current_user.id,
        period,
        db,
        start_date_str=start_date,
        end_date_str=end_date,
    )
    safe_filename = f"lenis_financial_report_{period}.csv"
    return Response(
        content=csv_content,
        media_type="text/csv",
        headers={
            "Content-Disposition": f'attachment; filename="{safe_filename}"',
            "Cache-Control": "no-cache",
        },
    )




# ---------------------------------------------------------------------------
# Merchant Analytics (Requirements 19.1–19.5)
# ---------------------------------------------------------------------------


@router.get(
    "/analytics",
    status_code=status.HTTP_200_OK,
    summary="Get merchant analytics",
    description=(
        "Returns revenue time-series, top tokens, top networks, conversion rate, "
        "and average payment size. Requires completed merchant onboarding. "
        "Requirements: 19.1, 19.2, 19.3, 19.4, 19.5"
    ),
)
async def get_analytics(
    period: Literal["daily", "weekly", "monthly"] = "daily",
    start_date: Optional[date] = Query(default=None),
    end_date: Optional[date] = Query(default=None),
    current_user: User = Depends(require_merchant),
    db: AsyncSession = Depends(get_db),
):
    """Return merchant analytics. Requires onboarding_complete = True."""
    from app.merchant.analytics import get_merchant_analytics
    from datetime import datetime, UTC

    # Onboarding guard
    profile = await service.get_or_create_profile(current_user.id, db)
    if not profile.onboarding_complete:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": "ONBOARDING_REQUIRED"},
        )

    # Default date range: last 30 days
    today = datetime.now(UTC).date()
    if end_date is None:
        end_date = today
    if start_date is None:
        start_date = today - timedelta(days=30)

    return await get_merchant_analytics(current_user.id, period, start_date, end_date, db)


# ---------------------------------------------------------------------------
# API Key Management (Developer API — Requirements 1.1–1.8)
# ---------------------------------------------------------------------------


@router.post(
    "/api-keys",
    response_model=APIKeyCreateResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new API key",
    description=(
        "Creates a new API key for the merchant's organization. "
        "The full plaintext key is returned exactly once in this response "
        "and is never stored in the database. "
        "Requirements: 1.1, 1.2, 1.3"
    ),
)
async def create_api_key(
    data: APIKeyCreateRequest,
    current_user: User = Depends(require_merchant),
    db: AsyncSession = Depends(get_db),
) -> APIKeyCreateResponse:
    """Create a new API key (sk_test, pk_test, sk_live, pk_live)."""
    result = await service.create_api_key(current_user.id, data.key_type, db)
    return APIKeyCreateResponse(**result)


@router.get(
    "/api-keys",
    response_model=APIKeyListResponse,
    status_code=status.HTTP_200_OK,
    summary="List active API keys",
    description=(
        "Returns all active (non-revoked) API keys for the authenticated merchant's "
        "organization. The response shows only masked fields (prefix + suffix_display); "
        "the full plaintext key and hash are never returned. "
        "Requirements: 1.4"
    ),
)
async def list_api_keys(
    current_user: User = Depends(require_merchant),
    db: AsyncSession = Depends(get_db),
) -> APIKeyListResponse:
    """List active API keys — masked display only."""
    keys = await service.list_api_keys(current_user.id, db)
    return APIKeyListResponse(
        items=keys,
        total=len(keys),
    )


@router.delete(
    "/api-keys/{key_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Revoke an API key",
    description=(
        "Revokes the specified API key by setting active=False and recording revoked_at. "
        "Returns HTTP 404 if the key does not belong to this merchant's organization "
        "or has already been revoked. "
        "Requirements: 1.5, 1.6, 1.7"
    ),
)
async def revoke_api_key(
    key_id: uuid.UUID,
    current_user: User = Depends(require_merchant),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Revoke an API key permanently."""
    await service.revoke_api_key(current_user.id, key_id, db)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# API Key IP Allowlist (Requirement 22.5, 22.6, 22.7)
# ---------------------------------------------------------------------------


class AllowedIPsUpdateRequest(BaseModel):
    """Payload for PATCH /merchant/api-keys/{key_id}/allowed-ips."""

    allowed_ips: list[str] = Field(default_factory=list, description="CIDR blocks or IP addresses")


class AllowedIPsResponse(BaseModel):
    """Response for PATCH /merchant/api-keys/{key_id}/allowed-ips."""

    id: uuid.UUID
    key_type: str
    prefix: str
    suffix_display: str
    active: bool
    allowed_ips: Optional[str]
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


@router.patch(
    "/api-keys/{key_id}/allowed-ips",
    response_model=AllowedIPsResponse,
    status_code=status.HTTP_200_OK,
    summary="Update IP allowlist for an API key",
    description=(
        "Sets the IP CIDR allowlist for the specified API key. "
        "Pass an empty list to remove all restrictions. "
        "Available on Pro and Enterprise tiers only. "
        "Requirements: 22.5, 22.6, 22.7"
    ),
)
async def update_api_key_allowed_ips(
    key_id: uuid.UUID,
    data: AllowedIPsUpdateRequest,
    current_user: User = Depends(require_merchant),
    db: AsyncSession = Depends(get_db),
) -> AllowedIPsResponse:
    """Update the IP allowlist for an API key (Pro/Enterprise only)."""
    import ipaddress as _ipaddress
    from app.core.tier_limits import get_effective_tier

    # Tier gate — free and growth tiers cannot use IP allowlisting (Req 22.5)
    effective_tier = get_effective_tier(current_user)
    if effective_tier in ("free", "growth"):
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail={"error": "feature_requires_pro_tier"},
        )

    # Validate each CIDR entry (Req 22.6)
    validated_cidrs: list[str] = []
    for entry in data.allowed_ips:
        entry = entry.strip()
        if not entry:
            continue
        try:
            network = _ipaddress.ip_network(entry, strict=False)
            validated_cidrs.append(str(network))
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={"error": "invalid_cidr", "param": "allowed_ips"},
            )

    allowed_ips_str = ",".join(validated_cidrs)

    api_key = await service.update_api_key_allowed_ips(
        current_user.id,
        key_id,
        allowed_ips_str,
        db,
    )
    return AllowedIPsResponse.model_validate(api_key)


# ---------------------------------------------------------------------------
# Team Members — Pydantic request models
# ---------------------------------------------------------------------------


class TeamInviteRequest(BaseModel):
    email: str
    role: str


class TeamRoleUpdateRequest(BaseModel):
    role: str


# ---------------------------------------------------------------------------
# Team Members (Requirements: 21.2, 21.4, 21.5, 21.6, 21.7)
# ---------------------------------------------------------------------------


@router.post(
    "/team/invite",
    status_code=status.HTTP_200_OK,
    summary="Invite a team member to the merchant's organization",
    description="Sends an invitation to the given email address with the specified role. Requirements: 21.2, 21.4",
)
async def invite_team_member(
    data: TeamInviteRequest,
    current_user: User = Depends(require_merchant),
    db: AsyncSession = Depends(get_db),
):
    """Invite a new team member by email."""
    result = await db.execute(
        select(Organization).where(Organization.owner_id == current_user.id)
    )
    org = result.scalar_one_or_none()
    if org is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "organization_not_found"},
        )
    return await team_service.invite_team_member(
        org_id=org.id,
        inviting_user=current_user,
        email=data.email,
        role=data.role,
        db=db,
    )


@router.get(
    "/team",
    status_code=status.HTTP_200_OK,
    summary="List team members of the merchant's organization",
    description="Returns all members belonging to the merchant's organization. Requirements: 21.5",
)
async def list_team_members(
    current_user: User = Depends(require_merchant),
    db: AsyncSession = Depends(get_db),
):
    """List all team members for the authenticated merchant's organization."""
    result = await db.execute(
        select(Organization).where(Organization.owner_id == current_user.id)
    )
    org = result.scalar_one_or_none()
    if org is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "organization_not_found"},
        )
    members = await team_service.list_team_members(org_id=org.id, db=db)
    return {"members": members}


@router.delete(
    "/team/{member_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Remove a team member from the merchant's organization",
    description="Removes the specified member. The org owner can always remove members. Requirements: 21.6",
)
async def remove_team_member(
    member_id: uuid.UUID,
    current_user: User = Depends(require_merchant),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Remove a team member from the organization."""
    org_result = await db.execute(
        select(Organization).where(Organization.owner_id == current_user.id)
    )
    org = org_result.scalar_one_or_none()
    if org is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "organization_not_found"},
        )
    caller_result = await db.execute(
        select(OrgMember).where(
            OrgMember.user_id == current_user.id,
            OrgMember.organization_id == org.id,
        )
    )
    caller_member = caller_result.scalar_one_or_none()
    calling_role = caller_member.role if caller_member is not None else "owner"
    await team_service.remove_team_member(
        org_id=org.id,
        calling_user_id=current_user.id,
        calling_member_role=calling_role,
        member_id=member_id,
        db=db,
    )
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch(
    "/team/{member_id}/role",
    status_code=status.HTTP_200_OK,
    summary="Update the role of a team member",
    description="Changes the role of the specified team member. Requirements: 21.7",
)
async def update_team_member_role(
    member_id: uuid.UUID,
    data: TeamRoleUpdateRequest,
    current_user: User = Depends(require_merchant),
    db: AsyncSession = Depends(get_db),
):
    """Update a team member's role within the organization."""
    org_result = await db.execute(
        select(Organization).where(Organization.owner_id == current_user.id)
    )
    org = org_result.scalar_one_or_none()
    if org is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "organization_not_found"},
        )
    caller_result = await db.execute(
        select(OrgMember).where(
            OrgMember.user_id == current_user.id,
            OrgMember.organization_id == org.id,
        )
    )
    caller_member = caller_result.scalar_one_or_none()
    calling_role = caller_member.role if caller_member is not None else "owner"
    updated = await team_service.update_member_role(
        org_id=org.id,
        calling_member_role=calling_role,
        calling_user_id=current_user.id,
        member_id=member_id,
        new_role=data.role,
        db=db,
    )
    return {"member_id": str(updated.id), "role": updated.role}
