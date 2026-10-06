"""
Subscription tier limit definitions and enforcement helpers.

Requirements: 20.1, 20.3, 20.6
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Optional


@dataclass(frozen=True)
class TierLimits:
    monthly_payments: int | None  # None = unlimited
    api_rate_multiplier: int


TIER_LIMITS: dict[str, TierLimits] = {
    "free": TierLimits(50, 1),
    "growth": TierLimits(500, 2),
    "pro": TierLimits(5000, 5),
    "enterprise": TierLimits(None, 10),
}


def get_effective_tier(user) -> str:
    """Return the user's effective subscription tier.

    If the subscription has expired, falls back to "free" regardless of the
    stored ``subscription_tier`` value.
    """
    if (
        user.subscription_expires_at is not None
        and user.subscription_expires_at < datetime.now(UTC)
    ):
        return "free"
    return user.subscription_tier or "free"


def check_monthly_limit(user) -> bool:
    """Return True if the user is within their monthly payment limit.

    Enterprise tier has no limit (always returns True).
    """
    tier = get_effective_tier(user)
    limits = TIER_LIMITS[tier]
    if limits.monthly_payments is None:
        return True
    return user.monthly_tx_count < limits.monthly_payments
