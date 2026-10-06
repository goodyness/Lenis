
from __future__ import annotations

import hashlib
import json
import logging
import secrets
import uuid
from datetime import UTC, datetime
from typing import Optional

import redis.asyncio as aioredis
from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.models import OrgMember, Organization, User
from app.core.redis_client import _get_pool

logger = logging.getLogger(__name__)


_INVITE_TTL_SECONDS: int = 172_800  # 48 hours
_VALID_ROLES: frozenset[str] = frozenset({"owner", "admin", "developer"})


def _redis() -> aioredis.Redis:
    """Return an async Redis client backed by the shared connection pool."""
    return aioredis.Redis(connection_pool=_get_pool())


def _invite_key(token_hash: str) -> str:
    return f"invite:{token_hash}"


async def invite_team_member(
    org_id: uuid.UUID,
    inviting_user: User,
    email: str,
    role: str,
    db: AsyncSession,
) -> dict:
    """Send a team invitation email and store a Redis token for acceptance.

    The inviting user must be an ``owner`` or ``admin`` of *org_id*; the
    target *role* must be one of ``owner``, ``admin``, or ``developer``.

    The plaintext token is embedded in the invitation link and is **never**
    stored — only its SHA-256 hex digest is kept as the Redis key.  The token
    expires after 48 hours.

    Args:
        org_id: The organisation the new member is being invited to.
        inviting_user: The authenticated user performing the invitation.
        email: Email address of the person being invited.
        role: Role to assign to the invitee once they accept.
        db: Active async SQLAlchemy session.

    Returns:
        ``{"status": "invited", "email": email, "role": role}``

    Raises:
        HTTPException(403): Calling user is not an owner/admin of the org.
        HTTPException(422): *role* is not a valid team role.
    """
    # --- Permission check ---------------------------------------------------
    caller_result = await db.execute(
        select(OrgMember).where(
            OrgMember.organization_id == org_id,
            OrgMember.user_id == inviting_user.id,
        )
    )
    caller_member = caller_result.scalar_one_or_none()

    if caller_member is None or caller_member.role not in ("owner", "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": "insufficient_permissions"},
        )

    # --- Role validation ----------------------------------------------------
    if role not in _VALID_ROLES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"error": "invalid_role"},
        )

    # --- Generate token and store in Redis ----------------------------------
    plaintext_token = secrets.token_hex(32)
    token_hash = hashlib.sha256(plaintext_token.encode()).hexdigest()

    payload = json.dumps(
        {
            "org_id": str(org_id),
            "email": email,
            "role": role,
            "invited_by": str(inviting_user.id),
        }
    )

    r = _redis()
    await r.set(_invite_key(token_hash), payload, ex=_INVITE_TTL_SECONDS)

    # --- Dispatch invitation email ------------------------------------------
    invitation_link = (
        f"{settings.frontend_origin}/team/accept?token={plaintext_token}"
    )
    try:
        from app.core.email import send_email_task  # local import avoids circulars

        send_email_task.delay(
            to=email,
            subject="You've been invited to join a team on Lenis",
            template="team_invitation",
            context={
                "invitation_link": invitation_link,
                "invited_by_email": inviting_user.email,
                "role": role,
            },
        )
    except Exception as exc:  # broker/serialisation errors must not fail the request
        logger.error(
            "Failed to dispatch team invitation email to %s: %s", email, exc
        )

    logger.info(
        "Team invite sent: org_id=%s inviter=%s email=%s role=%s",
        org_id,
        inviting_user.id,
        email,
        role,
    )

    return {"status": "invited", "email": email, "role": role}


async def accept_team_invite(
    token_plaintext: str,
    user_id: uuid.UUID,
    db: AsyncSession,
) -> OrgMember:
    """Accept a pending team invitation.

    Validates the plaintext token against Redis, creates an ``OrgMember``
    record, and deletes the Redis key so the token cannot be reused.

    Args:
        token_plaintext: The plaintext token from the invitation link.
        user_id: The authenticated user accepting the invite.
        db: Active async SQLAlchemy session.

    Returns:
        The newly created ``OrgMember`` instance.

    Raises:
        HTTPException(404): Token not found in Redis (expired or invalid).
        HTTPException(409): User is already a member of the organisation.

    """
    token_hash = hashlib.sha256(token_plaintext.encode()).hexdigest()
    key = _invite_key(token_hash)

    r = _redis()
    raw = await r.get(key)

    if raw is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "invitation_not_found_or_expired"},
        )

    data = json.loads(raw)
    org_id_str: str = data["org_id"]
    role: str = data["role"]
    invited_by_str: str = data["invited_by"]

    org_uuid = uuid.UUID(org_id_str)

    # --- Duplicate membership guard -----------------------------------------
    existing_result = await db.execute(
        select(OrgMember).where(
            OrgMember.organization_id == org_uuid,
            OrgMember.user_id == user_id,
        )
    )
    if existing_result.scalar_one_or_none() is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={"error": "already_a_member"},
        )

    # --- Create membership --------------------------------------------------
    member = OrgMember(
        organization_id=org_uuid,
        user_id=user_id,
        role=role,
        invited_by=uuid.UUID(invited_by_str),
        accepted_at=datetime.now(UTC),
    )
    db.add(member)
    await db.flush()
    await db.refresh(member)

    # Consume the token so it cannot be accepted twice.
    await r.delete(key)

    logger.info(
        "Team invite accepted: org_id=%s user_id=%s role=%s",
        org_uuid,
        user_id,
        role,
    )

    return member


async def list_team_members(
    org_id: uuid.UUID,
    db: AsyncSession,
) -> list[dict]:
    """Return all members of an organisation.

    Each entry is a plain dict with ``member_id``, ``email``, ``full_name``,
    ``role``, and ``accepted_at`` (ISO-8601 string or ``None``).

    Args:
        org_id: The organisation whose members are listed.
        db: Active async SQLAlchemy session.

    Returns:
        List of member dicts ordered by ``OrgMember.created_at`` ascending.
    """
    rows_result = await db.execute(
        select(OrgMember, User)
        .join(User, OrgMember.user_id == User.id)
        .where(OrgMember.organization_id == org_id)
        .order_by(OrgMember.created_at)
    )
    rows = rows_result.all()

    return [
        {
            "member_id": str(member.id),
            "email": user.email,
            "full_name": user.full_name,
            "role": member.role,
            "accepted_at": (
                member.accepted_at.isoformat() if member.accepted_at else None
            ),
        }
        for member, user in rows
    ]


async def remove_team_member(
    org_id: uuid.UUID,
    calling_user_id: uuid.UUID,
    calling_member_role: str,
    member_id: uuid.UUID,
    db: AsyncSession,
) -> None:
    """Remove a member from an organisation.

    The calling user must be an ``owner`` or ``admin``.  The sole owner of an
    organisation cannot be removed.

    Args:
        org_id: The organisation to remove from.
        calling_user_id: ID of the user performing the removal.
        calling_member_role: Pre-fetched role of the calling user.
        member_id: The ``OrgMember.id`` of the record to remove.
        db: Active async SQLAlchemy session.

    Raises:
        HTTPException(403): Caller lacks permission.
        HTTPException(404): Target member not found in this org.
        HTTPException(409): Attempt to remove the sole owner.
    """
    if calling_member_role not in ("owner", "admin"):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": "insufficient_permissions"},
        )

    # Fetch target member
    target_result = await db.execute(
        select(OrgMember).where(
            OrgMember.id == member_id,
            OrgMember.organization_id == org_id,
        )
    )
    target_member = target_result.scalar_one_or_none()

    if target_member is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "member_not_found"},
        )

    # Guard: cannot remove the sole owner
    if target_member.role == "owner":
        owner_count_result = await db.execute(
            select(func.count(OrgMember.id)).where(
                OrgMember.organization_id == org_id,
                OrgMember.role == "owner",
            )
        )
        owner_count: int = owner_count_result.scalar_one()
        if owner_count == 1:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={"error": "cannot_remove_sole_owner"},
            )

    await db.delete(target_member)
    await db.flush()

    logger.info(
        "Team member removed: org_id=%s member_id=%s by user_id=%s",
        org_id,
        member_id,
        calling_user_id,
    )


async def update_member_role(
    org_id: uuid.UUID,
    calling_member_role: str,
    calling_user_id: uuid.UUID,
    member_id: uuid.UUID,
    new_role: str,
    db: AsyncSession,
) -> OrgMember:
    """Change the role of an organisation member.

    Role-escalation rules:
    - Only an ``owner`` may assign or remove the ``owner`` role.
    - An ``admin`` may only promote a ``developer`` to ``admin``.
    - A ``developer`` may not change any roles.

    Args:
        org_id: The organisation context.
        calling_member_role: Pre-fetched role of the calling user.
        calling_user_id: ID of the user making the change.
        member_id: ``OrgMember.id`` of the member to update.
        new_role: The role to assign.
        db: Active async SQLAlchemy session.

    Returns:
        The updated ``OrgMember`` instance.

    Raises:
        HTTPException(422): *new_role* is not a valid role.
        HTTPException(404): Target member not found.
        HTTPException(403): Caller lacks the required permission for the change.
    """
    if new_role not in _VALID_ROLES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"error": "invalid_role"},
        )

    # Fetch target
    target_result = await db.execute(
        select(OrgMember).where(
            OrgMember.id == member_id,
            OrgMember.organization_id == org_id,
        )
    )
    target_member = target_result.scalar_one_or_none()

    if target_member is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "member_not_found"},
        )

    # --- Role escalation enforcement ----------------------------------------
    target_current_role = target_member.role

    if calling_member_role == "developer":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": "insufficient_permissions"},
        )

    if calling_member_role == "owner":
        # Owners can do any role change — no further checks needed.
        pass
    elif calling_member_role == "admin":
        # Admins may only promote developer → admin.
        if target_current_role == "owner" or new_role == "owner":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"error": "only_owner_can_assign_owner_role"},
            )
        if not (target_current_role == "developer" and new_role == "admin"):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={"error": "insufficient_permissions"},
            )
    else:
        # Unrecognised calling role — deny by default.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": "insufficient_permissions"},
        )

    target_member.role = new_role
    await db.flush()
    await db.refresh(target_member)

    logger.info(
        "Member role updated: org_id=%s member_id=%s %s→%s by user_id=%s",
        org_id,
        member_id,
        target_current_role,
        new_role,
        calling_user_id,
    )

    return target_member
