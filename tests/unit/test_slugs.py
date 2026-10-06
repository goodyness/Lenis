"""
Unit tests for app/core/slugs.py.

Tests are self-contained and require no running database.  The async DB
session is replaced by a lightweight AsyncMock that simulates collision
behaviour.
"""
from __future__ import annotations

import re
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.slugs import SlugCollisionError, ensure_unique_slug, generate_slug


# ---------------------------------------------------------------------------
# generate_slug
# ---------------------------------------------------------------------------


class TestGenerateSlug:
    def test_default_length_is_12(self) -> None:
        slug = generate_slug()
        assert len(slug) == 12

    def test_returns_exact_requested_length(self) -> None:
        for length in [8, 12, 16, 24, 32]:
            slug = generate_slug(length=length)
            assert len(slug) == length, f"Expected length {length}, got {len(slug)}"

    def test_output_contains_only_url_safe_chars(self) -> None:
        url_safe_pattern = re.compile(r"^[A-Za-z0-9_-]+$")
        for _ in range(100):
            slug = generate_slug()
            assert url_safe_pattern.match(slug), (
                f"Slug {slug!r} contains non-URL-safe characters"
            )

    def test_custom_length_contains_only_url_safe_chars(self) -> None:
        url_safe_pattern = re.compile(r"^[A-Za-z0-9_-]+$")
        for length in [6, 20, 50]:
            for _ in range(20):
                slug = generate_slug(length=length)
                assert url_safe_pattern.match(slug), (
                    f"Slug {slug!r} (length={length}) contains non-URL-safe characters"
                )

    def test_produces_different_values_on_repeated_calls(self) -> None:
        slugs = {generate_slug() for _ in range(50)}
        # With 12-character URL-safe slugs the probability of any collision
        # across 50 draws is astronomically small; one collision would be a
        # test infrastructure fluke, not expected behaviour.
        assert len(slugs) >= 49, "Unexpectedly high number of duplicate slugs"


# ---------------------------------------------------------------------------
# ensure_unique_slug
# ---------------------------------------------------------------------------


def _make_db(existing_slugs: set[str]) -> MagicMock:
    """Return a mock AsyncSession whose execute() simulates slug presence."""

    async def fake_execute(stmt):  # noqa: ANN001
        # Extract the candidate from the WHERE clause by re-running the
        # comparison on the in-memory set.  We can't easily inspect the SA
        # statement object, so we patch generate_slug instead (see tests).
        result = MagicMock()
        result.scalar_one_or_none.return_value = None
        return result

    db = MagicMock()
    db.execute = AsyncMock(side_effect=fake_execute)
    return db


@pytest.mark.asyncio
class TestEnsureUniqueSlug:
    async def test_returns_slug_when_no_collision(self) -> None:
        """DB returns no existing slug → first candidate is accepted."""
        db = MagicMock()
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None  # no collision
        db.execute = AsyncMock(return_value=mock_result)

        slug = await ensure_unique_slug(db)

        assert isinstance(slug, str)
        assert len(slug) == 12
        db.execute.assert_called_once()

    async def test_returns_slug_matching_requested_length(self) -> None:
        db = MagicMock()
        mock_result = MagicMock()
        mock_result.scalar_one_or_none.return_value = None
        db.execute = AsyncMock(return_value=mock_result)

        slug = await ensure_unique_slug(db, length=16)

        assert len(slug) == 16

    async def test_retries_on_collision_and_succeeds(self) -> None:
        """First two candidates collide; third succeeds."""
        collision_result = MagicMock()
        collision_result.scalar_one_or_none.return_value = "collision"  # slug exists

        success_result = MagicMock()
        success_result.scalar_one_or_none.return_value = None  # unique

        db = MagicMock()
        db.execute = AsyncMock(
            side_effect=[collision_result, collision_result, success_result]
        )

        # Patch generate_slug so we control the sequence of candidates
        candidates = ["collide1", "collide2", "unique12"]
        with patch("app.core.slugs.generate_slug", side_effect=candidates):
            slug = await ensure_unique_slug(db, max_retries=5)

        assert slug == "unique12"
        assert db.execute.call_count == 3

    async def test_raises_slug_collision_error_when_all_retries_exhausted(self) -> None:
        """Every candidate collides → SlugCollisionError must be raised."""
        collision_result = MagicMock()
        collision_result.scalar_one_or_none.return_value = "always_exists"

        db = MagicMock()
        db.execute = AsyncMock(return_value=collision_result)

        with pytest.raises(SlugCollisionError) as exc_info:
            await ensure_unique_slug(db, max_retries=5)

        # Verify HTTP semantics
        assert exc_info.value.status_code == 500
        detail = exc_info.value.detail
        assert isinstance(detail, dict)
        assert detail["code"] == "SLUG_COLLISION"

        # Exactly max_retries attempts were made
        assert db.execute.call_count == 5

    async def test_raises_slug_collision_error_with_custom_max_retries(self) -> None:
        collision_result = MagicMock()
        collision_result.scalar_one_or_none.return_value = "always_exists"

        db = MagicMock()
        db.execute = AsyncMock(return_value=collision_result)

        with pytest.raises(SlugCollisionError):
            await ensure_unique_slug(db, max_retries=3)

        assert db.execute.call_count == 3

    async def test_slug_collision_error_http_status(self) -> None:
        err = SlugCollisionError()
        assert err.status_code == 500
        assert err.detail["code"] == "SLUG_COLLISION"
        assert "detail" in err.detail
