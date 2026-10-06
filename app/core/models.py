"""
SQLAlchemy ORM models for the Lenis platform.

All seven tables defined in the design document are mapped here:
  User, EmailToken, RefreshToken, Organization, APIKey,
  VerificationRequest, AuditLog

Design decisions:
- Primary keys use SQLAlchemy's built-in ``Uuid`` type (available since 2.0),
  which stores as CHAR(32)/CHAR(36) on SQLite and as native UUID on PostgreSQL,
  providing seamless portability between the two databases.
- All timestamps use ``DateTime(timezone=True)`` so values are stored with
  timezone information and round-trip correctly between SQLite and PostgreSQL.
- ``server_default=func.now()`` supplies the DB-side default; Python-side
  ``default=datetime.now(UTC)`` ensures the value is available immediately
  after flush/insert without requiring a round-trip.
- ``AuditLog`` inherits ``AppendOnlyMixin`` which raises
  ``OperationNotPermittedError`` on any call to ``.update()`` or ``.delete()``,
  satisfying Requirement 8.3.
"""
from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Optional

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    JSON,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy import Uuid

from app.core.db import Base

# ---------------------------------------------------------------------------
# AppendOnlyMixin
# ---------------------------------------------------------------------------


class OperationNotPermittedError(Exception):
    """Raised when a forbidden operation is attempted on an append-only model."""


class AppendOnlyMixin:
    """Mixin that prevents update and delete operations on a model instance.

    Apply this to any model that must be append-only at the application layer.
    Both ``update()`` and ``delete()`` raise ``OperationNotPermittedError``
    regardless of arguments, satisfying Requirement 8.3.
    """

    def update(self, *args, **kwargs) -> None:  # type: ignore[override]
        raise OperationNotPermittedError("AuditLog entries cannot be modified.")

    def delete(self, *args, **kwargs) -> None:  # type: ignore[override]
        raise OperationNotPermittedError("AuditLog entries cannot be deleted.")


# ---------------------------------------------------------------------------
# User
# ---------------------------------------------------------------------------


class User(Base):
    """Registered platform user (merchant, developer, admin, or superadmin).

    Requirements: 1.1, 1.7
    """

    __tablename__ = "users"

    __table_args__ = (
        CheckConstraint(
            "account_type IN ('merchant', 'developer', 'admin', 'superadmin')",
            name="ck_users_account_type",
        ),
        CheckConstraint(
            "status IN ('unverified', 'active', 'suspended', 'verified')",
            name="ck_users_status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    email: Mapped[str] = mapped_column(
        String(254),
        nullable=False,
        unique=True,
    )
    password_hash: Mapped[str] = mapped_column(
        String(72),
        nullable=False,
    )
    full_name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )
    account_type: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="unverified",
        server_default="unverified",
    )
    suspension_reason: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
    )
    suspension_message: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )
    email_verified: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="0",
    )
    phone_number: Mapped[Optional[str]] = mapped_column(
        String(30),
        nullable=True,
    )
    phone_verified: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="0",
    )
    phone_otp_hash: Mapped[Optional[str]] = mapped_column(
        String(72),
        nullable=True,
    )
    phone_otp_expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    notification_preferences: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )
    subscription_tier: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
        default="free",
        server_default="free",
    )
    subscription_period: Mapped[Optional[str]] = mapped_column(
        String(20),
        nullable=True,
    )
    subscription_expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    subscription_grace_until: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    subscription_last_reminder: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True,
    )
    monthly_tx_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )
    two_factor_enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="0",
    )
    two_factor_secret: Mapped[Optional[str]] = mapped_column(
        String(64),
        nullable=True,
    )
    last_login_ip: Mapped[Optional[str]] = mapped_column(
        String(45),
        nullable=True,
    )
    last_login_ua: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
    )
    security_otp_hash: Mapped[Optional[str]] = mapped_column(
        String(72),
        nullable=True,
    )
    security_otp_expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    security_otp_channel: Mapped[Optional[str]] = mapped_column(
        String(20),
        nullable=True,
    )
    security_unlocked_until: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    security_unlocked_ip: Mapped[Optional[str]] = mapped_column(
        String(45),
        nullable=True,
    )
    security_unlocked_ua: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
        onupdate=lambda: datetime.now(UTC),
    )

    # Relationships
    email_tokens: Mapped[list["EmailToken"]] = relationship(
        "EmailToken",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="select",
    )
    refresh_tokens: Mapped[list["RefreshToken"]] = relationship(
        "RefreshToken",
        back_populates="user",
        cascade="all, delete-orphan",
        lazy="select",
    )
    organization: Mapped[Optional["Organization"]] = relationship(
        "Organization",
        back_populates="owner",
        foreign_keys="Organization.owner_id",
        uselist=False,
        lazy="select",
    )
    verification_requests: Mapped[list["VerificationRequest"]] = relationship(
        "VerificationRequest",
        back_populates="developer",
        foreign_keys="VerificationRequest.developer_id",
        cascade="all, delete-orphan",
        lazy="select",
    )
    merchant_profile: Mapped[Optional["MerchantProfile"]] = relationship(
        "MerchantProfile",
        back_populates="user",
        foreign_keys="MerchantProfile.user_id",
        uselist=False,
        lazy="select",
    )
    suspension_appeals: Mapped[list["SuspensionAppeal"]] = relationship(
        "SuspensionAppeal",
        back_populates="user",
        foreign_keys="SuspensionAppeal.user_id",
        cascade="all, delete-orphan",
        lazy="select",
    )
    notifications: Mapped[list["Notification"]] = relationship(
        "Notification",
        back_populates="user",
        foreign_keys="Notification.user_id",
        cascade="all, delete-orphan",
        lazy="select",
    )
    org_memberships: Mapped[list["OrgMember"]] = relationship(
        "OrgMember",
        back_populates="user",
        foreign_keys="OrgMember.user_id",
        cascade="all, delete-orphan",
        lazy="select",
    )

    def __repr__(self) -> str:
        return f"<User id={self.id} email={self.email!r} role={self.account_type!r}>"


# ---------------------------------------------------------------------------
# EmailToken
# ---------------------------------------------------------------------------


class EmailToken(Base):
    """One-use, time-limited tokens for email verification and password reset.

    The ``token_hash`` column stores the SHA-256 hex digest of the plaintext
    token. The plaintext is only ever embedded in the email link; it is never
    persisted.
    """

    __tablename__ = "email_tokens"

    __table_args__ = (
        CheckConstraint(
            "token_type IN ('email_verification', 'password_reset')",
            name="ck_email_tokens_token_type",
        ),
        Index("idx_email_tokens_user_type", "user_id", "token_type"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    token_hash: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        unique=True,
    )
    token_type: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )
    used: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="0",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
    )

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="email_tokens")

    def __repr__(self) -> str:
        return (
            f"<EmailToken id={self.id} type={self.token_type!r} used={self.used}>"
        )


# ---------------------------------------------------------------------------
# RefreshToken
# ---------------------------------------------------------------------------


class RefreshToken(Base):
    """Server-side record for long-lived opaque refresh tokens.

    The ``token_hash`` stores the SHA-256 hex digest. The plaintext token is
    returned to the client once and never stored.
    """

    __tablename__ = "refresh_tokens"

    __table_args__ = (
        Index("idx_refresh_tokens_user", "user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    token_hash: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        unique=True,
    )
    revoked: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="0",
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )
    issued_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
    )
    client_ip: Mapped[Optional[str]] = mapped_column(
        String(45),
        nullable=True,
    )

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="refresh_tokens")

    def __repr__(self) -> str:
        return (
            f"<RefreshToken id={self.id} user_id={self.user_id} revoked={self.revoked}>"
        )


# ---------------------------------------------------------------------------
# Organization
# ---------------------------------------------------------------------------


class Organization(Base):
    """An organization owned by a merchant or developer user.

    Created automatically when a new user registers. API keys are associated
    with the organization, not directly with the user.
    """

    __tablename__ = "organizations"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    owner_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id"),
        nullable=False,
    )
    name: Mapped[str] = mapped_column(
        String(200),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
    )

    # Relationships
    owner: Mapped["User"] = relationship(
        "User",
        back_populates="organization",
        foreign_keys=[owner_id],
    )
    api_keys: Mapped[list["APIKey"]] = relationship(
        "APIKey",
        back_populates="organization",
        cascade="all, delete-orphan",
        lazy="select",
    )
    members: Mapped[list["OrgMember"]] = relationship(
        "OrgMember",
        back_populates="organization",
        cascade="all, delete-orphan",
        lazy="select",
        foreign_keys="OrgMember.organization_id",
    )

    def __repr__(self) -> str:
        return f"<Organization id={self.id} name={self.name!r}>"


# ---------------------------------------------------------------------------
# OrgMember
# ---------------------------------------------------------------------------


class OrgMember(Base):
    """A member of an organization with an assigned role.

    Each (organization_id, user_id) pair is unique. The ``invited_by`` column
    records which user sent the invitation; it is nullable and has no cascade
    so that the inviter's account can be deleted without affecting the membership
    record.

    Requirements: 21.1
    """

    __tablename__ = "org_members"

    __table_args__ = (
        UniqueConstraint("organization_id", "user_id", name="uq_org_members_org_user"),
        CheckConstraint(
            "role IN ('owner','admin','developer')",
            name="ck_org_members_role",
        ),
        Index("idx_org_members_org", "organization_id"),
        Index("idx_org_members_user", "user_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    role: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
    )
    invited_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id"),
        nullable=True,
    )
    accepted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
    )

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization",
        back_populates="members",
        foreign_keys=[organization_id],
    )
    user: Mapped["User"] = relationship(
        "User",
        back_populates="org_memberships",
        foreign_keys=[user_id],
    )
    inviter: Mapped[Optional["User"]] = relationship(
        "User",
        foreign_keys=[invited_by],
        lazy="select",
    )

    def __repr__(self) -> str:
        return (
            f"<OrgMember id={self.id} org={self.organization_id} "
            f"user={self.user_id} role={self.role!r}>"
        )


# ---------------------------------------------------------------------------
# APIKey
# ---------------------------------------------------------------------------


class APIKey(Base):
    """API key record for an organization.

    Publishable keys (``pk_test_``, ``pk_live_``) are stored as plaintext
    because they are public by design. Secret keys (``sk_test_``, ``sk_live_``)
    are stored as SHA-256 hashes; the ``suffix_display`` column holds the last
    4 characters of the original plaintext for masked display.
    """

    __tablename__ = "api_keys"

    __table_args__ = (
        CheckConstraint(
            "key_type IN ('pk_test', 'sk_test', 'pk_live', 'sk_live')",
            name="ck_api_keys_key_type",
        ),
        Index("idx_api_keys_org", "organization_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    key_type: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
    )
    prefix: Mapped[str] = mapped_column(
        String(12),
        nullable=False,
    )
    suffix_display: Mapped[str] = mapped_column(
        String(4),
        nullable=False,
    )
    key_hash: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
        unique=True,
    )
    active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default="1",
    )
    # Comma-separated list of IP addresses or CIDR blocks that are allowed to
    # use this key. Null / empty string means "allow all". Requirement: 22.1
    allowed_ips: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
    )
    revoked_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization",
        back_populates="api_keys",
    )

    def __repr__(self) -> str:
        return (
            f"<APIKey id={self.id} type={self.key_type!r} active={self.active}>"
        )


# ---------------------------------------------------------------------------
# VerificationRequest
# ---------------------------------------------------------------------------


class VerificationRequest(Base):
    """Developer KYC-like verification request submitted for admin review."""

    __tablename__ = "verification_requests"

    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'approved', 'rejected')",
            name="ck_vr_status",
        ),
        Index("idx_vr_developer", "developer_id"),
        Index("idx_vr_status", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    developer_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id"),
        nullable=False,
    )
    full_legal_name: Mapped[str] = mapped_column(
        String(200),
        nullable=False,
    )
    country: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )
    business_type: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )
    website_url: Mapped[str] = mapped_column(
        String(2048),
        nullable=False,
    )
    intended_use: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="pending",
        server_default="pending",
    )
    rejection_reason: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )
    reviewed_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id"),
        nullable=True,
    )
    rejected_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
        onupdate=lambda: datetime.now(UTC),
    )

    # Relationships
    developer: Mapped["User"] = relationship(
        "User",
        back_populates="verification_requests",
        foreign_keys=[developer_id],
    )
    reviewer: Mapped[Optional["User"]] = relationship(
        "User",
        foreign_keys=[reviewed_by],
        lazy="select",
    )

    def __repr__(self) -> str:
        return (
            f"<VerificationRequest id={self.id} "
            f"developer_id={self.developer_id} status={self.status!r}>"
        )


# ---------------------------------------------------------------------------
# AuditLog (append-only)
# ---------------------------------------------------------------------------


class AuditLog(AppendOnlyMixin, Base):
    """Append-only audit log record.

    ``AppendOnlyMixin`` raises ``OperationNotPermittedError`` on any call to
    ``.update()`` or ``.delete()``, enforcing the append-only constraint at
    the application layer in addition to the database-level permission grants.

    Requirement 8.3.
    """

    __tablename__ = "audit_logs"

    __table_args__ = (
        CheckConstraint(
            "outcome IN ('success', 'failure')",
            name="ck_audit_logs_outcome",
        ),
        Index("idx_audit_actor", "actor_id"),
        Index("idx_audit_event_type", "event_type"),
        Index("idx_audit_created_at", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    event_type: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )
    actor_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        nullable=False,
    )
    target_type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
    )
    target_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        nullable=False,
    )
    outcome: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
    )
    client_ip: Mapped[Optional[str]] = mapped_column(
        String(45),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
    )

    def __repr__(self) -> str:
        return (
            f"<AuditLog id={self.id} event={self.event_type!r} "
            f"actor={self.actor_id} outcome={self.outcome!r}>"
        )


# ---------------------------------------------------------------------------
# MerchantProfile
# ---------------------------------------------------------------------------


class MerchantProfile(Base):
    """Merchant-specific onboarding profile.

    Created lazily on first ``GET /merchant/onboarding-status`` rather than at
    registration, to avoid polluting the database with profiles for merchants
    who never start onboarding.

    ``kyc_reviewed_by`` references ``users.id`` for the admin who reviewed the
    KYC submission. The relationship is intentionally NOT set up with cascade
    delete so that audit history is preserved if the reviewing admin's account
    is later deleted.

    Requirements: 2.11, 4.11, 5.6, 12.3, 12.4
    """

    __tablename__ = "merchant_profiles"

    __table_args__ = (
        UniqueConstraint("user_id", name="uq_merchant_profiles_user_id"),
        CheckConstraint(
            "kyc_status IN ('not_started','pending','approved','rejected')",
            name="ck_merchant_profiles_kyc_status",
        ),
        CheckConstraint(
            "personal_info_status IN ('pending','approved','rejected')",
            name="ck_merchant_profiles_personal_info_status",
        ),
        CheckConstraint(
            "business_info_status IN ('pending','approved','rejected')",
            name="ck_merchant_profiles_business_info_status",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )

    # Step 1 — personal info
    full_name: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )
    country: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )
    phone_number: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
    )
    personal_info_status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="pending",
        server_default="pending",
    )
    personal_info_rejection_reason: Mapped[Optional[str]] = mapped_column(
        String(500),
        nullable=True,
    )

    # Step 2 — business info
    business_name: Mapped[Optional[str]] = mapped_column(
        String(200),
        nullable=True,
    )
    website_url: Mapped[Optional[str]] = mapped_column(
        String(2048),
        nullable=True,
    )
    social_instagram: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
    )
    social_twitter: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
    )
    social_facebook: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
    )
    social_linkedin: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
    )
    social_tiktok: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
    )
    is_registered_business: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="0",
    )
    registration_doc_path: Mapped[Optional[str]] = mapped_column(
        String(500),
        nullable=True,
    )
    business_address: Mapped[Optional[str]] = mapped_column(
        String(500),
        nullable=True,
    )
    business_description: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )
    business_category: Mapped[Optional[str]] = mapped_column(
        String(100),
        nullable=True,
    )
    monthly_volume_estimate: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True,
    )
    business_info_status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="pending",
        server_default="pending",
    )
    business_info_rejection_reason: Mapped[Optional[str]] = mapped_column(
        String(500),
        nullable=True,
    )

    # Step 3 — KYC
    kyc_status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="not_started",
        server_default="not_started",
    )
    kyc_document_path: Mapped[Optional[str]] = mapped_column(
        String(500),
        nullable=True,
    )
    kyc_document_type: Mapped[Optional[str]] = mapped_column(
        # Accepted values: 'passport', 'national_id', 'drivers_license', 'nin_slip'
        String(50),
        nullable=True,
    )
    nin: Mapped[Optional[str]] = mapped_column(
        # Nigeria-only National Identification Number (11 digits)
        String(11),
        nullable=True,
    )
    kyc_dojah_session_id: Mapped[Optional[str]] = mapped_column(
        String(200),
        nullable=True,
    )
    kyc_didit_session_id: Mapped[Optional[str]] = mapped_column(
        String(200),
        nullable=True,
    )
    kyc_reviewed_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        Uuid(as_uuid=True),
        # No ondelete cascade — preserve audit history if admin account is deleted
        ForeignKey("users.id"),
        nullable=True,
    )
    kyc_reviewed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    kyc_rejection_reason: Mapped[Optional[str]] = mapped_column(
        String(500),
        nullable=True,
    )

    # Step 4 — wallet
    wallet_added: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="0",
    )

    # Store Branding & Customization
    brand_logo_url: Mapped[Optional[str]] = mapped_column(
        String(500),
        nullable=True,
    )
    brand_color: Mapped[Optional[str]] = mapped_column(
        String(7),
        nullable=True,
        default="#4F46E5",
        server_default="#4F46E5",
    )
    brand_tagline: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
    )
    support_email: Mapped[Optional[str]] = mapped_column(
        String(254),
        nullable=True,
    )
    support_phone: Mapped[Optional[str]] = mapped_column(
        String(30),
        nullable=True,
    )

    # Onboarding progress
    onboarding_complete: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="0",
    )
    onboarding_step: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=1,
        server_default="1",
    )

    # Timestamps
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
        onupdate=lambda: datetime.now(UTC),
    )

    # Relationships
    user: Mapped["User"] = relationship(
        "User",
        back_populates="merchant_profile",
        foreign_keys=[user_id],
    )
    reviewer: Mapped[Optional["User"]] = relationship(
        "User",
        foreign_keys=[kyc_reviewed_by],
        lazy="select",
    )

    def __repr__(self) -> str:
        return (
            f"<MerchantProfile id={self.id} user_id={self.user_id} "
            f"kyc_status={self.kyc_status!r} step={self.onboarding_step}>"
        )


# ---------------------------------------------------------------------------
# MerchantWallet
# ---------------------------------------------------------------------------


class MerchantWallet(Base):
    """EVM wallet address submitted by a merchant as their payment receiving address.

    One merchant may have at most one wallet in ``active`` or ``pending`` status
    per network. This uniqueness constraint is enforced at the database level via
    a partial unique index that must be created manually in the Alembic migration:

        CREATE UNIQUE INDEX uq_wallet_active ON merchant_wallets
            (merchant_id, network) WHERE status IN ('active', 'pending');

    SQLAlchemy's ``UniqueConstraint`` does not support WHERE clauses, so the
    index is NOT declared here — only the ``CheckConstraint`` on ``status`` is.

    Requirements: 5.6, 13.1, 13.3, 13.4
    """

    __tablename__ = "merchant_wallets"

    __table_args__ = (
        CheckConstraint(
            "status IN ('active','pending','inactive')",
            name="ck_merchant_wallets_status",
        ),
        # NOTE: The partial unique index below is NOT declared here.
        # It must be created manually in the Alembic migration:
        #   CREATE UNIQUE INDEX uq_wallet_active ON merchant_wallets
        #       (merchant_id, network) WHERE status IN ('active','pending');
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    merchant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    # Accepted values: 'ethereum' | 'base' | 'polygon' | 'arbitrum' | 'optimism' | 'bsc'
    network: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
    )
    # EVM address: 0x prefix followed by exactly 40 hexadecimal characters
    address: Mapped[str] = mapped_column(
        String(42),
        nullable=False,
    )
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="active",
        server_default="active",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
        onupdate=lambda: datetime.now(UTC),
    )

    # Relationships
    merchant: Mapped["User"] = relationship(
        "User",
        foreign_keys=[merchant_id],
        lazy="select",
    )

    def __repr__(self) -> str:
        return (
            f"<MerchantWallet id={self.id} merchant_id={self.merchant_id} "
            f"network={self.network!r} status={self.status!r}>"
        )


# ---------------------------------------------------------------------------
# PaymentLink
# ---------------------------------------------------------------------------


class PaymentLink(Base):
    """A shareable payment link created by a merchant.

    Customers open the link at ``/pay/{slug}`` to initiate a crypto payment.
    The ``accepted_tokens`` JSON column stores a snapshot of the network/token
    configuration at link-creation time so that later changes to the global
    network registry do not invalidate existing links.

    The ``slug`` is a 12-character URL-safe string generated by
    ``app.core.slugs.generate_slug`` with up to 5 collision retries.

    Status lifecycle: ``active`` → ``inactive`` (merchant deactivates) or
    ``suspended_by_admin`` (admin suspends merchant).

    Requirements: 8.14, 8.15, 9.1, 9.2
    """

    __tablename__ = "payment_links"

    __table_args__ = (
        CheckConstraint(
            "amount_mode IN ('fixed','flexible')",
            name="ck_payment_links_amount_mode",
        ),
        CheckConstraint(
            "status IN ('active','inactive','suspended_by_admin')",
            name="ck_payment_links_status",
        ),
        Index("idx_payment_links_slug", "slug"),
        Index("idx_payment_links_merchant", "merchant_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    merchant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(
        String(200),
        nullable=False,
    )
    # Unique URL-safe identifier; minimum 12 characters enforced at the app layer.
    slug: Mapped[str] = mapped_column(
        String(200),
        nullable=False,
        unique=True,
    )
    # 'fixed' requires a non-null amount; 'flexible' lets the payer choose.
    amount_mode: Mapped[str] = mapped_column(
        String(10),
        nullable=False,
    )
    amount: Mapped[Optional[object]] = mapped_column(
        Numeric(precision=28, scale=18),
        nullable=True,
    )
    # Reserved for future fiat-currency display; currently unused.
    currency: Mapped[Optional[str]] = mapped_column(
        String(10),
        nullable=True,
    )
    # Snapshot of [{network, token_symbol, contract_address}, …] at creation time.
    accepted_tokens: Mapped[object] = mapped_column(
        JSON,
        nullable=False,
    )
    status: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
        default="active",
        server_default="active",
    )
    expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    max_uses: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
    )
    use_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )
    redirect_url: Mapped[Optional[str]] = mapped_column(
        String(2048),
        nullable=True,
    )
    custom_message: Mapped[Optional[str]] = mapped_column(
        String(500),
        nullable=True,
    )
    collect_phone: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="0",
    )
    collect_address: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="0",
    )
    total_collected: Mapped[object] = mapped_column(
        Numeric(precision=28, scale=18),
        nullable=False,
        default=0,
        server_default="0",
    )
    # True when created via a sk_test_* API key; False for live-mode records.
    # Requirement: 16.1, 16.3
    is_test: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="0",
    )
    # Opaque developer-supplied reference string; max 128 chars.
    # Requirement: 5.6
    external_id: Mapped[Optional[str]] = mapped_column(
        String(128),
        nullable=True,
    )
    # Organization that created this payment link via the Developer API; nullable
    # for backward compatibility with records created before this column existed.
    # Requirement: 7.5
    organization_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("organizations.id"),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
        onupdate=lambda: datetime.now(UTC),
    )

    # Relationships
    merchant: Mapped["User"] = relationship(
        "User",
        foreign_keys=[merchant_id],
        lazy="select",
    )

    def __repr__(self) -> str:
        return (
            f"<PaymentLink id={self.id} slug={self.slug!r} "
            f"merchant_id={self.merchant_id} status={self.status!r}>"
        )


# ---------------------------------------------------------------------------
# Invoice
# ---------------------------------------------------------------------------


class Invoice(Base):
    """Invoice created by a merchant for a specific customer.

    An invoice groups one or more line items into a single payment request sent
    to the customer by email. It is backed by an auto-generated ``PaymentLink``
    when it transitions from ``draft`` to ``sent``.

    ``notes`` is optional free-text (max 2000 chars enforced at the app layer,
    not at the DB layer). ``accepted_tokens`` is a JSON snapshot of the
    network/token configuration at creation time, matching the same pattern used
    by ``PaymentLink``.

    Status lifecycle:
      draft → sent → viewed → paid
      sent / viewed → overdue  (Celery beat, when due_date has passed)
      draft / sent / viewed / overdue → cancelled  (merchant cancels)

    Requirements: 10.3, 10.7, 10.11
    """

    __tablename__ = "invoices"

    __table_args__ = (
        CheckConstraint(
            "status IN ('draft','sent','viewed','paid','overdue','cancelled')",
            name="ck_invoices_status",
        ),
        Index("idx_invoices_merchant", "merchant_id"),
        Index("idx_invoices_status", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    merchant_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    # Nullable: set once the invoice is sent and a PaymentLink is created for it.
    payment_link_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("payment_links.id"),
        nullable=True,
    )
    customer_name: Mapped[str] = mapped_column(
        String(200),
        nullable=False,
    )
    customer_email: Mapped[str] = mapped_column(
        String(254),
        nullable=False,
    )
    # Date-only field (no time component) — validated as a future date on creation.
    due_date: Mapped[object] = mapped_column(
        Date,
        nullable=False,
    )
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="draft",
        server_default="draft",
    )
    # Optional free-text; max 2000 characters enforced at the application layer.
    notes: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )
    # Snapshot of [{network, token_symbol, contract_address}, …] at creation time.
    accepted_tokens: Mapped[object] = mapped_column(
        JSON,
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
        onupdate=lambda: datetime.now(UTC),
    )

    # Relationships
    merchant: Mapped["User"] = relationship(
        "User",
        foreign_keys=[merchant_id],
        lazy="select",
    )
    payment_link: Mapped[Optional["PaymentLink"]] = relationship(
        "PaymentLink",
        foreign_keys=[payment_link_id],
        lazy="select",
    )
    line_items: Mapped[list["InvoiceLineItem"]] = relationship(
        "InvoiceLineItem",
        back_populates="invoice",
        cascade="all, delete-orphan",
        order_by="InvoiceLineItem.sort_order",
        lazy="select",
    )

    def __repr__(self) -> str:
        return (
            f"<Invoice id={self.id} merchant_id={self.merchant_id} "
            f"status={self.status!r} customer={self.customer_email!r}>"
        )


# ---------------------------------------------------------------------------
# InvoiceLineItem
# ---------------------------------------------------------------------------


class InvoiceLineItem(Base):
    """A single line item within an invoice.

    Deleted automatically (CASCADE) when the parent ``Invoice`` is deleted.
    ``amount`` supports values up to 999,999.99 (Numeric 12,2).
    ``sort_order`` controls the display order of line items on the invoice.

    Requirements: 10.3
    """

    __tablename__ = "invoice_line_items"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    invoice_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("invoices.id", ondelete="CASCADE"),
        nullable=False,
    )
    # Non-empty description; max 500 characters enforced at the app layer.
    description: Mapped[str] = mapped_column(
        String(500),
        nullable=False,
    )
    # Monetary amount: max 999,999.99 (12 significant digits, 2 decimal places).
    amount: Mapped[object] = mapped_column(
        Numeric(precision=12, scale=2),
        nullable=False,
    )
    sort_order: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )

    # Relationships
    invoice: Mapped["Invoice"] = relationship(
        "Invoice",
        back_populates="line_items",
    )

    def __repr__(self) -> str:
        return (
            f"<InvoiceLineItem id={self.id} invoice_id={self.invoice_id} "
            f"amount={self.amount!r} sort_order={self.sort_order}>"
        )


# ---------------------------------------------------------------------------
# Payment (placeholder — populated by future blockchain indexer)
# ---------------------------------------------------------------------------


class Payment(Base):
    """Placeholder table populated only by a future blockchain indexer service.

    No application service code reads or writes this table in this spec.
    It exists solely to define the schema so that the Alembic migration creates
    the table and foreign-key relationships can be referenced by other models
    (e.g. ``PaymentLink.use_count`` aggregation in a future indexer).

    Status lifecycle managed by the indexer:
      ``pending`` → ``detected`` → ``confirming`` → ``confirmed`` → ``paid``

    Requirements: 6.3, 6.4, 11.9
    """

    __tablename__ = "payments"

    __table_args__ = (
        CheckConstraint(
            "status IN ('pending','detected','confirming','confirmed','paid','expired','abandoned','failed','underpaid')",
            name="ck_payments_status",
        ),
        Index("idx_payments_link", "payment_link_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    payment_link_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("payment_links.id", ondelete="CASCADE"),
        nullable=False,
    )
    invoice_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("invoices.id", ondelete="SET NULL"),
        nullable=True,
    )
    # Network identifier, e.g. 'ethereum', 'base', 'polygon', etc.
    network: Mapped[str] = mapped_column(
        String(64),
        nullable=False,
    )
    # Token symbol, e.g. 'USDC', 'USDT', 'DAI'.
    token_symbol: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
    )
    # ERC-20 contract address; null for native-token payments.
    contract_address: Mapped[Optional[str]] = mapped_column(
        String(42),
        nullable=True,
    )
    # Payer's EVM address; may be null if not yet detected.
    from_address: Mapped[Optional[str]] = mapped_column(
        String(42),
        nullable=True,
    )
    # Merchant's receiving wallet address (0x + 40 hex chars).
    to_address: Mapped[str] = mapped_column(
        String(42),
        nullable=False,
    )
    # Payer's email address collected at checkout.
    payer_email: Mapped[Optional[str]] = mapped_column(
        String(255),
        nullable=True,
    )
    # Payer's phone and address collected at checkout if configured.
    payer_phone: Mapped[Optional[str]] = mapped_column(
        String(30),
        nullable=True,
    )
    payer_address: Mapped[Optional[str]] = mapped_column(
        String(500),
        nullable=True,
    )
    # Payment amount in the token's native precision (28 significant digits, 18 dp).
    amount: Mapped[object] = mapped_column(
        Numeric(precision=28, scale=18),
        nullable=False,
    )
    # On-chain transaction hash (0x + 64 hex chars); null until broadcast.
    tx_hash: Mapped[Optional[str]] = mapped_column(
        String(66),
        nullable=True,
        unique=True,
    )
    block_number: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
    )
    confirmations: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="pending",
        server_default="pending",
    )
    confirmed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    # True when created via a sk_test_* API key; False for live-mode records.
    # Requirements: 16.1, 16.3
    is_test: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="0",
    )
    # Developer-supplied metadata dict; max 16 keys enforced at the app layer.
    # Requirement: 5.6
    metadata_json: Mapped[Optional[object]] = mapped_column(
        JSON,
        nullable=True,
    )
    # Organization that created this payment via the Developer API; nullable for
    # backward compatibility with records created before this column existed.
    # Requirement: 7.5
    organization_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("organizations.id"),
        nullable=True,
    )
    # Fiat equivalent captured at settlement time (Requirement 17.1)
    fiat_amount_at_payment: Mapped[Optional[object]] = mapped_column(
        Numeric(precision=18, scale=2),
        nullable=True,
    )
    # ISO 4217 fiat currency code; default USD (Requirement 17.1)
    fiat_currency: Mapped[Optional[str]] = mapped_column(
        String(10),
        nullable=True,
        default="USD",
        server_default="USD",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
        onupdate=lambda: datetime.now(UTC),
    )

    # Relationships (read-only; no back-populates since no service code uses these)
    payment_link: Mapped["PaymentLink"] = relationship(
        "PaymentLink",
        foreign_keys=[payment_link_id],
        lazy="select",
    )
    invoice: Mapped[Optional["Invoice"]] = relationship(
        "Invoice",
        foreign_keys=[invoice_id],
        lazy="select",
    )

    def __repr__(self) -> str:
        return (
            f"<Payment id={self.id} status={self.status!r} "
            f"network={self.network!r} token={self.token_symbol!r} "
            f"amount={self.amount!r}>"
        )

# ---------------------------------------------------------------------------
# SuspensionAppeal
# ---------------------------------------------------------------------------


class SuspensionAppeal(Base):
    """An appeal submitted by a suspended user requesting account reinstatement.

    Users may submit one pending appeal at a time.  Admins review appeals and
    set the status to 'approved' (which also reactivates the user account) or
    'rejected'.
    """

    __tablename__ = "suspension_appeals"

    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'approved', 'rejected')",
            name="ck_suspension_appeals_status",
        ),
        Index("idx_suspension_appeals_user_id", "user_id"),
        Index("idx_suspension_appeals_status", "status"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    message: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="pending",
        server_default="pending",
    )
    admin_note: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )
    reviewed_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id"),
        nullable=True,
    )
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
        onupdate=lambda: datetime.now(UTC),
    )

    # Relationships
    user: Mapped["User"] = relationship(
        "User",
        back_populates="suspension_appeals",
        foreign_keys=[user_id],
    )
    reviewer: Mapped[Optional["User"]] = relationship(
        "User",
        foreign_keys=[reviewed_by],
        lazy="select",
    )

    def __repr__(self) -> str:
        return (
            f"<SuspensionAppeal id={self.id} user_id={self.user_id} "
            f"status={self.status!r}>"
        )


# ---------------------------------------------------------------------------
# Notification
# ---------------------------------------------------------------------------


class Notification(Base):
    """In-app notification for merchant and user lifecycle/security events."""

    __tablename__ = "notifications"

    __table_args__ = (
        Index("idx_notifications_user_id", "user_id"),
        Index("idx_notifications_user_unread", "user_id", "is_read"),
        Index("idx_notifications_created_at", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    type: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="system",
        server_default="system",
    )
    title: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )
    message: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )
    link: Mapped[Optional[str]] = mapped_column(
        String(500),
        nullable=True,
    )
    is_read: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="0",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
    )

    # Relationships
    user: Mapped["User"] = relationship(
        "User",
        back_populates="notifications",
        foreign_keys=[user_id],
    )

    def __repr__(self) -> str:
        return (
            f"<Notification id={self.id} user_id={self.user_id} "
            f"type={self.type!r} is_read={self.is_read}>"
        )



# ---------------------------------------------------------------------------
# WebhookEndpoint
# ---------------------------------------------------------------------------


class WebhookEndpoint(Base):
    """Registered webhook endpoint for an organization.

    Receives signed POST requests for subscribed event types. The ``secret``
    column stores a plaintext 32-byte hex string used as the HMAC-SHA256 key
    for signing deliveries. It is returned only once at creation time.

    Auto-disable logic: after 3 consecutive calendar days where all delivery
    attempts fail, ``enabled`` is set to False and ``disabled_at`` is recorded.

    Requirements: 10.1, 10.2, 10.3
    """

    __tablename__ = "webhook_endpoints"

    __table_args__ = (
        CheckConstraint(
            "url LIKE 'https://%'",
            name="ck_webhook_endpoints_https",
        ),
        Index("idx_webhook_endpoints_org", "organization_id"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("organizations.id", ondelete="CASCADE"),
        nullable=False,
    )
    # HTTPS URL enforced by CheckConstraint above; max 2048 characters.
    url: Mapped[str] = mapped_column(
        String(2048),
        nullable=False,
    )
    # AES-256-GCM encrypted secret; stored as base64(nonce_12 || ciphertext).
    # ~108 chars for a 64-char hex plaintext; 200 chars gives comfortable headroom.
    # Returned (decrypted, plaintext) to the caller only at creation time.
    secret: Mapped[str] = mapped_column(
        String(200),
        nullable=False,
    )
    # Previous encrypted secret retained during a 24-hour rotation window so
    # in-flight deliveries can still be verified with the old signature.
    # Requirement: 23.2
    previous_secret: Mapped[Optional[str]] = mapped_column(
        String(200),
        nullable=True,
    )
    # UTC timestamp when the dual-signing window expires and previous_secret
    # can be discarded.
    previous_secret_expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    # JSON list of subscribed event type strings, e.g. ["payment.confirmed"].
    events: Mapped[object] = mapped_column(
        JSON,
        nullable=False,
    )
    enabled: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default="1",
    )
    # Set when the endpoint is auto-disabled after 3 consecutive bad days.
    disabled_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
        onupdate=lambda: datetime.now(UTC),
    )

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization",
        foreign_keys=[organization_id],
        lazy="select",
    )
    deliveries: Mapped[list["WebhookDelivery"]] = relationship(
        "WebhookDelivery",
        back_populates="endpoint",
        cascade="all, delete-orphan",
        lazy="select",
    )

    def __repr__(self) -> str:
        return (
            f"<WebhookEndpoint id={self.id} url={self.url!r} "
            f"enabled={self.enabled}>"
        )


# ---------------------------------------------------------------------------
# WebhookEvent (append-only rows; status field is the only mutable column)
# ---------------------------------------------------------------------------


class WebhookEvent(Base):
    """Outbound event record created whenever a subscribed event fires.

    Rows are never deleted. The ``status`` field is the only column that may
    be mutated after insert (``pending`` → ``delivered`` or ``failed``).
    All other mutations are prohibited at the application layer by never
    exposing UPDATE/DELETE routes for this table.

    ``id`` uses the ``evt_`` prefix followed by 28 lowercase hex characters,
    e.g. ``evt_a3f1b2c4d5e6f7a8b9c0d1e2f3a4``.

    Requirements: 10.1, 10.2, 10.3
    """

    __tablename__ = "webhook_events"

    __table_args__ = (
        CheckConstraint(
            "status IN ('pending', 'delivered', 'failed')",
            name="ck_webhook_events_status",
        ),
        Index("idx_webhook_events_org", "organization_id"),
        Index("idx_webhook_events_type", "type"),
        Index("idx_webhook_events_created", "created_at"),
    )

    # VARCHAR(32) PK with "evt_" prefix; e.g. "evt_" + 28 lowercase hex chars.
    id: Mapped[str] = mapped_column(
        String(32),
        primary_key=True,
    )
    organization_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("organizations.id"),
        nullable=False,
    )
    # Event type name, e.g. "payment.confirmed".
    type: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
    )
    # Full event envelope JSON: {id, type, created, livemode, data}.
    payload: Mapped[object] = mapped_column(
        JSON,
        nullable=False,
    )
    # False for events emitted while operating under a sk_test_* API key.
    livemode: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="0",
    )
    status: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
        default="pending",
        server_default="pending",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
    )

    # Relationships
    organization: Mapped["Organization"] = relationship(
        "Organization",
        foreign_keys=[organization_id],
        lazy="select",
    )
    deliveries: Mapped[list["WebhookDelivery"]] = relationship(
        "WebhookDelivery",
        back_populates="event",
        cascade="all, delete-orphan",
        lazy="select",
    )

    def __repr__(self) -> str:
        return (
            f"<WebhookEvent id={self.id!r} type={self.type!r} "
            f"status={self.status!r} livemode={self.livemode}>"
        )


# ---------------------------------------------------------------------------
# WebhookDelivery
# ---------------------------------------------------------------------------


class WebhookDelivery(Base):
    """Audit record for a single delivery attempt of a WebhookEvent.

    One row is created per attempt (initial + each retry), giving a complete
    audit trail. ``attempt_number=0`` is reserved for test deliveries triggered
    by ``POST /v1/webhooks/{id}/test``; real deliveries start at 1.

    ``response_body`` stores only the first 4096 bytes of the HTTP response
    body to avoid unbounded storage growth.

    Requirements: 10.1, 10.2, 10.3
    """

    __tablename__ = "webhook_deliveries"

    __table_args__ = (
        Index("idx_webhook_deliveries_endpoint", "endpoint_id"),
        Index("idx_webhook_deliveries_event", "event_id"),
        Index("idx_webhook_deliveries_created", "created_at"),
    )

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    endpoint_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("webhook_endpoints.id", ondelete="CASCADE"),
        nullable=False,
    )
    # References webhook_events.id (VARCHAR PK with "evt_" prefix).
    event_id: Mapped[str] = mapped_column(
        String(32),
        ForeignKey("webhook_events.id"),
        nullable=False,
    )
    # HTTP response status code; null on connection timeout or DNS failure.
    status_code: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
    )
    # First 4096 bytes of the HTTP response body; null on timeout/failure.
    response_body: Mapped[Optional[str]] = mapped_column(
        Text,
        nullable=True,
    )
    # Round-trip request duration in milliseconds; null on timeout.
    duration_ms: Mapped[Optional[int]] = mapped_column(
        Integer,
        nullable=True,
    )
    # 0 = synthetic test, 1 = first real attempt, 2–6 = retries.
    attempt_number: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
    )
    # True iff a 2xx HTTP response was received.
    success: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
    )
    # Set to the delivery timestamp when success=True; null on failure.
    delivered_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
    )

    # Relationships
    endpoint: Mapped["WebhookEndpoint"] = relationship(
        "WebhookEndpoint",
        back_populates="deliveries",
        lazy="select",
    )
    event: Mapped["WebhookEvent"] = relationship(
        "WebhookEvent",
        back_populates="deliveries",
        lazy="select",
    )

    def __repr__(self) -> str:
        return (
            f"<WebhookDelivery id={self.id} event_id={self.event_id!r} "
            f"attempt={self.attempt_number} success={self.success}>"
        )


# ---------------------------------------------------------------------------
# PlatformWallet (Treasury EVM Wallets with Load Balancing)
# ---------------------------------------------------------------------------


class PlatformWallet(Base):
    """Admin-configured platform EVM treasury wallet for collecting subscription upgrades.

    Supports load balancing (least usage count / round-robin) across active wallets.
    """

    __tablename__ = "platform_wallets"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    wallet_address: Mapped[str] = mapped_column(
        String(42),
        nullable=False,
        unique=True,
        index=True,
    )
    label: Mapped[str] = mapped_column(
        String(100),
        nullable=False,
        default="Primary Treasury Wallet",
    )
    network: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
        default="all_evm",
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default="1",
    )
    usage_count: Mapped[int] = mapped_column(
        Integer,
        nullable=False,
        default=0,
        server_default="0",
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        onupdate=lambda: datetime.now(UTC),
        server_default=func.now(),
    )

    payments: Mapped[list["SubscriptionPayment"]] = relationship(
        "SubscriptionPayment",
        back_populates="platform_wallet",
        lazy="select",
    )

    def __repr__(self) -> str:
        return f"<PlatformWallet id={self.id} address={self.wallet_address} active={self.is_active} usage={self.usage_count}>"


# ---------------------------------------------------------------------------
# SubscriptionPayment
# ---------------------------------------------------------------------------


class SubscriptionPayment(Base):
    """Crypto payment record for subscription tier upgrades and renewals."""

    __tablename__ = "subscription_payments"

    id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
    )
    user_id: Mapped[uuid.UUID] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    platform_wallet_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        Uuid(as_uuid=True),
        ForeignKey("platform_wallets.id", ondelete="SET NULL"),
        nullable=True,
    )
    tier: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
    )
    period: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
    )
    usd_amount: Mapped[float] = mapped_column(
        Float,
        nullable=False,
    )
    crypto_token: Mapped[str] = mapped_column(
        String(20),
        nullable=False,
    )
    crypto_network: Mapped[str] = mapped_column(
        String(50),
        nullable=False,
    )
    crypto_amount: Mapped[str] = mapped_column(
        String(60),
        nullable=False,
    )
    assigned_wallet_address: Mapped[str] = mapped_column(
        String(42),
        nullable=False,
    )
    tx_hash: Mapped[Optional[str]] = mapped_column(
        String(66),
        nullable=True,
        index=True,
    )
    amount_received: Mapped[Optional[str]] = mapped_column(
        String(60),
        nullable=True,
    )
    status: Mapped[str] = mapped_column(
        String(30),
        nullable=False,
        default="pending",
        server_default="pending",
    )
    confirmed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    reminder_10m_sent: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="0",
    )
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(UTC),
        server_default=func.now(),
    )

    user: Mapped["User"] = relationship(
        "User",
        lazy="select",
    )
    platform_wallet: Mapped[Optional["PlatformWallet"]] = relationship(
        "PlatformWallet",
        back_populates="payments",
        lazy="select",
    )

    def __repr__(self) -> str:
        return f"<SubscriptionPayment id={self.id} user_id={self.user_id} tier={self.tier} status={self.status}>"

