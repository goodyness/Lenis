"""add_developer_api_and_webhooks

Revision ID: c3d4e5f6a7b8
Revises: b2c3d4e5f6a7
Create Date: 2026-10-10

Adds three new webhook tables (webhook_endpoints, webhook_events,
webhook_deliveries) and extends the existing payments and payment_links
tables with columns required by the Developer API and test/live mode
isolation.

NOTE: Several columns were already added to the dev SQLite DB via the
lifespan auto-migration in app/main.py before this Alembic migration was
written:
  - payment_links: custom_message, collect_phone, collect_address
  - payments: payer_email, payer_phone, payer_address
Those columns are intentionally omitted here to avoid "duplicate column"
errors on the development database. They are still declared in the ORM
model and will be created fresh on any clean PostgreSQL or new SQLite DB
via Base.metadata.create_all.
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = "c3d4e5f6a7b8"
down_revision: Union[str, Sequence[str], None] = "b2c3d4e5f6a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ------------------------------------------------------------------
    # 1. ALTER existing tables — add new columns
    # ------------------------------------------------------------------

    # payments: is_test, metadata_json, organization_id
    with op.batch_alter_table("payments", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "is_test",
                sa.Boolean(),
                nullable=False,
                server_default="0",
            )
        )
        batch_op.add_column(
            sa.Column(
                "metadata_json",
                sa.JSON(),
                nullable=True,
            )
        )
        batch_op.add_column(
            sa.Column(
                "organization_id",
                sa.Uuid(),
                nullable=True,
            )
        )
        batch_op.create_index("idx_payments_is_test", ["is_test"], unique=False)
        batch_op.create_index("idx_payments_org", ["organization_id"], unique=False)

    # payment_links: is_test, external_id, organization_id
    with op.batch_alter_table("payment_links", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "is_test",
                sa.Boolean(),
                nullable=False,
                server_default="0",
            )
        )
        batch_op.add_column(
            sa.Column(
                "external_id",
                sa.String(128),
                nullable=True,
            )
        )
        batch_op.add_column(
            sa.Column(
                "organization_id",
                sa.Uuid(),
                nullable=True,
            )
        )
        batch_op.create_index("idx_payment_links_is_test", ["is_test"], unique=False)
        batch_op.create_index("idx_payment_links_org", ["organization_id"], unique=False)

    # ------------------------------------------------------------------
    # 2. Create new tables
    # ------------------------------------------------------------------

    # webhook_endpoints
    op.create_table(
        "webhook_endpoints",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("url", sa.String(2048), nullable=False),
        sa.Column("secret", sa.String(64), nullable=False),
        sa.Column("events", sa.JSON(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="1"),
        sa.Column("disabled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
        ),
        sa.CheckConstraint("url LIKE 'https://%'", name="ck_webhook_endpoints_https"),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("webhook_endpoints", schema=None) as batch_op:
        batch_op.create_index(
            "idx_webhook_endpoints_org", ["organization_id"], unique=False
        )

    # webhook_events
    op.create_table(
        "webhook_events",
        sa.Column("id", sa.String(32), nullable=False),
        sa.Column("organization_id", sa.Uuid(), nullable=False),
        sa.Column("type", sa.String(100), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.Column("livemode", sa.Boolean(), nullable=False, server_default="0"),
        sa.Column(
            "status",
            sa.String(20),
            nullable=False,
            server_default="pending",
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
        ),
        sa.CheckConstraint(
            "status IN ('pending','delivered','failed')",
            name="ck_webhook_events_status",
        ),
        sa.ForeignKeyConstraint(
            ["organization_id"],
            ["organizations.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("webhook_events", schema=None) as batch_op:
        batch_op.create_index(
            "idx_webhook_events_org", ["organization_id"], unique=False
        )
        batch_op.create_index("idx_webhook_events_type", ["type"], unique=False)
        batch_op.create_index(
            "idx_webhook_events_created", ["created_at"], unique=False
        )

    # webhook_deliveries
    op.create_table(
        "webhook_deliveries",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("endpoint_id", sa.Uuid(), nullable=False),
        sa.Column("event_id", sa.String(32), nullable=False),
        sa.Column("status_code", sa.Integer(), nullable=True),
        sa.Column("response_body", sa.Text(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("attempt_number", sa.Integer(), nullable=False),
        sa.Column("success", sa.Boolean(), nullable=False),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("(CURRENT_TIMESTAMP)"),
        ),
        sa.ForeignKeyConstraint(
            ["endpoint_id"],
            ["webhook_endpoints.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["event_id"],
            ["webhook_events.id"],
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    with op.batch_alter_table("webhook_deliveries", schema=None) as batch_op:
        batch_op.create_index(
            "idx_webhook_deliveries_endpoint", ["endpoint_id"], unique=False
        )
        batch_op.create_index(
            "idx_webhook_deliveries_event", ["event_id"], unique=False
        )
        batch_op.create_index(
            "idx_webhook_deliveries_created", ["created_at"], unique=False
        )


def downgrade() -> None:
    # Drop new tables in reverse dependency order.
    with op.batch_alter_table("webhook_deliveries", schema=None) as batch_op:
        batch_op.drop_index("idx_webhook_deliveries_created")
        batch_op.drop_index("idx_webhook_deliveries_event")
        batch_op.drop_index("idx_webhook_deliveries_endpoint")
    op.drop_table("webhook_deliveries")

    with op.batch_alter_table("webhook_events", schema=None) as batch_op:
        batch_op.drop_index("idx_webhook_events_created")
        batch_op.drop_index("idx_webhook_events_type")
        batch_op.drop_index("idx_webhook_events_org")
    op.drop_table("webhook_events")

    with op.batch_alter_table("webhook_endpoints", schema=None) as batch_op:
        batch_op.drop_index("idx_webhook_endpoints_org")
    op.drop_table("webhook_endpoints")

    # Drop added columns from payment_links.
    # NOTE: SQLite has limited ALTER TABLE support, but batch mode handles this.
    with op.batch_alter_table("payment_links", schema=None) as batch_op:
        batch_op.drop_index("idx_payment_links_org")
        batch_op.drop_index("idx_payment_links_is_test")
        batch_op.drop_column("organization_id")
        batch_op.drop_column("external_id")
        batch_op.drop_column("is_test")

    # Drop added columns from payments.
    # NOTE: SQLite has limited ALTER TABLE support, but batch mode handles this.
    with op.batch_alter_table("payments", schema=None) as batch_op:
        batch_op.drop_index("idx_payments_org")
        batch_op.drop_index("idx_payments_is_test")
        batch_op.drop_column("organization_id")
        batch_op.drop_column("metadata_json")
        batch_op.drop_column("is_test")
