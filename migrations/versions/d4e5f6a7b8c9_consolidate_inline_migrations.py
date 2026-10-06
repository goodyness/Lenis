"""Consolidate inline SQLite auto-migrations into Alembic

Revision ID: d4e5f6a7b8c9
Revises: c3d4e5f6a7b8
Create Date: 2026-10-06

Consolidates all schema additions previously applied by the _sync_sqlite_cols
inline migration in app/main.py lifespan.  That helper has now been removed;
this migration is the canonical record of those changes so that any clean
PostgreSQL install or new SQLite database gets the same schema.

Columns that were *already* covered by earlier migrations are intentionally
omitted here to avoid duplicate-column errors.  Specifically:

  - payments:      is_test, metadata_json, organization_id  (c3d4e5f6a7b8)
  - payment_links: is_test, external_id, organization_id    (c3d4e5f6a7b8)
  - Tables webhook_endpoints / webhook_events / webhook_deliveries were
    created fresh in c3d4e5f6a7b8.

New columns added here:

  users:
    phone_number, phone_verified, phone_otp_hash, phone_otp_expires_at,
    notification_preferences, subscription_tier, subscription_period,
    subscription_expires_at, monthly_tx_count, subscription_grace_until,
    subscription_last_reminder, two_factor_enabled, two_factor_secret,
    last_login_ip, last_login_ua, security_otp_hash, security_otp_expires_at,
    security_otp_channel, security_unlocked_until, security_unlocked_ip,
    security_unlocked_ua

  merchant_profiles:
    brand_logo_url, brand_color, brand_tagline, support_email, support_phone,
    business_address, business_description, business_category,
    monthly_volume_estimate, kyc_didit_session_id

  payment_links:
    custom_message, collect_phone, collect_address

  payments:
    payer_phone, payer_address

  subscription_payments:
    amount_received, reminder_10m_sent

  webhook_endpoints:
    previous_secret, previous_secret_expires_at
    (secret column widened from VARCHAR(64) to VARCHAR(200))
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d4e5f6a7b8c9"
down_revision: Union[str, Sequence[str], None] = "c3d4e5f6a7b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _existing_columns(table_name: str) -> set[str]:
    """Return the set of column names currently in *table_name*."""
    conn = op.get_bind()
    insp = sa.inspect(conn)
    return {c["name"] for c in insp.get_columns(table_name)}


def _add_missing(table_name: str, columns: list[sa.Column]) -> None:
    """Add only the columns from *columns* that do not already exist in *table_name*.

    Uses inspect() before opening the batch context so we never attempt to add
    a column that is already present — the previous try/except approach failed
    because batch_alter_table defers SQL execution until the ``with`` block
    exits, meaning the exception fired outside the try.
    """
    existing = _existing_columns(table_name)
    missing = [c for c in columns if c.name not in existing]
    if not missing:
        return
    with op.batch_alter_table(table_name, schema=None) as batch_op:
        for col in missing:
            batch_op.add_column(col)


def _drop(batch_op, name: str) -> None:
    """Drop a column, silently ignoring errors (e.g. already gone)."""
    try:
        batch_op.drop_column(name)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Upgrade
# ---------------------------------------------------------------------------

def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. users
    # ------------------------------------------------------------------
    _add_missing("users", [
        sa.Column("phone_number", sa.String(30), nullable=True),
        sa.Column("phone_verified", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("phone_otp_hash", sa.String(72), nullable=True),
        sa.Column("phone_otp_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notification_preferences", sa.Text(), nullable=True),
        sa.Column("subscription_tier", sa.String(30), nullable=False, server_default="free"),
        sa.Column("subscription_period", sa.String(20), nullable=True),
        sa.Column("subscription_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("monthly_tx_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("subscription_grace_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("subscription_last_reminder", sa.DateTime(timezone=True), nullable=True),
        sa.Column("two_factor_enabled", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("two_factor_secret", sa.String(64), nullable=True),
        sa.Column("last_login_ip", sa.String(45), nullable=True),
        sa.Column("last_login_ua", sa.String(255), nullable=True),
        sa.Column("security_otp_hash", sa.String(72), nullable=True),
        sa.Column("security_otp_expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("security_otp_channel", sa.String(20), nullable=True),
        sa.Column("security_unlocked_until", sa.DateTime(timezone=True), nullable=True),
        sa.Column("security_unlocked_ip", sa.String(45), nullable=True),
        sa.Column("security_unlocked_ua", sa.String(255), nullable=True),
    ])

    # ------------------------------------------------------------------
    # 2. merchant_profiles
    # ------------------------------------------------------------------
    _add_missing("merchant_profiles", [
        sa.Column("brand_logo_url", sa.String(500), nullable=True),
        sa.Column("brand_color", sa.String(7), nullable=True, server_default="#4F46E5"),
        sa.Column("brand_tagline", sa.String(255), nullable=True),
        sa.Column("support_email", sa.String(254), nullable=True),
        sa.Column("support_phone", sa.String(30), nullable=True),
        sa.Column("business_address", sa.String(500), nullable=True),
        sa.Column("business_description", sa.Text(), nullable=True),
        sa.Column("business_category", sa.String(100), nullable=True),
        sa.Column("monthly_volume_estimate", sa.String(50), nullable=True),
        sa.Column("kyc_didit_session_id", sa.String(200), nullable=True),
    ])

    # ------------------------------------------------------------------
    # 3. payment_links
    # ------------------------------------------------------------------
    _add_missing("payment_links", [
        sa.Column("custom_message", sa.String(500), nullable=True),
        sa.Column("collect_phone", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column("collect_address", sa.Boolean(), nullable=False, server_default="0"),
    ])

    # ------------------------------------------------------------------
    # 4. payments
    # ------------------------------------------------------------------
    _add_missing("payments", [
        sa.Column("payer_phone", sa.String(30), nullable=True),
        sa.Column("payer_address", sa.String(500), nullable=True),
    ])

    # ------------------------------------------------------------------
    # 5. subscription_payments (table may not exist on all installs)
    # ------------------------------------------------------------------
    conn = op.get_bind()
    insp = sa.inspect(conn)
    if "subscription_payments" in insp.get_table_names():
        _add_missing("subscription_payments", [
            sa.Column("amount_received", sa.String(60), nullable=True),
            sa.Column("reminder_10m_sent", sa.Boolean(), nullable=False, server_default="0"),
        ])

    # ------------------------------------------------------------------
    # 6. webhook_endpoints — widen secret column + add rotation columns
    # ------------------------------------------------------------------
    if "webhook_endpoints" in insp.get_table_names():
        _add_missing("webhook_endpoints", [
            sa.Column("previous_secret", sa.String(200), nullable=True),
            sa.Column("previous_secret_expires_at", sa.DateTime(timezone=True), nullable=True),
        ])
        # Widen secret column from VARCHAR(64) to VARCHAR(200) if needed.
        # SQLite ignores varchar widths at runtime so this is a no-op there,
        # but it keeps PostgreSQL installs consistent.
        try:
            with op.batch_alter_table("webhook_endpoints", schema=None) as batch_op:
                batch_op.alter_column(
                    "secret",
                    existing_type=sa.String(64),
                    type_=sa.String(200),
                    existing_nullable=False,
                )
        except Exception:
            pass


# ---------------------------------------------------------------------------
# Downgrade
# ---------------------------------------------------------------------------

def downgrade() -> None:
    # ------------------------------------------------------------------
    # 6. webhook_endpoints
    # ------------------------------------------------------------------
    try:
        with op.batch_alter_table("webhook_endpoints", schema=None) as batch_op:
            _drop(batch_op, "previous_secret_expires_at")
            _drop(batch_op, "previous_secret")
            try:
                batch_op.alter_column(
                    "secret",
                    existing_type=sa.String(200),
                    type_=sa.String(64),
                    existing_nullable=False,
                )
            except Exception:
                pass
    except Exception:
        pass

    # ------------------------------------------------------------------
    # 5. subscription_payments
    # ------------------------------------------------------------------
    try:
        with op.batch_alter_table("subscription_payments", schema=None) as batch_op:
            _drop(batch_op, "reminder_10m_sent")
            _drop(batch_op, "amount_received")
    except Exception:
        pass

    # ------------------------------------------------------------------
    # 4. payments
    # ------------------------------------------------------------------
    with op.batch_alter_table("payments", schema=None) as batch_op:
        _drop(batch_op, "payer_address")
        _drop(batch_op, "payer_phone")

    # ------------------------------------------------------------------
    # 3. payment_links
    # ------------------------------------------------------------------
    with op.batch_alter_table("payment_links", schema=None) as batch_op:
        _drop(batch_op, "collect_address")
        _drop(batch_op, "collect_phone")
        _drop(batch_op, "custom_message")

    # ------------------------------------------------------------------
    # 2. merchant_profiles
    # ------------------------------------------------------------------
    with op.batch_alter_table("merchant_profiles", schema=None) as batch_op:
        _drop(batch_op, "kyc_didit_session_id")
        _drop(batch_op, "monthly_volume_estimate")
        _drop(batch_op, "business_category")
        _drop(batch_op, "business_description")
        _drop(batch_op, "business_address")
        _drop(batch_op, "support_phone")
        _drop(batch_op, "support_email")
        _drop(batch_op, "brand_tagline")
        _drop(batch_op, "brand_color")
        _drop(batch_op, "brand_logo_url")

    # ------------------------------------------------------------------
    # 1. users
    # ------------------------------------------------------------------
    with op.batch_alter_table("users", schema=None) as batch_op:
        _drop(batch_op, "security_unlocked_ua")
        _drop(batch_op, "security_unlocked_ip")
        _drop(batch_op, "security_unlocked_until")
        _drop(batch_op, "security_otp_channel")
        _drop(batch_op, "security_otp_expires_at")
        _drop(batch_op, "security_otp_hash")
        _drop(batch_op, "last_login_ua")
        _drop(batch_op, "last_login_ip")
        _drop(batch_op, "two_factor_secret")
        _drop(batch_op, "two_factor_enabled")
        _drop(batch_op, "subscription_last_reminder")
        _drop(batch_op, "subscription_grace_until")
        _drop(batch_op, "monthly_tx_count")
        _drop(batch_op, "subscription_expires_at")
        _drop(batch_op, "subscription_period")
        _drop(batch_op, "subscription_tier")
        _drop(batch_op, "notification_preferences")
        _drop(batch_op, "phone_otp_expires_at")
        _drop(batch_op, "phone_otp_hash")
        _drop(batch_op, "phone_verified")
        _drop(batch_op, "phone_number")
