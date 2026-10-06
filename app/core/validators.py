"""
Shared validation utilities for the Lenis platform.

These validators are used by:
- app/auth/service.py (registration, password reset)
- app/cli/bootstrap.py (superadmin CLI bootstrap)
- app/main.py (env-var bootstrap on startup)

Keeping them here avoids circular imports and ensures all entry points enforce
identical rules.
"""
from __future__ import annotations

import re

# ---------------------------------------------------------------------------
# Email
# ---------------------------------------------------------------------------

_EMAIL_PATTERN = re.compile(
    r"^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$"
)


def validate_email(email: str) -> bool:
    """Return ``True`` if *email* matches the simplified RFC 5322 pattern.

    The pattern requires:
    - A local part containing alphanumeric characters and ``._%+-``
    - An ``@`` separator
    - A domain label with alphanumeric characters and ``.-``
    - A TLD of at least two alphabetic characters
    """
    return bool(email and _EMAIL_PATTERN.match(email))


# ---------------------------------------------------------------------------
# Password complexity
# ---------------------------------------------------------------------------


def validate_password_complexity(password: str) -> list[str]:
    """Return a list of unmet password complexity rule descriptions.

    Rules (Requirements 6.1, 6.3, 3.3 -- the stricter superadmin / reset variant):
    - Minimum 8 characters
    - Maximum 128 characters
    - At least one uppercase letter
    - At least one lowercase letter
    - At least one digit
    - At least one special character (any non-alphanumeric character)

    Returns an empty list when the password meets all rules.
    Each entry in the returned list describes exactly one unmet rule, allowing
    the CLI to print each unmet rule as a separate line (Requirement 6.3).
    """
    errors: list[str] = []

    if len(password) < 8:
        errors.append("Password must be at least 8 characters long.")
    if len(password) > 128:
        errors.append("Password must not exceed 128 characters.")
    if not re.search(r"[A-Z]", password):
        errors.append("Password must contain at least one uppercase letter.")
    if not re.search(r"[a-z]", password):
        errors.append("Password must contain at least one lowercase letter.")
    if not re.search(r"\d", password):
        errors.append("Password must contain at least one digit.")
    if not re.search(r"[^A-Za-z0-9]", password):
        errors.append("Password must contain at least one special character.")

    return errors


def validate_registration_password(password: str) -> list[str]:
    """Return unmet rules for the registration password (no special char required).

    Registration only requires length >= 8, uppercase, lowercase, and a digit.
    Special characters are not required at registration (Requirements 1.3, 1.4).
    Use ``validate_password_complexity`` for superadmin bootstrap and password reset.
    """
    errors: list[str] = []

    if len(password) < 8:
        errors.append("Password must be at least 8 characters long.")
    if not re.search(r"[A-Z]", password):
        errors.append("Password must contain at least one uppercase letter.")
    if not re.search(r"[a-z]", password):
        errors.append("Password must contain at least one lowercase letter.")
    if not re.search(r"\d", password):
        errors.append("Password must contain at least one digit.")

    return errors
