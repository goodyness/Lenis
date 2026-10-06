"""Add section review fields to merchant_profiles

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Create Date: 2026-10-03

"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b2c3d4e5f6a7"
down_revision: Union[str, Sequence[str], None] = "a1b2c3d4e5f6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "merchant_profiles",
        sa.Column(
            "personal_info_status",
            sa.String(20),
            nullable=False,
            server_default="pending",
        ),
    )
    op.add_column(
        "merchant_profiles",
        sa.Column(
            "personal_info_rejection_reason",
            sa.String(500),
            nullable=True,
        ),
    )
    op.add_column(
        "merchant_profiles",
        sa.Column(
            "business_info_status",
            sa.String(20),
            nullable=False,
            server_default="pending",
        ),
    )
    op.add_column(
        "merchant_profiles",
        sa.Column(
            "business_info_rejection_reason",
            sa.String(500),
            nullable=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("merchant_profiles", "business_info_rejection_reason")
    op.drop_column("merchant_profiles", "business_info_status")
    op.drop_column("merchant_profiles", "personal_info_rejection_reason")
    op.drop_column("merchant_profiles", "personal_info_status")
