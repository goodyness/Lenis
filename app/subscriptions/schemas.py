"""Pydantic schemas for platform wallets and crypto subscription payments."""
from __future__ import annotations

import re
import uuid
from datetime import datetime
from typing import Optional
from uuid import UUID

from pydantic import BaseModel, Field, field_validator


class PlatformWalletCreate(BaseModel):
    wallet_address: str = Field(..., min_length=42, max_length=42)
    label: str = Field(default="Primary Treasury Wallet", max_length=100)
    network: str = Field(default="all_evm", max_length=50)
    is_active: bool = True

    @field_validator("wallet_address")
    @classmethod
    def validate_evm_address(cls, v: str) -> str:
        v = v.strip()
        if not re.match(r"^0x[a-fA-F0-9]{40}$", v):
            raise ValueError("Invalid EVM wallet address. Must be 0x followed by 40 hex characters.")
        return v


class PlatformWalletUpdate(BaseModel):
    label: Optional[str] = Field(default=None, max_length=100)
    network: Optional[str] = Field(default=None, max_length=50)
    is_active: Optional[bool] = None


class PlatformWalletResponse(BaseModel):
    id: UUID
    wallet_address: str
    label: str
    network: str
    is_active: bool
    usage_count: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class PlatformWalletListResponse(BaseModel):
    wallets: list[PlatformWalletResponse]
    total: int


class CreateCryptoPaymentRequest(BaseModel):
    tier: str = Field(..., description="'growth', 'scale', or 'enterprise'")
    period: str = Field(default="monthly", description="'monthly' or 'yearly'")
    crypto_token: str = Field(default="USDC", description="'USDC', 'USDT', 'ETH', 'POL', or 'BNB'")
    crypto_network: str = Field(default="base", description="'base', 'polygon', 'arbitrum', 'ethereum', or 'bsc'")

    @field_validator("tier")
    @classmethod
    def validate_tier(cls, v: str) -> str:
        v = v.strip().lower()
        if v not in ("growth", "scale", "enterprise"):
            raise ValueError("Invalid subscription tier. Must be 'growth', 'scale', or 'enterprise'.")
        return v

    @field_validator("period")
    @classmethod
    def validate_period(cls, v: str) -> str:
        v = v.strip().lower()
        if v not in ("monthly", "yearly"):
            raise ValueError("Invalid billing period. Must be 'monthly' or 'yearly'.")
        return v

    @field_validator("crypto_token")
    @classmethod
    def validate_token(cls, v: str) -> str:
        v = v.strip().upper()
        if v not in ("USDC", "USDT", "ETH", "POL", "MATIC", "BNB"):
            raise ValueError("Unsupported crypto token.")
        if v == "MATIC":
            v = "POL"
        return v

    @field_validator("crypto_network")
    @classmethod
    def validate_network(cls, v: str) -> str:
        v = v.strip().lower()
        if v not in ("base", "polygon", "arbitrum", "ethereum", "bsc"):
            raise ValueError("Unsupported network. Must be 'base', 'polygon', 'arbitrum', 'ethereum', or 'bsc'.")
        return v


class CreateCryptoPaymentResponse(BaseModel):
    payment_id: UUID
    tier: str
    tier_name: str
    period: str
    usd_amount: float
    crypto_token: str
    crypto_network: str
    crypto_amount: str
    assigned_wallet_address: str
    expires_at: datetime


class SubmitPaymentTxRequest(BaseModel):
    payment_id: UUID
    tx_hash: str = Field(..., min_length=66, max_length=66)

    @field_validator("tx_hash")
    @classmethod
    def validate_tx_hash(cls, v: str) -> str:
        v = v.strip().lower()
        if not re.match(r"^0x[a-f0-9]{64}$", v):
            raise ValueError("Invalid EVM transaction hash. Must be 0x followed by 64 hex characters.")
        return v


class SubscriptionPaymentResponse(BaseModel):
    id: UUID
    user_id: UUID
    tier: str
    tier_name: Optional[str] = None
    period: str
    usd_amount: float
    crypto_token: str
    crypto_network: str
    crypto_amount: str
    amount_received: Optional[str] = None
    remaining_balance: Optional[str] = None
    assigned_wallet_address: str
    tx_hash: Optional[str] = None
    status: str
    is_expired: bool = False
    time_remaining_seconds: int = 0
    confirmed_at: Optional[datetime] = None
    expires_at: datetime
    created_at: datetime
    user_email: Optional[str] = None

    model_config = {"from_attributes": True}


class SubscriptionPaymentListResponse(BaseModel):
    payments: list[SubscriptionPaymentResponse]
    total: int


PlatformWalletResponse.model_rebuild()
PlatformWalletListResponse.model_rebuild()
CreateCryptoPaymentResponse.model_rebuild()
SubmitPaymentTxRequest.model_rebuild()
SubscriptionPaymentResponse.model_rebuild()
SubscriptionPaymentListResponse.model_rebuild()
