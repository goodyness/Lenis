"""
Superadmin bootstrap CLI for the Lenis platform.

Usage
-----
    python -m app.cli.bootstrap --email admin@example.com --password "P@ssw0rd!1"

This command creates the first superadmin account. It is idempotent: if a
superadmin already exists, it prints a warning and exits with code 0 without
modifying the database.

Requirements addressed: 6.1, 6.2, 6.3, 6.4, 6.7
"""
from __future__ import annotations

import argparse
import sys

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings
from app.core.security import hash_password
from app.core.validators import validate_email, validate_password_complexity


# ---------------------------------------------------------------------------
# Synchronous DB helpers (CLI runs outside any async event loop)
# ---------------------------------------------------------------------------

def _get_sync_engine():
    """Create a synchronous SQLAlchemy engine from the configured DATABASE_URL.

    The async driver prefix (``+aiosqlite``, ``+asyncpg``) is replaced with
    the corresponding synchronous driver so the CLI can run without an event
    loop.
    """
    url = settings.database_url
    # Map async driver URLs to their synchronous equivalents
    url = url.replace("sqlite+aiosqlite", "sqlite")
    url = url.replace("postgresql+asyncpg", "postgresql+psycopg2")
    url = url.replace("postgres+asyncpg", "postgresql+psycopg2")

    connect_args = {}
    if url.startswith("sqlite"):
        connect_args["check_same_thread"] = False

    return create_engine(url, connect_args=connect_args)


def _get_sync_session() -> Session:
    """Return a synchronous SQLAlchemy session."""
    engine = _get_sync_engine()
    SyncSessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    return SyncSessionLocal()


# ---------------------------------------------------------------------------
# Core bootstrap logic (separated for testability)
# ---------------------------------------------------------------------------

def run_bootstrap(email: str, password: str) -> int:
    """Execute the bootstrap flow.

    Parameters
    ----------
    email:
        The superadmin email address.
    password:
        The superadmin password (plaintext).

    Returns
    -------
    int
        Exit code -- 0 on success or already-exists, 1 on validation failure.

    Side effects
    ------------
    - Writes error messages to ``sys.stderr``.
    - Writes status messages to ``sys.stdout``.
    """
    # --- Email validation (Requirement 6.4) --------------------------------
    if not validate_email(email):
        sys.stderr.write(f"Error: '{email}' is not a valid email address.\n")
        return 1

    # --- Password complexity (Requirement 6.3) -----------------------------
    errors = validate_password_complexity(password)
    if errors:
        sys.stderr.write("Error: Password does not meet complexity requirements:\n")
        for rule in errors:
            sys.stderr.write(f"  - {rule}\n")
        return 1

    # --- Database operations -----------------------------------------------
    # Late import to avoid importing ORM models before the engine is ready.
    from app.core.models import User  # noqa: PLC0415

    session = _get_sync_session()
    try:
        # Check for existing superadmin (Requirement 6.2)
        existing = session.execute(
            select(User).where(User.account_type == "superadmin")
        ).scalar_one_or_none()

        if existing is not None:
            sys.stdout.write(
                f"Warning: A superadmin account already exists ({existing.email}). "
                "No changes were made.\n"
            )
            return 0

        # Hash the password with bcrypt cost=12 (Requirement 6.7)
        hashed = hash_password(password)

        # Insert the superadmin user (Requirement 6.1)
        superadmin = User(
            email=email,
            password_hash=hashed,
            full_name="Platform Operator",
            account_type="superadmin",
            status="active",
            email_verified=True,
        )
        session.add(superadmin)
        session.commit()

        sys.stdout.write(f"Superadmin created: {email}\n")
        return 0

    except Exception as exc:
        session.rollback()
        sys.stderr.write(f"Error: Failed to create superadmin account: {exc}\n")
        return 1

    finally:
        session.close()


# ---------------------------------------------------------------------------
# CLI entry point
# ---------------------------------------------------------------------------

def main() -> None:
    """Parse arguments and run the bootstrap command."""
    parser = argparse.ArgumentParser(
        prog="python -m app.cli.bootstrap",
        description="Bootstrap the first superadmin account for the Lenis platform.",
    )
    parser.add_argument(
        "--email",
        required=True,
        help="Email address for the superadmin account.",
    )
    parser.add_argument(
        "--password",
        required=True,
        help="Password for the superadmin account.",
    )

    args = parser.parse_args()
    sys.exit(run_bootstrap(args.email, args.password))


if __name__ == "__main__":
    main()
