"""
Alembic environment configuration for the Lenis platform.

Supports both offline (SQL script generation) and online (live database)
migration modes. The online mode uses an async engine via asyncio.run() to
support aiosqlite (development) and asyncpg (production).
"""
from __future__ import annotations

import asyncio
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context

# ---------------------------------------------------------------------------
# Alembic Config object -- access to values within alembic.ini
# ---------------------------------------------------------------------------
config = context.config

# Set up Python logging from the ini file.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# ---------------------------------------------------------------------------
# Import application metadata and settings
# ---------------------------------------------------------------------------
# These imports make the ORM models visible to Alembic for autogenerate.
# app.core.db.Base must be imported *after* all model modules have been
# imported (model imports happen transitively via app.core.models in task 2.1).
from app.core.db import Base  # noqa: E402
from app.core import models as _models  # noqa: E402, F401  -- registers all ORM models with Base.metadata
from app.core.config import settings  # noqa: E402

target_metadata = Base.metadata

# Override the sqlalchemy.url with the value from application settings so
# that the same DATABASE_URL env var drives both the app and migrations.
config.set_main_option("sqlalchemy.url", settings.database_url)


# ---------------------------------------------------------------------------
# Offline mode
# ---------------------------------------------------------------------------

def run_migrations_offline() -> None:
    """Run migrations in 'offline' mode (emit SQL to stdout/file).

    No live database connection is required. Useful for generating SQL scripts
    to be reviewed or applied manually.
    """
    url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        render_as_batch=True,  # required for SQLite ALTER TABLE support
    )

    with context.begin_transaction():
        context.run_migrations()


# ---------------------------------------------------------------------------
# Online mode (async)
# ---------------------------------------------------------------------------

def do_run_migrations(connection: Connection) -> None:
    """Execute migrations on the provided synchronous connection."""
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        render_as_batch=True,  # required for SQLite ALTER TABLE support
    )
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    """Create an async engine and run migrations inside a sync connection."""
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    """Run migrations in 'online' mode using the async engine."""
    asyncio.run(run_async_migrations())


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
