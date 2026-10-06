"""
FastAPI router for the Auth service.

Registers all authentication endpoints under the ``/auth`` prefix that is
applied in ``app/main.py`` via ``_include_router_if_available``.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Request, status
from redis.asyncio import Redis
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth.schemas import (
    LoginPayload,
    LogoutPayload,
    OkResponse,
    PasswordReset2FAPayload,
    PasswordResetConfirmPayload,
    PasswordResetRequestPayload,
    RefreshPayload,
    RegistrationPayload,
    ResendVerificationPayload,
    TokenPairResponse,
    UserCreatedResponse,
    VerifyEmailPayload,
    VerifyEmailResponse,
    VerifyStatusResponse,
)
from app.auth.service import AuthService
from app.core.db import get_db
from app.core.dependencies import get_current_user
from app.core.models import User
from app.core.redis_client import get_redis

router = APIRouter()


# ---------------------------------------------------------------------------
# POST /auth/register
# ---------------------------------------------------------------------------


@router.post(
    "/register",
    response_model=UserCreatedResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new merchant or developer account",
    description=(
        "Creates a new user account with status 'unverified', "
        "sends a verification email, and returns the new user's ID and email. "
        "Requirements: 1.1 â€“ 1.8"
    ),
)
async def register(
    payload: RegistrationPayload,
    db: AsyncSession = Depends(get_db),
) -> UserCreatedResponse:
    """Register a new merchant or developer.

    Returns HTTP 201 with ``{ user_id, email }`` on success.
    Returns HTTP 400 for any validation failure.
    Returns HTTP 409 if the email is already registered.
    """
    return await AuthService.register(payload=payload, db=db)


# ---------------------------------------------------------------------------
# POST /auth/verify-email
# ---------------------------------------------------------------------------


@router.post(
    "/verify-email",
    response_model=VerifyEmailResponse,
    status_code=status.HTTP_200_OK,
    summary="Verify email address with a confirmation token",
    description=(
        "Validates the submitted token, marks the user's email as verified, "
        "and sets the account status to 'active'. For developer accounts, "
        "test-mode API keys are generated and the plaintext secret key is "
        "returned exactly once in the response. "
        "Requirements: 1.9, 1.10, 9.1, 9.2"
    ),
)
async def verify_email(
    payload: VerifyEmailPayload,
    db: AsyncSession = Depends(get_db),
) -> VerifyEmailResponse:
    """Verify an email address.

    Returns HTTP 200 on success.  For developer accounts, the response
    includes ``secret_key`` containing the plaintext test-mode secret key
    (returned exactly once; subsequent calls will not include it).
    Returns HTTP 400 with TOKEN_INVALID if the token is not found or already used.
    Returns HTTP 400 with TOKEN_EXPIRED if the token has expired.
    """
    return await AuthService.verify_email(token=payload.token, db=db)


# ---------------------------------------------------------------------------
# POST /auth/resend-verification
# ---------------------------------------------------------------------------


@router.post(
    "/resend-verification",
    response_model=OkResponse,
    status_code=status.HTTP_200_OK,
    summary="Resend the email verification link",
    description=(
        "Invalidates any existing unexpired verification tokens for the given "
        "email address and sends a new verification email. Always returns 200 "
        "to prevent email enumeration. "
        "Requirements: 1.11, 1.12"
    ),
)
async def resend_verification(
    payload: ResendVerificationPayload,
    db: AsyncSession = Depends(get_db),
) -> OkResponse:
    """Resend a verification email.

    Returns HTTP 200 regardless of whether the email is registered
    (prevents enumeration).
    Returns HTTP 400 with EMAIL_ALREADY_VERIFIED if the email is already verified.
    """
    return await AuthService.resend_verification(email=payload.email, db=db)


# ---------------------------------------------------------------------------
# POST /auth/password-reset/request
# ---------------------------------------------------------------------------


@router.post(
    "/password-reset/request",
    response_model=OkResponse,
    status_code=status.HTTP_200_OK,
    summary="Request a password reset email",
    description=(
        "Sends a password reset email to the given address if the account "
        "exists and is email-verified. Always returns 200 to prevent email "
        "enumeration. "
        "Requirements: 3.1, 3.2"
    ),
)
async def password_reset_request(
    payload: PasswordResetRequestPayload,
    db: AsyncSession = Depends(get_db),
) -> OkResponse:
    """Request a password reset.

    Returns HTTP 200 regardless of whether the email is registered
    (prevents enumeration per Requirement 3.2).
    A reset email is sent only when the account exists and is verified.
    """
    return await AuthService.request_password_reset(email=payload.email, db=db)


# ---------------------------------------------------------------------------
# POST /auth/login
# ---------------------------------------------------------------------------


@router.post(
    "/login",
    response_model=TokenPairResponse,
    status_code=status.HTTP_200_OK,
    summary="Authenticate and receive a token pair",
    description=(
        "Verifies the user's credentials and returns an RS256 access token "
        "(15 min) and an opaque refresh token (7 days). Enforces IP-based "
        "lockout after 5 consecutive failures. "
        "Requirements: 2.1 â€“ 2.6, 10.7"
    ),
)
async def login(
    payload: LoginPayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> TokenPairResponse:
    """Authenticate a user.

    Returns HTTP 200 with ``{ access_token, refresh_token, token_type, expires_in }``
    on success.
    Returns HTTP 401 with INVALID_CREDENTIALS for bad email or password.
    Returns HTTP 403 with EMAIL_VERIFICATION_REQUIRED if email is unverified.
    Returns HTTP 429 with LOGIN_BLOCKED if the IP is temporarily locked out.
    """
    forwarded_for = request.headers.get("X-Forwarded-For", "")
    client_ip = forwarded_for.split(",")[0].strip() if forwarded_for else (
        request.client.host if request.client else "unknown"
    )
    return await AuthService.login(
        payload=payload,
        client_ip=client_ip,
        db=db,
        redis=redis,
    )


# ---------------------------------------------------------------------------
# POST /auth/refresh
# ---------------------------------------------------------------------------


@router.post(
    "/refresh",
    response_model=TokenPairResponse,
    status_code=status.HTTP_200_OK,
    summary="Rotate a refresh token and issue a new token pair",
    description=(
        "Revokes the submitted Refresh_Token and issues a new Refresh_Token "
        "(7-day expiry) and a new Access_Token (15-min expiry). "
        "Also resets the login failure counter for the requesting IP. "
        "Requirements: 2.6, 2.7, 2.8"
    ),
)
async def refresh(
    payload: RefreshPayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
) -> TokenPairResponse:
    """Rotate a refresh token.

    Returns HTTP 200 with a new ``{ access_token, refresh_token, token_type, expires_in }``
    on success.
    Returns HTTP 401 with INVALID_TOKEN if the token is expired, revoked, or not found.
    """
    forwarded_for = request.headers.get("X-Forwarded-For", "")
    client_ip = forwarded_for.split(",")[0].strip() if forwarded_for else (
        request.client.host if request.client else "unknown"
    )
    return await AuthService.refresh_tokens(
        refresh_token=payload.refresh_token,
        client_ip=client_ip,
        db=db,
        redis=redis,
    )


# ---------------------------------------------------------------------------
# POST /auth/logout
# ---------------------------------------------------------------------------


@router.post(
    "/logout",
    response_model=OkResponse,
    status_code=status.HTTP_200_OK,
    summary="Logout â€” revoke session tokens",
    description=(
        "Adds the Access_Token JTI to the Redis blocklist for the remainder "
        "of its validity period, revokes the associated Refresh_Token record, "
        "and writes a user.logout Audit_Log entry. "
        "Requirements: 2.9"
    ),
)
async def logout(
    payload: LogoutPayload,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    redis: Redis = Depends(get_redis),
    request: Request = None,
) -> OkResponse:
    """Logout the authenticated user.

    Requires a valid ``Authorization: Bearer <access_token>`` header.

    Returns HTTP 200 on success.
    Returns HTTP 401 if the access token is invalid or expired.
    """
    # Extract the raw token from the Authorization header so the service
    # can decode it again to get the JTI and exp.
    auth_header = request.headers.get("Authorization", "")
    access_token = auth_header.removeprefix("Bearer ").strip()

    return await AuthService.logout(
        access_token=access_token,
        refresh_token=payload.refresh_token,
        db=db,
        redis=redis,
    )


# ---------------------------------------------------------------------------
# POST /auth/password-reset/confirm
# ---------------------------------------------------------------------------


@router.post(
    "/password-reset/confirm",
    response_model=OkResponse,
    status_code=status.HTTP_200_OK,
    summary="Confirm a password reset with a reset token",
    description=(
        "Validates the reset token, enforces new password complexity rules "
        "(length 8-128, uppercase, lowercase, digit, and special character), "
        "updates the password hash, and revokes all active refresh tokens so "
        "that every existing session is terminated. "
        "Requirements: 3.3, 3.4, 3.5, 3.6"
    ),
)
async def password_reset_confirm(
    payload: PasswordResetConfirmPayload,
    db: AsyncSession = Depends(get_db),
) -> OkResponse:
    """Confirm a password reset.

    Returns HTTP 200 on success.
    Returns HTTP 400 with TOKEN_EXPIRED if the reset token has expired.
    Returns HTTP 400 with TOKEN_ALREADY_USED if the token was already used.
    Returns HTTP 400 with TOKEN_INVALID if the token does not exist.
    Returns HTTP 400 with INVALID_PASSWORD if the new password fails complexity rules.
    """
    return await AuthService.reset_password(
        token=payload.token,
        new_password=payload.new_password,
        db=db,
    )


# ---------------------------------------------------------------------------
# POST /auth/password-reset/2fa
# ---------------------------------------------------------------------------


@router.post(
    "/password-reset/2fa",
    response_model=OkResponse,
    status_code=status.HTTP_200_OK,
    summary="Reset password using 2FA Authenticator code",
    description="Resets user password immediately using their 6-digit TOTP authenticator code without needing an email link.",
)
async def password_reset_2fa(
    payload: PasswordReset2FAPayload,
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> OkResponse:
    """Reset password via 2FA."""
    client_ip = request.client.host if request.client else None
    user_agent = request.headers.get("user-agent")
    return await AuthService.reset_password_2fa(
        email=payload.email,
        two_factor_code=payload.two_factor_code,
        new_password=payload.new_password,
        db=db,
        client_ip=client_ip,
        user_agent=user_agent,
    )


# ---------------------------------------------------------------------------
# GET /auth/verify-status
# ---------------------------------------------------------------------------


@router.get(
    "/verify-status",
    response_model=VerifyStatusResponse,
    status_code=200,
    summary="Check whether an email address has been verified",
    description=(
        "Polls whether the given email address has completed email verification. "
        "Returns the same response shape regardless of whether the address is "
        "registered, to prevent email enumeration."
    ),
)
async def verify_status(
    email: str,
    db: AsyncSession = Depends(get_db),
) -> VerifyStatusResponse:
    """Poll email verification status.

    Returns HTTP 200 with ``{ verified: true }`` once the address is verified,
    ``{ verified: false }`` otherwise.  Safe to call repeatedly.
    """
    verified = await AuthService.get_verify_status(email=email, db=db)
    return VerifyStatusResponse(verified=verified)
