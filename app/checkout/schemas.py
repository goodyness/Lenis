"""
Pydantic v2 request/response schemas for the Checkout module.

Public-facing (no auth required) schemas for the customer checkout page.

Schema groups:
  - ``TokenInfo`` — a single accepted payment token entry
  - ``WalletInfo`` — a merchant wallet address for a specific network
  - ``CheckoutLinkResponse`` — full checkout data returned by GET /pay/{slug}
  - ``PaymentStatusResponse`` — polling response for GET /pay/{slug}/status

All response schemas set ``model_config = ConfigDict(from_attributes=True)``
for compatibility with SQLAlchemy ORM instances where applicable.

Requirements: 11.1–11.11, 9.4, 9.5
"""
from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict, field_validator


# ---------------------------------------------------------------------------
# Token and wallet descriptors
# ---------------------------------------------------------------------------


class TokenInfo(BaseModel):
    """Describes a single accepted payment token on a checkout link.

    ``contract_address`` is ``None`` for native-token payments (e.g. ETH).

    Requirements: 11.2
    """

    network: str
    token_symbol: str
    contract_address: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)


class WalletInfo(BaseModel):
    """Merchant wallet address for a specific network.

    Returned as part of ``CheckoutLinkResponse`` so the frontend can display
    the correct receiving address after a customer selects a network/token.

    Requirements: 11.5
    """

    network: str
    address: str

    model_config = ConfigDict(from_attributes=True)


# ---------------------------------------------------------------------------
# Checkout link response
# ---------------------------------------------------------------------------


class CheckoutLinkResponse(BaseModel):
    """Response for GET /pay/{slug} — public checkout data for customers.

    ``amount`` is ``None`` when ``amount_mode == 'flexible'`` — the customer
    enters their own amount on the frontend (Requirement 11.4).
    ``wallets`` lists all active/pending wallet addresses the merchant has
    registered; the frontend filters to the customer-selected network.

    Requirements: 11.1–11.5, 9.4, 9.5
    """

    merchant_name: str
    title: str
    # 'fixed' | 'flexible'
    amount_mode: str
    # None when amount_mode == 'flexible'
    amount: Optional[Decimal] = None
    # Reserved for future fiat-currency display
    currency: Optional[str] = None
    # Snapshot of accepted tokens at link-creation time
    accepted_tokens: list[TokenInfo]
    # Active/pending wallet addresses indexed by network
    wallets: list[WalletInfo]
    slug: str
    
    # Store branding
    brand_logo_url: Optional[str] = None
    brand_color: Optional[str] = "#4F46E5"
    brand_tagline: Optional[str] = None
    support_email: Optional[str] = None
    support_phone: Optional[str] = None

    # Link customizations
    redirect_url: Optional[str] = None
    custom_message: Optional[str] = None
    collect_phone: bool = False
    collect_address: bool = False


class PaymentBroadcastRequest(BaseModel):
    """Payload sent by customer frontend upon wallet transaction broadcast."""

    network: str
    token_symbol: str
    contract_address: Optional[str] = None
    from_address: str
    to_address: str
    payer_email: Optional[str] = None
    payer_phone: Optional[str] = None
    payer_address: Optional[str] = None
    amount: Decimal
    tx_hash: str

    @field_validator("amount")
    @classmethod
    def validate_positive_amount(cls, v: Decimal) -> Decimal:
        if v <= Decimal("0"):
            raise ValueError("Payment amount must be greater than zero.")
        return v


class PaymentStatusResponse(BaseModel):
    """Response for GET /pay/{slug}/status — current payment status and confirmation details.

    ``status`` is one of: ``'pending'``, ``'detected'``, ``'confirming'``,
    ``'confirmed'``, ``'paid'``, ``'underpaid'``, ``'expired'``, ``'failed'``.
    """

    status: str
    tx_hash: Optional[str] = None
    confirmations: int = 0
    required_confirmations: int = 3
    block_number: Optional[int] = None
    amount: Optional[Decimal] = None
    token_symbol: Optional[str] = None
    network: Optional[str] = None
    from_address: Optional[str] = None
    to_address: Optional[str] = None
    payer_email: Optional[str] = None
    payer_phone: Optional[str] = None
    payer_address: Optional[str] = None
    confirmed_at: Optional[str] = None
    model_config = ConfigDict(from_attributes=True)


class CheckoutSessionRequest(BaseModel):
    """Payload sent when a customer opens or updates a checkout session."""

    payer_email: Optional[str] = None
    payer_phone: Optional[str] = None
    payer_address: Optional[str] = None
    network: Optional[str] = None
    token_symbol: Optional[str] = None
    amount: Optional[Decimal] = None
    from_address: Optional[str] = None

    @field_validator("amount")
    @classmethod
    def validate_session_amount(cls, v: Optional[Decimal]) -> Optional[Decimal]:
        if v is not None and v <= Decimal("0"):
            raise ValueError("Session amount must be strictly positive.")
        return v

    @field_validator("payer_email")
    @classmethod
    def validate_payer_email(cls, v: Optional[str]) -> Optional[str]:
        if v is not None:
            v_clean = v.strip()
            if not v_clean:
                return None
            import re
            if not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", v_clean):
                raise ValueError("Invalid email format.")
            return v_clean.lower()
        return None


class CheckoutSessionResponse(BaseModel):
    """Response returned when a checkout session is initiated or refreshed."""

    session_id: Optional[str] = None
    status: str
    expires_in_seconds: int = 1200
    created_at: Optional[datetime] = None


class CheckoutExpireRequest(BaseModel):
    """Payload sent when a checkout session timer reaches expiration."""

    payer_email: Optional[str] = None
    session_id: Optional[str] = None

