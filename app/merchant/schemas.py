"""
Pydantic v2 request/response schemas for the Merchant module.

Covers five schema groups:
  - Onboarding: status, steps 1–4 form payloads
  - Wallet: create and response shapes
  - Payment link: create, response, paginated list
  - Invoice: line item, create, response, paginated list
  - Dashboard: recent transaction item and overview response

All response schemas set ``model_config = ConfigDict(from_attributes=True)``
so they can be constructed directly from SQLAlchemy ORM instances.

Monetary amounts are typed as ``Decimal``.  IDs are ``uuid.UUID``.
Datetimes are timezone-aware (validated via ``AwareDatetime``).
"""
from __future__ import annotations

import re
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Any, Literal, Optional

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)

# ---------------------------------------------------------------------------
# Shared helpers / constants
# ---------------------------------------------------------------------------

_EVM_RE = re.compile(r"^0x[0-9a-fA-F]{40}$")
_URL_SCHEMES = ("http://", "https://")
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _validate_evm_address(v: str) -> str:
    if not _EVM_RE.match(v):
        raise ValueError(
            "Invalid EVM address — must be '0x' followed by exactly 40 hex characters."
        )
    return v


def _validate_url_scheme(v: str | None) -> str | None:
    if v is not None and not v.startswith(_URL_SCHEMES):
        raise ValueError("URL must begin with 'http://' or 'https://'.")
    return v


# ---------------------------------------------------------------------------
# Onboarding schemas
# ---------------------------------------------------------------------------


class RejectedSectionItem(BaseModel):
    section: str
    step: int
    title: str
    reason: str


class OnboardingStatusResponse(BaseModel):
    """Returned by GET /merchant/onboarding-status.

    ``current_step`` is the next step the merchant needs to complete (1–4).
    ``onboarding_complete`` is True once all four steps have been submitted.

    Requirements: 16.1, 16.2
    """

    current_step: int
    onboarding_complete: bool
    kyc_status: str
    wallet_added: bool
    personal_info_status: str = "pending"
    personal_info_rejection_reason: Optional[str] = None
    business_info_status: str = "pending"
    business_info_rejection_reason: Optional[str] = None
    kyc_rejection_reason: Optional[str] = None
    rejected_sections: list[RejectedSectionItem] = Field(default_factory=list)

    # Saved profile fields for prefilling forms
    full_name: Optional[str] = None
    country: Optional[str] = None
    phone_number: Optional[str] = None
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
    is_registered_business: bool = False
    has_registration_doc: bool = False
    kyc_document_type: Optional[str] = None
    nin: Optional[str] = None
    has_kyc_doc: bool = False
    kyc_didit_session_id: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class Step1Request(BaseModel):
    """Payload for PATCH /merchant/onboarding/1 — personal information.

    ``full_name`` must contain 2–100 characters with at least 2 non-whitespace.
    ``phone_number`` (excluding dial code) must be 4–15 characters containing
    only digits, spaces, hyphens, and parentheses.

    Requirements: 2.7, 2.8, 2.9
    """

    full_name: Annotated[str, Field(min_length=2, max_length=100)]
    country: Annotated[str, Field(min_length=1, max_length=100)]
    phone_number: Annotated[str, Field(min_length=4, max_length=15)]

    @field_validator("full_name")
    @classmethod
    def full_name_has_non_whitespace(cls, v: str) -> str:
        if len(v.strip()) < 2:
            raise ValueError(
                "full_name must contain at least 2 non-whitespace characters."
            )
        return v

    @field_validator("phone_number")
    @classmethod
    def phone_number_format(cls, v: str) -> str:
        if not re.fullmatch(r"[0-9 \-()+]{4,15}", v):
            raise ValueError(
                "phone_number may only contain digits, spaces, hyphens, "
                "parentheses, and plus signs, and must be 4–15 characters."
            )
        return v


class Step2Request(BaseModel):
    """Payload for PATCH /merchant/onboarding/2 — business information.

    Note: the optional ``registration_doc`` file upload is sent as a multipart
    field and is handled separately by the router — it is not part of this
    JSON body schema.

    ``business_name`` is validated on its *trimmed* length (2–200 chars).
    ``business_address`` and ``business_description`` are mandatory.
    At least one social handle must be non-empty (validated in model_validator).

    Requirements: 3.1, 3.2, 3.3, 3.4, 3.6
    """

    business_name: Annotated[str, Field(min_length=1, max_length=201)]
    business_address: Annotated[str, Field(min_length=3, max_length=300)]
    business_description: Annotated[str, Field(min_length=5, max_length=1000)]
    business_category: Annotated[Optional[str], Field(max_length=100)] = None
    monthly_volume_estimate: Annotated[Optional[str], Field(max_length=100)] = None
    website_url: Optional[str] = None
    social_instagram: Annotated[Optional[str], Field(max_length=100)] = None
    social_twitter: Annotated[Optional[str], Field(max_length=100)] = None
    social_facebook: Annotated[Optional[str], Field(max_length=100)] = None
    social_linkedin: Annotated[Optional[str], Field(max_length=100)] = None
    social_tiktok: Annotated[Optional[str], Field(max_length=100)] = None
    is_registered_business: bool = False

    @field_validator("business_name")
    @classmethod
    def business_name_trimmed_length(cls, v: str) -> str:
        stripped = v.strip()
        if len(stripped) < 2:
            raise ValueError(
                "business_name must be at least 2 non-whitespace characters."
            )
        if len(stripped) > 200:
            raise ValueError("business_name must be at most 200 characters when trimmed.")
        return stripped

    @field_validator("business_address")
    @classmethod
    def business_address_trimmed_length(cls, v: str) -> str:
        stripped = v.strip()
        if len(stripped) < 3:
            raise ValueError(
                "business_address must be at least 3 non-whitespace characters."
            )
        if len(stripped) > 300:
            raise ValueError("business_address must be at most 300 characters.")
        return stripped

    @field_validator("business_description")
    @classmethod
    def business_description_trimmed_length(cls, v: str) -> str:
        stripped = v.strip()
        if len(stripped) < 5:
            raise ValueError(
                "business_description must be at least 5 non-whitespace characters."
            )
        if len(stripped) > 1000:
            raise ValueError("business_description must be at most 1000 characters.")
        return stripped

    @field_validator("website_url")
    @classmethod
    def website_url_scheme(cls, v: str | None) -> str | None:
        return _validate_url_scheme(v)

    @model_validator(mode="after")
    def at_least_one_social_handle(self) -> "Step2Request":
        handles = [
            self.social_instagram,
            self.social_twitter,
            self.social_facebook,
            self.social_linkedin,
            self.social_tiktok,
        ]
        if not any(h and h.strip() for h in handles):
            raise ValueError("At least one social media handle must be provided.")
        return self


class Step3Request(BaseModel):
    """Payload for PATCH /merchant/onboarding/3 — KYC identity verification.

    For Nigerian merchants: ``nin`` (11-digit numeric) + identity document file
    (handled as multipart in the router).

    For non-Nigerian merchants: ``kyc_document_type`` (Passport / National ID
    Card / Driver's License) + identity document file (multipart).

    When ``USE_DOJAH=True``: ``kyc_dojah_session_id`` carries the session
    returned by the Dojah widget; the other fields should be omitted.

    Document file upload is a multipart field handled by the router.

    Requirements: 4.1–4.11
    """

    nin: Annotated[Optional[str], Field(max_length=11)] = None
    kyc_document_type: Optional[str] = None
    kyc_dojah_session_id: Optional[str] = None

    @field_validator("nin")
    @classmethod
    def nin_format(cls, v: str | None) -> str | None:
        if v is not None:
            v_stripped = v.strip()
            if not v_stripped:
                return None
            if not re.fullmatch(r"\d{11}", v_stripped):
                raise ValueError("NIN must be exactly 11 numeric digits.")
            return v_stripped
        return None


class Step4Request(BaseModel):
    """Payload for PATCH /merchant/onboarding/4 — wallet setup.

    ``network`` is the network identifier (e.g. 'ethereum', 'base', 'polygon').
    ``address`` must match the EVM address pattern: 0x + 40 hex chars.
    ``signature`` and ``nonce`` are optional cryptographic EIP-191 proof of ownership.

    Requirements: 5.4, 5.6
    """

    network: Annotated[str, Field(min_length=1, max_length=64)]
    address: str
    signature: Optional[str] = None
    nonce: Optional[str] = None

    @field_validator("address")
    @classmethod
    def evm_address_format(cls, v: str) -> str:
        return _validate_evm_address(v)


# ---------------------------------------------------------------------------
# Wallet schemas
# ---------------------------------------------------------------------------


class WalletChallengeRequest(BaseModel):
    """Payload for requesting an EIP-191 challenge nonce."""

    address: str

    @field_validator("address")
    @classmethod
    def evm_address_format(cls, v: str) -> str:
        return _validate_evm_address(v)


class WalletChallengeResponse(BaseModel):
    """Response containing challenge text to be signed by the merchant's wallet."""

    challenge: str
    nonce: str
    address: str
    expires_in: int


class WalletCreate(BaseModel):
    """Payload for POST /merchant/wallets — add a new wallet address.

    Requirements: 13.2, 13.3
    """

    network: Annotated[str, Field(min_length=1, max_length=64)]
    address: str
    signature: Optional[str] = None
    nonce: Optional[str] = None

    @field_validator("address")
    @classmethod
    def evm_address_format(cls, v: str) -> str:
        return _validate_evm_address(v)


class WalletResponse(BaseModel):
    """Response shape for a single MerchantWallet record.

    Requirements: 13.1
    """

    id: uuid.UUID
    merchant_id: uuid.UUID
    network: str
    address: str
    status: str
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Payment link schemas
# ---------------------------------------------------------------------------


class PaymentLinkCreate(BaseModel):
    """Payload for POST /merchant/payment-links.

    ``accepted_tokens`` is a list of token descriptors in the format:
    ``[{"network": "...", "token_symbol": "...", "contract_address": "..."}]``.
    At least one token must be provided.

    Requirements: 8.1–8.15
    """

    title: Annotated[str, Field(min_length=1, max_length=200)]
    amount_mode: Literal["fixed", "flexible"]
    amount: Optional[Decimal] = None
    accepted_tokens: Annotated[list[dict[str, Any]], Field(min_length=1)]
    expires_at: Optional[AwareDatetime] = None
    max_uses: Annotated[Optional[int], Field(ge=1, le=1_000_000)] = None
    redirect_url: Optional[str] = None
    custom_message: Optional[str] = None
    collect_phone: bool = False
    collect_address: bool = False

    @field_validator("title")
    @classmethod
    def title_non_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("title must contain at least one non-whitespace character.")
        return v

    @field_validator("amount")
    @classmethod
    def amount_precision(cls, v: Decimal | None) -> Decimal | None:
        if v is not None:
            if v <= 0:
                raise ValueError("amount must be a positive value.")
            if v > Decimal("999999999.99"):
                raise ValueError("amount must not exceed 999,999,999.99.")
            # Check decimal places — at most 18
            sign, digits, exponent = v.as_tuple()
            dp = -exponent if exponent < 0 else 0
            if dp > 18:
                raise ValueError("amount must have at most 18 decimal places.")
        return v

    @field_validator("redirect_url")
    @classmethod
    def redirect_url_scheme(cls, v: str | None) -> str | None:
        return _validate_url_scheme(v)

    @model_validator(mode="after")
    def fixed_amount_required(self) -> "PaymentLinkCreate":
        if self.amount_mode == "fixed" and self.amount is None:
            raise ValueError("amount is required when amount_mode is 'fixed'.")
        return self


class PaymentLinkResponse(BaseModel):
    """Response shape for a single PaymentLink record.

    ``payment_url`` is computed by the service layer and injected before
    serialisation — it is not stored in the database.

    Requirements: 8.15, 9.2
    """

    id: uuid.UUID
    merchant_id: uuid.UUID
    title: str
    slug: str
    amount_mode: str
    amount: Optional[Decimal] = None
    currency: Optional[str] = None
    accepted_tokens: list[Any]
    status: str
    expires_at: Optional[datetime] = None
    max_uses: Optional[int] = None
    use_count: int
    redirect_url: Optional[str] = None
    custom_message: Optional[str] = None
    collect_phone: bool = False
    collect_address: bool = False
    total_collected: Decimal
    payment_url: str = ""
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class PaymentLinkListResponse(BaseModel):
    """Paginated list of PaymentLink records.

    Requirements: 9.1, 9.3
    """

    items: list[PaymentLinkResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


# ---------------------------------------------------------------------------
# Invoice schemas
# ---------------------------------------------------------------------------


class LineItemCreate(BaseModel):
    """A single line item within an invoice creation request.

    ``amount`` must be positive with at most 2 decimal places and a value
    no greater than 999,999.99.

    Requirements: 10.3
    """

    description: Annotated[str, Field(min_length=1, max_length=500)]
    amount: Decimal
    sort_order: int = 0

    @field_validator("amount")
    @classmethod
    def amount_valid(cls, v: Decimal) -> Decimal:
        if v <= 0:
            raise ValueError("Line item amount must be positive.")
        if v > Decimal("999999.99"):
            raise ValueError("Line item amount must not exceed 999,999.99.")
        sign, digits, exponent = v.as_tuple()
        dp = -exponent if exponent < 0 else 0
        if dp > 2:
            raise ValueError("Line item amount must have at most 2 decimal places.")
        return v


class LineItemResponse(BaseModel):
    """Response shape for a single InvoiceLineItem record.

    Requirements: 10.3
    """

    id: uuid.UUID
    invoice_id: uuid.UUID
    description: str
    amount: Decimal
    sort_order: int

    model_config = ConfigDict(from_attributes=True)


class InvoiceCreate(BaseModel):
    """Payload for POST /merchant/invoices — create a draft invoice.

    ``line_items`` must contain between 1 and 50 items.
    ``accepted_tokens`` must contain at least one entry.
    ``notes`` is optional free-text capped at 2000 characters.

    Requirements: 10.1–10.7
    """

    customer_name: Annotated[str, Field(min_length=1, max_length=200)]
    customer_email: str
    due_date: date
    line_items: Annotated[list[LineItemCreate], Field(min_length=1, max_length=50)]
    accepted_tokens: Annotated[list[dict[str, Any]], Field(min_length=1)]
    notes: Annotated[Optional[str], Field(max_length=2000)] = None

    @field_validator("customer_name")
    @classmethod
    def customer_name_non_empty(cls, v: str) -> str:
        if not v.strip():
            raise ValueError(
                "customer_name must contain at least one non-whitespace character."
            )
        return v

    @field_validator("customer_email")
    @classmethod
    def customer_email_format(cls, v: str) -> str:
        if not _EMAIL_RE.match(v):
            raise ValueError("customer_email must be a valid email address.")
        return v


class InvoiceResponse(BaseModel):
    """Response shape for a single Invoice record.

    Requirements: 10.1, 10.7, 10.14
    """

    id: uuid.UUID
    merchant_id: uuid.UUID
    payment_link_id: Optional[uuid.UUID] = None
    customer_name: str
    customer_email: str
    due_date: date
    status: str
    notes: Optional[str] = None
    accepted_tokens: list[Any]
    line_items: list[LineItemResponse]
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class InvoiceListResponse(BaseModel):
    """Paginated list of Invoice records.

    Requirements: 10.14
    """

    items: list[InvoiceResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


# ---------------------------------------------------------------------------
# Dashboard schemas
# ---------------------------------------------------------------------------


class DailyVolumePoint(BaseModel):
    """Time-series data point for revenue analytics."""

    date: str
    volume_usd: Decimal
    count: int
    successful_count: int


class RecentTransactionItem(BaseModel):
    """A single payment transaction entry in the dashboard overview.

    ``payment_type`` is either ``'link'`` or ``'invoice'``.
    ``timestamp`` is in ISO 8601 format with timezone.

    Requirements: 6.5
    """

    payment_type: str
    type: Optional[str] = None
    amount: Decimal
    token_symbol: str
    network: str
    status: str
    timestamp: datetime
    created_at: Optional[datetime] = None
    tx_hash: Optional[str] = None
    source_title: Optional[str] = None
    payer_email: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)

    @model_validator(mode="after")
    def populate_aliases(self) -> "RecentTransactionItem":
        if self.type is None:
            self.type = self.payment_type
        if self.created_at is None:
            self.created_at = self.timestamp
        return self


class DashboardOverviewResponse(BaseModel):
    """Response for GET /merchant/dashboard/overview.

    ``lifetime_total`` is the sum of all confirmed payments rounded to 2 dp.
    ``lifetime_total_token`` is the token symbol for the displayed total.
    ``pending_count`` is the number of payments in pending/detected/confirming.
    ``recent_transactions`` holds the 10 most recent payments.

    Requirements: 6.1–6.9
    """

    lifetime_total: Decimal
    lifetime_total_token: str
    pending_count: int
    confirmed_count: int = 0
    total_transactions: int = 0
    success_rate: float = 0.0
    volume_30d: Decimal = Decimal("0.00")
    active_links_count: int = 0
    open_invoices_count: int = 0
    network_breakdown: dict[str, Decimal] = Field(default_factory=dict)
    token_breakdown: dict[str, Decimal] = Field(default_factory=dict)
    daily_volume: list[DailyVolumePoint] = Field(default_factory=list)
    recent_transactions: list[RecentTransactionItem]


# ---------------------------------------------------------------------------
# Transaction & Payer Directory Schemas
# ---------------------------------------------------------------------------


class TransactionDetailItem(BaseModel):
    """Rich transaction history item for merchant & admin views."""

    id: uuid.UUID
    tx_hash: Optional[str] = None
    network: str
    token_symbol: str
    amount: Decimal
    from_address: Optional[str] = None
    to_address: str
    payer_email: Optional[str] = None
    status: str
    confirmations: int = 0
    source_type: str
    source_title: Optional[str] = None
    source_id: Optional[uuid.UUID] = None
    source_slug: Optional[str] = None
    confirmed_at: Optional[datetime] = None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class TransactionListResponse(BaseModel):
    """Paginated list of transactions with analytics."""

    items: list[TransactionDetailItem]
    total: int
    total_volume_usd: Decimal
    tokens_breakdown: dict[str, Decimal]
    page: int
    page_size: int
    total_pages: int


class PayerDirectoryItem(BaseModel):
    """An aggregated customer / payer record."""

    email: str
    name: Optional[str] = None
    total_payments: int
    successful_payments: int = 0
    pending_payments: int = 0
    expired_payments: int = 0
    status_breakdown: dict[str, int] = {}
    total_volume: Decimal
    tokens_used: list[str]
    networks_used: list[str]
    last_payment_at: Optional[datetime] = None
    first_seen_at: datetime
    sources: list[str] = []

    model_config = ConfigDict(from_attributes=True)


class PayerDirectoryResponse(BaseModel):
    """Paginated list of unique payers with aggregated metrics."""

    items: list[PayerDirectoryItem]
    total: int
    total_payers: int
    total_volume: Decimal
    page: int
    page_size: int
    total_pages: int


class PayerActivityLogItem(BaseModel):
    """A single payment / checkout session event for a customer."""

    id: str
    type: str  # "Payment Link" | "Invoice"
    title: str
    status: str  # "paid", "confirmed", "pending", "expired", "detected", "confirming", "failed"
    amount_crypto: Optional[str] = None
    token_symbol: Optional[str] = None
    network: Optional[str] = None
    usd_amount: Optional[str] = None
    tx_hash: Optional[str] = None
    created_at: datetime
    confirmed_at: Optional[datetime] = None
    merchant_name: Optional[str] = None
    merchant_id: Optional[str] = None
    checkout_url: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class PayerDetailResponse(BaseModel):
    """Detailed profile, metric summaries, and chronological activity logs for a payer."""

    email: str
    name: Optional[str] = None
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
    activity_logs: list[PayerActivityLogItem]

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Branding schemas (Phase 3)
# ---------------------------------------------------------------------------


class BrandingUpdateRequest(BaseModel):
    """Payload for updating merchant store branding."""

    brand_logo_url: Optional[str] = None
    brand_color: Optional[str] = Field(default="#4F46E5", max_length=7)
    brand_tagline: Optional[str] = Field(default=None, max_length=255)
    support_email: Optional[str] = Field(default=None, max_length=254)
    support_phone: Optional[str] = Field(default=None, max_length=30)

    @field_validator("brand_color")
    @classmethod
    def validate_hex_color(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            v = v.strip()
            if not re.match(r"^#(?:[0-9a-fA-F]{3}){1,2}$", v):
                raise ValueError("brand_color must be a valid hex color code (e.g. #4F46E5).")
        return v

    @field_validator("support_email")
    @classmethod
    def validate_email(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and v.strip():
            v = v.strip().lower()
            if not _EMAIL_RE.match(v):
                raise ValueError("support_email must be a valid email address.")
            return v
        return None


class BrandingResponse(BaseModel):
    """Current store branding settings."""

    business_name: Optional[str] = None
    brand_logo_url: Optional[str] = None
    brand_color: str = "#4F46E5"
    brand_tagline: Optional[str] = None
    support_email: Optional[str] = None
    support_phone: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Reports & Analytics schemas (Phase 4)
# ---------------------------------------------------------------------------


class TopLinkItem(BaseModel):
    """Top performing payment link summary."""

    id: str
    title: str
    slug: str
    total_volume_usd: Decimal
    total_transactions: int
    successful_transactions: int


class ReportSummaryResponse(BaseModel):
    """Comprehensive analytics summary for financial reports."""

    period: str
    start_date: str
    end_date: str
    gross_revenue_usd: Decimal
    total_transactions: int
    successful_payments: int
    pending_payments: int
    expired_payments: int
    failed_payments: int
    average_order_value_usd: Decimal
    conversion_rate: float
    daily_volume_series: list[DailyVolumePoint]
    token_breakdown: dict[str, Decimal]
    network_breakdown: dict[str, Decimal]
    top_links: list[TopLinkItem]

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Wallet Balances & Link Analytics Schemas
# ---------------------------------------------------------------------------


class TokenBalanceItem(BaseModel):
    """Token balance detail."""

    token_symbol: str
    balance: Decimal
    contract_address: Optional[str] = None


class WalletBalanceItem(BaseModel):
    """Per-wallet balance summary."""

    wallet_id: uuid.UUID
    network: str
    address: str
    status: str
    native_balance: Decimal
    native_symbol: str
    tokens: list[TokenBalanceItem] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)


class WalletBalanceResponse(BaseModel):
    """Response returned by GET /merchant/wallets/balances."""

    wallets: list[WalletBalanceItem] = Field(default_factory=list)


class PaymentLinkAnalyticsResponse(BaseModel):
    """Detailed analytics for a specific payment link."""

    link_id: uuid.UUID
    title: str
    slug: str
    total_sessions: int
    paid_sessions: int
    underpaid_sessions: int
    expired_sessions: int
    conversion_rate: float
    abandonment_rate: float
    avg_time_to_pay_seconds: Optional[float] = None
    total_collected: Decimal

    model_config = ConfigDict(from_attributes=True)





# ---------------------------------------------------------------------------
# API Key schemas (Developer API — Requirement 1.1–1.8)
# ---------------------------------------------------------------------------


class APIKeyCreateRequest(BaseModel):
    """Payload for POST /merchant/api-keys.

    Requirements: 1.1
    """

    key_type: str = Field(..., description="One of: sk_test, pk_test, sk_live, pk_live")


class APIKeyCreateResponse(BaseModel):
    """Response for POST /merchant/api-keys — includes plaintext key (returned once).

    Requirements: 1.1, 1.2
    """

    id: uuid.UUID
    key_type: str
    prefix: str
    suffix_display: str
    plaintext_key: str  # returned only at creation; never stored in DB
    active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=False)


class APIKeyListItem(BaseModel):
    """A single masked API key entry in the list response.

    The full plaintext key and hash are never included here.
    Requirements: 1.4
    """

    id: uuid.UUID
    key_type: str
    prefix: str
    suffix_display: str
    active: bool
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class APIKeyListResponse(BaseModel):
    """Response for GET /merchant/api-keys.

    Requirements: 1.4
    """

    items: list[APIKeyListItem]
    total: int
