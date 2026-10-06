"""
Slug generation and uniqueness utilities for the Lenis platform.

Payment links are identified by a short, URL-safe slug that is both human-
friendly and collision-resistant.  This module provides:

- ``generate_slug`` — produces a cryptographically random URL-safe string of a
  given length using :mod:`secrets`.
- ``ensure_unique_slug`` — wraps ``generate_slug`` with a DB collision check and
  up to ``max_retries`` regeneration attempts before raising
  ``SlugCollisionError``.
- ``SlugCollisionError`` — an :class:`fastapi.HTTPException` (HTTP 500) raised
  when all retry attempts are exhausted without finding a unique slug.

Requirements: 8.14
"""
from __future__ import annotations

import secrets

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import PaymentLink


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------


class SlugCollisionError(HTTPException):
    """Raised when a unique slug cannot be generated within the retry budget.

    Maps to HTTP 500 so that callers receive a server-error response rather
    than a misleading 4xx, since slug exhaustion is not a client fault.
    """

    def __init__(self) -> None:
        super().__init__(
            status_code=500,
            detail={
                "detail": "Failed to generate unique slug after maximum retries.",
                "code": "SLUG_COLLISION",
            },
        )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def generate_slug(length: int = 12) -> str:
    """Return a cryptographically random URL-safe string of exactly *length* chars.

    :func:`secrets.token_urlsafe` produces Base64url-encoded output whose
    alphabet is ``[A-Za-z0-9_-]``, so the result is always safe to embed in
    a URL path segment without percent-encoding.

    Args:
        length: Desired slug length.  Defaults to 12 characters.

    Returns:
        A URL-safe string of exactly *length* characters.
    """
    # token_urlsafe(n) returns at least n bytes of randomness encoded in
    # Base64url, which always yields more characters than requested — slicing
    # to exactly `length` preserves the URL-safe alphabet.
    return secrets.token_urlsafe(length)[:length]


async def ensure_unique_slug(
    db: AsyncSession,
    length: int = 12,
    max_retries: int = 5,
) -> str:
    """Generate a slug that does not collide with any existing ``PaymentLink.slug``.

    Attempts up to *max_retries* times.  On each attempt a fresh candidate is
    generated via :func:`generate_slug` and checked against the database.  The
    first candidate that is not already present is returned immediately.

    Args:
        db: An open async SQLAlchemy session.
        length: Desired slug length.  Defaults to 12 characters.
        max_retries: Maximum number of generation+check attempts before giving
            up.  Defaults to 5.

    Returns:
        A unique URL-safe slug string of exactly *length* characters.

    Raises:
        SlugCollisionError: If every attempt collides with an existing slug.
    """
    for _ in range(max_retries):
        candidate = generate_slug(length)
        result = await db.execute(
            select(PaymentLink.slug).where(PaymentLink.slug == candidate)
        )
        existing = result.scalar_one_or_none()
        if existing is None:
            return candidate

    raise SlugCollisionError()
