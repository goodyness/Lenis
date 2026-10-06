"""
Pydantic request/response schemas for the Auth service.
"""
from __future__ import annotations

import uuid

from pydantic import BaseModel


class RegistrationPayload(BaseModel):
    """Payload for POST /auth/register."""

    email: str
    password: str
    full_name: str
    account_type: str = "merchant"


class UserCreatedResponse(BaseModel):
    """Response body returned on successful registration (HTTP 201)."""

    user_id: uuid.UUID
    email: str


class VerifyEmailPayload(BaseModel):
    """Payload for POST /auth/verify-email."""

    token: str


class ResendVerificationPayload(BaseModel):
    """Payload for POST /auth/resend-verification."""

    email: str


class OkResponse(BaseModel):
    """Generic 200 OK response."""

    message: str = "ok"


class LoginPayload(BaseModel):
    """Payload for POST /auth/login."""

    email: str
    password: str
    two_factor_code: str | None = None


class TokenPairResponse(BaseModel):
    """Response body returned on successful login."""

    access_token: str | None = None
    refresh_token: str | None = None
    token_type: str = "bearer"
    expires_in: int = 900
    requires_2fa: bool = False


class RefreshPayload(BaseModel):
    """Payload for POST /auth/refresh."""

    refresh_token: str


class LogoutPayload(BaseModel):
    """Payload for POST /auth/logout."""

    refresh_token: str


class PasswordResetRequestPayload(BaseModel):
    """Payload for POST /auth/password-reset/request."""

    email: str


class PasswordResetConfirmPayload(BaseModel):
    """Payload for POST /auth/password-reset/confirm."""

    token: str
    new_password: str


class PasswordReset2FAPayload(BaseModel):
    """Payload for POST /auth/password-reset/2fa."""

    email: str
    two_factor_code: str
    new_password: str


class VerifyEmailResponse(BaseModel):
    """Response body for POST /auth/verify-email.

    For developer accounts, ``secret_key`` carries the plaintext test-mode
    secret key exactly once (Requirement 9.2).  For merchant accounts it is
    ``None``.
    """

    message: str = "ok"
    secret_key: str | None = None


class VerifyStatusResponse(BaseModel):
    """Response body for GET /auth/verify-status."""

    verified: bool
