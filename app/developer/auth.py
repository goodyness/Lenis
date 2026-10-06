"""
API key authentication dependency for the Developer API (`/v1/*`).

Extracts and validates a ``sk_test_*`` or ``sk_live_*`` Bearer token from the
``Authorization`` header, looks up the SHA-256 hash in ``api_keys``, and
attaches the owning ``Organization``, ``User``, and key id to ``request.state``.

Requirements: 2.1 – 2.7, 22.2 – 22.4
"""
from __future__ import annotations

import ipaddress
from datetime import UTC, datetime

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.db import get_db
from app.core.models import APIKey, OrgMember, Organization, User
from app.core.security import hash_token

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

_SK_PREFIXES = ("sk_test_", "sk_live_")
_MIN_SUFFIX_LEN = 32

_ERR_INVALID = {
    "error": "invalid_api_key",
    "message": "No valid API key found in the Authorization header.",
}
_ERR_REVOKED = {
    "error": "api_key_revoked",
    "message": "This API key has been revoked.",
}
_ERR_EXPIRED = {
    "error": "api_key_expired",
    "message": "This API key has expired.",
}


# ---------------------------------------------------------------------------
# IP helpers
# ---------------------------------------------------------------------------


def _client_ip(request: Request) -> str:
    """Return the best-guess real client IP address.

    Reads the first IP in the ``X-Forwarded-For`` header that is not a
    private / link-local address, falling back to the first non-private value
    found anywhere in the header, and finally to ``request.client.host``.

    Requirements: 22.2
    """
    xff: str | None = request.headers.get("X-Forwarded-For")
    if xff:
        for addr in xff.split(","):
            candidate = addr.strip()
            try:
                obj = ipaddress.ip_address(candidate)
                if not obj.is_private and not obj.is_loopback and not obj.is_link_local:
                    return candidate
            except ValueError:
                continue
        # All entries were private — fall back to the raw first value
        first = xff.split(",")[0].strip()
        if first:
            return first
    return request.client.host if request.client else "127.0.0.1"


def _ip_in_allowlist(client_ip: str, allowed_ips: str) -> bool:
    """Return True if *client_ip* matches any CIDR in the comma-separated
    *allowed_ips* string.

    Each entry is parsed with ``ip_network(cidr, strict=False)`` so host bits
    are silently masked (e.g. ``203.0.113.5/24`` → ``203.0.113.0/24``).

    Requirements: 22.3
    """
    try:
        addr = ipaddress.ip_address(client_ip)
    except ValueError:
        return False

    for cidr in allowed_ips.split(","):
        cidr = cidr.strip()
        if not cidr:
            continue
        try:
            network = ipaddress.ip_network(cidr, strict=False)
            if addr in network:
                return True
        except ValueError:
            continue
    return False


# ---------------------------------------------------------------------------
# Dependency
# ---------------------------------------------------------------------------


async def get_api_key_org(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> tuple[Organization, User, str]:
    """FastAPI dependency injected into all /v1/* handlers.

    Steps:
    1. Extract ``Authorization: Bearer <token>`` header.
    2. Validate format: must be ``sk_test_*`` or ``sk_live_*`` with a suffix
       of at least 32 characters.
    3. SHA-256 hash the token and look up ``api_keys.key_hash``.
    4. Check ``active=True``.
    5. Check ``expires_at`` not in the past (if the column ever exists on the
       model; currently the model has no ``expires_at`` — skipped safely).
    6. Set ``request.state`` fields and return ``(organization, user, key_id)``.

    Returns:
        ``(Organization, User, str)`` — owning org, owner user, APIKey UUID str.

    Raises:
        HTTP 401 on any auth failure.
    """
    # ------------------------------------------------------------------
    # 1. Extract header
    # ------------------------------------------------------------------
    auth_header: str | None = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_ERR_INVALID)

    token = auth_header[len("Bearer "):]

    # ------------------------------------------------------------------
    # 2. Validate format
    # ------------------------------------------------------------------
    matched_prefix: str | None = None
    for prefix in _SK_PREFIXES:
        if token.startswith(prefix):
            matched_prefix = prefix
            break

    if matched_prefix is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_ERR_INVALID)

    suffix = token[len(matched_prefix):]
    if len(suffix) < _MIN_SUFFIX_LEN:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_ERR_INVALID)

    # ------------------------------------------------------------------
    # 3. Hash token and look up in DB
    # ------------------------------------------------------------------
    token_hash = hash_token(token)

    stmt = (
        select(APIKey)
        .where(APIKey.key_hash == token_hash)
        .options(
            selectinload(APIKey.organization).selectinload(Organization.owner),
        )
    )
    result = await db.execute(stmt)
    api_key: APIKey | None = result.scalars().first()

    if api_key is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_ERR_INVALID)

    # ------------------------------------------------------------------
    # 4. Check active
    # ------------------------------------------------------------------
    if not api_key.active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_ERR_REVOKED)

    # ------------------------------------------------------------------
    # 5. Check expiry (guard: only if the attribute exists on the model)
    # ------------------------------------------------------------------
    expires_at = getattr(api_key, "expires_at", None)
    if expires_at is not None and expires_at < datetime.now(UTC):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=_ERR_EXPIRED)

    # ------------------------------------------------------------------
    # 5b. Check IP allowlist (Requirement 22.4)
    # ------------------------------------------------------------------
    if api_key.allowed_ips:
        client_ip = _client_ip(request)
        if not _ip_in_allowlist(client_ip, api_key.allowed_ips):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"error": "ip_not_allowed"},
            )

    # ------------------------------------------------------------------
    # 6. Attach context to request.state
    # ------------------------------------------------------------------
    organization: Organization = api_key.organization
    user: User = organization.owner

    request.state.test_mode = token.startswith("sk_test_")
    request.state.organization = organization
    request.state.user = user
    request.state.api_key_id = str(api_key.id)

    # ------------------------------------------------------------------
    # 7. Resolve member role
    # ------------------------------------------------------------------
    member_stmt = select(OrgMember).where(
        OrgMember.user_id == organization.owner_id,
        OrgMember.organization_id == organization.id,
    )
    member_result = await db.execute(member_stmt)
    member = member_result.scalars().first()
    request.state.member_role = member.role if member else None

    return organization, user, str(api_key.id)
