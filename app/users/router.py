"""
FastAPI router for the Users service.

Registers user-facing endpoints under the ``/users`` prefix applied in
``app/main.py``.
"""
from __future__ import annotations

import uuid
from uuid import UUID

from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.dependencies import get_current_user, get_current_user_allow_suspended
from app.core.models import User
from app.users.schemas import (
    APIKeyHistoryResponse,
    APIKeyListResponse,
    AppealResponse,
    ChangePasswordRequest,
    GenerateLiveKeysResponse,
    KeyActionAuthRequest,
    NotificationPreferences,
    OkResponse,
    PhoneSendOTPRequest,
    PhoneVerifyOTPRequest,
    RegenerateKeyRequest,
    RegeneratedKeysResponse,
    RequestSecurityOTPRequest,
    SecretKeyResponse,
    SecurityChallengeStatusResponse,
    SubmitAppealRequest,
    SubscriptionOverviewResponse,
    SubscriptionUpgradeRequest,
    SuspensionInfoResponse,
    TwoFactorDisableRequest,
    TwoFactorEnableRequest,
    TwoFactorSetupResponse,
    TwoFactorStatusResponse,
    UserProfileResponse,
    VerifySecurityChallengeRequest,
    VerifySecurityChallengeResponse,
)
from app.subscriptions.schemas import (
    CreateCryptoPaymentRequest,
    CreateCryptoPaymentResponse,
    SubmitPaymentTxRequest,
    SubscriptionPaymentListResponse,
    SubscriptionPaymentResponse,
)
from app.subscriptions.service import SubscriptionService
from app.users.service import UserService

router = APIRouter()


# ---------------------------------------------------------------------------
# GET /users/me
# ---------------------------------------------------------------------------


@router.get(
    "/me",
    response_model=UserProfileResponse,
    status_code=status.HTTP_200_OK,
    summary="Get the authenticated user's profile",
    description=(
        "Returns the profile of the currently authenticated user, including "
        "their ID, email, full_name, account_type, status, email_verified "
        "flag, and account creation timestamp. "
        "Requires a valid Bearer access token. "
        "Requirement: 1.1"
    ),
)
async def get_my_profile(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> UserProfileResponse:
    """Return the authenticated user's profile.

    Returns HTTP 200 with the user profile on success.
    Returns HTTP 401 if the Bearer token is missing, invalid, or expired.
    Returns HTTP 403 if the account is suspended.
    """
    return await UserService.get_profile(user_id=current_user.id, db=db)


# ---------------------------------------------------------------------------
# GET /users/me/api-keys
# ---------------------------------------------------------------------------


@router.get(
    "/me/api-keys",
    response_model=APIKeyListResponse,
    status_code=status.HTTP_200_OK,
    summary="List API keys for the authenticated developer",
    description=(
        "Returns the test-mode publishable key in plaintext and the secret key "
        "as a masked value displaying only the last 4 characters. "
        "Also indicates whether live-mode keys have been generated. "
        "Only available to accounts with account_type 'developer'. "
        "Requirements: 9.3"
    ),
)
async def list_api_keys(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> APIKeyListResponse:
    """Return the masked API key summary for the authenticated developer.

    Returns HTTP 200 with ``{ publishable_key, secret_key_masked, has_live_keys }``
    on success.
    Returns HTTP 401 if the Bearer token is missing, invalid, or expired.
    Returns HTTP 403 if the account is not a developer account.
    Returns HTTP 404 if no API keys have been generated yet (email not verified).
    """
    return await UserService.list_api_keys(user_id=current_user.id, db=db)


# ---------------------------------------------------------------------------
# POST /users/me/api-keys/regenerate-sk
# ---------------------------------------------------------------------------


@router.post(
    "/me/api-keys/regenerate-sk",
    response_model=RegeneratedKeysResponse,
    status_code=status.HTTP_200_OK,
    summary="Regenerate the secret key",
    description=(
        "Immediately invalidates the existing secret key (sandbox or live) and "
        "issues a new one. The new plaintext secret key is returned exactly once. "
        "Requires 2FA TOTP or OTP authorization code. "
        "Requirement: 9.4"
    ),
)
async def regenerate_secret_key(
    request: Request,
    body: RegenerateKeyRequest | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RegeneratedKeysResponse:
    """Regenerate the authenticated developer's secret key (sandbox or live)."""
    client_ip: str | None = request.client.host if request.client else None
    mode = body.mode if body and body.mode else "sandbox"
    return await UserService.regenerate_api_keys(
        user_id=current_user.id,
        key_category="sk",
        mode=mode,
        security_code=body.security_code if body else None,
        security_method=body.security_method if body else None,
        client_ip=client_ip,
        db=db,
    )


# ---------------------------------------------------------------------------
# POST /users/me/api-keys/regenerate-pk
# ---------------------------------------------------------------------------


@router.post(
    "/me/api-keys/regenerate-pk",
    response_model=RegeneratedKeysResponse,
    status_code=status.HTTP_200_OK,
    summary="Regenerate the publishable key",
    description=(
        "Immediately invalidates the existing publishable key (sandbox or live) and "
        "issues a new one. Requires 2FA TOTP or OTP authorization code."
    ),
)
async def regenerate_publishable_key(
    request: Request,
    body: RegenerateKeyRequest | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RegeneratedKeysResponse:
    """Regenerate the authenticated developer's publishable key (sandbox or live)."""
    client_ip: str | None = request.client.host if request.client else None
    mode = body.mode if body and body.mode else "sandbox"
    return await UserService.regenerate_api_keys(
        user_id=current_user.id,
        key_category="pk",
        mode=mode,
        security_code=body.security_code if body else None,
        security_method=body.security_method if body else None,
        client_ip=client_ip,
        db=db,
    )


# ---------------------------------------------------------------------------
# POST /users/me/api-keys/regenerate-pair
# ---------------------------------------------------------------------------


@router.post(
    "/me/api-keys/regenerate-pair",
    response_model=RegeneratedKeysResponse,
    status_code=status.HTTP_200_OK,
    summary="Regenerate both publishable and secret keys",
    description=(
        "Immediately invalidates existing public and secret keys and issues a fresh "
        "key pair. Requires 2FA TOTP or OTP authorization code."
    ),
)
async def regenerate_key_pair(
    request: Request,
    body: RegenerateKeyRequest | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> RegeneratedKeysResponse:
    """Regenerate both publishable and secret keys simultaneously."""
    client_ip: str | None = request.client.host if request.client else None
    mode = body.mode if body and body.mode else "sandbox"
    return await UserService.regenerate_api_keys(
        user_id=current_user.id,
        key_category="pair",
        mode=mode,
        security_code=body.security_code if body else None,
        security_method=body.security_method if body else None,
        client_ip=client_ip,
        db=db,
    )


# ---------------------------------------------------------------------------
# GET /users/me/api-keys/history
# ---------------------------------------------------------------------------


@router.get(
    "/me/api-keys/history",
    response_model=APIKeyHistoryResponse,
    status_code=status.HTTP_200_OK,
    summary="Get API key rotation history",
    description="Returns the full audit log of active and revoked API keys for the current organization.",
)
async def get_api_key_history(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> APIKeyHistoryResponse:
    """Return all active and revoked API keys for the organization."""
    return await UserService.get_api_key_history(user_id=current_user.id, db=db)



# ---------------------------------------------------------------------------
# POST /users/me/api-keys/live
# ---------------------------------------------------------------------------


@router.post(
    "/me/api-keys/live",
    response_model=GenerateLiveKeysResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Generate live-mode API keys",
    description=(
        "Generates a live-mode publishable key (pk_live_) and secret key "
        "(sk_live_) for a verified developer account. "
        "Requires 2FA TOTP or OTP authorization code. "
        "Requirements: 9.5, 9.6"
    ),
)
async def generate_live_keys(
    request: Request,
    body: KeyActionAuthRequest | None = None,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> GenerateLiveKeysResponse:
    """Generate live-mode API keys for the authenticated verified developer.

    Returns HTTP 201 with ``{"pk_live": ..., "sk_live": ...}`` on success —
    the sk_live plaintext is returned exactly once and never stored.
    Returns HTTP 403 with ``{"error": "VERIFICATION_REQUIRED"}`` if the
    account is not yet verified.
    Returns HTTP 409 with ``{"error": "live_keys_already_exist"}`` if live
    keys have already been generated.
    """
    from sqlalchemy import select as sa_select
    from app.core.models import Organization

    # Resolve the user's organization — required by the service method.
    org_result = await db.execute(
        sa_select(Organization).where(Organization.owner_id == current_user.id)
    )
    org = org_result.scalar_one_or_none()
    if org is None:
        from fastapi import HTTPException as _HTTPException
        raise _HTTPException(
            status_code=500,
            detail={"error": "ORGANIZATION_NOT_FOUND"},
        )

    result = await UserService.generate_live_api_keys(
        user=current_user,
        org=org,
        db=db,
    )
    return GenerateLiveKeysResponse(**result)


# ---------------------------------------------------------------------------
# Step-Up Security Challenge Endpoints
# ---------------------------------------------------------------------------


@router.get(
    "/me/security-challenge/status",
    response_model=SecurityChallengeStatusResponse,
    status_code=status.HTTP_200_OK,
    summary="Get security challenge status and available verification methods",
)
async def get_security_challenge_status(
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SecurityChallengeStatusResponse:
    """Check if the current device session is unlocked or needs step-up verification."""
    client_ip: str | None = request.client.host if request.client else None
    user_agent: str | None = request.headers.get("user-agent")
    return await UserService.get_security_challenge_status(
        user_id=current_user.id,
        client_ip=client_ip,
        user_agent=user_agent,
        db=db,
    )


@router.post(
    "/me/security-challenge/request-otp",
    status_code=status.HTTP_200_OK,
    summary="Request a one-time security passcode via Email or SMS",
)
async def request_security_otp(
    body: RequestSecurityOTPRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Generate and deliver a 6-digit security verification code."""
    return await UserService.request_security_otp(
        user_id=current_user.id,
        channel=body.channel,
        db=db,
    )


@router.post(
    "/me/security-challenge/verify",
    response_model=VerifySecurityChallengeResponse,
    status_code=status.HTTP_200_OK,
    summary="Verify security challenge code (2FA TOTP or Email/SMS OTP)",
)
async def verify_security_challenge(
    request: Request,
    body: VerifySecurityChallengeRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> VerifySecurityChallengeResponse:
    """Verify code and grant 14-day access unlock on this device."""
    client_ip: str | None = request.client.host if request.client else None
    user_agent: str | None = request.headers.get("user-agent")
    return await UserService.verify_security_challenge(
        user_id=current_user.id,
        code=body.code,
        method=body.method,
        remember_device=body.remember_device,
        client_ip=client_ip,
        user_agent=user_agent,
        db=db,
    )



# ---------------------------------------------------------------------------
# GET /users/me/suspension-info
# ---------------------------------------------------------------------------


@router.get(
    "/me/suspension-info",
    response_model=SuspensionInfoResponse,
    status_code=status.HTTP_200_OK,
    summary="Get suspension details for the current user",
    description=(
        "Returns the suspension reason, admin message, and whether a pending "
        "appeal exists for the authenticated user. "
        "Accessible even when the account is suspended."
    ),
)
async def get_suspension_info(
    current_user: User = Depends(get_current_user_allow_suspended),
    db: AsyncSession = Depends(get_db),
) -> SuspensionInfoResponse:
    """Return suspension metadata for the currently authenticated user."""
    return await UserService.get_suspension_info(user_id=current_user.id, db=db)


# ---------------------------------------------------------------------------
# POST /users/me/appeal
# ---------------------------------------------------------------------------


@router.post(
    "/me/appeal",
    response_model=AppealResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Submit a suspension appeal",
    description=(
        "Submits an appeal to reinstate a suspended account. "
        "Only one pending appeal is allowed at a time. "
        "Accessible even when the account is suspended."
    ),
)
async def submit_appeal(
    body: SubmitAppealRequest,
    current_user: User = Depends(get_current_user_allow_suspended),
    db: AsyncSession = Depends(get_db),
) -> AppealResponse:
    """Submit a suspension appeal.

    Returns HTTP 201 with the created appeal on success.
    Returns HTTP 400 if the account is not suspended.
    Returns HTTP 409 if a pending appeal already exists.
    Returns HTTP 401 if the Bearer token is missing, invalid, or expired.
    """
    return await UserService.submit_appeal(
        user_id=current_user.id,
        message=body.message,
        db=db,
    )


# ---------------------------------------------------------------------------
# POST /users/me/change-password
# ---------------------------------------------------------------------------


@router.post(
    "/me/change-password",
    response_model=OkResponse,
    status_code=status.HTTP_200_OK,
    summary="Change account password",
    description="Updates the user's password after verifying the current password, and triggers an email security alert.",
)
async def change_password(
    body: ChangePasswordRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> OkResponse:
    """Change account password with current password verification."""
    client_ip = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent")
    return await UserService.change_password(
        user_id=current_user.id,
        payload=body,
        db=db,
        client_ip=client_ip,
        user_agent=user_agent,
    )


# ---------------------------------------------------------------------------
# 2FA Management Endpoints
# ---------------------------------------------------------------------------


@router.post(
    "/me/2fa/setup",
    response_model=TwoFactorSetupResponse,
    status_code=status.HTTP_200_OK,
    summary="Initialize 2FA setup with QR code",
    description="Generates a fresh TOTP secret and QR code data URL for scanning into an authenticator app.",
)
async def setup_2fa(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TwoFactorSetupResponse:
    """Initialize 2FA setup."""
    return await UserService.setup_2fa(user_id=current_user.id, db=db)


@router.post(
    "/me/2fa/enable",
    response_model=OkResponse,
    status_code=status.HTTP_200_OK,
    summary="Confirm and activate 2FA",
    description="Verifies the 6-digit TOTP code and activates Two-Factor Authentication on the account.",
)
async def enable_2fa(
    body: TwoFactorEnableRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> OkResponse:
    """Activate 2FA with 6-digit code verification."""
    return await UserService.enable_2fa(
        user_id=current_user.id,
        payload=body,
        db=db,
    )


@router.post(
    "/me/2fa/disable",
    response_model=OkResponse,
    status_code=status.HTTP_200_OK,
    summary="Deactivate 2FA",
    description="Disables Two-Factor Authentication after verifying account password.",
)
async def disable_2fa(
    body: TwoFactorDisableRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> OkResponse:
    """Deactivate 2FA."""
    return await UserService.disable_2fa(
        user_id=current_user.id,
        payload=body,
        db=db,
    )


@router.get(
    "/me/2fa/status",
    response_model=TwoFactorStatusResponse,
    status_code=status.HTTP_200_OK,
    summary="Get 2FA status",
    description="Returns whether 2FA is currently enabled for the authenticated account.",
)
async def get_2fa_status(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> TwoFactorStatusResponse:
    """Check 2FA status."""
    return await UserService.get_2fa_status(user_id=current_user.id, db=db)


# ---------------------------------------------------------------------------
# Phone Verification (Termii SMS)
# ---------------------------------------------------------------------------


@router.post(
    "/me/phone/send-otp",
    status_code=status.HTTP_200_OK,
    summary="Send phone verification OTP",
    description="Dispatches a 6-digit verification OTP code to the provided phone number via Termii SMS.",
)
async def send_phone_otp(
    body: PhoneSendOTPRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Send phone verification OTP."""
    return await UserService.send_phone_otp(
        user_id=current_user.id,
        phone_number=body.phone_number,
        db=db,
    )


@router.post(
    "/me/phone/verify-otp",
    status_code=status.HTTP_200_OK,
    summary="Verify phone OTP",
    description="Validates the submitted 6-digit OTP code and marks the phone number as verified.",
)
async def verify_phone_otp(
    body: PhoneVerifyOTPRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> dict:
    """Verify phone OTP code."""
    return await UserService.verify_phone_otp(
        user_id=current_user.id,
        phone_number=body.phone_number,
        otp=body.otp,
        db=db,
    )


# ---------------------------------------------------------------------------
# Notification Preferences
# ---------------------------------------------------------------------------


@router.get(
    "/me/notifications/preferences",
    response_model=NotificationPreferences,
    status_code=status.HTTP_200_OK,
    summary="Get notification preferences",
)
async def get_notification_preferences(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> NotificationPreferences:
    """Return notification preferences."""
    return await UserService.get_notification_preferences(user_id=current_user.id, db=db)


@router.put(
    "/me/notifications/preferences",
    response_model=NotificationPreferences,
    status_code=status.HTTP_200_OK,
    summary="Update notification preferences",
)
async def update_notification_preferences(
    body: NotificationPreferences,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> NotificationPreferences:
    """Update notification preferences."""
    return await UserService.update_notification_preferences(
        user_id=current_user.id,
        prefs=body,
        db=db,
    )


# ---------------------------------------------------------------------------
# Subscription Tiers & Plans
# ---------------------------------------------------------------------------


@router.get(
    "/me/subscription",
    response_model=SubscriptionOverviewResponse,
    status_code=status.HTTP_200_OK,
    summary="Get subscription status",
)
async def get_subscription(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SubscriptionOverviewResponse:
    """Get subscription status."""
    return await UserService.get_subscription_overview(user_id=current_user.id, db=db)


@router.post(
    "/me/subscription/upgrade",
    response_model=SubscriptionOverviewResponse,
    status_code=status.HTTP_200_OK,
    summary="Upgrade subscription plan",
)
async def upgrade_subscription(
    body: SubscriptionUpgradeRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SubscriptionOverviewResponse:
    """Upgrade subscription plan."""
    return await UserService.upgrade_subscription(
        user_id=current_user.id,
        tier=body.tier,
        period=body.period,
        db=db,
    )


@router.post(
    "/me/subscription/crypto-intent",
    response_model=CreateCryptoPaymentResponse,
    status_code=status.HTTP_200_OK,
    summary="Create a crypto subscription upgrade intent",
    description="Calculates exact crypto conversion and returns assigned load-balanced platform treasury wallet address.",
)
async def create_crypto_subscription_intent(
    body: CreateCryptoPaymentRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> CreateCryptoPaymentResponse:
    """Create crypto subscription payment intent."""
    return await SubscriptionService.create_crypto_payment_intent(
        db=db,
        user=current_user,
        payload=body,
    )


@router.post(
    "/me/subscription/submit-tx",
    response_model=SubscriptionPaymentResponse,
    status_code=status.HTTP_200_OK,
    summary="Submit transaction hash for crypto subscription payment",
    description="Confirms crypto payment, activates subscription tier, and sends in-app and email notifications.",
)
async def submit_subscription_tx(
    body: SubmitPaymentTxRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SubscriptionPaymentResponse:
    """Submit transaction hash to activate plan."""
    return await SubscriptionService.submit_payment_tx(
        db=db,
        user=current_user,
        payment_id=body.payment_id,
        tx_hash=body.tx_hash,
    )


@router.get(
    "/me/subscription/payments",
    response_model=SubscriptionPaymentListResponse,
    status_code=status.HTTP_200_OK,
    summary="Get user's crypto subscription payment history",
    description="Returns chronological audit trail of all subscription payment attempts, statuses, and assigned addresses.",
)
async def list_my_subscription_payments(
    limit: int = 50,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SubscriptionPaymentListResponse:
    """List current user's subscription payments."""
    return await SubscriptionService.list_user_payments(
        db=db,
        user=current_user,
        limit=limit,
    )


@router.get(
    "/me/subscription/payments/{payment_id}",
    response_model=SubscriptionPaymentResponse,
    status_code=status.HTTP_200_OK,
    summary="Poll crypto payment intent status",
    description="Checks live on-chain status, auto-confirms if payment received, or marks failed if window expired.",
)
async def get_subscription_payment_status(
    payment_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> SubscriptionPaymentResponse:
    """Poll subscription payment status."""
    return await SubscriptionService.get_payment_status(
        db=db,
        user=current_user,
        payment_id=payment_id,
    )



