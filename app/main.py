"""
Lenis FastAPI application entry point.

This module creates and configures the FastAPI instance. It:
- Registers all middleware (HTTPS redirect, security headers, rate limiting)
- Conditionally includes service routers when they become available
- Defines the application lifespan for startup/shutdown events
"""
from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from app.core.config import settings
from app.core.middleware import HTTPSRedirectMiddleware, RequestIDMiddleware, SecurityHeadersMiddleware
from app.core.rate_limit import RateLimitMiddleware
from app.core.redis_client import close_redis_pool
from app.developer.middleware import APIKeyRateLimitMiddleware, IdempotencyMiddleware

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Application lifespan
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Application lifespan event handler."""

    # Configure structured JSON logging before anything else starts up (Req 11.6).
    from app.core.logging_config import configure_logging
    configure_logging(settings.app_env)

    # Production startup guard: fail fast if WEBHOOK_ENCRYPTION_KEY is missing
    # or malformed (Req 8.4).
    if settings.app_env == "production":
        from app.webhooks.crypto import _get_key
        _get_key()

    yield
    # Shutdown -- dispose DB engine & close Redis pool cleanly
    try:
        from app.core.db import engine
        await engine.dispose()
    except Exception:
        pass
    try:
        await asyncio.wait_for(close_redis_pool(), timeout=0.5)
    except Exception:
        pass



# ---------------------------------------------------------------------------
# Application factory
# ---------------------------------------------------------------------------

def create_app() -> FastAPI:
    """Create and configure the FastAPI application instance."""
    application = FastAPI(
        title=settings.app_name,
        description="Non-custodial Web3 Financial Infrastructure SaaS",
        version="0.1.0",
        docs_url="/docs" if settings.debug else None,
        redoc_url="/redoc" if settings.debug else None,
        lifespan=lifespan,
    )

    @application.exception_handler(RequestValidationError)
    async def validation_exception_handler(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        """Log and return readable 422 validation errors."""
        errors = exc.errors()
        logger.warning("422 on %s %s -- %s", request.method, request.url.path, errors)
        # Build a single human-readable message from the first error
        first = errors[0] if errors else {}
        loc_parts = [str(p) for p in first.get("loc", []) if p != "body"]
        field = loc_parts[-1].replace("_", " ").capitalize() if loc_parts else ""
        raw_msg: str = first.get("msg", "Validation error")
        import re as _re
        clean = _re.sub(r"^[Vv]alue error,\s*", "", raw_msg)
        clean = _re.sub(r"^[Ff]ield required$", "is required", clean)
        clean = _re.sub(r"^[Ss]tring should have at least \d+ character.*$", "is too short", clean)
        clean = _re.sub(r"^[Ss]tring should have at most \d+ character.*$", "is too long", clean)
        detail = f"{field} {clean}".strip() if field else clean
        return JSONResponse(status_code=422, content={"detail": detail})

    @application.exception_handler(Exception)
    async def global_exception_handler(
        request: Request, exc: Exception
    ) -> JSONResponse:
        """Catch-all for unhandled exceptions to prevent leaking tracebacks."""
        if isinstance(exc, HTTPException):
            return JSONResponse(
                status_code=exc.status_code,
                content={"detail": exc.detail},
                headers=exc.headers,
            )
        logger.exception("Unhandled 500 error on %s %s: %s", request.method, request.url.path, exc)
        return JSONResponse(
            status_code=500,
            content={"detail": "Internal server error. Our engineering team has been notified."},
        )

    # ------------------------------------------------------------------
    # Middleware
    #
    # Middleware is applied in reverse registration order (last added is the
    # outermost layer that wraps everything underneath it).
    #
    # Registration order and resulting execution order:
    #   1. add HTTPSRedirectMiddleware  -> executes 3rd (innermost of the three)
    #   2. add SecurityHeadersMiddleware -> executes 2nd
    #   3. add RateLimitMiddleware (x2)  -> executes 1st (outermost)
    #
    # This means security headers are added to every response (including
    # redirect responses produced by HTTPSRedirectMiddleware) because
    # SecurityHeadersMiddleware wraps HTTPSRedirectMiddleware.
    # ------------------------------------------------------------------
    application.add_middleware(HTTPSRedirectMiddleware)
    application.add_middleware(SecurityHeadersMiddleware)

    # CORS -- must be registered after custom middleware so it executes first
    # (Starlette applies middleware in reverse registration order).
    application.add_middleware(
        CORSMiddleware,
        allow_origins=[settings.frontend_origin],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Rate limiting: 10 requests per IP per minute on auth endpoints (Req 10.4).
    application.add_middleware(
        RateLimitMiddleware,
        endpoint_pattern="/auth/register",
        max_requests=settings.rate_limit_requests_per_minute,
        window_seconds=60,
    )
    application.add_middleware(
        RateLimitMiddleware,
        endpoint_pattern="/auth/login",
        max_requests=settings.rate_limit_requests_per_minute,
        window_seconds=60,
    )
    # Rate limiting on public checkout endpoints (60 req / min)
    application.add_middleware(
        RateLimitMiddleware,
        endpoint_pattern="/pay",
        max_requests=60,
        window_seconds=60,
    )
    # Idempotency deduplication for POST /v1/* (Req 4.1â€“4.5)
    application.add_middleware(IdempotencyMiddleware)
    # Per-API-key sliding-window rate limiter for /v1/* (Req 3.1â€“3.5, 4.1â€“4.5)
    application.add_middleware(APIKeyRateLimitMiddleware)
    # Request ID correlation â€” outermost middleware, runs first on every request
    # (Req 11.3, 11.4). Added last so it wraps everything else.
    application.add_middleware(RequestIDMiddleware)

    # ------------------------------------------------------------------
    # Routers
    #
    # Service routers are included conditionally. Each router module is
    # created in a later task. Until those tasks run, the import will raise
    # ImportError and the application continues to start without that router
    # -- this supports incremental development.
    # ------------------------------------------------------------------
    _include_router_if_available(
        application,
        module="app.auth.router",
        attr="router",
        prefix="/auth",
        tags=["auth"],
    )
    _include_router_if_available(
        application,
        module="app.users.router",
        attr="router",
        prefix="/users",
        tags=["users"],
    )
    _include_router_if_available(
        application,
        module="app.verification.router",
        attr="router",
        prefix="/verification",
        tags=["verification"],
    )
    _include_router_if_available(
        application,
        module="app.admin.router",
        attr="router",
        prefix="/admin",
        tags=["admin"],
    )
    _include_router_if_available(
        application,
        module="app.developer.router",
        attr="router",
        prefix="",
        tags=["developer-api"],
    )
    _include_router_if_available(
        application,
        module="app.merchant.router",
        attr="router",
        prefix="/merchant",
        tags=["merchant"],
    )
    _include_router_if_available(
        application,
        module="app.checkout.router",
        attr="router",
        prefix="",
        tags=["checkout"],
    )
    _include_router_if_available(
        application,
        module="app.networks.router",
        attr="router",
        prefix="",
        tags=["networks"],
    )
    _include_router_if_available(
        application,
        module="app.notifications.router",
        attr="router",
        prefix="/notifications",
        tags=["notifications"],
    )
    _include_router_if_available(
        application,
        module="app.notifications.router",
        attr="router",
        prefix="/api/v1/notifications",
        tags=["notifications"],
    )
    _include_router_if_available(
        application,
        module="app.webhooks.router",
        attr="router",
        prefix="",
        tags=["webhooks"],
    )
    _include_router_if_available(
        application,
        module="app.public.router",
        attr="router",
        prefix="",
        tags=["public"],
    )
    _include_router_if_available(
        application,
        module="app.web3.router",
        attr="router",
        prefix="",
        tags=["blockchain"],
    )

    # ------------------------------------------------------------------
    # Health and readiness endpoints (Req 10.1â€“10.6)
    # ------------------------------------------------------------------

    @application.get("/health", tags=["ops"])
    async def health_check() -> dict:
        """Liveness probe â€” no DB or Redis calls, always fast."""
        return {"status": "ok"}

    @application.get("/ready", tags=["ops"])
    async def readiness_check() -> JSONResponse:
        """Readiness probe â€” checks DB and Redis connectivity."""
        from sqlalchemy import text as sa_text

        from app.core.db import AsyncSessionLocal
        from app.core.redis_client import _get_pool

        import redis.asyncio as _aioredis

        db_status = "ok"
        redis_status = "ok"

        # DB check
        try:
            async with asyncio.timeout(2.0):
                async with AsyncSessionLocal() as s:
                    await s.execute(sa_text("SELECT 1"))
        except Exception:
            db_status = "error"

        # Redis check
        try:
            async with asyncio.timeout(2.0):
                r = _aioredis.Redis(connection_pool=_get_pool())
                await r.ping()
                await r.aclose()
        except Exception:
            redis_status = "error"

        status_code = 503 if (db_status == "error" or redis_status == "error") else 200
        overall = "ok" if status_code == 200 else "degraded"
        return JSONResponse(
            status_code=status_code,
            content={"status": overall, "db": db_status, "redis": redis_status},
        )

    @application.get("/api/v1/uploads/{file_path:path}", tags=["uploads"])
    @application.get("/uploads/{file_path:path}", tags=["uploads"])
    async def get_uploaded_file(file_path: str) -> Response:
        """Serve uploaded public assets such as store branding logos."""
        from app.core.storage import get_storage_backend
        storage = get_storage_backend()
        try:
            content, content_type = await storage.get_file(file_path)
            return Response(content=content, media_type=content_type)
        except Exception:
            raise HTTPException(status_code=404, detail="File not found.")

    return application


def _include_router_if_available(
    app: FastAPI,
    *,
    module: str,
    attr: str,
    prefix: str,
    tags: list[str],
) -> None:
    """Import *module* and attach its *attr* router to *app*.

    Silently skip if the module or attribute does not exist yet, logging a
    debug message so developers can see which routers are pending.
    """
    import importlib  # noqa: PLC0415

    try:
        mod = importlib.import_module(module)
        router = getattr(mod, attr, None)
        if router is None:
            logger.debug("Router attribute '%s' not found in %s -- skipping.", attr, module)
            return
        app.include_router(router, prefix=prefix, tags=tags)
        logger.debug("Included router from %s at prefix '%s'.", module, prefix)
    except ImportError as exc:
        logger.debug(
            "Router module '%s' not available yet (%s) -- skipping. "
            "This is expected until the corresponding service task is complete.",
            module,
            exc,
        )


app = create_app()
