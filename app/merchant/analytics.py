"""
Merchant analytics service.

Provides aggregated revenue series, top tokens/networks, conversion rate,
and average payment size for the merchant analytics dashboard.

Results are cached in Redis for 300 seconds to avoid repeated heavy
aggregation queries.

Requirements: 19.1, 19.2, 19.3, 19.4, 19.5
"""
from __future__ import annotations

import json
import logging
import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

from fastapi import HTTPException
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.models import Payment, PaymentLink

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Period mapping helpers
# ---------------------------------------------------------------------------

# Maps period name → (PostgreSQL date_trunc arg, SQLite strftime format)
_PERIOD_MAP: dict[str, tuple[str, str]] = {
    "daily":   ("day",   "%Y-%m-%d"),
    "weekly":  ("week",  "%Y-%W"),
    "monthly": ("month", "%Y-%m"),
}


def _is_sqlite() -> bool:
    return settings.database_url.startswith("sqlite")


# ---------------------------------------------------------------------------
# Main analytics function
# ---------------------------------------------------------------------------


async def get_merchant_analytics(
    merchant_id: uuid.UUID,
    period: str,
    start_date: date,
    end_date: date,
    db: AsyncSession,
) -> dict[str, Any]:
    """Compute merchant analytics and return a typed dict.

    Args:
        merchant_id: The authenticated merchant's User ID.
        period: One of "daily", "weekly", "monthly".
        start_date: Start of the date range (inclusive).
        end_date: End of the date range (inclusive).
        db: The active async SQLAlchemy session.

    Returns:
        A dict with keys:
          - revenue_series
          - top_tokens
          - top_networks
          - conversion_rate
          - average_payment_size

    Raises:
        HTTPException(422): Invalid or too-large date range.
    """
    # --- Validate date range ------------------------------------------------
    today = date.today()

    if start_date > end_date:
        raise HTTPException(
            status_code=422,
            detail={"error": "invalid_date_range"},
        )

    max_start = today - timedelta(days=730)
    if start_date < max_start:
        raise HTTPException(
            status_code=422,
            detail={"error": "date_range_too_large"},
        )

    # --- Redis cache check --------------------------------------------------
    from app.core.redis_client import _get_pool
    import redis.asyncio as aioredis

    redis = aioredis.Redis(connection_pool=_get_pool())
    cache_key = f"analytics:{merchant_id}:{period}:{start_date.isoformat()}:{end_date.isoformat()}"

    try:
        cached = await redis.get(cache_key)
        if cached:
            return json.loads(cached)
    except Exception as exc:
        logger.warning("Analytics: Redis cache read failed: %s", exc)

    # --- Load merchant payment link IDs -------------------------------------
    link_ids_result = await db.execute(
        select(PaymentLink.id).where(PaymentLink.merchant_id == merchant_id)
    )
    link_ids = [row[0] for row in link_ids_result.all()]

    if not link_ids:
        result = _empty_analytics()
        await _cache_result(redis, cache_key, result)
        return result

    # Build datetime boundaries (inclusive of end_date)
    start_dt = datetime.combine(start_date, datetime.min.time()).replace(tzinfo=UTC)
    end_dt = datetime.combine(end_date, datetime.max.time()).replace(tzinfo=UTC)

    # Base filter for all confirmed/paid payments in range
    confirmed_statuses = ("confirmed", "paid")
    base_filter = and_(
        Payment.payment_link_id.in_(link_ids),
        Payment.status.in_(confirmed_statuses),
        Payment.confirmed_at >= start_dt,
        Payment.confirmed_at <= end_dt,
    )

    # --- Revenue series -----------------------------------------------------
    revenue_series = await _query_revenue_series(db, link_ids, start_dt, end_dt, period)

    # --- Top tokens ---------------------------------------------------------
    top_tokens = await _query_top_tokens(db, link_ids, start_dt, end_dt)

    # --- Top networks -------------------------------------------------------
    top_networks = await _query_top_networks(db, link_ids, start_dt, end_dt)

    # --- Conversion rate ----------------------------------------------------
    conversion_rate = await _query_conversion_rate(db, link_ids, start_dt, end_dt)

    # --- Average payment size -----------------------------------------------
    average_payment_size = await _query_average_payment_size(db, base_filter)

    # --- Build result -------------------------------------------------------
    result = {
        "revenue_series": revenue_series,
        "top_tokens": top_tokens,
        "top_networks": top_networks,
        "conversion_rate": str(conversion_rate),
        "average_payment_size": str(average_payment_size) if average_payment_size is not None else None,
    }

    # --- Cache result -------------------------------------------------------
    await _cache_result(redis, cache_key, result)

    return result


# ---------------------------------------------------------------------------
# Query helpers
# ---------------------------------------------------------------------------


async def _query_revenue_series(
    db: AsyncSession,
    link_ids: list,
    start_dt: datetime,
    end_dt: datetime,
    period: str,
) -> list[dict]:
    """Aggregate revenue by time bucket."""
    period_cfg = _PERIOD_MAP.get(period, _PERIOD_MAP["daily"])
    pg_trunc, sqlite_fmt = period_cfg

    if _is_sqlite():
        date_expr = func.strftime(sqlite_fmt, Payment.confirmed_at).label("bucket")
    else:
        date_expr = func.date_trunc(pg_trunc, Payment.confirmed_at).label("bucket")

    stmt = (
        select(
            date_expr,
            func.sum(Payment.amount).label("total_amount"),
            func.sum(Payment.fiat_amount_at_payment).label("total_fiat"),
        )
        .where(
            and_(
                Payment.payment_link_id.in_(link_ids),
                Payment.status.in_(("confirmed", "paid")),
                Payment.confirmed_at >= start_dt,
                Payment.confirmed_at <= end_dt,
            )
        )
        .group_by("bucket")
        .order_by("bucket")
    )

    rows = (await db.execute(stmt)).all()

    series = []
    for row in rows:
        bucket = row[0]
        amount = row[1]
        fiat = row[2]

        # Normalise bucket to a plain date string
        if hasattr(bucket, "date"):
            bucket_str = bucket.date().isoformat()
        else:
            bucket_str = str(bucket) if bucket is not None else ""

        series.append({
            "date": bucket_str,
            "amount": str(round(Decimal(str(amount or 0)), 8)),
            "fiat_equivalent": str(round(Decimal(str(fiat)), 2)) if fiat is not None else None,
        })

    return series


async def _query_top_tokens(
    db: AsyncSession,
    link_ids: list,
    start_dt: datetime,
    end_dt: datetime,
) -> list[dict]:
    """Top 5 tokens by total amount in confirmed/paid payments."""
    stmt = (
        select(
            Payment.token_symbol,
            func.sum(Payment.amount).label("total_amount"),
            func.count(Payment.id).label("payment_count"),
        )
        .where(
            and_(
                Payment.payment_link_id.in_(link_ids),
                Payment.status.in_(("confirmed", "paid")),
                Payment.confirmed_at >= start_dt,
                Payment.confirmed_at <= end_dt,
            )
        )
        .group_by(Payment.token_symbol)
        .order_by(func.sum(Payment.amount).desc())
        .limit(5)
    )

    rows = (await db.execute(stmt)).all()
    return [
        {
            "token_symbol": row[0] or "UNKNOWN",
            "total_amount": str(round(Decimal(str(row[1] or 0)), 8)),
            "payment_count": row[2] or 0,
        }
        for row in rows
    ]


async def _query_top_networks(
    db: AsyncSession,
    link_ids: list,
    start_dt: datetime,
    end_dt: datetime,
) -> list[dict]:
    """Top 5 networks by total amount in confirmed/paid payments."""
    stmt = (
        select(
            Payment.network,
            func.sum(Payment.amount).label("total_amount"),
            func.count(Payment.id).label("payment_count"),
        )
        .where(
            and_(
                Payment.payment_link_id.in_(link_ids),
                Payment.status.in_(("confirmed", "paid")),
                Payment.confirmed_at >= start_dt,
                Payment.confirmed_at <= end_dt,
            )
        )
        .group_by(Payment.network)
        .order_by(func.sum(Payment.amount).desc())
        .limit(5)
    )

    rows = (await db.execute(stmt)).all()
    return [
        {
            "network": row[0] or "unknown",
            "total_amount": str(round(Decimal(str(row[1] or 0)), 8)),
            "payment_count": row[2] or 0,
        }
        for row in rows
    ]


async def _query_conversion_rate(
    db: AsyncSession,
    link_ids: list,
    start_dt: datetime,
    end_dt: datetime,
) -> Decimal:
    """Ratio of confirmed/paid payments to all payments in the date range."""
    # Total payments created in range (any status)
    total_stmt = (
        select(func.count(Payment.id))
        .where(
            and_(
                Payment.payment_link_id.in_(link_ids),
                Payment.created_at >= start_dt,
                Payment.created_at <= end_dt,
            )
        )
    )
    total = (await db.execute(total_stmt)).scalar_one() or 0

    if total == 0:
        return Decimal("0.00")

    # Confirmed + paid count
    confirmed_stmt = (
        select(func.count(Payment.id))
        .where(
            and_(
                Payment.payment_link_id.in_(link_ids),
                Payment.status.in_(("confirmed", "paid")),
                Payment.created_at >= start_dt,
                Payment.created_at <= end_dt,
            )
        )
    )
    confirmed = (await db.execute(confirmed_stmt)).scalar_one() or 0

    rate = Decimal(str(confirmed)) / Decimal(str(total))
    return round(rate, 4)


async def _query_average_payment_size(
    db: AsyncSession,
    base_filter,
) -> Decimal | None:
    """Mean fiat_amount_at_payment for confirmed/paid payments (2 dp)."""
    try:
        stmt = (
            select(func.avg(Payment.fiat_amount_at_payment))
            .where(base_filter)
            .where(Payment.fiat_amount_at_payment.is_not(None))
        )
        avg_val = (await db.execute(stmt)).scalar_one()
    except Exception as exc:
        logger.warning("Analytics: could not compute average_payment_size: %s", exc)
        return None

    if avg_val is None:
        return None

    return round(Decimal(str(avg_val)), 2)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _empty_analytics() -> dict[str, Any]:
    """Return an empty analytics result when the merchant has no payment links."""
    return {
        "revenue_series": [],
        "top_tokens": [],
        "top_networks": [],
        "conversion_rate": "0.00",
        "average_payment_size": None,
    }


async def _cache_result(redis, cache_key: str, result: dict) -> None:
    """Serialize and cache the analytics result in Redis for 300 seconds."""
    try:
        await redis.set(cache_key, json.dumps(result), ex=300)
    except Exception as exc:
        logger.warning("Analytics: Redis cache write failed: %s", exc)
