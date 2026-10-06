"""
Async Redis connection pool for the Lenis platform.

Exposes a module-level pool initialised from the REDIS_URL setting and a
get_redis() FastAPI dependency that yields a connection from that pool.
"""
from __future__ import annotations

from collections.abc import AsyncGenerator
from typing import Optional

import redis.asyncio as aioredis
from redis.asyncio import Redis

from app.core.config import settings

# ---------------------------------------------------------------------------
# Module-level pool (created once, reused across requests)
# ---------------------------------------------------------------------------

_pool: Optional[aioredis.ConnectionPool] = None


def _get_pool() -> aioredis.ConnectionPool:
    """Return the module-level connection pool, creating it on first call."""
    global _pool
    if _pool is None:
        _pool = aioredis.ConnectionPool.from_url(
            settings.redis_url,
            encoding="utf-8",
            decode_responses=True,
            max_connections=20,
        )
    return _pool


# ---------------------------------------------------------------------------
# FastAPI dependency
# ---------------------------------------------------------------------------


async def get_redis() -> AsyncGenerator[Redis, None]:
    """Yield a Redis client backed by the shared connection pool.

    Usage in a FastAPI route::

        @router.get("/example")
        async def example(redis: Redis = Depends(get_redis)):
            value = await redis.get("key")

    The client is closed (connection returned to pool) after each request.
    """
    client: Redis = aioredis.Redis(connection_pool=_get_pool())
    try:
        yield client
    finally:
        await client.aclose()


# ---------------------------------------------------------------------------
# Lifecycle helpers (called from app/main.py lifespan)
# ---------------------------------------------------------------------------


async def close_redis_pool() -> None:
    """Drain and close the connection pool gracefully on application shutdown."""
    global _pool
    if _pool is not None:
        await _pool.aclose()
        _pool = None
