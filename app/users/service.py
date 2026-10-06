"""
Users service for the Lenis platform.

``UserService`` contains business logic for user-facing profile operations
and API key management.

Requirements addressed by this module: 1.1, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6
"""
from __future__ import annotations

import logging
import re
import secrets
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.models import APIKey, AuditLog, MerchantProfile, Organization, User
from app.core.security import hash_token
from app.users.schemas import (
    APIKeyHistoryItem,
    APIKeyHistoryResponse,
    APIKeyListResponse,
    RegeneratedKeysResponse,
    SecretKeyResponse,
    SecurityChallengeStatusResponse,
    UserProfileResponse,
    VerifySecurityChallengeResponse,
)

logger = logging.getLogger(__name__)

def mask_email(email: str) -> str:
    """Mask email for privacy e.g. u***r@domain.com."""
    if "@" not in email:
        return email
    local, domain = email.split("@", 1)
    if len(local) <= 2:
        masked_local = local[0] + "***"
    else:
        masked_local = local[:2] + "***" + local[-1]
    return f"{masked_local}@{domain}"


def mask_phone(phone: str | None) -> str | None:
    """Mask phone number for privacy e.g. +1 *** *** 1234."""
    if not phone:
        return None
    phone_clean = phone.strip()
    if len(phone_clean) <= 4:
        return "***"
    return phone_clean[:3] + " " + ("*" * max(1, len(phone_clean) - 7)) + " " + phone_clean[-4:]


def _to_utc(dt: datetime | None) -> datetime | None:
    """Normalize datetime to timezone-aware UTC. Works seamlessly with both SQLite and Postgres."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


# Alphanumeric character set used when generating API key suffixes.
_ALNUM = re.compile(r"[^A-Za-z0-9]")
_KEY_SUFFIX_LENGTH = 32


def _generate_alnum_suffix() -> str:
    """Return a 32-character alphanumeric string derived from a CSPRNG source.

    Strategy: generate ``secrets.token_urlsafe(48)`` (which uses base64url and
    therefore contains only ``[A-Za-z0-9_-]``), strip the two non-alphanumeric
    characters (``_`` and ``-``), and take the first 32 characters.  Generating
    48 bytes of urlsafe base64 yields ~64 characters; after stripping roughly
    4 non-alnum chars there are always >= 32 alphanumeric characters left.
    If by an extremely rare chance fewer than 32 remain, we retry until we have
    enough.
    """
    result = ""
    while len(result) < _KEY_SUFFIX_LENGTH:
        chunk = _ALNUM.sub("", secrets.token_urlsafe(48))
        result += chunk
    return result[:_KEY_SUFFIX_LENGTH]


class UserService:
    """Stateless service that holds user profile and API key business logic."""

    # ------------------------------------------------------------------
    # Profile retrieval (Requirement 1.1)
    # ------------------------------------------------------------------

    @staticmethod
    async def get_profile(
        user_id: uuid.UUID,
        db: AsyncSession,
    ) -> UserProfileResponse:
        """Return the profile for the given user.

        Parameters
        ----------
        user_id:
            UUID of the authenticated user whose profile is requested.
        db:
            Active async database session from the request's dependency.

        Returns
        -------
        UserProfileResponse
            The user's id, email, full_name, account_type, status,
            email_verified, and created_at fields.

        Raises
        ------
        HTTPException(404)
            If no user with the given id exists (defensive; should not occur
            when called from the authenticated endpoint).
        """
        result = await db.execute(select(User).where(User.id == user_id))
        user = result.scalar_one_or_none()

        if user is None:
            raise HTTPException(
                status_code=404,
                detail={
                    "detail": "User not found.",
                    "code": "USER_NOT_FOUND",
                },
            )

        phone_num = user.phone_number
        if not phone_num:
            mp_res = await db.execute(select(MerchantProfile).where(MerchantProfile.user_id == user.id))
            mp = mp_res.scalar_one_or_none()
            if mp and mp.phone_number:
                phone_num = mp.phone_number

        return UserProfileResponse(
            user_id=user.id,
            email=user.email,
            full_name=user.full_name,
            account_type=user.account_type,
            status=user.status,
            email_verified=user.email_verified,
            phone_number=phone_num,
            phone_verified=bool(user.phone_verified),
            two_factor_enabled=bool(user.two_factor_enabled),
            subscription_tier=user.subscription_tier or "free",
            subscription_period=user.subscription_period,
            subscription_expires_at=user.subscription_expires_at,
            monthly_tx_count=user.monthly_tx_count or 0,
            created_at=user.created_at,
        )

    # ------------------------------------------------------------------
    # API key generation (Requirements 9.1, 9.2)
    # ------------------------------------------------------------------

    @staticmethod
    async def _generate_test_keys(
        user_id: uuid.UUID,
        db: AsyncSession,
    ) -> SecretKeyResponse:
        """Generate test-mode API keys for a newly verified developer.

        Called internally by ``AuthService.verify_email()`` immediately after
        the user's email is marked verified.  This method must only be called
        for users with ``account_type == "developer"``.

        Key generation strategy (Requirement 9.1)
        ------------------------------------------
        - Publishable key: ``pk_test_`` + 32 alphanumeric chars (stored plaintext)
        - Secret key:      ``sk_test_`` + 32 alphanumeric chars

        Storage (Requirement 9.2)
        -------------------------
        - ``pk_test`` APIKey record: ``key_hash`` stores the full plaintext
          publishable key (pk is public by design; hashing provides no security
          benefit and would prevent retrieval).
        - ``sk_test`` APIKey record: ``key_hash`` stores the SHA-256 hex digest
          of the full plaintext secret key.  ``suffix_display`` holds the last 4
          characters of the **suffix** (the 32 chars after the ``sk_test_`` prefix)
          for masked display (Requirement 9.3).

        Returns
        -------
        SecretKeyResponse
            Contains the plaintext secret key, returned exactly once.
        """
        # Locate the user's organization.
        org_result = await db.execute(
            select(Organization).where(Organization.owner_id == user_id)
        )
        org = org_result.scalar_one_or_none()

        if org is None:
            raise HTTPException(
                status_code=500,
                detail={
                    "detail": "Organization not found for user.",
                    "code": "ORGANIZATION_NOT_FOUND",
                },
            )

        # --- Publishable key (pk_test) -----------------------------------
        pk_prefix = "pk_test_"
        pk_suffix = _generate_alnum_suffix()
        pk_plaintext = pk_prefix + pk_suffix

        pk_record = APIKey(
            organization_id=org.id,
            key_type="pk_test",
            prefix=pk_prefix,
            # For publishable keys the full plaintext is stored so it can
            # be returned in the GET /users/me/api-keys response.
            suffix_display=pk_suffix[-4:],
            key_hash=pk_plaintext,
            active=True,
        )
        db.add(pk_record)

        # --- Secret key (sk_test) ----------------------------------------
        sk_prefix = "sk_test_"
        sk_suffix = _generate_alnum_suffix()
        sk_plaintext = sk_prefix + sk_suffix

        sk_record = APIKey(
            organization_id=org.id,
            key_type="sk_test",
            prefix=sk_prefix,
            # Last 4 chars of the suffix (not the full key) for masked display.
            suffix_display=sk_suffix[-4:],
            # One-way hash â€” plaintext is never stored (Requirement 9.2).
            key_hash=hash_token(sk_plaintext),
            active=True,
        )
        db.add(sk_record)

        await db.flush()

        # Return the plaintext sk exactly once (Requirement 9.2).
        return SecretKeyResponse(secret_key=sk_plaintext)

    # ------------------------------------------------------------------
    # API key listing (Requirement 9.3)
    # ------------------------------------------------------------------

    @staticmethod
    async def list_api_keys(
        user_id: uuid.UUID,
        db: AsyncSession,
    ) -> APIKeyListResponse:
        """Return the masked API key summary for the authenticated developer.

        The publishable key is returned in plaintext (it is public by design).
        The secret key is returned as a masked value: ``sk_test_****...wxyz``
        where ``wxyz`` is the last 4 characters of the original plaintext key
        (Requirement 9.3).

        Raises
        ------
        HTTPException(403)
            If the user is not a developer.
        HTTPException(404)
            If no active test keys are found (keys not yet generated, which
            would only happen if email is not verified yet).
        """
        # Verify caller is a developer, merchant, or admin.
        user_result = await db.execute(select(User).where(User.id == user_id))
        user = user_result.scalar_one_or_none()

        if user is None or user.account_type not in ("developer", "merchant", "admin"):
            raise HTTPException(
                status_code=403,
                detail={
                    "detail": "API key management is available to developers and merchants only.",
                    "code": "INSUFFICIENT_PRIVILEGES",
                },
            )

        # Fetch or create the user's organization.
        org_result = await db.execute(
            select(Organization).where(Organization.owner_id == user_id)
        )
        org = org_result.scalar_one_or_none()

        if org is None:
            org = Organization(
                owner_id=user.id,
                name=f"{user.full_name}'s Organization",
            )
            db.add(org)
            await db.flush()

        # Fetch active keys for this organization.
        keys_result = await db.execute(
            select(APIKey).where(
                APIKey.organization_id == org.id,
                APIKey.active.is_(True),
            )
        )
        keys = keys_result.scalars().all()

        pk_record = next((k for k in keys if k.key_type == "pk_test"), None)
        sk_record = next((k for k in keys if k.key_type == "sk_test"), None)

        if pk_record is None or sk_record is None:
            # Auto-provision initial test keys
            await UserService._generate_test_keys(user_id=user_id, db=db)
            keys_result = await db.execute(
                select(APIKey).where(
                    APIKey.organization_id == org.id,
                    APIKey.active.is_(True),
                )
            )
            keys = keys_result.scalars().all()
            pk_record = next((k for k in keys if k.key_type == "pk_test"), None)
            sk_record = next((k for k in keys if k.key_type == "sk_test"), None)

        if pk_record is None or sk_record is None:
            raise HTTPException(
                status_code=404,
                detail={
                    "detail": "API keys not yet generated. Verify your email first.",
                    "code": "KEYS_NOT_FOUND",
                },
            )

        # Check whether live-mode keys exist.
        pk_live_record = next((k for k in keys if k.key_type == "pk_live"), None)
        sk_live_record = next((k for k in keys if k.key_type == "sk_live"), None)
        has_live = pk_live_record is not None or sk_live_record is not None

        live_pk = pk_live_record.key_hash if pk_live_record else None
        live_sk_masked = (
            sk_live_record.prefix + ("*" * (_KEY_SUFFIX_LENGTH - 4)) + sk_live_record.suffix_display
            if sk_live_record else None
        )

        # Build the masked secret key representation.
        # key_hash for pk_test stores the full plaintext key.
        # For sk_test we have only the hash and suffix_display (last 4 chars of suffix).
        # Masked format: prefix + "****...{last4}" where the total suffix length is 32.
        masked_sk = sk_record.prefix + ("*" * (_KEY_SUFFIX_LENGTH - 4)) + sk_record.suffix_display

        return APIKeyListResponse(
            publishable_key=pk_record.key_hash,
            secret_key_masked=masked_sk,
            has_live_keys=has_live,
            live_publishable_key=live_pk,
            live_secret_key_masked=live_sk_masked,
        )

    # ------------------------------------------------------------------
    # ------------------------------------------------------------------
    # Unified API key rotation & history (Requirement 9.4, 9.5)
    # ------------------------------------------------------------------

    @staticmethod
    async def regenerate_api_keys(
        user_id: uuid.UUID,
        key_category: str = "sk",  # "pk" | "sk" | "pair"
        mode: str = "sandbox",     # "sandbox" | "live"
        security_code: str | None = None,
        security_method: str | None = None,
        client_ip: str | None = None,
        db: AsyncSession = None,  # type: ignore[assignment]
    ) -> RegeneratedKeysResponse:
        """Rotate public keys, secret keys, or full key pairs for sandbox or live environments."""
        user_result = await db.execute(select(User).where(User.id == user_id))
        user = user_result.scalar_one_or_none()

        if user is None or user.account_type not in ("developer", "merchant", "admin"):
            raise HTTPException(
                status_code=403,
                detail={
                    "detail": "API key management is available to developers and merchants only.",
                    "code": "INSUFFICIENT_PRIVILEGES",
                },
            )

        is_live = mode.lower() in ("live", "production")
        if is_live and user.status != "verified":
            raise HTTPException(
                status_code=403,
                detail={
                    "detail": "Live-mode API key management requires account verification.",
                    "code": "VERIFICATION_REQUIRED",
                },
            )

        # Always verify 2FA / OTP security authorization for key rotation
        await UserService.verify_security_action_auth(
            user=user,
            security_code=security_code,
            security_method=security_method,
            db=db,
        )

        org_result = await db.execute(
            select(Organization).where(Organization.owner_id == user_id)
        )
        org = org_result.scalar_one_or_none()
        if org is None:
            raise HTTPException(
                status_code=500,
                detail={
                    "detail": "Organization not found for user.",
                    "code": "ORGANIZATION_NOT_FOUND",
                },
            )

        now = datetime.now(UTC)
        pk_type = "pk_live" if is_live else "pk_test"
        sk_type = "sk_live" if is_live else "sk_test"
        pk_prefix = "pk_live_" if is_live else "pk_test_"
        sk_prefix = "sk_live_" if is_live else "sk_test_"

        new_pk_plaintext: str | None = None
        new_sk_plaintext: str | None = None

        # --- Rotate Public Key if requested ---
        if key_category in ("pk", "pair"):
            old_pk_res = await db.execute(
                select(APIKey).where(
                    APIKey.organization_id == org.id,
                    APIKey.key_type == pk_type,
                    APIKey.active.is_(True),
                )
            )
            old_pks = old_pk_res.scalars().all()
            for old_pk in old_pks:
                old_pk.active = False
                old_pk.revoked_at = now

            pk_suffix = _generate_alnum_suffix()
            new_pk_plaintext = pk_prefix + pk_suffix
            new_pk_id = uuid.uuid4()
            new_pk = APIKey(
                id=new_pk_id,
                organization_id=org.id,
                key_type=pk_type,
                prefix=pk_prefix,
                suffix_display=pk_suffix[-4:],
                key_hash=new_pk_plaintext,
                active=True,
                created_at=now,
            )
            db.add(new_pk)
            await db.flush()

            audit_pk = AuditLog(
                id=uuid.uuid4(),
                event_type="api_key.regenerate_pk",
                actor_id=user_id,
                target_type="api_key",
                target_id=new_pk_id,
                outcome="success",
                client_ip=client_ip,
                created_at=now,
            )
            db.add(audit_pk)

        # --- Rotate Secret Key if requested ---
        if key_category in ("sk", "pair"):
            old_sk_res = await db.execute(
                select(APIKey).where(
                    APIKey.organization_id == org.id,
                    APIKey.key_type == sk_type,
                    APIKey.active.is_(True),
                )
            )
            old_sks = old_sk_res.scalars().all()
            for old_sk in old_sks:
                old_sk.active = False
                old_sk.revoked_at = now

            sk_suffix = _generate_alnum_suffix()
            new_sk_plaintext = sk_prefix + sk_suffix
            new_sk_id = uuid.uuid4()
            new_sk = APIKey(
                id=new_sk_id,
                organization_id=org.id,
                key_type=sk_type,
                prefix=sk_prefix,
                suffix_display=sk_suffix[-4:],
                key_hash=hash_token(new_sk_plaintext),
                active=True,
                created_at=now,
            )
            db.add(new_sk)
            await db.flush()

            audit_sk = AuditLog(
                id=uuid.uuid4(),
                event_type="api_key.regenerate_sk",
                actor_id=user_id,
                target_type="api_key",
                target_id=new_sk_id,
                outcome="success",
                client_ip=client_ip,
                created_at=now,
            )
            db.add(audit_sk)

        env_label = "Production Live" if is_live else "Sandbox (Test)"
        target_label = (
            "Public Key (Publishable)"
            if key_category == "pk"
            else ("Full Key Pair (Public & Secret)" if key_category == "pair" else "Secret Key")
        )

        # In-app notification
        try:
            from app.core.notifications import create_in_app_notification
            await create_in_app_notification(
                db=db,
                user_id=user.id,
                title=f"{env_label} {target_label} Rotated",
                message=f"Your {env_label.lower()} {target_label.lower()} was regenerated and previous credentials were deactivated.",
                type="security_alert",
                link="/dashboard/api-keys",
                commit=False,
            )
        except Exception as exc:
            logger.warning("Failed to create in-app notification for key rotation: %s", exc)

        await db.commit()

        # Email notification
        try:
            from app.core.config import settings
            from app.core.email import send_email_task
            keys_url = f"{settings.cors_origins[0] if settings.cors_origins else 'http://localhost:5173'}/dashboard/api-keys"
            send_email_task.delay(
                to=user.email,
                subject=f"[Security Alert] {env_label} {target_label} Rotated - Lenis",
                template="api_key_alert",
                context={
                    "name": user.full_name or user.email,
                    "action_title": f"{env_label} {target_label} Rotated",
                    "action_badge": f"{env_label} Key Rotation",
                    "action_type": "rotation",
                    "is_live": is_live,
                    "mode": env_label,
                    "key_type": target_label,
                    "client_ip": client_ip,
                    "date_str": now.strftime("%b %d, %Y at %H:%M UTC"),
                    "keys_url": keys_url,
                },
            )
        except Exception as exc:
            logger.warning("Failed to send email notification for key rotation: %s", exc)

        msg = (
            f"Successfully rotated {key_category.upper()} for {'Live' if is_live else 'Sandbox'} environment."
        )
        return RegeneratedKeysResponse(
            success=True,
            publishable_key=new_pk_plaintext,
            secret_key=new_sk_plaintext,
            key_type=key_category,
            mode="live" if is_live else "sandbox",
            message=msg,
        )

    @staticmethod
    async def regenerate_test_secret_key(
        user_id: uuid.UUID,
        db: AsyncSession,
        client_ip: str | None = None,
        security_code: str | None = None,
        security_method: str | None = None,
    ) -> SecretKeyResponse:
        """Invalidate the current test secret key and issue a new one (compatibility wrapper)."""
        res = await UserService.regenerate_api_keys(
            user_id=user_id,
            key_category="sk",
            mode="sandbox",
            security_code=security_code,
            security_method=security_method,
            client_ip=client_ip,
            db=db,
        )
        return SecretKeyResponse(secret_key=res.secret_key or "")

    @staticmethod
    async def get_api_key_history(
        user_id: uuid.UUID,
        db: AsyncSession,
    ) -> APIKeyHistoryResponse:
        """Fetch full rotation history of API keys for the user's organization."""
        org_result = await db.execute(
            select(Organization).where(Organization.owner_id == user_id)
        )
        org = org_result.scalar_one_or_none()
        if org is None:
            return APIKeyHistoryResponse(keys=[], total=0)

        history_result = await db.execute(
            select(APIKey)
            .where(APIKey.organization_id == org.id)
            .order_by(APIKey.created_at.desc())
        )
        keys = history_result.scalars().all()
        items = [
            APIKeyHistoryItem(
                id=k.id,
                key_type=k.key_type,
                prefix=k.prefix,
                suffix_display=k.suffix_display,
                active=k.active,
                created_at=k.created_at,
                revoked_at=k.revoked_at,
            )
            for k in keys
        ]
        return APIKeyHistoryResponse(keys=items, total=len(items))

    # ------------------------------------------------------------------
    # Live API key generation (Requirements 9.5, 9.6)
    # ------------------------------------------------------------------

    @staticmethod
    async def generate_live_keys(
        user_id: uuid.UUID,
        db: AsyncSession,
        client_ip: str | None = None,
        security_code: str | None = None,
        security_method: str | None = None,
    ) -> SecretKeyResponse:
        """Generate live-mode API keys for a verified developer."""
        # Verify caller is a developer.
        user_result = await db.execute(select(User).where(User.id == user_id))
        user = user_result.scalar_one_or_none()

        if user is None or user.account_type not in ("developer", "merchant", "admin"):
            raise HTTPException(
                status_code=403,
                detail={
                    "detail": "API key management is available to developers and merchants only.",
                    "code": "INSUFFICIENT_PRIVILEGES",
                },
            )

        # Require account status "verified" (Requirement 9.5).
        if user.status != "verified":
            raise HTTPException(
                status_code=403,
                detail={
                    "detail": (
                        "Live-mode API keys require account verification. "
                        "Please submit a verification request."
                    ),
                    "code": "VERIFICATION_REQUIRED",
                },
            )

        # Always verify 2FA / OTP security authorization for live key creation
        await UserService.verify_security_action_auth(
            user=user,
            security_code=security_code,
            security_method=security_method,
            db=db,
        )

        # Locate the user's organization.
        org_result = await db.execute(
            select(Organization).where(Organization.owner_id == user_id)
        )
        org = org_result.scalar_one_or_none()

        if org is None:
            raise HTTPException(
                status_code=500,
                detail={
                    "detail": "Organization not found for user.",
                    "code": "ORGANIZATION_NOT_FOUND",
                },
            )

        # Check whether live-mode keys already exist (Requirement 9.5: generate once).
        existing_result = await db.execute(
            select(APIKey).where(
                APIKey.organization_id == org.id,
                APIKey.key_type.in_(["pk_live", "sk_live"]),
                APIKey.active.is_(True),
            )
        )
        existing_live_keys = existing_result.scalars().all()

        if existing_live_keys:
            raise HTTPException(
                status_code=409,
                detail={
                    "detail": "Live-mode API keys have already been generated.",
                    "code": "LIVE_KEYS_ALREADY_EXIST",
                },
            )

        now = datetime.now(UTC)

        # --- Publishable key (pk_live) -----------------------------------
        pk_prefix = "pk_live_"
        pk_suffix = _generate_alnum_suffix()
        pk_plaintext = pk_prefix + pk_suffix

        pk_record_id = uuid.uuid4()
        pk_record = APIKey(
            id=pk_record_id,
            organization_id=org.id,
            key_type="pk_live",
            prefix=pk_prefix,
            suffix_display=pk_suffix[-4:],
            key_hash=pk_plaintext,
            active=True,
        )
        db.add(pk_record)

        # --- Secret key (sk_live) ----------------------------------------
        sk_prefix = "sk_live_"
        sk_suffix = _generate_alnum_suffix()
        sk_plaintext = sk_prefix + sk_suffix
        sk_record_id = uuid.uuid4()

        sk_record = APIKey(
            id=sk_record_id,
            organization_id=org.id,
            key_type="sk_live",
            prefix=sk_prefix,
            suffix_display=sk_suffix[-4:],
            key_hash=hash_token(sk_plaintext),
            active=True,
        )
        db.add(sk_record)

        await db.flush()

        # Write audit log entry for the live key generation event.
        audit_entry = AuditLog(
            id=uuid.uuid4(),
            event_type="api_key.generate_live",
            actor_id=user_id,
            target_type="api_key",
            target_id=sk_record_id,
            outcome="success",
            client_ip=client_ip,
            created_at=now,
        )
        db.add(audit_entry)

        # In-app notification
        try:
            from app.core.notifications import create_in_app_notification
            await create_in_app_notification(
                db=db,
                user_id=user.id,
                title="Production Live API Keys Generated",
                message="Your production live publishable and secret API keys have been generated successfully.",
                type="security_alert",
                link="/dashboard/api-keys",
                commit=False,
            )
        except Exception as exc:
            logger.warning("Failed to create in-app notification for live key generation: %s", exc)

        await db.commit()

        # Email notification
        try:
            from app.core.config import settings
            from app.core.email import send_email_task
            keys_url = f"{settings.cors_origins[0] if settings.cors_origins else 'http://localhost:5173'}/dashboard/api-keys"
            send_email_task.delay(
                to=user.email,
                subject="[Security Alert] Production Live API Keys Generated - Lenis",
                template="api_key_alert",
                context={
                    "name": user.full_name or user.email,
                    "action_title": "Production Live API Keys Generated",
                    "action_badge": "Live API Keys Generated",
                    "action_type": "generation",
                    "is_live": True,
                    "mode": "Live (Production)",
                    "key_type": "Full Key Pair (pk_live & sk_live)",
                    "client_ip": client_ip,
                    "date_str": now.strftime("%b %d, %Y at %H:%M UTC"),
                    "keys_url": keys_url,
                },
            )
        except Exception as exc:
            logger.warning("Failed to send email notification for live key generation: %s", exc)

        # Return the plaintext sk and pk exactly once (Requirement 9.6).
        return SecretKeyResponse(secret_key=sk_plaintext, publishable_key=pk_plaintext)

    # ------------------------------------------------------------------
    # Live API key generation â€” spec-compliant entry point (Tasks 5.1, 5.2)
    # ------------------------------------------------------------------

    @staticmethod
    async def generate_live_api_keys(
        user: User,
        org: Organization,
        db: AsyncSession,
    ) -> dict[str, str]:
        """Generate live-mode API keys following the spec for tasks 5.1 and 5.2.

        Behaviour
        ---------
        1. Assert ``user.status == "verified"`` â†’ HTTP 403
           ``{"error": "VERIFICATION_REQUIRED"}`` if not.
        2. Query ``APIKey`` for existing ``pk_live`` / ``sk_live`` on the org
           â†’ HTTP 409 ``{"error": "live_keys_already_exist"}`` if found.
        3. Generate ``pk_live_<64-hex-chars>`` and ``sk_live_<64-hex-chars>``.
        4. Store pk_live with ``key_hash = SHA256(pk_live_plaintext)`` and
           ``suffix_display = pk_live_plaintext[-4:]``.
        5. Store sk_live with ``key_hash = SHA256(sk_live_plaintext)`` and
           ``suffix_display = sk_live_plaintext[-4:]``; plaintext is never
           persisted.
        6. Write an ``AuditLog`` entry for the live key generation event.
        7. Return ``{"pk_live": pk_live_plaintext, "sk_live": sk_live_plaintext}``.

        Requirements: 5.1, 5.2, 5.3, 5.4, 5.5
        """
        import hashlib

        # 1. Require verified account status.
        if user.status != "verified":
            raise HTTPException(
                status_code=403,
                detail={"error": "VERIFICATION_REQUIRED"},
            )

        # 2. Prevent duplicate live key generation.
        existing_result = await db.execute(
            select(APIKey).where(
                APIKey.organization_id == org.id,
                APIKey.key_type.in_(["pk_live", "sk_live"]),
                APIKey.active.is_(True),
            )
        )
        if existing_result.scalars().first() is not None:
            raise HTTPException(
                status_code=409,
                detail={"error": "live_keys_already_exist"},
            )

        now = datetime.now(UTC)

        # 3 & 4. Generate and store the live publishable key.
        pk_prefix = "pk_live_"
        pk_plaintext = pk_prefix + secrets.token_hex(32)
        pk_record_id = uuid.uuid4()
        pk_record = APIKey(
            id=pk_record_id,
            organization_id=org.id,
            key_type="pk_live",
            prefix=pk_prefix,
            suffix_display=pk_plaintext[-4:],
            key_hash=hashlib.sha256(pk_plaintext.encode()).hexdigest(),
            active=True,
            created_at=now,
        )
        db.add(pk_record)

        # 3 & 5. Generate and store the live secret key (hash only, never plaintext).
        sk_prefix = "sk_live_"
        sk_plaintext = sk_prefix + secrets.token_hex(32)
        sk_record_id = uuid.uuid4()
        sk_record = APIKey(
            id=sk_record_id,
            organization_id=org.id,
            key_type="sk_live",
            prefix=sk_prefix,
            suffix_display=sk_plaintext[-4:],
            key_hash=hashlib.sha256(sk_plaintext.encode()).hexdigest(),
            active=True,
            created_at=now,
        )
        db.add(sk_record)

        await db.flush()

        # 6. Write audit log entry.
        audit_entry = AuditLog(
            id=uuid.uuid4(),
            event_type="api_key.generate_live",
            actor_id=user.id,
            target_type="APIKey",
            target_id=sk_record_id,
            outcome="success",
            created_at=now,
        )
        db.add(audit_entry)

        await db.commit()

        # 7. Return both plaintexts exactly once.
        return {"pk_live": pk_plaintext, "sk_live": sk_plaintext}

    # ------------------------------------------------------------------
    # Suspension info (new)
    # ------------------------------------------------------------------

    @staticmethod
    async def get_suspension_info(
        user_id: uuid.UUID,
        db: AsyncSession,
    ):
        """Return the suspension reason, message, and pending appeal status.

        This endpoint is intentionally callable even for suspended users (the
        dependency that gates it skips the status check).
        """
        from app.core.models import SuspensionAppeal
        from app.users.schemas import SuspensionInfoResponse
        from sqlalchemy import select

        result = await db.execute(select(User).where(User.id == user_id))
        user: User | None = result.scalar_one_or_none()

        if user is None:
            raise HTTPException(
                status_code=404,
                detail={"detail": "User not found.", "code": "USER_NOT_FOUND"},
            )

        appeal_result = await db.execute(
            select(SuspensionAppeal).where(
                SuspensionAppeal.user_id == user_id,
                SuspensionAppeal.status == "pending",
            )
        )
        has_pending_appeal = appeal_result.scalar_one_or_none() is not None

        return SuspensionInfoResponse(
            suspension_reason=user.suspension_reason,
            suspension_message=user.suspension_message,
            has_pending_appeal=has_pending_appeal,
        )

    # ------------------------------------------------------------------
    # Submit appeal (new)
    # ------------------------------------------------------------------

    @staticmethod
    async def submit_appeal(
        user_id: uuid.UUID,
        message: str,
        db: AsyncSession,
    ):
        """Submit a suspension appeal for the given user.

        Raises 409 if there is already a pending appeal.
        Raises 400 if the user is not currently suspended.
        """
        from app.core.models import SuspensionAppeal
        from app.users.schemas import AppealResponse
        from sqlalchemy import select
        from datetime import UTC, datetime

        result = await db.execute(select(User).where(User.id == user_id))
        user: User | None = result.scalar_one_or_none()

        if user is None:
            raise HTTPException(
                status_code=404,
                detail={"detail": "User not found.", "code": "USER_NOT_FOUND"},
            )

        if user.status != "suspended":
            raise HTTPException(
                status_code=400,
                detail={
                    "detail": "Only suspended accounts can submit an appeal.",
                    "code": "ACCOUNT_NOT_SUSPENDED",
                },
            )

        # Check for existing pending appeal
        existing_result = await db.execute(
            select(SuspensionAppeal).where(
                SuspensionAppeal.user_id == user_id,
                SuspensionAppeal.status == "pending",
            )
        )
        if existing_result.scalar_one_or_none() is not None:
            raise HTTPException(
                status_code=409,
                detail={
                    "detail": "You already have a pending appeal.",
                    "code": "APPEAL_ALREADY_PENDING",
                },
            )

        appeal = SuspensionAppeal(
            user_id=user_id,
            message=message,
            status="pending",
        )
        db.add(appeal)
        await db.commit()
        await db.refresh(appeal)

        return AppealResponse(
            id=appeal.id,
            status=appeal.status,
            message=appeal.message,
            created_at=appeal.created_at,
        )

    # ------------------------------------------------------------------
    # Security: Password Change & 2FA Management
    # ------------------------------------------------------------------

    @staticmethod
    async def change_password(
        user_id: uuid.UUID,
        payload: ChangePasswordRequest,
        db: AsyncSession,
        client_ip: str | None = None,
        user_agent: str | None = None,
    ) -> OkResponse:
        """Verify current password, validate new password complexity, and update password hash."""
        from app.core.security import hash_password, verify_password
        from app.core.tasks import send_password_changed_email

        result = await db.execute(select(User).where(User.id == user_id))
        user: User | None = result.scalar_one_or_none()

        if user is None:
            raise HTTPException(
                status_code=404,
                detail={"detail": "User not found.", "code": "USER_NOT_FOUND"},
            )

        # Verify current password
        if not verify_password(payload.current_password, user.password_hash):
            raise HTTPException(
                status_code=400,
                detail={"detail": "Incorrect current password.", "code": "INVALID_CURRENT_PASSWORD"},
            )

        # Validate new password strength
        new_pw = payload.new_password
        if len(new_pw) < 8:
            raise HTTPException(
                status_code=400,
                detail={"detail": "New password must be at least 8 characters long.", "code": "PASSWORD_TOO_SHORT"},
            )
        if not any(c.isupper() for c in new_pw):
            raise HTTPException(
                status_code=400,
                detail={"detail": "New password must contain at least one uppercase letter.", "code": "PASSWORD_NO_UPPERCASE"},
            )
        if not any(c.islower() for c in new_pw):
            raise HTTPException(
                status_code=400,
                detail={"detail": "New password must contain at least one lowercase letter.", "code": "PASSWORD_NO_LOWERCASE"},
            )
        if not any(c.isdigit() for c in new_pw):
            raise HTTPException(
                status_code=400,
                detail={"detail": "New password must contain at least one digit.", "code": "PASSWORD_NO_DIGIT"},
            )

        if verify_password(new_pw, user.password_hash):
            raise HTTPException(
                status_code=400,
                detail={"detail": "New password must be different from current password.", "code": "PASSWORD_NOT_CHANGED"},
            )

        # Hash and update
        user.password_hash = hash_password(new_pw)
        user.updated_at = datetime.now(UTC)

        # Audit log
        audit = AuditLog(
            user_id=user.id,
            action="USER_PASSWORD_CHANGED",
            resource_type="user",
            resource_id=str(user.id),
            details={"email": user.email, "ip": client_ip},
        )
        db.add(audit)
        await db.commit()

        # Trigger asynchronous Celery security notification email
        try:
            send_password_changed_email.delay(
                user_id=str(user.id),
                client_ip=client_ip,
                user_agent=user_agent,
            )
        except Exception:
            pass

        return OkResponse(message="Password changed successfully.", code="PASSWORD_CHANGED")

    @staticmethod
    async def setup_2fa(
        user_id: uuid.UUID,
        db: AsyncSession,
    ) -> TwoFactorSetupResponse:
        """Generate a fresh TOTP secret key and QR code data URL for 2FA setup."""
        from app.core.totp import generate_totp_qr_data_url, generate_totp_secret, generate_totp_uri
        from app.users.schemas import TwoFactorSetupResponse

        result = await db.execute(select(User).where(User.id == user_id))
        user: User | None = result.scalar_one_or_none()

        if user is None:
            raise HTTPException(
                status_code=404,
                detail={"detail": "User not found.", "code": "USER_NOT_FOUND"},
            )

        secret = generate_totp_secret()
        otpauth_url = generate_totp_uri(secret, user.email, issuer="Lenis")
        qr_code_data_url = generate_totp_qr_data_url(otpauth_url)

        return TwoFactorSetupResponse(
            secret=secret,
            otpauth_url=otpauth_url,
            qr_code_data_url=qr_code_data_url,
        )

    @staticmethod
    async def enable_2fa(
        user_id: uuid.UUID,
        payload: TwoFactorEnableRequest,
        db: AsyncSession,
    ) -> OkResponse:
        """Verify 6-digit TOTP code and enable 2FA for the account."""
        from app.core.totp import verify_totp_code

        result = await db.execute(select(User).where(User.id == user_id))
        user: User | None = result.scalar_one_or_none()

        if user is None:
            raise HTTPException(
                status_code=404,
                detail={"detail": "User not found.", "code": "USER_NOT_FOUND"},
            )

        if not verify_totp_code(payload.secret, payload.code):
            raise HTTPException(
                status_code=400,
                detail={"detail": "Invalid authentication code. Please check the code and try again.", "code": "INVALID_2FA_CODE"},
            )

        user.two_factor_enabled = True
        user.two_factor_secret = payload.secret.strip().upper()
        user.updated_at = datetime.now(UTC)

        audit = AuditLog(
            user_id=user.id,
            action="USER_2FA_ENABLED",
            resource_type="user",
            resource_id=str(user.id),
            details={"email": user.email},
        )
        db.add(audit)

        try:
            from app.core.notifications import create_in_app_notification
            await create_in_app_notification(
                db,
                user.id,
                title="Two-Factor Authentication Enabled",
                message="Two-Factor Authentication (TOTP) was successfully enabled on your account.",
                type="security_alert",
                link="/dashboard/security",
                commit=False,
            )
            from app.core.tasks import send_two_factor_alert_email
            send_two_factor_alert_email.delay(
                user_id=str(user.id),
                action="enabled",
            )
        except Exception as notif_err:
            logger.warning("Could not dispatch 2FA enable notification: %s", notif_err)

        await db.commit()

        return OkResponse(message="Two-Factor Authentication enabled successfully.", code="2FA_ENABLED")

    @staticmethod
    async def disable_2fa(
        user_id: uuid.UUID,
        payload: TwoFactorDisableRequest,
        db: AsyncSession,
    ) -> OkResponse:
        """Verify user password and disable 2FA for the account."""
        from app.core.security import verify_password
        from app.core.totp import verify_totp_code

        result = await db.execute(select(User).where(User.id == user_id))
        user: User | None = result.scalar_one_or_none()

        if user is None:
            raise HTTPException(
                status_code=404,
                detail={"detail": "User not found.", "code": "USER_NOT_FOUND"},
            )

        if not verify_password(payload.password, user.password_hash):
            raise HTTPException(
                status_code=400,
                detail={"detail": "Incorrect password.", "code": "INVALID_PASSWORD"},
            )

        if payload.code and user.two_factor_secret:
            if not verify_totp_code(user.two_factor_secret, payload.code):
                raise HTTPException(
                    status_code=400,
                    detail={"detail": "Invalid authentication code.", "code": "INVALID_2FA_CODE"},
                )

        user.two_factor_enabled = False
        user.two_factor_secret = None
        user.updated_at = datetime.now(UTC)

        audit = AuditLog(
            user_id=user.id,
            action="USER_2FA_DISABLED",
            resource_type="user",
            resource_id=str(user.id),
            details={"email": user.email},
        )
        db.add(audit)

        try:
            from app.core.notifications import create_in_app_notification
            await create_in_app_notification(
                db,
                user.id,
                title="Two-Factor Authentication Disabled",
                message="Two-Factor Authentication was disabled for your account. Please re-enable it to secure your funds.",
                type="security_alert",
                link="/dashboard/security",
                commit=False,
            )
            from app.core.tasks import send_two_factor_alert_email
            send_two_factor_alert_email.delay(
                user_id=str(user.id),
                action="disabled",
            )
        except Exception as notif_err:
            logger.warning("Could not dispatch 2FA disable notification: %s", notif_err)

        await db.commit()

        return OkResponse(message="Two-Factor Authentication disabled successfully.", code="2FA_DISABLED")

    @staticmethod
    async def get_2fa_status(
        user_id: uuid.UUID,
        db: AsyncSession,
    ) -> TwoFactorStatusResponse:
        """Return whether 2FA is currently enabled for the user."""
        from app.users.schemas import TwoFactorStatusResponse

        result = await db.execute(select(User).where(User.id == user_id))
        user: User | None = result.scalar_one_or_none()

        if user is None:
            raise HTTPException(
                status_code=404,
                detail={"detail": "User not found.", "code": "USER_NOT_FOUND"},
            )

        return TwoFactorStatusResponse(two_factor_enabled=bool(user.two_factor_enabled))

    # ------------------------------------------------------------------
    # Phone Verification via Termii SMS (Requirement)
    # ------------------------------------------------------------------

    @staticmethod
    async def send_phone_otp(
        user_id: uuid.UUID,
        phone_number: str,
        db: AsyncSession,
    ) -> dict[str, Any]:
        """Send a 6-digit phone verification OTP via Termii API."""
        from datetime import timedelta
        from app.core.sms import clean_phone_number, generate_numeric_otp, get_termii_client

        cleaned_phone = clean_phone_number(phone_number)
        if len(cleaned_phone) < 7:
            raise HTTPException(
                status_code=400,
                detail={"detail": "Invalid phone number format.", "code": "INVALID_PHONE_NUMBER"},
            )

        result = await db.execute(select(User).where(User.id == user_id))
        user: User | None = result.scalar_one_or_none()

        if user is None:
            raise HTTPException(
                status_code=404,
                detail={"detail": "User not found.", "code": "USER_NOT_FOUND"},
            )

        otp_code = generate_numeric_otp(6)
        user.phone_number = phone_number.strip()
        user.phone_otp_hash = hash_token(otp_code)
        user.phone_otp_expires_at = datetime.now(UTC) + timedelta(minutes=10)
        user.updated_at = datetime.now(UTC)

        termii = get_termii_client()
        sms_res = await termii.send_phone_otp(cleaned_phone, otp_code)

        await db.commit()

        return {
            "message": "Verification OTP sent successfully via SMS.",
            "phone_number": cleaned_phone,
            "sandbox": sms_res.get("sandbox", False),
        }

    @staticmethod
    async def verify_phone_otp(
        user_id: uuid.UUID,
        phone_number: str,
        otp: str,
        db: AsyncSession,
    ) -> dict[str, Any]:
        """Verify the 6-digit OTP code and mark phone number as verified."""
        result = await db.execute(select(User).where(User.id == user_id))
        user: User | None = result.scalar_one_or_none()

        if user is None:
            raise HTTPException(
                status_code=404,
                detail={"detail": "User not found.", "code": "USER_NOT_FOUND"},
            )

        if not user.phone_otp_hash or not user.phone_otp_expires_at:
            raise HTTPException(
                status_code=400,
                detail={"detail": "No pending verification code found. Please request a new OTP.", "code": "NO_PENDING_OTP"},
            )

        if datetime.now(UTC) > _to_utc(user.phone_otp_expires_at):
            raise HTTPException(
                status_code=400,
                detail={"detail": "Verification code has expired. Please request a new OTP.", "code": "OTP_EXPIRED"},
            )

        if user.phone_otp_hash != hash_token(otp.strip()):
            raise HTTPException(
                status_code=400,
                detail={"detail": "Incorrect verification code. Please check and try again.", "code": "INVALID_OTP"},
            )

        user.phone_verified = True
        user.phone_number = phone_number.strip()
        user.phone_otp_hash = None
        user.phone_otp_expires_at = None
        user.updated_at = datetime.now(UTC)

        # Sync with MerchantProfile if one exists
        mp_res = await db.execute(select(MerchantProfile).where(MerchantProfile.user_id == user.id))
        mp = mp_res.scalar_one_or_none()
        if mp:
            mp.phone_number = user.phone_number
            mp.updated_at = datetime.now(UTC)

        audit = AuditLog(
            user_id=user.id,
            action="USER_PHONE_VERIFIED",
            resource_type="user",
            resource_id=str(user.id),
            details={"phone_number": user.phone_number},
        )
        db.add(audit)

        await db.commit()

        return {
            "message": "Phone number verified successfully.",
            "phone_verified": True,
            "phone_number": user.phone_number,
        }

    # ------------------------------------------------------------------
    # Notification Preferences
    # ------------------------------------------------------------------

    @staticmethod
    async def get_notification_preferences(
        user_id: uuid.UUID,
        db: AsyncSession,
    ) -> NotificationPreferences:
        """Return the user's notification preferences."""
        import json
        from app.users.schemas import NotificationPreferences

        result = await db.execute(select(User).where(User.id == user_id))
        user: User | None = result.scalar_one_or_none()

        if user is None:
            raise HTTPException(
                status_code=404,
                detail={"detail": "User not found.", "code": "USER_NOT_FOUND"},
            )

        if not user.notification_preferences:
            return NotificationPreferences()

        try:
            data = json.loads(user.notification_preferences)
            return NotificationPreferences(**data)
        except Exception:
            return NotificationPreferences()

    @staticmethod
    async def update_notification_preferences(
        user_id: uuid.UUID,
        prefs: NotificationPreferences,
        db: AsyncSession,
    ) -> NotificationPreferences:
        """Save updated notification preferences."""
        result = await db.execute(select(User).where(User.id == user_id))
        user: User | None = result.scalar_one_or_none()

        if user is None:
            raise HTTPException(
                status_code=404,
                detail={"detail": "User not found.", "code": "USER_NOT_FOUND"},
            )

        user.notification_preferences = prefs.model_dump_json()
        user.updated_at = datetime.now(UTC)

        await db.commit()
        return prefs

    # ------------------------------------------------------------------
    # Subscription Tiers & Plans
    # ------------------------------------------------------------------

    @staticmethod
    async def get_subscription_overview(
        user_id: uuid.UUID,
        db: AsyncSession,
    ) -> SubscriptionOverviewResponse:
        """Return current subscription tier, usage count, and tier features."""
        from app.users.schemas import SubscriptionOverviewResponse

        result = await db.execute(select(User).where(User.id == user_id))
        user: User | None = result.scalar_one_or_none()

        if user is None:
            raise HTTPException(
                status_code=404,
                detail={"detail": "User not found.", "code": "USER_NOT_FOUND"},
            )

        tier = (user.subscription_tier or "free").lower()
        tier_names = {
            "free": "Starter Free",
            "growth": "Growth Pro",
            "scale": "Scale Business",
            "enterprise": "Enterprise Custom",
        }
        caps = {
            "free": 50,
            "growth": 1000,
            "scale": 10000,
            "enterprise": 1000000,
        }
        features_map = {
            "free": [
                "Up to 50 transactions / month",
                "Standard crypto payment links",
                "Basic invoicing & checkout",
                "2 EVM chains (Base, Polygon)",
            ],
            "growth": [
                "Up to 1,000 transactions / month",
                "All 5 EVM chains (Ethereum, Base, Polygon, Arbitrum, BSC)",
                "Custom store branding & logos",
                "Real-time Webhook event dispatching",
                "CSV financial reports & exports",
                "Customer / Payer directory & analytics",
            ],
            "scale": [
                "Up to 10,000 transactions / month",
                "Unlimited payment links & invoices",
                "Multi-wallet settlement routing",
                "Automated customer payment reminders",
                "Priority Termii SMS payment alerts",
                "Dedicated email support",
            ],
            "enterprise": [
                "Unlimited monthly volume & transactions",
                "Dedicated RPC nodes & SLA guarantee",
                "Custom checkout domain (e.g. pay.mybrand.com)",
                "24/7 dedicated integration engineer",
            ],
        }

        return SubscriptionOverviewResponse(
            tier=tier,
            tier_name=tier_names.get(tier, "Starter Free"),
            monthly_tx_count=user.monthly_tx_count or 0,
            monthly_tx_cap=caps.get(tier, 50),
            period=user.subscription_period,
            expires_at=user.subscription_expires_at,
            grace_until=user.subscription_grace_until,
            features=features_map.get(tier, features_map["free"]),
            is_active=True,
        )

    @staticmethod
    async def upgrade_subscription(
        user_id: uuid.UUID,
        tier: str,
        period: str,
        db: AsyncSession,
    ) -> SubscriptionOverviewResponse:
        """Upgrade merchant subscription tier."""
        from datetime import timedelta

        result = await db.execute(select(User).where(User.id == user_id))
        user: User | None = result.scalar_one_or_none()

        if user is None:
            raise HTTPException(
                status_code=404,
                detail={"detail": "User not found.", "code": "USER_NOT_FOUND"},
            )

        valid_tiers = ["free", "growth", "scale", "enterprise"]
        tier_clean = tier.lower()
        if tier_clean not in valid_tiers:
            raise HTTPException(
                status_code=400,
                detail={"detail": "Invalid subscription tier.", "code": "INVALID_TIER"},
            )

        days = 365 if period == "yearly" else 30
        user.subscription_tier = tier_clean
        user.subscription_period = period
        user.subscription_expires_at = datetime.now(UTC) + timedelta(days=days)
        user.updated_at = datetime.now(UTC)

        audit = AuditLog(
            user_id=user.id,
            action="SUBSCRIPTION_UPGRADED",
            resource_type="subscription",
            resource_id=tier_clean,
            details={"tier": tier_clean, "period": period},
        )
        db.add(audit)

        try:
            from app.core.notifications import create_in_app_notification
            await create_in_app_notification(
                db,
                user.id,
                title=f"Plan Upgraded to {tier_clean.capitalize()}!",
                message=f"Your subscription has been successfully upgraded to the {tier_clean.capitalize()} plan ({period}).",
                type="plan_upgrade",
                link="/dashboard/settings",
                commit=False,
            )
        except Exception:
            pass

        await db.commit()
        return await UserService.get_subscription_overview(user_id=user_id, db=db)

    # ------------------------------------------------------------------
    # Step-Up Security Challenge & 2FA/OTP Protection
    # ------------------------------------------------------------------

    @staticmethod
    async def verify_security_action_auth(
        user: User,
        security_code: str | None,
        security_method: str | None,
        db: AsyncSession,
    ) -> None:
        """Verify 2FA TOTP or Email/Phone OTP authorization before sensitive operations."""
        # 1. If user has 2FA enabled, strictly require valid TOTP code
        if user.two_factor_enabled:
            from app.core.totp import verify_totp_code
            if not security_code:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "detail": "Security verification required. Please enter your 6-digit Authenticator code.",
                        "code": "SECURITY_2FA_REQUIRED",
                    },
                )
            if not user.two_factor_secret or not verify_totp_code(user.two_factor_secret, security_code.strip()):
                raise HTTPException(
                    status_code=400,
                    detail={
                        "detail": "Invalid 2FA Authenticator code. Please check your app and try again.",
                        "code": "INVALID_2FA_CODE",
                    },
                )
        else:
            # 2. If no 2FA enabled, require OTP (Email or Phone)
            if not security_code:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "detail": "Security verification required. Please request and enter a verification code.",
                        "code": "SECURITY_CODE_REQUIRED",
                    },
                )
            if not user.security_otp_hash or not user.security_otp_expires_at:
                raise HTTPException(
                    status_code=400,
                    detail={
                        "detail": "No active verification code found. Please request a new security code.",
                        "code": "NO_ACTIVE_OTP",
                    },
                )
            if datetime.now(UTC) > _to_utc(user.security_otp_expires_at):
                raise HTTPException(
                    status_code=400,
                    detail={
                        "detail": "Security verification code has expired. Please request a new code.",
                        "code": "OTP_EXPIRED",
                    },
                )
            if user.security_otp_hash != hash_token(security_code.strip()):
                raise HTTPException(
                    status_code=400,
                    detail={
                        "detail": "Incorrect verification code. Please check and try again.",
                        "code": "INVALID_OTP",
                    },
                )
            # One-time use: invalidate OTP
            user.security_otp_hash = None
            user.security_otp_expires_at = None

    @staticmethod
    async def get_security_challenge_status(
        user_id: uuid.UUID,
        client_ip: str | None,
        user_agent: str | None,
        db: AsyncSession,
    ) -> SecurityChallengeStatusResponse:
        """Return the current step-up security state and available verification methods."""
        result = await db.execute(select(User).where(User.id == user_id))
        user: User | None = result.scalar_one_or_none()
        if user is None:
            raise HTTPException(status_code=404, detail={"detail": "User not found.", "code": "USER_NOT_FOUND"})

        # Check if unlocked within 14 days and matching device
        is_unlocked = False
        if user.security_unlocked_until and _to_utc(user.security_unlocked_until) > datetime.now(UTC):
            # Check if IP or user agent changed
            ip_match = (
                user.security_unlocked_ip is None
                or client_ip is None
                or user.security_unlocked_ip == client_ip
            )
            ua_match = (
                user.security_unlocked_ua is None
                or user_agent is None
                or user.security_unlocked_ua == user_agent[:255]
            )
            if ip_match and ua_match:
                is_unlocked = True

        available_methods: list[str] = []
        if user.two_factor_enabled:
            available_methods.append("2fa")
        if user.phone_verified and user.phone_number:
            available_methods.append("phone")
        available_methods.append("email")

        default_method = (
            "2fa"
            if user.two_factor_enabled
            else ("phone" if (user.phone_verified and user.phone_number) else "email")
        )

        return SecurityChallengeStatusResponse(
            two_factor_enabled=bool(user.two_factor_enabled),
            phone_verified=bool(user.phone_verified),
            masked_phone=mask_phone(user.phone_number),
            masked_email=mask_email(user.email),
            is_unlocked=is_unlocked,
            unlocked_until=user.security_unlocked_until,
            available_methods=available_methods,
            default_method=default_method,
        )

    @staticmethod
    async def request_security_otp(
        user_id: uuid.UUID,
        channel: str,
        db: AsyncSession,
    ) -> dict[str, Any]:
        """Generate and send a 6-digit one-time passcode to email or verified phone."""
        result = await db.execute(select(User).where(User.id == user_id))
        user: User | None = result.scalar_one_or_none()
        if user is None:
            raise HTTPException(status_code=404, detail={"detail": "User not found.", "code": "USER_NOT_FOUND"})

        from app.core.sms import generate_numeric_otp
        otp_code = generate_numeric_otp(6)
        user.security_otp_hash = hash_token(otp_code)
        user.security_otp_expires_at = datetime.now(UTC) + timedelta(minutes=10)
        user.security_otp_channel = channel
        user.updated_at = datetime.now(UTC)
        await db.flush()

        if channel == "phone" and user.phone_verified and user.phone_number:
            from app.core.sms import clean_phone_number, get_termii_client
            termii = get_termii_client()
            cleaned_phone = clean_phone_number(user.phone_number)
            try:
                await termii.send_phone_otp(cleaned_phone, otp_code)
            except Exception as e:
                logger.warning("SMS security OTP dispatch failed: %s", e)
            logger.info("[SECURITY_OTP] SMS code generated for %s: %s", user.phone_number, otp_code)
            return {
                "success": True,
                "message": f"Verification code sent via SMS to {mask_phone(user.phone_number)}.",
            }
        else:
            # Fallback or chosen method: email
            from app.core.email import send_email_task
            try:
                send_email_task.delay(
                    to=user.email,
                    subject="Your Lenis Security Verification Code",
                    template="security_otp",
                    context={
                        "name": user.full_name,
                        "otp": otp_code,
                        "action": "API Keys & Security Credentials",
                    },
                )
            except Exception as e:
                logger.warning("Email security OTP task dispatch failed: %s", e)
            logger.info("[SECURITY_OTP] Email verification code generated for %s: %s", user.email, otp_code)
            return {
                "success": True,
                "message": f"Verification code sent to {mask_email(user.email)}.",
            }

    @staticmethod
    async def verify_security_challenge(
        user_id: uuid.UUID,
        code: str,
        method: str,
        remember_device: bool,
        client_ip: str | None,
        user_agent: str | None,
        db: AsyncSession,
    ) -> VerifySecurityChallengeResponse:
        """Validate 2FA TOTP or Email/Phone OTP and unlock security access."""
        result = await db.execute(select(User).where(User.id == user_id))
        user: User | None = result.scalar_one_or_none()
        if user is None:
            raise HTTPException(status_code=404, detail={"detail": "User not found.", "code": "USER_NOT_FOUND"})

        if method == "2fa":
            from app.core.totp import verify_totp_code
            if not user.two_factor_enabled or not user.two_factor_secret:
                raise HTTPException(
                    status_code=400,
                    detail={"detail": "2FA is not enabled on this account.", "code": "2FA_NOT_ENABLED"},
                )
            if not verify_totp_code(user.two_factor_secret, code.strip()):
                raise HTTPException(
                    status_code=400,
                    detail={"detail": "Invalid 2FA code. Please check your authenticator app.", "code": "INVALID_2FA_CODE"},
                )
        else:
            # Email or Phone OTP verification
            if not user.security_otp_hash or not user.security_otp_expires_at:
                raise HTTPException(
                    status_code=400,
                    detail={"detail": "No active verification code found. Please request a new code.", "code": "NO_PENDING_OTP"},
                )
            if datetime.now(UTC) > _to_utc(user.security_otp_expires_at):
                raise HTTPException(
                    status_code=400,
                    detail={"detail": "Verification code has expired. Please request a new code.", "code": "OTP_EXPIRED"},
                )
            if user.security_otp_hash != hash_token(code.strip()):
                raise HTTPException(
                    status_code=400,
                    detail={"detail": "Incorrect verification code. Please try again.", "code": "INVALID_OTP"},
                )
            user.security_otp_hash = None
            user.security_otp_expires_at = None

        # Set unlock session window: 14 days if remember_device else 2 hours
        unlock_duration = timedelta(days=14) if remember_device else timedelta(hours=2)
        user.security_unlocked_until = datetime.now(UTC) + unlock_duration
        user.security_unlocked_ip = client_ip
        user.security_unlocked_ua = user_agent[:255] if user_agent else None
        user.updated_at = datetime.now(UTC)
        await db.commit()

        return VerifySecurityChallengeResponse(
            verified=True,
            unlocked_until=user.security_unlocked_until,
            message="Security verification confirmed. Access granted.",
        )


