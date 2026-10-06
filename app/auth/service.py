"""
Authentication service for the Lenis platform.

``AuthService`` contains the business logic for user registration and
subsequent auth operations (login, token refresh, logout, etc.).

Requirements addressed by this module: 1.1 – 1.8, 1.9 – 1.12
"""
from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import HTTPException
from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


def _utcnow() -> datetime:
    """Return the current UTC time as a naive datetime.

    SQLite strips timezone info on read-back, so all comparisons against
    DB datetime columns must use naive UTC to avoid TypeError.
    New values written to the DB still use datetime.now(UTC) which
    SQLAlchemy stores correctly regardless of dialect.
    """
    return datetime.utcnow()  # noqa: DTZ003

from app.auth.schemas import (
    LoginPayload,
    OkResponse,
    RegistrationPayload,
    TokenPairResponse,
    UserCreatedResponse,
    VerifyEmailResponse,
)
from app.core.email import send_email_task
from app.core.config import settings
from app.core.models import AuditLog, EmailToken, Organization, RefreshToken, User
from app.core.rate_limit import (
    is_login_blocked,
    record_login_failure,
    reset_login_counter,
    set_login_block,
)
from app.core.security import generate_token, hash_password, hash_token, verify_password
from app.core.tokens import create_access_token

# ---------------------------------------------------------------------------
# Validation constants
# ---------------------------------------------------------------------------

_EMAIL_PATTERN = re.compile(
    r"^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$"
)

_ALLOWED_ACCOUNT_TYPES = {"merchant", "developer"}

# ---------------------------------------------------------------------------
# AuthService
# ---------------------------------------------------------------------------


class AuthService:
    """Stateless service that holds all auth business logic.

    Every public method accepts an ``AsyncSession`` as its first argument so
    that all database operations participate in the same unit of work managed
    by the FastAPI dependency (``get_db()``).
    """

    # ------------------------------------------------------------------
    # Registration (Requirements 1.1 – 1.8)
    # ------------------------------------------------------------------

    @staticmethod
    async def register(
        payload: RegistrationPayload,
        db: AsyncSession,
    ) -> UserCreatedResponse:
        """Create a new merchant or developer account.

        Validation rules
        ----------------
        - Email must match ``^[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}$``
        - Password must be >= 8 chars, contain at least one uppercase letter,
          one lowercase letter, and one digit (Requirement 1.3, 1.4)
        - full_name must be 2 – 100 characters (Requirement 1.1)
        - account_type must be "merchant" or "developer" (Requirement 1.6)

        Raises
        ------
        HTTPException(400)
            Any validation rule is violated.
        HTTPException(409)
            The submitted email address is already registered.
        """
        # --- Input validation -----------------------------------------

        AuthService._validate_email(payload.email)
        AuthService._validate_password(payload.password)
        AuthService._validate_full_name(payload.full_name)
        AuthService._validate_account_type(payload.account_type)

        # --- Duplicate-email check (Requirement 1.2) ------------------

        result = await db.execute(
            select(User).where(User.email == payload.email)
        )
        existing = result.scalar_one_or_none()
        if existing is not None:
            raise HTTPException(
                status_code=409,
                detail={
                    "detail": "Email already registered.",
                    "code": "EMAIL_ALREADY_REGISTERED",
                },
            )

        # --- Create User (Requirements 1.1, 1.7) ----------------------

        hashed_pw = hash_password(payload.password)
        user = User(
            email=payload.email,
            password_hash=hashed_pw,
            full_name=payload.full_name,
            account_type=payload.account_type,
            status="unverified",
            email_verified=False,
        )
        db.add(user)
        # Flush to obtain the server-generated user.id before creating
        # dependent records.
        await db.flush()

        # --- Auto-create Organisation (design requirement) -----------

        org = Organization(
            owner_id=user.id,
            name=f"{user.full_name}'s Organization",
        )
        db.add(org)

        # --- Email verification token (Requirement 1.8) --------------

        plaintext_token = generate_token()
        token_hash = hash_token(plaintext_token)
        email_token = EmailToken(
            user_id=user.id,
            token_hash=token_hash,
            token_type="email_verification",
            expires_at=datetime.now(UTC) + timedelta(hours=24),
            used=False,
        )
        db.add(email_token)

        # Flush remaining inserts; the caller's get_db() will commit.
        await db.flush()

        # --- Enqueue verification email (Requirement 1.8) ------------

        verification_url = (
            f"{settings.frontend_origin}/verify-email?token={plaintext_token}"
        )
        send_email_task.delay(
            to=payload.email,
            subject="Verify your email",
            template="email_verification",
            context={
                "token": plaintext_token,
                "name": user.full_name,
                "verification_url": verification_url,
            },
        )

        return UserCreatedResponse(user_id=user.id, email=user.email)

    # ------------------------------------------------------------------
    # Email verification (Requirements 1.9, 1.10)
    # ------------------------------------------------------------------

    @staticmethod
    async def verify_email(
        token: str,
        db: AsyncSession,
    ) -> VerifyEmailResponse:
        """Verify a user's email address using a confirmation token.

        For developer accounts, test-mode API keys are generated automatically
        after the email is verified (Requirements 9.1, 9.2).  The plaintext
        secret key is included in the response exactly once and never returned
        again.

        Raises
        ------
        HTTPException(400)
            Token not found, already used, or expired.
        """
        from app.users.service import UserService

        token_hash = hash_token(token)

        result = await db.execute(
            select(EmailToken).where(
                EmailToken.token_hash == token_hash,
                EmailToken.token_type == "email_verification",
                EmailToken.used.is_(False),
            )
        )
        email_token = result.scalar_one_or_none()

        if email_token is None:
            raise HTTPException(
                status_code=400,
                detail={
                    "detail": "Token not found or already used.",
                    "code": "TOKEN_INVALID",
                },
            )

        if email_token.expires_at <= _utcnow():
            raise HTTPException(
                status_code=400,
                detail={
                    "detail": "Token has expired.",
                    "code": "TOKEN_EXPIRED",
                },
            )

        # Mark token as used
        email_token.used = True

        # Fetch and update the associated user
        user_result = await db.execute(
            select(User).where(User.id == email_token.user_id)
        )
        user = user_result.scalar_one()
        user.email_verified = True
        user.status = "active"

        await db.flush()

        # Generate test-mode API keys for developer accounts (Requirements 9.1, 9.2)
        secret_key: str | None = None
        if user.account_type == "developer":
            key_response = await UserService._generate_test_keys(
                user_id=user.id,
                db=db,
            )
            secret_key = key_response.secret_key

        return VerifyEmailResponse(
            message="Email verified successfully.",
            secret_key=secret_key,
        )

    # ------------------------------------------------------------------
    # Resend verification (Requirements 1.11, 1.12)
    # ------------------------------------------------------------------

    @staticmethod
    async def resend_verification(
        email: str,
        db: AsyncSession,
    ) -> OkResponse:
        """Resend the email verification link.

        Always returns 200 so callers cannot enumerate registered addresses.

        Raises
        ------
        HTTPException(400)
            Email is already verified (Requirement 1.12).
        """
        _RESEND_OK = OkResponse(
            message=(
                "If that email is registered and unverified, "
                "a new verification email has been sent."
            )
        )

        # Look up the user
        result = await db.execute(
            select(User).where(User.email == email)
        )
        user = result.scalar_one_or_none()

        # Don't reveal whether the email exists (Requirement 1.11 privacy)
        if user is None:
            return _RESEND_OK

        # Email already verified — explicit 400 (Requirement 1.12)
        if user.email_verified:
            raise HTTPException(
                status_code=400,
                detail={
                    "detail": "Email is already verified.",
                    "code": "EMAIL_ALREADY_VERIFIED",
                },
            )

        # Invalidate all existing unexpired tokens for this user
        now = _utcnow()
        tokens_result = await db.execute(
            select(EmailToken).where(
                EmailToken.user_id == user.id,
                EmailToken.token_type == "email_verification",
                EmailToken.used.is_(False),
                EmailToken.expires_at > now,
            )
        )
        for old_token in tokens_result.scalars().all():
            old_token.used = True

        # Generate and store new token
        plaintext_token = generate_token()
        new_token_hash = hash_token(plaintext_token)
        new_email_token = EmailToken(
            user_id=user.id,
            token_hash=new_token_hash,
            token_type="email_verification",
            expires_at=now + timedelta(hours=24),
            used=False,
        )
        db.add(new_email_token)
        await db.flush()

        # Enqueue verification email
        verification_url = (
            f"{settings.frontend_origin}/verify-email?token={plaintext_token}"
        )
        send_email_task.delay(
            to=email,
            subject="Verify your email",
            template="email_verification",
            context={
                "token": plaintext_token,
                "name": user.full_name,
                "verification_url": verification_url,
            },
        )

        return _RESEND_OK

    # ------------------------------------------------------------------
    # Password Reset Request (Requirements 3.1, 3.2)
    # ------------------------------------------------------------------

    @staticmethod
    async def request_password_reset(
        email: str,
        db: AsyncSession,
    ) -> OkResponse:
        """Request a password reset email.

        Always returns 200 to prevent email enumeration (Requirement 3.2).

        Flow
        ----
        1. Look up user by email — return generic 200 if not found (no detail).
        2. If user exists but email is not verified, return generic 200 silently
           (do not send a reset email; the account is not fully active).
        3. Generate a 256-bit opaque token, store its SHA-256 hash in
           ``EmailToken`` with ``token_type="password_reset"`` and
           ``expires_at = now + 30 min`` (Requirement 3.1).
        4. Enqueue ``send_email_task`` with the plaintext token.
        5. Return 200.
        """
        _OK = OkResponse(
            message=(
                "If that email is registered and verified, "
                "a password reset email has been sent."
            )
        )

        # 1. Look up user — never reveal whether the address exists
        result = await db.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()

        if user is None:
            return _OK

        # 2. Unverified account — silently skip sending a reset email
        if not user.email_verified:
            return _OK

        # 3. Generate token and store its hash
        plaintext_token = generate_token()
        token_hash = hash_token(plaintext_token)
        now = datetime.now(UTC)
        email_token = EmailToken(
            user_id=user.id,
            token_hash=token_hash,
            token_type="password_reset",
            expires_at=now + timedelta(minutes=30),
            used=False,
        )
        db.add(email_token)
        await db.flush()

        # 4. Enqueue password reset email
        send_email_task.delay(
            to=email,
            subject="Reset your password",
            template="password_reset",
            context={
                "token": plaintext_token,
                "name": user.full_name,
            },
        )

        return _OK

    # ------------------------------------------------------------------
    # Password Reset Confirmation (Requirements 3.3 – 3.6)
    # ------------------------------------------------------------------

    @staticmethod
    async def reset_password(
        token: str,
        new_password: str,
        db: AsyncSession,
    ) -> OkResponse:
        """Confirm a password reset using a time-limited reset token.

        Flow
        ----
        1. Hash the submitted token and look up the matching ``EmailToken``
           record with ``token_type="password_reset"``.
        2. Distinguish between expired, already-used, and not-found states
           to return specific error codes (Requirements 3.4, 3.5, 3.6).
        3. Validate new password complexity: length 8–128, uppercase,
           lowercase, digit, and special character (Requirement 3.3).
        4. Update ``user.password_hash``, mark the token ``used=True``.
        5. Revoke all active ``RefreshToken`` records for the user so that
           every existing session is invalidated (Requirement 3.3).
        6. Return 200.

        Raises
        ------
        HTTPException(400)
            TOKEN_EXPIRED — the token's ``expires_at`` is in the past.
            TOKEN_ALREADY_USED — the token has ``used=True``.
            TOKEN_INVALID — no matching token record exists.
            INVALID_PASSWORD — new password fails complexity rules.
        """
        token_hash = hash_token(token)
        now = _utcnow()

        # 1. Look up the token record (all states, including used/expired)
        result = await db.execute(
            select(EmailToken).where(
                EmailToken.token_hash == token_hash,
                EmailToken.token_type == "password_reset",
            )
        )
        email_token = result.scalar_one_or_none()

        # 2. Distinguish not-found / expired / used
        if email_token is None:
            raise HTTPException(
                status_code=400,
                detail={
                    "detail": "Reset token is invalid.",
                    "code": "TOKEN_INVALID",
                },
            )

        if email_token.expires_at <= now:
            raise HTTPException(
                status_code=400,
                detail={
                    "detail": "Reset token has expired.",
                    "code": "TOKEN_EXPIRED",
                },
            )

        if email_token.used:
            raise HTTPException(
                status_code=400,
                detail={
                    "detail": "Reset token has already been used.",
                    "code": "TOKEN_ALREADY_USED",
                },
            )

        # 3. Validate the new password (stricter than registration: special char + max 128)
        AuthService._validate_reset_password(new_password)

        # 4. Update the user's password hash and mark the token as used
        user_result = await db.execute(
            select(User).where(User.id == email_token.user_id)
        )
        user = user_result.scalar_one()
        user.password_hash = hash_password(new_password)
        email_token.used = True

        # 5. Revoke all active refresh tokens for this user
        rt_result = await db.execute(
            select(RefreshToken).where(
                RefreshToken.user_id == user.id,
                RefreshToken.revoked.is_(False),
            )
        )
        for rt in rt_result.scalars().all():
            rt.revoked = True

        await db.flush()

        return OkResponse(message="Password has been reset successfully.")

    # ------------------------------------------------------------------
    # Login (Requirements 2.1 – 2.6, 10.7)
    # ------------------------------------------------------------------

    @staticmethod
    async def login(
        payload: LoginPayload,
        client_ip: str,
        db: AsyncSession,
        redis: Redis,
    ) -> TokenPairResponse:
        """Authenticate a user and return an access/refresh token pair.

        Flow
        ----
        1. Reject if the IP is currently blocked (429).
        2. Look up user by email — 401 on miss (no distinguishing detail).
        3. Reject unverified users with 403 EMAIL_VERIFICATION_REQUIRED.
        4. Verify password — record failure / maybe set block — 401 on mismatch.
        5. On success: reset failure counter, issue tokens, store refresh token,
           write success AuditLog, return TokenPairResponse.

        AuditLog entries are written for both success and failure so that
        suspicious activity is visible in the audit trail (Requirement 10.7).
        """
        _SENTINEL_UUID = uuid.UUID(int=0)

        # 1. IP block check -----------------------------------------------
        if await is_login_blocked(redis, client_ip):
            raise HTTPException(
                status_code=429,
                detail={
                    "detail": "Too many failed login attempts. Please try again later.",
                    "code": "LOGIN_BLOCKED",
                },
            )

        # 2. User lookup ---------------------------------------------------
        result = await db.execute(select(User).where(User.email == payload.email))
        user = result.scalar_one_or_none()

        if user is None:
            # Write failure AuditLog with sentinel IDs (no real user)
            db.add(
                AuditLog(
                    event_type="user.login.failure",
                    actor_id=_SENTINEL_UUID,
                    target_type="user",
                    target_id=_SENTINEL_UUID,
                    outcome="failure",
                    client_ip=client_ip,
                )
            )
            await db.flush()
            raise HTTPException(
                status_code=401,
                detail={
                    "detail": "Invalid credentials.",
                    "code": "INVALID_CREDENTIALS",
                },
            )

        if not user.email_verified and user.account_type not in ("admin", "superadmin"):
            raise HTTPException(
                status_code=403,
                detail={
                    "detail": "Email verification required.",
                    "code": "EMAIL_VERIFICATION_REQUIRED",
                },
            )

        # 3b. Suspended account check — return reason and message so the
        #     frontend can surface them on the suspension page.
        if user.status == "suspended":
            raise HTTPException(
                status_code=403,
                detail={
                    "detail": "Your account has been suspended.",
                    "code": "ACCOUNT_SUSPENDED",
                    "suspension_reason": user.suspension_reason,
                    "suspension_message": user.suspension_message,
                },
            )

        # 4. Password verification ----------------------------------------
        if not verify_password(payload.password, user.password_hash):
            count = await record_login_failure(redis, client_ip)
            if count >= 5:
                await set_login_block(redis, client_ip)
            db.add(
                AuditLog(
                    event_type="user.login.failure",
                    actor_id=user.id,
                    target_type="user",
                    target_id=user.id,
                    outcome="failure",
                    client_ip=client_ip,
                )
            )
            await db.flush()
            raise HTTPException(
                status_code=401,
                detail={
                    "detail": "Invalid credentials.",
                    "code": "INVALID_CREDENTIALS",
                },
            )

        # 4b. 2FA Check ---------------------------------------------------
        if user.two_factor_enabled and user.two_factor_secret:
            from app.core.totp import verify_totp_code

            if not payload.two_factor_code:
                # 2FA code is required
                return TokenPairResponse(
                    access_token=None,
                    refresh_token=None,
                    requires_2fa=True,
                )

            if not verify_totp_code(user.two_factor_secret, payload.two_factor_code):
                count = await record_login_failure(redis, client_ip)
                if count >= 5:
                    await set_login_block(redis, client_ip)
                db.add(
                    AuditLog(
                        event_type="user.login.2fa_failure",
                        actor_id=user.id,
                        target_type="user",
                        target_id=user.id,
                        outcome="failure",
                        client_ip=client_ip,
                    )
                )
                await db.flush()
                raise HTTPException(
                    status_code=401,
                    detail={
                        "detail": "Invalid 2FA authentication code.",
                        "code": "INVALID_2FA_CODE",
                    },
                )

        # 5. Successful login ---------------------------------------------
        await reset_login_counter(redis, client_ip)

        # Update last login info
        user.last_login_ip = client_ip
        user.updated_at = datetime.now(UTC)

        # Issue access token (RS256, 15 min)
        access_token = create_access_token(
            {
                "sub": str(user.id),
                "email": user.email,
                "role": user.account_type,
            }
        )

        # Issue refresh token (opaque 32-byte hex, 7 days)
        refresh_token = generate_token()
        now = datetime.now(UTC)
        db.add(
            RefreshToken(
                user_id=user.id,
                token_hash=hash_token(refresh_token),
                revoked=False,
                expires_at=now + timedelta(days=7),
                issued_at=now,
                client_ip=client_ip,
            )
        )

        # Write success AuditLog
        db.add(
            AuditLog(
                event_type="user.login.success",
                actor_id=user.id,
                target_type="user",
                target_id=user.id,
                outcome="success",
                client_ip=client_ip,
            )
        )

        await db.flush()

        return TokenPairResponse(
            access_token=access_token,
            refresh_token=refresh_token,
            token_type="bearer",
            expires_in=900,
            requires_2fa=False,
        )

    @staticmethod
    async def reset_password_2fa(
        email: str,
        two_factor_code: str,
        new_password: str,
        db: AsyncSession,
        client_ip: str | None = None,
        user_agent: str | None = None,
    ) -> OkResponse:
        """Reset password immediately using 2FA authenticator verification."""
        from app.core.tasks import send_password_changed_email
        from app.core.totp import verify_totp_code

        clean_email = email.strip().lower()
        result = await db.execute(select(User).where(User.email == clean_email))
        user = result.scalar_one_or_none()

        if user is None:
            raise HTTPException(
                status_code=400,
                detail={"detail": "Account not found.", "code": "USER_NOT_FOUND"},
            )

        if not user.two_factor_enabled or not user.two_factor_secret:
            raise HTTPException(
                status_code=400,
                detail={"detail": "2FA is not enabled on this account. Please use the email reset link.", "code": "2FA_NOT_ENABLED"},
            )

        if not verify_totp_code(user.two_factor_secret, two_factor_code):
            raise HTTPException(
                status_code=400,
                detail={"detail": "Invalid 2FA authentication code.", "code": "INVALID_2FA_CODE"},
            )

        AuthService._validate_reset_password(new_password)

        user.password_hash = hash_password(new_password)
        user.updated_at = datetime.now(UTC)

        # Invalidate existing refresh tokens
        rt_result = await db.execute(
            select(RefreshToken).where(
                RefreshToken.user_id == user.id,
                RefreshToken.revoked.is_(False),
            )
        )
        for rt in rt_result.scalars().all():
            rt.revoked = True

        db.add(
            AuditLog(
                event_type="user.password.reset_2fa",
                actor_id=user.id,
                target_type="user",
                target_id=user.id,
                outcome="success",
                client_ip=client_ip,
            )
        )
        await db.flush()

        # Send security notification email
        try:
            send_password_changed_email.delay(
                user_id=str(user.id),
                client_ip=client_ip,
                user_agent=user_agent,
            )
        except Exception:
            pass

        return OkResponse(message="Password has been reset successfully using 2FA.")

    # ------------------------------------------------------------------
    # Token Refresh (Requirements 2.6, 2.7, 2.8)
    # ------------------------------------------------------------------

    @staticmethod
    async def refresh_tokens(
        refresh_token: str,
        client_ip: str,
        db: AsyncSession,
        redis: Redis,
    ) -> TokenPairResponse:
        """Rotate a refresh token and issue a new token pair.

        Flow
        ----
        1. Hash the submitted refresh token.
        2. Look up the matching RefreshToken record where ``revoked=False``
           and ``expires_at > now``; return 401 if not found or expired.
        3. Mark the existing record ``revoked=True``.
        4. Issue a new refresh token (7 days) and a new access token (15 min).
        5. Reset the login failure counter for the requesting IP (Req 2.6).
        6. Return the new token pair.

        Requirements: 2.6, 2.7, 2.8
        """
        now = _utcnow()
        token_hash = hash_token(refresh_token)

        # 1 & 2. Look up a valid, non-revoked token record --------------------
        result = await db.execute(
            select(RefreshToken).where(
                RefreshToken.token_hash == token_hash,
                RefreshToken.revoked.is_(False),
                RefreshToken.expires_at > now,
            )
        )
        record = result.scalar_one_or_none()

        if record is None:
            raise HTTPException(
                status_code=401,
                detail={
                    "detail": "Invalid or expired refresh token.",
                    "code": "INVALID_TOKEN",
                },
            )

        # 3. Revoke the existing record -------------------------------------
        record.revoked = True

        # Fetch the associated user so we can include role/email in the
        # new access token payload.
        user_result = await db.execute(
            select(User).where(User.id == record.user_id)
        )
        user = user_result.scalar_one_or_none()

        if user is None:
            # The user was deleted after the token was issued — treat as invalid.
            raise HTTPException(
                status_code=401,
                detail={
                    "detail": "Invalid or expired refresh token.",
                    "code": "INVALID_TOKEN",
                },
            )

        # 4. Issue new tokens ----------------------------------------------
        new_access_token = create_access_token(
            {
                "sub": str(user.id),
                "email": user.email,
                "role": user.account_type,
            }
        )

        new_refresh_token = generate_token()
        db.add(
            RefreshToken(
                user_id=user.id,
                token_hash=hash_token(new_refresh_token),
                revoked=False,
                expires_at=now + timedelta(days=7),
                issued_at=now,
                client_ip=client_ip,
            )
        )

        await db.flush()

        # 5. Reset the login failure counter for this IP -------------------
        await reset_login_counter(redis, client_ip)

        # 6. Return the new token pair -------------------------------------
        return TokenPairResponse(
            access_token=new_access_token,
            refresh_token=new_refresh_token,
            token_type="bearer",
            expires_in=900,
        )

    # ------------------------------------------------------------------
    # Logout (Requirements 2.9)
    # ------------------------------------------------------------------

    @staticmethod
    async def logout(
        access_token: str,
        refresh_token: str,
        db: AsyncSession,
        redis: Redis,
    ) -> OkResponse:
        """Logout a user by blocklisting the access token and revoking the refresh token.

        Flow
        ----
        1. Decode the access token to extract ``jti`` and ``exp``.
        2. Compute remaining TTL (``exp - now``) and write
           ``blocklist:jti:{jti}`` to Redis with that TTL (Requirement 2.9).
        3. Revoke the matching RefreshToken record in the database.
        4. Write a ``user.logout`` AuditLog entry.
        5. Return 200.

        Raises
        ------
        HTTPException(401)
            If the access token cannot be decoded.
        """
        from datetime import timezone as _tz

        from jwt.exceptions import PyJWTError as JWTError

        from app.core.tokens import (
            JWTError as _JWTError,
            blocklist_token,
            decode_access_token,
        )

        # 1. Decode access token -----------------------------------------
        try:
            claims = decode_access_token(access_token)
        except JWTError:
            raise HTTPException(
                status_code=401,
                detail={
                    "detail": "Invalid or expired access token.",
                    "code": "INVALID_TOKEN",
                },
            )

        jti: str = claims["jti"]
        exp_ts: int = claims["exp"]
        user_id_str: str = claims.get("sub", "")

        # 2. Blocklist the access token ----------------------------------
        now = datetime.now(UTC)
        exp_dt = datetime.fromtimestamp(exp_ts, tz=UTC)
        ttl_seconds = max(0, int((exp_dt - now).total_seconds()))
        await blocklist_token(redis, jti, ttl_seconds)

        # 3. Revoke the refresh token record -----------------------------
        if refresh_token:
            rt_hash = hash_token(refresh_token)
            rt_result = await db.execute(
                select(RefreshToken).where(
                    RefreshToken.token_hash == rt_hash,
                    RefreshToken.revoked.is_(False),
                )
            )
            rt_record = rt_result.scalar_one_or_none()
            if rt_record is not None:
                rt_record.revoked = True

        # 4. Write AuditLog entry ----------------------------------------
        try:
            actor_id = uuid.UUID(user_id_str)
        except (ValueError, AttributeError):
            actor_id = uuid.UUID(int=0)

        db.add(
            AuditLog(
                event_type="user.logout",
                actor_id=actor_id,
                target_type="user",
                target_id=actor_id,
                outcome="success",
                client_ip=None,
            )
        )
        await db.flush()

        return OkResponse(message="Logged out successfully.")

    # ------------------------------------------------------------------
    # Private validation helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _validate_email(email: str) -> None:
        """Raise HTTP 400 if *email* does not match the required pattern."""
        if not email or not _EMAIL_PATTERN.match(email):
            raise HTTPException(
                status_code=400,
                detail={
                    "detail": "Invalid email address.",
                    "code": "INVALID_EMAIL",
                },
            )

    @staticmethod
    def _validate_password(password: str) -> None:
        """Raise HTTP 400 listing every unmet password complexity rule.

        Registration rules (Requirements 1.3, 1.4):
        - Minimum 8 characters
        - At least one uppercase letter
        - At least one lowercase letter
        - At least one digit

        Note: special characters are NOT required at registration (they are
        required only for password reset and superadmin bootstrap per Req 3.3
        and 6.1).
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

        if errors:
            raise HTTPException(
                status_code=400,
                detail={
                    "detail": " ".join(errors),
                    "code": "INVALID_PASSWORD",
                },
            )

    @staticmethod
    def _validate_full_name(full_name: str) -> None:
        """Raise HTTP 400 if *full_name* is not between 2 and 100 characters."""
        if not full_name or not (2 <= len(full_name.strip()) <= 100):
            raise HTTPException(
                status_code=400,
                detail={
                    "detail": "Full name must be between 2 and 100 characters.",
                    "code": "INVALID_FULL_NAME",
                },
            )

    @staticmethod
    def _validate_account_type(account_type: str) -> None:
        """Raise HTTP 400 if *account_type* is not 'merchant' or 'developer'."""
        if account_type not in _ALLOWED_ACCOUNT_TYPES:
            raise HTTPException(
                status_code=400,
                detail={
                    "detail": (
                        f"Account type must be one of: "
                        f"{', '.join(sorted(_ALLOWED_ACCOUNT_TYPES))}."
                    ),
                    "code": "INVALID_ACCOUNT_TYPE",
                },
            )

    @staticmethod
    def _validate_reset_password(password: str) -> None:
        """Raise HTTP 400 listing every unmet complexity rule for password resets.

        Password reset rules (Requirement 3.3):
        - Minimum 8 characters
        - Maximum 128 characters
        - At least one uppercase letter
        - At least one lowercase letter
        - At least one digit
        - At least one special character
        """
        errors: list[str] = []

        if len(password) < 8:
            errors.append("Password must be at least 8 characters long.")
        if len(password) > 128:
            errors.append("Password must be no longer than 128 characters.")
        if not re.search(r"[A-Z]", password):
            errors.append("Password must contain at least one uppercase letter.")
        if not re.search(r"[a-z]", password):
            errors.append("Password must contain at least one lowercase letter.")
        if not re.search(r"\d", password):
            errors.append("Password must contain at least one digit.")
        if not re.search(r"[^A-Za-z0-9]", password):
            errors.append("Password must contain at least one special character.")

        if errors:
            raise HTTPException(
                status_code=400,
                detail={
                    "detail": " ".join(errors),
                    "code": "INVALID_PASSWORD",
                },
            )

    # ------------------------------------------------------------------
    # Verify status check (used by frontend polling)
    # ------------------------------------------------------------------

    @staticmethod
    async def get_verify_status(
        email: str,
        db: AsyncSession,
    ) -> bool:
        """Return whether the given email address is verified.

        Always returns a boolean so callers cannot distinguish registered
        from unregistered addresses (same shape for both).
        """
        from sqlalchemy import select as _select
        result = await db.execute(
            _select(User).where(User.email == email)
        )
        user = result.scalar_one_or_none()
        if user is None:
            return False
        return bool(user.email_verified)
