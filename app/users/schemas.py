"""
Pydantic response schemas for the Users service.
"""
from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel


class UserProfileResponse(BaseModel):
    """Response body for GET /users/me (Requirement 1.1)."""

    user_id: uuid.UUID
    email: str
    full_name: str
    account_type: str
    status: str
    email_verified: bool
    phone_number: str | None = None
    phone_verified: bool = False
    two_factor_enabled: bool = False
    subscription_tier: str = "free"
    subscription_period: str | None = None
    subscription_expires_at: datetime | None = None
    monthly_tx_count: int = 0
    created_at: datetime

    model_config = {"from_attributes": True}


class PhoneSendOTPRequest(BaseModel):
    """Request body for POST /users/me/phone/send-otp."""

    phone_number: str


class PhoneVerifyOTPRequest(BaseModel):
    """Request body for POST /users/me/phone/verify-otp."""

    phone_number: str
    otp: str


class NotificationPreferences(BaseModel):
    """Granular notification preferences across email, in-app, and SMS."""

    email_payment_detected: bool = True
    email_payment_confirmed: bool = True
    email_invoice_paid: bool = True
    email_kyc_decision: bool = True
    email_security_alerts: bool = True
    inapp_payment_detected: bool = True
    inapp_payment_confirmed: bool = True
    inapp_invoice_paid: bool = True
    inapp_kyc_decision: bool = True
    inapp_security_alerts: bool = True
    sms_enabled: bool = False
    sms_payment_confirmed: bool = False


class SubscriptionOverviewResponse(BaseModel):
    """Subscription status and usage metrics."""

    tier: str
    tier_name: str
    monthly_tx_count: int
    monthly_tx_cap: int
    period: str | None = None
    expires_at: datetime | None = None
    grace_until: datetime | None = None
    features: list[str]
    is_active: bool = True


class SubscriptionUpgradeRequest(BaseModel):
    """Request body for upgrading subscription."""

    tier: str
    period: str = "monthly"


class ChangePasswordRequest(BaseModel):
    """Request body for POST /users/me/change-password."""

    current_password: str
    new_password: str


class TwoFactorSetupResponse(BaseModel):
    """Response body for POST /users/me/2fa/setup."""

    secret: str
    otpauth_url: str
    qr_code_data_url: str


class TwoFactorEnableRequest(BaseModel):
    """Request body for POST /users/me/2fa/enable."""

    secret: str
    code: str


class TwoFactorDisableRequest(BaseModel):
    """Request body for POST /users/me/2fa/disable."""

    password: str
    code: str | None = None


class TwoFactorStatusResponse(BaseModel):
    """Response body for GET /users/me/2fa/status."""

    two_factor_enabled: bool


class OkResponse(BaseModel):
    """Generic 200 OK response."""

    message: str = "ok"
    code: str | None = None


class SecretKeyResponse(BaseModel):
    """Response returned exactly once when a secret key is first created.

    The plaintext ``secret_key`` is returned here and never again — subsequent
    requests return only the masked value (Requirement 9.2).
    """

    secret_key: str
    publishable_key: str | None = None


class APIKeyListResponse(BaseModel):
    """Response body for GET /users/me/api-keys (Requirement 9.3).

    ``secret_key_masked`` exposes only the last 4 characters of the original
    plaintext secret key; all preceding characters are replaced with ``*``.
    ``has_live_keys`` indicates whether live-mode keys have been generated.
    """

    publishable_key: str
    secret_key_masked: str
    has_live_keys: bool
    live_publishable_key: str | None = None
    live_secret_key_masked: str | None = None


class SuspensionInfoResponse(BaseModel):
    """Response body for GET /users/me/suspension-info.

    Returns the suspension reason and message stored on the user record,
    plus whether the user already has a pending appeal.
    """

    suspension_reason: str | None = None
    suspension_message: str | None = None
    has_pending_appeal: bool


class SubmitAppealRequest(BaseModel):
    """Request body for POST /users/me/appeal."""

    from pydantic import Field

    message: str = Field(min_length=10, max_length=2000)


class AppealResponse(BaseModel):
    """Response body for POST /users/me/appeal."""

    id: uuid.UUID
    status: str
    message: str
    created_at: datetime

    model_config = {"from_attributes": True}


class SecurityChallengeStatusResponse(BaseModel):
    """Status of user's security challenge unlock state and verification options."""

    two_factor_enabled: bool
    phone_verified: bool
    masked_phone: str | None = None
    masked_email: str
    is_unlocked: bool
    unlocked_until: datetime | None = None
    available_methods: list[str]
    default_method: str


class RequestSecurityOTPRequest(BaseModel):
    """Request body for POST /users/me/security-challenge/request-otp."""

    channel: str = "email"  # "email" or "phone"


class VerifySecurityChallengeRequest(BaseModel):
    """Request body for POST /users/me/security-challenge/verify."""

    code: str
    method: str = "email"  # "2fa" | "email" | "phone"
    remember_device: bool = True


class VerifySecurityChallengeResponse(BaseModel):
    """Response body for POST /users/me/security-challenge/verify."""

    verified: bool
    unlocked_until: datetime | None = None
    message: str


class KeyActionAuthRequest(BaseModel):
    """Optional security code payload for key regeneration or live key creation."""

    security_code: str | None = None
    security_method: str | None = None


class RegenerateKeyRequest(KeyActionAuthRequest):
    """Request payload for rotating public key, secret key, or key pair."""

    mode: str = "sandbox"  # "sandbox" | "live"
    key_category: str = "sk"  # "pk" | "sk" | "pair"


class RegeneratedKeysResponse(BaseModel):
    """Response returned upon successful key rotation."""

    success: bool = True
    publishable_key: str | None = None
    secret_key: str | None = None
    key_type: str
    mode: str
    message: str


class APIKeyHistoryItem(BaseModel):
    """Representation of an API key in the rotation history log."""

    id: uuid.UUID
    key_type: str
    prefix: str
    suffix_display: str
    active: bool
    created_at: datetime
    revoked_at: datetime | None = None

    model_config = {"from_attributes": True}


class APIKeyHistoryResponse(BaseModel):
    """Response body for GET /users/me/api-keys/history."""

    keys: list[APIKeyHistoryItem]
    total: int


class GenerateLiveKeysResponse(BaseModel):
    """Response body for POST /users/me/api-keys/live (Requirements 5.1–5.5).

    Both the live publishable key and live secret key are returned exactly once
    at generation time. The secret key (``sk_live``) is never stored in
    plaintext and cannot be retrieved again.
    """

    pk_live: str
    sk_live: str


