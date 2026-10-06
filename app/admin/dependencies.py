"""
FastAPI dependencies for admin role enforcement.

Exposes:
  - ``require_admin``      -- asserts account_type in {"admin", "superadmin"}
  - ``require_superadmin`` -- asserts account_type == "superadmin"

Both dependencies chain off ``get_current_user`` so the full token validation
sequence (signature, expiry, blocklist, suspension) is always run first.

Requirements: 7.5, 7.9, 7.11
"""
from __future__ import annotations

from fastapi import Depends, HTTPException, status

from app.core.dependencies import get_current_user, get_current_user_flexible
from app.core.models import User

# Roles that are allowed to access general admin endpoints.
_ADMIN_ROLES: frozenset[str] = frozenset({"admin", "superadmin"})


async def require_admin(
    current_user: User = Depends(get_current_user),
) -> User:
    """FastAPI dependency that requires an admin or superadmin session.

    Chains off ``get_current_user``, so the Bearer token is fully validated
    (signature, expiry, blocklist, suspension) before the role check.

    Returns:
        The authenticated :class:`~app.core.models.User` instance.

    Raises:
        HTTPException(403) -- if the user's account_type is not "admin" or
            "superadmin" (Requirement 7.11).
    """
    if current_user.account_type not in _ADMIN_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "detail": "You do not have permission to access this resource.",
                "code": "INSUFFICIENT_PRIVILEGES",
            },
        )
    return current_user


async def require_admin_flexible(
    current_user: User = Depends(get_current_user_flexible),
) -> User:
    """FastAPI dependency accepting token in Authorization header or query param."""
    if current_user.account_type not in _ADMIN_ROLES:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "detail": "You do not have permission to access this resource.",
                "code": "INSUFFICIENT_PRIVILEGES",
            },
        )
    return current_user


async def require_superadmin(
    current_user: User = Depends(get_current_user),
) -> User:
    """FastAPI dependency that requires a superadmin session exclusively.

    Intended for endpoints that must not be accessible to regular admins,
    such as suspending users, reactivating users, or promoting accounts
    (Requirements 7.5, 7.9).

    Returns:
        The authenticated :class:`~app.core.models.User` instance.

    Raises:
        HTTPException(403) -- if the user's account_type is not "superadmin".
    """
    if current_user.account_type != "superadmin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "detail": "This action requires superadmin privileges.",
                "code": "INSUFFICIENT_PRIVILEGES",
            },
        )
    return current_user
