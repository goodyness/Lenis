"""
CoinGecko price oracle with Redis caching.

Provides real-time token-to-USD exchange rates used for fiat equivalent
display on confirmed payments.  Results are cached in Redis for 60 seconds
to avoid hammering the CoinGecko public API.

Requirements: 17.2, 17.3, 17.4
"""
from __future__ import annotations

import logging
from decimal import Decimal

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# CoinGecko symbol → CoinGecko coin-ID mapping
# ---------------------------------------------------------------------------

COINGECKO_SYMBOL_MAP: dict[str, str] = {
    "USDC": "usd-coin",
    "USDT": "tether",
    "DAI": "dai",
    "ETH": "ethereum",
    "MATIC": "matic-network",
    "BNB": "binancecoin",
}

# Redis TTL for cached prices (seconds)
CACHE_TTL = 60


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


async def get_token_usd_price(token_symbol: str) -> Decimal | None:
    """Return the current USD price of *token_symbol*, or ``None`` on failure.

    Checks Redis first; on a cache miss, fetches from CoinGecko and stores
    the result with a 60-second TTL.  On any error (network timeout, bad
    response, missing symbol) logs a warning and returns ``None`` so that
    callers can degrade gracefully without failing the enclosing operation.

    Args:
        token_symbol: Token ticker string, e.g. ``"USDC"`` or ``"ETH"``.

    Returns:
        A ``Decimal`` price in USD, or ``None`` if the price is unavailable.
    """
    from app.core.redis_client import _get_pool
    import redis.asyncio as aioredis

    symbol = token_symbol.upper()
    cache_key = f"price_oracle:{symbol}"

    redis = aioredis.Redis(connection_pool=_get_pool())

    try:
        cached = await redis.get(cache_key)
        if cached:
            return Decimal(cached)
    except Exception as exc:
        logger.warning("PriceOracle: Redis read failed for %s: %s", symbol, exc)
        # Fall through to network fetch

    cg_id = COINGECKO_SYMBOL_MAP.get(symbol)
    if not cg_id:
        logger.warning("PriceOracle: unknown token symbol %r", symbol)
        return None

    try:
        headers: dict[str, str] = {}
        if settings.coingecko_api_key:
            headers["x-cg-demo-api-key"] = settings.coingecko_api_key

        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(
                "https://api.coingecko.com/api/v3/simple/price",
                params={"ids": cg_id, "vs_currencies": "usd"},
                headers=headers,
            )
            resp.raise_for_status()

        data = resp.json()
        price = Decimal(str(data[cg_id]["usd"]))

        # Cache for 60 seconds
        try:
            await redis.set(cache_key, str(price), ex=CACHE_TTL)
        except Exception as cache_exc:
            logger.warning("PriceOracle: Redis write failed for %s: %s", symbol, cache_exc)

        return price

    except Exception as exc:
        logger.warning("PriceOracle: failed to fetch %s price: %s", symbol, exc)
        return None
