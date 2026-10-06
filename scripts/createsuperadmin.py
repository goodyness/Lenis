"""
Create a superadmin account interactively.

Usage::

    python scripts/createsuperadmin.py

Optional flags::

    --email EMAIL       Skip the email prompt
    --name  NAME        Skip the full-name prompt
    --non-interactive   Read password from ADMIN_PASSWORD env var (CI use)

The script validates email format and password complexity before writing
anything to the database, then exits 0 on success and 1 on any error.
"""
from __future__ import annotations

import argparse
import asyncio
import getpass
import os
import sys

# Ensure the project root is on sys.path so imports work when the script is
# run directly (e.g. `python scripts/createsuperadmin.py` from the repo root).
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from sqlalchemy import select

from app.core.db import AsyncSessionLocal, engine
from app.core.models import User
from app.core.security import hash_password
from app.core.validators import validate_email, validate_password_complexity


# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------


def _prompt_email(default: str | None) -> str:
    if default:
        return default
    while True:
        email = input("Email: ").strip()
        if not email:
            print("Email cannot be empty.")
            continue
        if not validate_email(email):
            print(f"  '{email}' is not a valid email address. Try again.")
            continue
        return email


def _prompt_full_name(default: str | None) -> str:
    if default:
        return default
    while True:
        name = input("Full name: ").strip()
        if name:
            return name
        print("Full name cannot be empty.")


def _prompt_password(non_interactive: bool) -> str:
    if non_interactive:
        password = os.environ.get("ADMIN_PASSWORD", "")
        if not password:
            print("Error: --non-interactive requires ADMIN_PASSWORD env var to be set.", file=sys.stderr)
            sys.exit(1)
        errors = validate_password_complexity(password)
        if errors:
            print("Password does not meet complexity requirements:", file=sys.stderr)
            for e in errors:
                print(f"  - {e}", file=sys.stderr)
            sys.exit(1)
        return password

    while True:
        password = getpass.getpass("Password: ")
        errors = validate_password_complexity(password)
        if errors:
            print("Password does not meet complexity requirements:")
            for e in errors:
                print(f"  - {e}")
            print("Please try again.")
            continue
        confirm = getpass.getpass("Password (again): ")
        if password != confirm:
            print("Passwords do not match. Please try again.")
            continue
        return password


# ---------------------------------------------------------------------------
# Database logic
# ---------------------------------------------------------------------------


async def create_superadmin(email: str, full_name: str, password: str) -> None:
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(User).where(User.email == email))
        existing = result.scalar_one_or_none()
        if existing:
            print(f"Error: a user with email '{email}' already exists (role: {existing.account_type}).")
            sys.exit(1)

        superadmin = User(
            email=email,
            password_hash=hash_password(password),
            full_name=full_name,
            account_type="superadmin",
            status="active",
            email_verified=True,
        )
        db.add(superadmin)
        await db.commit()
        await db.refresh(superadmin)

    print(f"\nSuperadmin created successfully.")
    print(f"  ID:    {superadmin.id}")
    print(f"  Email: {superadmin.email}")
    print(f"  Name:  {superadmin.full_name}")
    await engine.dispose()


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(description="Create a Lenis superadmin account.")
    parser.add_argument("--email", default=None, help="Superadmin email address")
    parser.add_argument("--name", default=None, help="Superadmin full name")
    parser.add_argument(
        "--non-interactive",
        action="store_true",
        help="Read password from ADMIN_PASSWORD env var instead of prompting",
    )
    args = parser.parse_args()

    print("Create superadmin account")
    print("-" * 26)

    email = _prompt_email(args.email)

    if args.email and not validate_email(email):
        print(f"Error: '{email}' is not a valid email address.", file=sys.stderr)
        sys.exit(1)

    full_name = _prompt_full_name(args.name)
    password = _prompt_password(args.non_interactive)

    asyncio.run(create_superadmin(email, full_name, password))


if __name__ == "__main__":
    main()
