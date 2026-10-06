"""
Pydantic v2 schemas for the Developer API (`/v1/`).

Requirements: 5.2, 6.5, 7.1, 19.1, 19.2
"""
from __future__ import annotations

from decimal import Decimal
from typing import Generic, List, Optional, TypeVar

from pydantic import BaseModel, ConfigDict, field_validator

T = TypeVar("T")


# ---------------------------------------------------------------------------
# Shared / nested schemas
# ---------------------------------------------------------------------------


class AcceptedTokenEntry(BaseModel):
    """A single accepted-token entry specifying network and token symbol."""

    token_symbol: str
    network: str
    contract_address: Optional[str] = None


# ---------------------------------------------------------------------------
# Payment Intent
# ---------------------------------------------------------------------------


class PaymentIntentRequest(BaseModel):
    """Request body for POST /v1/payments (create payment intent)."""

    amount: Decimal
    token_symbol: str
    network: str
    # At least one accepted token must be specified.
    accepted_tokens: List[AcceptedTokenEntry]
    # Optional payer email; stored as payer_email on the Payment row.
    customer_email: Optional[str] = None
    # Optional HTTPS redirect URL sent after payment; max 2048 chars.
    redirect_url: Optional[str] = None
    # Expiry window in seconds; 300–86400, default 1 hour.
    expires_in: int = 3600
    # Developer-supplied metadata dict; max 16 keys enforced in service layer.
    metadata: Optional[dict] = None

    @field_validator("accepted_tokens")
    @classmethod
    def _at_least_one_token(cls, v: list) -> list:
        if not v:
            raise ValueError("accepted_tokens must contain at least one entry")
        return v

    @field_validator("customer_email")
    @classmethod
    def _email_length(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and len(v) > 254:
            raise ValueError("customer_email must not exceed 254 characters")
        return v

    @field_validator("redirect_url")
    @classmethod
    def _redirect_url_https(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            if not v.startswith("https://"):
                raise ValueError("redirect_url must start with https://")
            if len(v) > 2048:
                raise ValueError("redirect_url must not exceed 2048 characters")
        return v


class PaymentIntentResponse(BaseModel):
    """Response schema for a created or retrieved payment intent."""

    id: str
    status: str
    amount: Decimal
    token_symbol: str
    network: str
    checkout_url: str
    created: int       # Unix timestamp
    expires_at: int    # Unix timestamp
    is_test: bool
    livemode: bool
    # Fiat equivalent at settlement time (Requirements 17.1, 17.5)
    fiat_amount_at_payment: Optional[Decimal] = None
    fiat_currency: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Payment Link
# ---------------------------------------------------------------------------


class PaymentLinkCreateRequest(BaseModel):
    """Request body for POST /v1/payment-links."""

    title: str
    amount_mode: str                           # "fixed" | "flexible"
    accepted_tokens: List[AcceptedTokenEntry]  # min 1
    amount: Optional[Decimal] = None           # required when amount_mode == "fixed"
    external_id: Optional[str] = None          # max 128 chars
    redirect_url: Optional[str] = None         # HTTPS, max 2048 chars
    expires_in: Optional[int] = None           # 300–86400 seconds
    max_uses: Optional[int] = None
    custom_message: Optional[str] = None

    @field_validator("title")
    @classmethod
    def _title_length(cls, v: str) -> str:
        if not v or len(v) > 200:
            raise ValueError("title must be between 1 and 200 characters")
        return v

    @field_validator("accepted_tokens")
    @classmethod
    def _at_least_one_token(cls, v: list) -> list:
        if not v:
            raise ValueError("accepted_tokens must contain at least one entry")
        return v

    @field_validator("amount_mode")
    @classmethod
    def _valid_amount_mode(cls, v: str) -> str:
        if v not in ("fixed", "flexible"):
            raise ValueError("amount_mode must be 'fixed' or 'flexible'")
        return v

    @field_validator("external_id")
    @classmethod
    def _external_id_length(cls, v: Optional[str]) -> Optional[str]:
        if v is not None and len(v) > 128:
            raise ValueError("external_id must not exceed 128 characters")
        return v

    @field_validator("redirect_url")
    @classmethod
    def _redirect_url_https(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            if not v.startswith("https://"):
                raise ValueError("redirect_url must start with https://")
            if len(v) > 2048:
                raise ValueError("redirect_url must not exceed 2048 characters")
        return v


class PaymentLinkResponse(BaseModel):
    """Response schema for a payment link."""

    id: str
    title: str
    amount_mode: str
    amount: Optional[Decimal] = None
    accepted_tokens: list
    status: str
    checkout_url: str
    external_id: Optional[str] = None
    is_test: bool
    created: int           # Unix timestamp
    expires_at: Optional[int] = None

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Generic list response
# ---------------------------------------------------------------------------


class ListResponse(BaseModel, Generic[T]):
    """Cursor-paginated list response envelope."""

    data: List[T]
    has_more: bool
    next_cursor: Optional[str] = None
    total: Optional[int] = None


# ---------------------------------------------------------------------------
# Error response
# ---------------------------------------------------------------------------


class ErrorResponse(BaseModel):
    """Standard error envelope returned on 4xx/5xx responses."""

    error: str
    message: str = ""
    param: Optional[str] = None
