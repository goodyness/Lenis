"""Add suspension fields to users and create suspension_appeals table

Revision ID: a1b2c3d4e5f6
Revises: 67994d65ccf6
Create Date: 2026-10-03

"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a1b2c3d4e5f6"
down_revision: Union[str, Sequence[str], None] = "67994d65ccf6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add suspension_reason and suspension_message columns to users table
    op.add_column(
        "users",
        sa.Column("suspension_reason", sa.String(100), nullable=True),
    )
    op.add_column(
        "users",
        sa.Column("suspension_message", sa.Text(), nullable=True),
    )

    # Create suspension_appeals table
    op.create_table(
        "suspension_appeals",
        sa.Column("id", sa.Uuid(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column(
            "status",
            sa.String(20),
            nullable=False,
            server_default="pending",
        ),
        sa.Column("admin_note", sa.Text(), nullable=True),
        sa.Column(
            "reviewed_by",
            sa.Uuid(as_uuid=True),
            sa.ForeignKey("users.id"),
            nullable=True,
        ),
        sa.Column("reviewed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'approved', 'rejected')",
            name="ck_suspension_appeals_status",
        ),
    )
    op.create_index(
        "idx_suspension_appeals_user_id",
        "suspension_appeals",
        ["user_id"],
    )
    op.create_index(
        "idx_suspension_appeals_status",
        "suspension_appeals",
        ["status"],
    )


def downgrade() -> None:
    op.drop_index("idx_suspension_appeals_status", table_name="suspension_appeals")
    op.drop_index("idx_suspension_appeals_user_id", table_name="suspension_appeals")
    op.drop_table("suspension_appeals")
    op.drop_column("users", "suspension_message")
    op.drop_column("users", "suspension_reason")
