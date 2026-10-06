"""Add fiat fields to payments, allowed_ips to api_keys, and create org_members table

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-10-07

Adds:
  payments:
    fiat_amount_at_payment NUMERIC(18,2) NULL
    fiat_currency          VARCHAR(10)   NULL  DEFAULT 'USD'

  api_keys:
    allowed_ips TEXT NULL

  org_members (new table, created only if not already present):
    id               CHAR(36)  PK
    organization_id  CHAR(36)  NOT NULL  FK → organizations.id ON DELETE CASCADE
    user_id          CHAR(36)  NOT NULL  FK → users.id         ON DELETE CASCADE
    role             VARCHAR(20) NOT NULL  CHECK role IN ('owner','admin','developer')
    invited_by       CHAR(36)  NULL      FK → users.id
    accepted_at      DATETIME(tz) NULL
    created_at       DATETIME(tz) NOT NULL
    UniqueConstraint(organization_id, user_id)
    Index on organization_id
    Index on user_id
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "e5f6a7b8c9d0"
down_revision: Union[str, Sequence[str], None] = "d4e5f6a7b8c9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# ---------------------------------------------------------------------------
# Helpers (same pattern as d4e5f6a7b8c9)
# ---------------------------------------------------------------------------

def _existing_columns(table_name: str) -> set[str]:
    """Return the set of column names currently in *table_name*."""
    conn = op.get_bind()
    insp = sa.inspect(conn)
    return {c["name"] for c in insp.get_columns(table_name)}


def _add_missing(table_name: str, columns: list[sa.Column]) -> None:
    """Add only the columns from *columns* that do not already exist in *table_name*.

    Inspects existing columns before opening the batch context so we never
    attempt to add a column that is already present.
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
    # 1. payments — add fiat tracking columns
    # ------------------------------------------------------------------
    _add_missing("payments", [
        sa.Column("fiat_amount_at_payment", sa.Numeric(18, 2), nullable=True),
        sa.Column("fiat_currency", sa.String(10), nullable=True, server_default="USD"),
    ])

    # ------------------------------------------------------------------
    # 2. api_keys — add IP allowlist column
    # ------------------------------------------------------------------
    _add_missing("api_keys", [
        sa.Column("allowed_ips", sa.Text(), nullable=True),
    ])

    # ------------------------------------------------------------------
    # 3. org_members — create table only if it doesn't already exist
    # ------------------------------------------------------------------
    conn = op.get_bind()
    insp = sa.inspect(conn)
    if "org_members" not in insp.get_table_names():
        op.create_table(
            "org_members",
            sa.Column("id", sa.String(36), nullable=False),
            sa.Column("organization_id", sa.String(36), nullable=False),
            sa.Column("user_id", sa.String(36), nullable=False),
            sa.Column("role", sa.String(20), nullable=False),
            sa.Column("invited_by", sa.String(36), nullable=True),
            sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.ForeignKeyConstraint(
                ["organization_id"],
                ["organizations.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["user_id"],
                ["users.id"],
                ondelete="CASCADE",
            ),
            sa.ForeignKeyConstraint(
                ["invited_by"],
                ["users.id"],
            ),
            sa.UniqueConstraint(
                "organization_id", "user_id", name="uq_org_members_org_user"
            ),
            sa.CheckConstraint(
                "role IN ('owner','admin','developer')",
                name="ck_org_members_role",
            ),
        )
        op.create_index(
            "ix_org_members_organization_id",
            "org_members",
            ["organization_id"],
        )
        op.create_index(
            "ix_org_members_user_id",
            "org_members",
            ["user_id"],
        )


# ---------------------------------------------------------------------------
# Downgrade
# ---------------------------------------------------------------------------

def downgrade() -> None:
    # ------------------------------------------------------------------
    # 3. org_members — drop table and its indexes (indexes dropped automatically)
    # ------------------------------------------------------------------
    conn = op.get_bind()
    insp = sa.inspect(conn)
    if "org_members" in insp.get_table_names():
        op.drop_index("ix_org_members_user_id", table_name="org_members")
        op.drop_index("ix_org_members_organization_id", table_name="org_members")
        op.drop_table("org_members")

    # ------------------------------------------------------------------
    # 2. api_keys — remove allowed_ips
    # ------------------------------------------------------------------
    with op.batch_alter_table("api_keys", schema=None) as batch_op:
        _drop(batch_op, "allowed_ips")

    # ------------------------------------------------------------------
    # 1. payments — remove fiat columns
    # ------------------------------------------------------------------
    with op.batch_alter_table("payments", schema=None) as batch_op:
        _drop(batch_op, "fiat_currency")
        _drop(batch_op, "fiat_amount_at_payment")
