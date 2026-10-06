# Implementation Plan: Production-Ready Platform

## Overview

This plan converts the Lenis Web3 Financial Infrastructure SaaS from a functional development build into a production-deployable, observable, and commercially complete platform. Tasks are grouped into five sections matching the four requirement groups plus property-based tests, ordered so every task only depends on previously-completed work.

The codebase is Python 3.12 + FastAPI 0.115 + SQLAlchemy 2.0 async. The existing `app/web3/indexer.py` has an `EVMIndexer` scan helper but no Celery task or webhook endpoint — those must be added. `app/developer/middleware.py` already contains `IdempotencyMiddleware` and `APIKeyRateLimitMiddleware` — they must be wired into `app/main.py`. All database schema additions go through Alembic only.

---

## Tasks

---

### Section 1: Critical Blockers

- [x] 1. Add new config variables and register web3 router
  - [x] 1.1 Add `blockchain_webhook_secret: str = ""`, `indexer_polling_enabled: bool = False`, and `webhook_encryption_key: str = ""` to the `Settings` class in `app/core/config.py`
    - Place them in a new `# Blockchain Indexer` section after the existing testnet RPC block
    - Also add `coingecko_api_key: str = ""` (used by price oracle in Section 4)
    - _Requirements: 1.2, 2.1, 17.3_

  - [x] 1.2 Create `app/web3/router.py` with `POST /webhooks/blockchain` endpoint
    - Import and call `_validate_provider_signature(body_bytes, request.headers)` from `app/web3/indexer.py` — raises `HTTPException(401)` on failure
    - Read raw body bytes with `await request.body()` **before** JSON-parsing (required for correct HMAC)
    - Dispatch `process_blockchain_event.delay(payload)` Celery task
    - Return `{"status": "accepted"}` with HTTP 200; total handler time must be < 500ms
    - _Requirements: 1.1, 1.2, 1.3, 1.7_

  - [x] 1.3 Register `app.web3.router` in `app/main.py`
    - Add `_include_router_if_available(application, module="app.web3.router", attr="router", prefix="", tags=["blockchain"])` to `create_app()`
    - Add `"app.web3.indexer"` to the `include` list in `app/core/celery_app.py`
    - _Requirements: 1.1, 1.7_

- [x] 2. Implement blockchain indexer — webhook mode
  - [x] 2.1 Add `_validate_provider_signature(body: bytes, headers: Headers) -> None` to `app/web3/indexer.py`
    - Compute `HMAC-SHA256(settings.blockchain_webhook_secret.encode(), body).hexdigest()`
    - Accept if `X-Alchemy-Signature` or `X-QN-Signature` header matches via `hmac.compare_digest`
    - Raise `HTTPException(status_code=401, detail="invalid_signature")` on failure
    - _Requirements: 1.2, 1.3_

  - [x] 2.2 Add `parse_alchemy_payload(payload: dict) -> list[dict]` and `parse_quicknode_payload(payload: dict) -> list[dict]` to `app/web3/indexer.py`
    - Each returns a normalised list of transfer event dicts: `{tx_hash, from_address, to_address, contract_address, raw_value, block_number, chain_id}`
    - Alchemy: iterate `payload["event"]["activity"]` for `erc20` category transfers
    - QuickNode: iterate `payload["matchedTransactions"]` events with Transfer topic
    - Return empty list if payload structure is unrecognised
    - _Requirements: 1.4_

  - [x] 2.3 Add `process_blockchain_event` Celery task to `app/web3/indexer.py`
    - Decorated with `@celery_app.task(bind=True, name="app.web3.indexer.process_blockchain_event", max_retries=3)`
    - Retry delays: `[5, 30, 300]` seconds — use `self.retry(exc=exc, countdown=delays[self.request.retries])`
    - Inside the task: parse payload using `parse_alchemy_payload` / `parse_quicknode_payload`, load `MerchantWallet` records by `to_address`, call `PaymentStateMachine.record_detected_payment` for matching wallets
    - Skip testnet chain IDs when `settings.testnet_mode = False`; skip mainnet chain IDs when `settings.testnet_mode = True`
    - _Requirements: 1.4, 1.5, 1.6, 1.7, 1.8, 9.3, 9.4_

- [x] 3. Implement blockchain indexer — polling fallback mode
  - [x] 3.1 Add `poll_blockchain_events` Celery task to `app/web3/indexer.py`
    - Decorated with `@celery_app.task(name="app.web3.indexer.poll_blockchain_events")`
    - Only executes body when `settings.indexer_polling_enabled` is `True`; logs a debug message and returns immediately otherwise
    - For each active network: read `indexer:last_block:{chain_id}` from Redis; call `eth_blockNumber`; call `eth_getLogs` with topics `[ERC20_TRANSFER_TOPIC, None, padded_merchant_addresses]` for last 10 blocks
    - On RPC error: log `WARNING` with chain ID and network name, `continue` to next network — do not raise
    - Write updated `indexer:last_block:{chain_id}` to Redis after processing each network
    - Call `PaymentStateMachine.record_detected_payment` for each matched transfer; duplicate tx_hash is silently ignored (caught by unique constraint)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [x] 3.2 Add `poll_blockchain_events` to Celery beat schedule in `app/core/celery_app.py`
    - Add entry: `"poll-blockchain-events": {"task": "app.web3.indexer.poll_blockchain_events", "schedule": 15.0}`
    - _Requirements: 2.1_

- [x] 4. Wire developer API middleware into `app/main.py`
  - [x] 4.1 Import `IdempotencyMiddleware` from `app/developer/middleware.py` and register it in `create_app()` in `app/main.py`
    - Add `application.add_middleware(IdempotencyMiddleware)` — the existing implementation already satisfies Req 3.1–3.6
    - Place after `RateLimitMiddleware` registrations so it is applied to POST `/v1/*` routes
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [x] 4.2 Update `APIKeyRateLimitMiddleware` in `app/developer/middleware.py` to support enterprise tier multiplier
    - After computing `key_discriminator`, fetch `api_key_tier:{key_discriminator}` from Redis (set by the auth dependency); default to `"free"` if missing
    - Apply `effective_limit = self.RATE_LIMIT * TIER_MULTIPLIERS.get(tier, 1)` where `TIER_MULTIPLIERS = {"enterprise": 10, "pro": 5, "growth": 2, "free": 1}`
    - Use `effective_limit` in all subsequent comparisons and in `X-RateLimit-Limit` header
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 4.3 Register `APIKeyRateLimitMiddleware` in `create_app()` in `app/main.py`
    - Add `application.add_middleware(APIKeyRateLimitMiddleware)` after `IdempotencyMiddleware`
    - _Requirements: 4.1_

- [x] 5. Complete live API key generation endpoint
  - [x] 5.1 Add `generate_live_api_keys(user, org, db)` service function to `app/users/service.py`
    - Assert `user.status == "verified"` → raise `HTTPException(403, {"error": "VERIFICATION_REQUIRED"})` if not
    - Query `APIKey` for existing `key_type IN ('pk_live', 'sk_live')` for `org.id` → raise `HTTPException(409, {"error": "live_keys_already_exist"})` if found
    - Generate `pk_live_ + secrets.token_hex(32)` (publishable) and `sk_live_ + secrets.token_hex(32)` (secret)
    - Store `pk_live` key with `key_hash = SHA256(pk_live_plaintext)` and `suffix_display = plaintext[-4:]`
    - Store `sk_live` key with `key_hash = SHA256(sk_live_plaintext)` and `suffix_display = sk_live_plaintext[-4:]`; never store plaintext
    - Write `AuditLog(event_type="api_key.generate_live", actor_id=user.id, target_type="APIKey", target_id=<new_key_id>, outcome="success")`
    - Return `{"pk_live": pk_live_plaintext, "sk_live": sk_live_plaintext}`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 5.2 Add `POST /users/me/api-keys/live` route to `app/users/router.py`
    - Require JWT authentication (existing `get_current_user` dependency)
    - Call `generate_live_api_keys(user, org, db)` from service
    - Return response schema `{"pk_live": str, "sk_live": str}` — `sk_live` plaintext shown exactly once
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

- [ ] 6. Checkpoint — Critical Blockers
  - Ensure all tests pass, ask the user if questions arise.

---

### Section 2: Security Hardening

- [x] 7. Update CSP and security headers
  - [x] 7.1 Update `SecurityHeadersMiddleware.dispatch` in `app/core/middleware.py`
    - Generate per-request nonce: `nonce = secrets.token_urlsafe(16)`, assign to `request.state.csp_nonce`
    - Build dynamic `script_src`: `f"'self' 'nonce-{nonce}'"` + add `" 'unsafe-eval'"` when `settings.app_env == "development"`
    - Construct full CSP string with directives: `default-src 'self'`, `script-src {script_src}`, `style-src 'self' 'unsafe-inline'`, `font-src 'self' data:`, `connect-src 'self' {settings.frontend_origin}`, `img-src 'self' data: blob:`, `frame-ancestors 'none'`
    - Remove the static `_HEADERS` dict; set all four security headers inline in `dispatch` (keep HSTS, X-Content-Type-Options, X-Frame-Options alongside the new dynamic CSP)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8_

- [x] 8. Admin frontend route protection
  - [x] 8.1 Create `frontend/src/routing/AdminRoute.tsx`
    - Define `interface AdminRouteProps { requiredRole: 'admin' | 'superadmin'; children: ReactNode; }`
    - Read `user` and `isLoading` from `useAuthStore()` (existing Zustand store — no extra API call)
    - If `isLoading`: return `<LoadingSpinner />` (prevents premature redirect per Req 7.4)
    - If `!user`: `return <Navigate to={`/login?next=${location.pathname}`} replace />`
    - Role check: `requiredRole === 'admin'` → allow if `user.account_type` is `'admin'` or `'superadmin'`; `requiredRole === 'superadmin'` → allow only `'superadmin'`
    - On role failure: `return <Navigate to="/dashboard" replace />`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 8.2 Wrap all `/admin/*` routes in `frontend/src/App.tsx` with `<AdminRoute requiredRole="admin">`
    - Locate the existing admin route definitions and wrap their element with `<AdminRoute requiredRole="admin">...</AdminRoute>`
    - _Requirements: 7.1, 7.2, 7.3_

- [x] 9. Webhook secret encryption at rest
  - [x] 9.1 Create `app/webhooks/crypto.py`
    - Implement `_get_key() -> bytes`: base64-decode `settings.webhook_encryption_key`; raise `SystemExit(1)` if empty or not exactly 32 bytes
    - Implement `encrypt_secret(plaintext: str) -> str`: generate `nonce = os.urandom(12)`, compute `ct = AESGCM(key).encrypt(nonce, plaintext.encode(), None)`, return `base64.b64encode(nonce + ct).decode()`
    - Implement `decrypt_secret(ciphertext: str) -> str`: base64-decode, split `raw[:12]` as nonce and `raw[12:]` as ct, return `AESGCM(key).decrypt(nonce, ct, None).decode()`
    - Use `from cryptography.hazmat.primitives.ciphers.aead import AESGCM`
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x] 9.2 Add `WEBHOOK_ENCRYPTION_KEY` startup validation to `app/main.py` lifespan
    - In the `lifespan` async context manager, add: `if settings.app_env == "production": from app.webhooks.crypto import _get_key; _get_key()`
    - This raises `SystemExit(1)` if key is missing or malformed
    - _Requirements: 8.4_

  - [x] 9.3 Update `WebhookEndpoint` model in `app/core/models.py`
    - Change `secret` column from `String(64)` to `String(200)` — accommodates AES-GCM base64 ciphertext (~108 chars)
    - Add `previous_secret: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)` — stores encrypted previous secret during rotation window
    - Add `previous_secret_expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)` — dual-signing window end time
    - _Requirements: 8.1, 23.2_

  - [x] 9.4 Update `create_webhook_endpoint` in `app/webhooks/service.py` to encrypt secret before INSERT
    - Replace `secret = secrets.token_hex(32)` with: generate plaintext, call `encrypt_secret(plaintext)`, store ciphertext in `endpoint.secret`
    - Return `(endpoint, plaintext_secret)` — plaintext returned to caller for one-time display
    - _Requirements: 8.3_

  - [x] 9.5 Update `deliver_webhook` in `app/webhooks/delivery.py` to decrypt secret before signing
    - In `_load_event_and_endpoint`, after loading `endpoint.secret`, call `from app.webhooks.crypto import decrypt_secret; decrypted = decrypt_secret(endpoint.secret)` and store as `"secret_plaintext"` in `endpoint_data`
    - Also load `previous_secret` and `previous_secret_expires_at` into `endpoint_data`
    - In the `build_signature_header` call site, use `endpoint_data["secret_plaintext"]`
    - If `endpoint_data["previous_secret"]` is non-null and `previous_secret_expires_at > datetime.now(UTC)`: decrypt previous secret, call `build_signature_header` again, append second `v1=` component to signature header
    - After `previous_secret_expires_at` passes during a signature operation: update `endpoint.previous_secret = None` and `endpoint.previous_secret_expires_at = None`
    - _Requirements: 8.2, 23.3, 23.4_

- [x] 10. Testnet isolation in the Payment State Machine
  - [x] 10.1 Add `TESTNET_CHAIN_MAP` dict and `get_testnet_equivalent(mainnet_chain_id)` method to `NetworkRegistry` in `app/core/networks.py`
    - `TESTNET_CHAIN_MAP = {1: 11155111, 8453: 84532, 137: 80001, 42161: 421614, 10: 11155420}`
    - `get_testnet_equivalent(self, mainnet_chain_id: int) -> NetworkConfig | None`: look up testnet chain ID, return `self._by_chain_id.get(testnet_id)` or `None`
    - _Requirements: 9.2, 9.3_

  - [x] 10.2 Update `PaymentStateMachine.update_confirmations` in `app/web3/state_machine.py` to use testnet config when `payment.is_test = True`
    - In the network config lookup loop, if `payment.is_test`, call `network_registry.get_testnet_equivalent(n.chain_id)` and use that config's `confirmation_count`
    - Ensure `_emit_payment_webhook` is called with `livemode = not payment.is_test` (this is already indirectly handled via `payment.is_test` being forwarded to `emit_webhook_event`)
    - _Requirements: 9.1, 9.2, 9.5_

- [ ] 11. Checkpoint — Security Hardening
  - Ensure all tests pass, ask the user if questions arise.

---

### Section 3: Operational Concerns

- [x] 12. Health and readiness endpoints
  - [x] 12.1 Add `GET /health` endpoint directly to `create_app()` in `app/main.py`
    - Register as `@application.get("/health", tags=["ops"])` **after** middleware registration but before the function returns
    - Handler: `async def health_check() -> dict: return {"status": "ok"}` — no DB or Redis calls
    - _Requirements: 10.1, 10.5_

  - [x] 12.2 Add `GET /ready` endpoint to `create_app()` in `app/main.py`
    - Import `asyncio`, `text` from sqlalchemy, `aioredis`
    - DB check: `async with asyncio.timeout(2.0): async with AsyncSessionLocal() as s: await s.execute(text("SELECT 1"))` — catch any exception → `db_status = "error"`
    - Redis check: `async with asyncio.timeout(2.0): r = aioredis.Redis(...); await r.ping()` — catch any exception → `redis_status = "error"`
    - Return `JSONResponse(status_code=503 if any error else 200, content={"status": ..., "db": ..., "redis": ...})`
    - _Requirements: 10.2, 10.3, 10.4, 10.5, 10.6_

- [x] 13. Structured JSON logging and Request ID middleware
  - [x] 13.1 Create `app/core/logging_config.py`
    - Implement `configure_logging(app_env: str) -> None`
    - If `app_env == "production"`: configure root logger with `pythonjsonlogger.jsonlogger.JsonFormatter` with fields `%(asctime)s %(levelname)s %(name)s %(message)s %(request_id)s %(path)s %(method)s %(status_code)s %(duration_ms)s`; set level to `WARNING`
    - Add `RequestContextFilter(logging.Filter)` that injects `request_id = getattr(record, "request_id", None)` and returns `True`
    - If `app_env != "production"`: no-op (leave Python default logging)
    - _Requirements: 11.1, 11.2, 11.6_

  - [x] 13.2 Create `RequestIDMiddleware` in `app/core/middleware.py`
    - Subclass `BaseHTTPMiddleware`
    - In `dispatch`: extract `req_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())`
    - Set `request.state.request_id = req_id`
    - Call `call_next(request)` and set `response.headers["X-Request-ID"] = req_id` on the response
    - _Requirements: 11.3, 11.4_

  - [x] 13.3 Register `RequestIDMiddleware` in `app/main.py` and call `configure_logging()` in lifespan
    - Add `application.add_middleware(RequestIDMiddleware)` to `create_app()`
    - In the `lifespan` context manager, add `from app.core.logging_config import configure_logging; configure_logging(settings.app_env)` before the `yield`
    - _Requirements: 11.3, 11.4, 11.6_

- [x] 14. PostgreSQL connection pool configuration
  - [x] 14.1 Update engine creation in `app/core/db.py`
    - Detect `is_sqlite = settings.database_url.startswith("sqlite")`
    - If `not is_sqlite`: create engine with `pool_size=10, max_overflow=20, pool_pre_ping=True, pool_recycle=1800` — remove the `connect_args` since asyncpg does not use it
    - If `is_sqlite`: keep existing `connect_args={"check_same_thread": False}` with no pool kwargs
    - Add `import logging; logger = logging.getLogger(__name__)`
    - After engine creation: `if not is_sqlite: logger.info("DB pool: pool_size=10, max_overflow=20")`
    - If `settings.app_env == "production" and is_sqlite`: `logger.warning("SQLite is not recommended for production use.")`
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

- [~] 15. Remove inline SQLite auto-migration and create Alembic migration
  - [-] 15.1 Remove `_sync_sqlite_cols` function and its caller block from `app/main.py`
    - Delete the entire `if settings.database_url.startswith("sqlite"):` block inside `lifespan` (lines that call `_sync_sqlite_cols`)
    - Delete the `_sync_sqlite_cols` function definition
    - The `lifespan` shutdown block should retain only `engine.dispose()` and `close_redis_pool()`
    - _Requirements: 13.1, 13.4_

  - [-] 15.2 Create Alembic migration `migrations/versions/consolidate_inline_migrations.py`
    - Revision ID: generate with `alembic revision --autogenerate -m "consolidate_inline_migrations"` or create manually
    - `upgrade()` function must use `op.add_column()` for every column previously in `_sync_sqlite_cols`:
      - `users`: `phone_number` VARCHAR(30), `phone_verified` BOOLEAN default false, `phone_otp_hash` VARCHAR(72), `phone_otp_expires_at` DATETIME, `notification_preferences` TEXT, `subscription_tier` VARCHAR(30) default 'free', `subscription_period` VARCHAR(20), `subscription_expires_at` DATETIME, `monthly_tx_count` INTEGER default 0, `two_factor_enabled` BOOLEAN default false, `two_factor_secret` VARCHAR(64), `last_login_ip` VARCHAR(45), `last_login_ua` VARCHAR(255), `security_otp_hash` VARCHAR(72), `security_otp_expires_at` DATETIME, `security_otp_channel` VARCHAR(20), `security_unlocked_until` DATETIME, `security_unlocked_ip` VARCHAR(45), `security_unlocked_ua` VARCHAR(255)
      - `merchant_profiles`: `brand_logo_url` VARCHAR(500), `brand_color` VARCHAR(7) default '#4F46E5', `brand_tagline` VARCHAR(255), `support_email` VARCHAR(254), `support_phone` VARCHAR(30), `business_address` VARCHAR(500), `business_description` TEXT, `business_category` VARCHAR(100), `monthly_volume_estimate` VARCHAR(50), `kyc_didit_session_id` VARCHAR(200)
      - `payment_links`: `custom_message` VARCHAR(500), `collect_phone` BOOLEAN default false, `collect_address` BOOLEAN default false, `is_test` BOOLEAN default false, `external_id` VARCHAR(128), `organization_id` UUID/VARCHAR(36)
      - `payments`: `payer_phone` VARCHAR(30), `payer_address` VARCHAR(500), `is_test` BOOLEAN default false, `metadata_json` TEXT/JSON, `organization_id` UUID/VARCHAR(36)
      - `webhook_endpoints`, `webhook_events`, `webhook_deliveries`: all columns listed in the original `_sync_sqlite_cols` that are not already in the initial migration
    - Use `op.execute("SELECT 1")` at start of `upgrade()` as a no-op guard; use `try/except` with `pass` around each `add_column` so running against an already-migrated DB is idempotent
    - `downgrade()`: drop each added column in reverse order
    - _Requirements: 13.2, 13.3, 13.5_

- [x] 16. Webhook event replay and event listing
  - [x] 16.1 Add `replay_webhook_event(event_id, org_id, db)` service function to `app/webhooks/service.py`
    - Query `WebhookEvent` by `event_id`; if not found or `organization_id != org_id` → raise `HTTPException(404, {"error": "event_not_found"})`
    - If `event.status == "delivered"` → raise `HTTPException(422, {"error": "event_already_delivered"})`
    - Set `event.status = "pending"` and flush
    - Query all enabled `WebhookEndpoint` records for `org_id` that subscribe to `event.type`
    - For each: `celery_app.send_task("app.webhooks.delivery.deliver_webhook", args=[event_id, str(ep.id)])`
    - Return `{"event_id": event_id, "status": "pending", "enqueued_to": len(endpoints)}`
    - _Requirements: 14.1, 14.2, 14.3, 14.4_

  - [x] 16.2 Add `list_webhook_events(org_id, status, type, cursor, limit, db)` service function to `app/webhooks/service.py`
    - Cursor-paginated query of `WebhookEvent` for `organization_id = org_id`, ordered by `created_at DESC`
    - Filter by `status` if provided; filter by `type` if provided
    - Cursor is the `created_at` timestamp of the last item from the previous page
    - Return `(events: list[WebhookEvent], next_cursor: str | None)`
    - _Requirements: 14.5_

  - [x] 16.3 Add `POST /v1/webhooks/events/{event_id}/replay` and `GET /v1/webhooks/events` routes to `app/webhooks/router.py`
    - Both require API key auth via existing `get_api_key_org` dependency
    - Replay: call `replay_webhook_event`; return the result dict
    - List: call `list_webhook_events`; return `{"data": [...], "next_cursor": ...}` with pagination
    - _Requirements: 14.1, 14.5_

- [x] 17. Email dead-letter queue
  - [x] 17.1 Update `send_email_task` in `app/core/email.py` to write dead-letter records after all retries are exhausted
    - After `logger.error(...)` and before `raise self.retry(exc=exc)`, check `if self.request.retries >= self.max_retries:`
    - If so: `import redis as sync_redis, json, uuid as _uuid; key = f"email_dead_letter:{_uuid.uuid4()}"; r = sync_redis.from_url(settings.redis_url); r.set(key, json.dumps({"to": to, "subject": subject, "template": template, "context": context})); logger.critical("Email dead-lettered at key %s for recipient %s", key, to)`
    - _Requirements: 15.2_

  - [x] 17.2 Add `kombu.exceptions.OperationalError` catch at all `send_email_task.delay()` call sites in `app/core/tasks.py`
    - Wrap each `.delay()` call with `try/except (kombu.exceptions.OperationalError, Exception) as e: logger.error("Email dispatch failed for %s (%s): %s", recipient_email, template_name, e); raise`
    - Import `kombu.exceptions` at the top of the file
    - _Requirements: 15.1_

  - [x] 17.3 Add `GET /admin/email-dead-letters`, `POST /admin/email-dead-letters/{key}/retry`, and `DELETE /admin/email-dead-letters/{key}` endpoints to `app/admin/router.py`
    - All require admin auth (existing admin dependency)
    - `GET`: scan Redis for keys matching `email_dead_letter:*` using `redis.scan_iter`; for each key parse JSON and return `[{key, to, subject, template}]`
    - `POST /retry`: get key from Redis, parse JSON, call `send_email_task.delay(...)`, delete key on success; return `{"status": "requeued"}`
    - `DELETE`: `redis.delete(key)`; return `{"status": "deleted"}`
    - _Requirements: 15.3, 15.4, 15.5_

- [x] 18. Docker image and deployment
  - [x] 18.1 Create multi-stage `Dockerfile` at project root
    - Stage 1 `builder`: `FROM python:3.12-slim AS builder`, `COPY requirements.txt .`, `RUN pip install --no-cache-dir --prefix=/install -r requirements.txt`
    - Stage 2 `runtime`: `FROM python:3.12-slim AS runtime`, `RUN apt-get update && apt-get install -y --no-install-recommends libmagic1 && rm -rf /var/lib/apt/lists/*`, `COPY --from=builder /install /usr/local`, `COPY . .`, `RUN useradd -r -u 1001 lenis && chown -R lenis:lenis /app`, `USER lenis`, `CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]`
    - _Requirements: 16.1, 16.2_

  - [x] 18.2 Add libmagic production startup guard to `app/core/storage.py`
    - At module load (or in a startup function called from lifespan): `if settings.app_env == "production": try: import magic except ImportError: logger.critical("python-magic/libmagic not available in production."); raise SystemExit(1)`
    - _Requirements: 16.4_

  - [x] 18.3 Create `docker-compose.prod.yml` at project root
    - Define services: `app` (build from Dockerfile, `restart: unless-stopped`, healthcheck `curl -f http://localhost:8000/health` with 5s timeout retries 3), `worker` (same image, `command: celery -A app.core.celery_app worker --loglevel=warning`), `beat` (same image, `command: celery -A app.core.celery_app beat --loglevel=warning`), `redis` (image `redis:7-alpine`, `command: redis-server --appendonly yes`, volume `redis_data:/data`), `postgres` (image `postgres:16-alpine`, volume `pg_data:/var/lib/postgresql/data`), `nginx` (image `nginx:1.27-alpine`, ports `443:443` and `80:80`, mounts `/etc/letsencrypt:/etc/letsencrypt:ro` and `./nginx/prod.conf:/etc/nginx/conf.d/default.conf:ro`)
    - All services: `restart: unless-stopped`; `app`, `worker`, `beat` depend on `postgres` and `redis`
    - Named volumes: `pg_data` and `redis_data` at the bottom of the file
    - _Requirements: 26.1, 26.2, 26.3, 26.4, 26.5, 26.6, 26.7_

  - [x] 18.4 Create `docs/deployment.md`
    - Sections: Prerequisites (Docker, Docker Compose v2, `certbot`); Required environment variables (table with name, description, example for all 40+ vars from `.env.example`); Deployment steps (`git clone`, `.env` setup, `alembic upgrade head`, `docker compose -f docker-compose.prod.yml up -d`); TLS setup with Let's Encrypt; GCE firewall rules (open 80, 443); Health check verification (`curl /health`, `curl /ready`); libmagic note
    - _Requirements: 16.3, 26.8_

- [ ] 19. Checkpoint — Operational Concerns
  - Ensure all tests pass, ask the user if questions arise.

---

### Section 4: New Product Features

- [x] 20. Price oracle and fiat equivalent on payments
  - [x] 20.1 Create `app/core/price_oracle.py`
    - Define `COINGECKO_SYMBOL_MAP = {"USDC": "usd-coin", "USDT": "tether", "DAI": "dai", "ETH": "ethereum", "MATIC": "matic-network", "BNB": "binancecoin"}`
    - Implement `async def get_token_usd_price(token_symbol: str) -> Decimal | None`:
      - Check Redis cache key `price_oracle:{symbol.upper()}` — if hit, return `Decimal(cached)`
      - On cache miss: call CoinGecko `GET https://api.coingecko.com/api/v3/simple/price?ids={cg_id}&vs_currencies=usd` with `httpx.AsyncClient(timeout=5.0)` and optional `x-cg-demo-api-key` header from `settings.coingecko_api_key`
      - Cache result with `ex=60` seconds
      - On any exception: `logger.warning(...)`, return `None`
    - _Requirements: 17.2, 17.3, 17.4_

  - [x] 20.2 Add `fiat_amount_at_payment` and `fiat_currency` columns to `Payment` model in `app/core/models.py`
    - `fiat_amount_at_payment: Mapped[Optional[object]] = mapped_column(Numeric(precision=18, scale=2), nullable=True)`
    - `fiat_currency: Mapped[Optional[str]] = mapped_column(String(10), nullable=True, default="USD", server_default="USD")`
    - _Requirements: 17.1_

  - [x] 20.3 Add price oracle call to `PaymentStateMachine.settle_payment` in `app/web3/state_machine.py`
    - After `payment.status = "paid"` and before `await db.flush()`, add:
      ```python
      try:
          from app.core.price_oracle import get_token_usd_price
          rate = await get_token_usd_price(payment.token_symbol)
          if rate is not None:
              from decimal import ROUND_HALF_UP
              payment.fiat_amount_at_payment = (Decimal(str(payment.amount)) * rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
              payment.fiat_currency = "USD"
      except Exception as exc:
          logger.warning("fiat_amount_at_payment: price oracle failed: %s", exc)
          payment.fiat_amount_at_payment = None
      ```
    - _Requirements: 17.2, 17.4, 17.7_

  - [x] 20.4 Include `fiat_amount_at_payment` and `fiat_currency` in `GET /v1/payments/{id}` and `GET /v1/transactions/{id}` API response schemas
    - Locate the response Pydantic schema for payment detail in `app/developer/schemas.py` (or equivalent) and add both fields as `Optional`
    - _Requirements: 17.5_

- [x] 21. Customer receipt page (backend)
  - [x] 21.1 Add `GET /api/v1/receipt/{tx_hash}` endpoint to `app/checkout/router.py`
    - No authentication required
    - Query `Payment` where `tx_hash = tx_hash.lower()` and `status IN ('confirmed', 'paid')`
    - If not found: raise `HTTPException(404, {"detail": "Receipt not found"})`
    - Load associated `PaymentLink` and merchant `User` to get merchant name
    - Build block explorer URL from `BLOCK_EXPLORERS = {1: "https://etherscan.io/tx/", 8453: "https://basescan.org/tx/", 137: "https://polygonscan.com/tx/", 42161: "https://arbiscan.io/tx/", 10: "https://optimistic.etherscan.io/tx/", 56: "https://bscscan.com/tx/"}`; set to `None` if `payment.is_test = True`
    - Return `{from_address, merchant_name, to_address, amount, token_symbol, network_display_name, confirmed_at (ISO 8601 UTC), block_number, confirmations, tx_hash, block_explorer_url, is_test}`
    - _Requirements: 18.2, 18.3, 18.4, 18.6_

- [x] 22. Customer receipt page (frontend)
  - [x] 22.1 Create `frontend/src/pages/ReceiptPage.tsx`
    - Route: `/receipt/:txHash` — add to `App.tsx` as a public route (no auth required)
    - On mount: call `GET /api/v1/receipt/:txHash`
    - If 404: display "Receipt not found" message and no payment details
    - Render: payer wallet address, merchant name, merchant wallet, amount + token symbol, network, confirmation timestamp, block number, confirmations count, transaction hash as a block explorer link
    - If `is_test = true`: show visible orange banner "This is a test-mode payment receipt"; hide block explorer link
    - Add `<meta name="description" content={`Payment receipt: {amount} {token_symbol} on {network}`} />` using `react-helmet` or equivalent
    - _Requirements: 18.1, 18.2, 18.3, 18.5, 18.6_

- [x] 23. Merchant analytics
  - [x] 23.1 Create `app/merchant/analytics.py` with `get_merchant_analytics(merchant_id, period, start_date, end_date, db)` async function
    - Validate `start_date <= end_date` → raise `HTTPException(422, {"error": "invalid_date_range"})`
    - Validate `start_date >= today - 730 days` → raise `HTTPException(422, {"error": "date_range_too_large"})`
    - Load all `PaymentLink.id` values for the merchant
    - Revenue series: `SELECT date_trunc/strftime(period, confirmed_at), SUM(amount), SUM(fiat_amount_at_payment) FROM payments WHERE payment_link_id IN (...) AND status IN ('confirmed','paid') AND confirmed_at BETWEEN ... GROUP BY date ORDER BY date`
    - Top tokens: `SELECT token_symbol, SUM(amount), COUNT(*) GROUP BY token_symbol ORDER BY SUM(amount) DESC LIMIT 5`
    - Top networks: `SELECT network, SUM(amount), COUNT(*) GROUP BY network ORDER BY SUM(amount) DESC LIMIT 5`
    - Conversion rate: confirmed+paid count / total count (return 0 if no records)
    - Average payment size: mean `fiat_amount_at_payment` for confirmed/paid, rounded to 2 dp; `None` if no records
    - Cache result in Redis under `analytics:{merchant_id}:{period}:{start_date}:{end_date}` with TTL 300s
    - Return typed dict matching the response schema
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5_

  - [x] 23.2 Add `GET /merchant/analytics` endpoint to `app/merchant/router.py`
    - Auth: existing merchant JWT + `onboarding_complete = True` guard
    - Query params: `period: Literal["daily","weekly","monthly"] = "daily"`, `start_date: date`, `end_date: date`
    - Call `get_merchant_analytics(...)` and return the result
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5_

  - [x] 23.3 Create `frontend/src/pages/merchant/AnalyticsPage.tsx`
    - Fetch `GET /merchant/analytics` with period/date controls
    - Render `revenue_series` as a line chart (x=date, y=USD amount) using the existing charting library already in the project
    - Render `top_tokens` and `top_networks` as bar charts or ranked lists
    - Display `conversion_rate` as a percentage and `average_payment_size` as a USD figure
    - Wire into merchant dashboard navigation
    - _Requirements: 19.6_

- [x] 24. Subscription tier enforcement
  - [x] 24.1 Create `app/core/tier_limits.py`
    - `@dataclass(frozen=True) class TierLimits: monthly_payments: int | None; api_rate_multiplier: int`
    - `TIER_LIMITS: dict[str, TierLimits] = {"free": TierLimits(50, 1), "growth": TierLimits(500, 2), "pro": TierLimits(5000, 5), "enterprise": TierLimits(None, 10)}`
    - `def get_effective_tier(user) -> str`: return `"free"` if `user.subscription_expires_at` is not None and is in the past; else return `user.subscription_tier or "free"`
    - `def check_monthly_limit(user) -> bool`: get effective tier, if `monthly_payments is None` return `True`; else return `user.monthly_tx_count < monthly_payments`
    - _Requirements: 20.1, 20.6_

  - [x] 24.2 Enforce tier limits in payment link creation in `app/merchant/router.py`
    - Before the INSERT: call `from app.core.tier_limits import check_monthly_limit, get_effective_tier, TIER_LIMITS`
    - If `not check_monthly_limit(user)`: `tier = get_effective_tier(user); limit = TIER_LIMITS[tier].monthly_payments; raise HTTPException(402, {"error": "monthly_limit_reached", "tier": tier, "limit": limit, "current": user.monthly_tx_count})`
    - _Requirements: 20.3_

  - [x] 24.3 Increment `monthly_tx_count` when a payment is settled in `app/web3/state_machine.py`
    - In `PaymentStateMachine.settle_payment`, after `payment.status = "paid"`, add:
      `from sqlalchemy import update; from app.core.models import User; await db.execute(update(User).where(User.id == uuid.UUID(merchant_id)).values(monthly_tx_count=User.monthly_tx_count + 1))`
    - _Requirements: 20.2_

  - [x] 24.4 Add `reset_monthly_tx_counts` Celery beat task to `app/core/tasks.py`
    - `@celery_app.task(name="app.core.tasks.reset_monthly_tx_counts") def reset_monthly_tx_counts():`
    - Inside: `_run_async(_reset_monthly_tx_counts_async())`; the async helper executes `UPDATE users SET monthly_tx_count = 0 WHERE monthly_tx_count > 0` and commits
    - Add to beat schedule: `"reset-monthly-tx-counts": {"task": "app.core.tasks.reset_monthly_tx_counts", "schedule": crontab(hour=0, minute=5)}`
    - Import `crontab` from `celery.schedules`
    - _Requirements: 20.4_

  - [x] 24.5 Update Merchant Dashboard overview page in `frontend/src/pages/dashboard/` (or equivalent Overview component)
    - Fetch `monthly_tx_count` and `subscription_tier` from the existing merchant profile API
    - Display `{monthly_tx_count} / {tier_limit}` where `tier_limit` is derived from the tier constants (or "Unlimited" for enterprise)
    - _Requirements: 20.5_

- [x] 25. Team members (OrgMember)
  - [x] 25.1 Add `OrgMember` model to `app/core/models.py`
    - Table `org_members`; columns: `id` (UUID PK), `organization_id` (UUID FK→organizations CASCADE), `user_id` (UUID FK→users CASCADE), `role` VARCHAR(20) with `CheckConstraint("role IN ('owner','admin','developer')")`, `invited_by` (UUID FK→users nullable), `accepted_at` (DATETIME nullable), `created_at` (DATETIME)
    - `UniqueConstraint("organization_id", "user_id", name="uq_org_members_org_user")`
    - Indexes: `Index("idx_org_members_org", "organization_id")`, `Index("idx_org_members_user", "user_id")`
    - _Requirements: 21.1_

  - [x] 25.2 Create `app/merchant/team_service.py` with all team management functions
    - `invite_team_member(org_id, inviting_user, email, role, db)`: check inviting user is owner/admin, generate 48h invitation token, store `invite:{token_hash}` in Redis with JSON `{org_id, email, role, invited_by}`, call `send_email_task.delay(...)` with invitation link `{frontend_origin}/team/accept?token={plaintext_token}`
    - `accept_team_invite(token_plaintext, user_id, db)`: look up `invite:{SHA256(token)}` in Redis; create `OrgMember(organization_id=..., user_id=user_id, role=..., invited_by=..., accepted_at=now())`; delete Redis key
    - `list_team_members(org_id, db)`: query `OrgMember` + join `User` for `org_id`, return list of `{member_id, email, full_name, role, accepted_at}`
    - `remove_team_member(org_id, calling_member_role, member_id, db)`: check calling role is owner/admin; if removing sole owner → raise `HTTPException(409, {"error": "cannot_remove_sole_owner"})`; delete `OrgMember`
    - `update_member_role(org_id, calling_member_role, calling_user_id, member_id, new_role, db)`: enforce role escalation rules (owner only assigns/removes owner; admin may change developer→admin only)
    - _Requirements: 21.2, 21.3, 21.4, 21.5, 21.6, 21.7_

  - [x] 25.3 Add team member routes to `app/merchant/router.py`
    - `POST /merchant/team/invite`, `GET /merchant/team`, `DELETE /merchant/team/{member_id}`, `PATCH /merchant/team/{member_id}/role`
    - All require merchant JWT auth; delegate to `team_service` functions
    - _Requirements: 21.2, 21.4, 21.5, 21.6, 21.7_

  - [x] 25.4 Update `get_api_key_org` dependency in `app/developer/auth.py` to resolve `member_role`
    - After resolving `organization`, query `OrgMember` where `user_id = org.owner_id` and `organization_id = org.id`
    - Set `request.state.member_role = member.role if member else None`
    - _Requirements: 21.8_

- [x] 26. IP allowlisting for API keys
  - [x] 26.1 Add `allowed_ips: Mapped[Optional[str]] = mapped_column(Text, nullable=True)` to `APIKey` model in `app/core/models.py`
    - _Requirements: 22.1_

  - [x] 26.2 Add IP CIDR validation logic to `get_api_key_org` dependency in `app/developer/auth.py`
    - Add helper functions `_client_ip(request: Request) -> str` (extracts first non-private IP from `X-Forwarded-For`, falls back to `request.client.host`) and `_ip_in_allowlist(client_ip: str, allowed_ips: str) -> bool` (uses `from ipaddress import ip_address, ip_network`)
    - After loading the API key: if `api_key.allowed_ips` is non-empty, call `_ip_in_allowlist`; if `False` → raise `HTTPException(403, {"error": "ip_not_allowed"})`
    - _Requirements: 22.2, 22.3, 22.4_

  - [x] 26.3 Add `PATCH /merchant/api-keys/{key_id}/allowed-ips` endpoint to `app/users/router.py` (or `app/merchant/router.py`)
    - Request body: `{"allowed_ips": ["203.0.113.0/24"]}`; validate each entry via `ipaddress.ip_network(cidr, strict=False)` — on validation failure raise `HTTPException(422, {"error": "invalid_cidr", "param": "allowed_ips"})`
    - Check `get_effective_tier(user) in ("free", "growth")` → raise `HTTPException(402, {"error": "feature_requires_pro_tier"})`
    - Update `api_key.allowed_ips = ",".join(validated_cidrs)` and commit
    - _Requirements: 22.5, 22.6, 22.7_

- [x] 27. Webhook endpoint secret rotation
  - [x] 27.1 Add `rotate_webhook_secret(org_id, endpoint_id, db)` service function to `app/webhooks/service.py`
    - Load `WebhookEndpoint` by `endpoint_id`, verify `organization_id == org_id` → 404 if not found
    - If `previous_secret_expires_at` is not None and `> datetime.now(UTC)` → raise `HTTPException(409, {"error": "rotation_already_in_progress", "expires_at": previous_secret_expires_at.isoformat()})`
    - Generate new `new_secret_plaintext = secrets.token_hex(32)`
    - Move current `endpoint.secret` → `endpoint.previous_secret`; set `endpoint.previous_secret_expires_at = datetime.now(UTC) + timedelta(hours=24)`
    - Set `endpoint.secret = encrypt_secret(new_secret_plaintext)`
    - Flush and return `{"new_secret": new_secret_plaintext, "expires_old_secret_at": endpoint.previous_secret_expires_at.isoformat()}`
    - _Requirements: 23.1, 23.2, 23.5, 23.6_

  - [x] 27.2 Add `POST /v1/webhooks/{id}/rotate-secret` route to `app/webhooks/router.py`
    - Require `sk_live_` or `sk_test_` API key auth
    - Call `rotate_webhook_secret`; return the result dict with `new_secret` plaintext (shown once)
    - _Requirements: 23.1, 23.5, 23.6_

- [x] 28. Stablecoin depeg alerts
  - [x] 28.1 Add `check_stablecoin_pegs` Celery task to `app/core/tasks.py`
    - `@celery_app.task(name="app.core.tasks.check_stablecoin_pegs") def check_stablecoin_pegs(): _run_async(_check_stablecoin_pegs_async())`
    - In `_check_stablecoin_pegs_async()`:
      - For each of `["USDC", "USDT"]`: call `await get_token_usd_price(symbol)` from `app.core.price_oracle`
      - If price deviation `> 0.01` from 1.00: check Redis `depeg_alert_sent:{symbol}` — if key missing: query merchants with `onboarding_complete=True` who have active `PaymentLink` with that token in `accepted_tokens`; insert `Notification(type="depeg_alert")` per merchant; dispatch `send_email_task.delay(...)` per merchant; set Redis key with `ex=21600`
      - If price is back within `0.005` of 1.00: `await redis.delete(f"depeg_alert_sent:{symbol}")`; create `Notification(type="depeg_resolved")` per previously-alerted merchant
    - Add to beat schedule: `"check-stablecoin-pegs": {"task": "app.core.tasks.check_stablecoin_pegs", "schedule": 300.0}`
    - _Requirements: 24.1, 24.2, 24.3, 24.4, 24.5, 24.6_

- [x] 29. Merchant balance endpoint
  - [x] 29.1 Create `app/merchant/balances.py` with `get_merchant_balances(merchant_id, db)` async function
    - Query all `MerchantWallet` records where `merchant_id = merchant_id` and `status IN ('active', 'pending')`
    - For each wallet: check Redis `balances:{merchant_id}:{wallet.id}` (TTL 30s); if cached, use it
    - If not cached: call `_fetch_balances(wallet)`:
      - Use `EVMRpcClient` from `app/web3/indexer.py`; select testnet/mainnet RPC URL based on `settings.testnet_mode`
      - Call `eth_getBalance(wallet.address, "latest")` for native token; call `balanceOf(wallet.address)` for each configured ERC-20 on the network
      - Format each balance: `round(Decimal(raw) / Decimal(10**decimals), 6)`, convert to string
      - Return `[{token_symbol, raw_balance: str, formatted_balance: str, contract_address}]`
    - On RPC error: set `balances = {"error": "rpc_unavailable"}` for that wallet; continue
    - Cache each wallet result in Redis with `ex=30`
    - Return `[{wallet_address, network, balances}]`
    - _Requirements: 25.1, 25.2, 25.3, 25.4, 25.5, 25.6, 25.7_

  - [x] 29.2 Add `GET /merchant/balances` endpoint to `app/merchant/router.py`
    - Auth: merchant JWT + `onboarding_complete = True` guard
    - Call `get_merchant_balances(merchant_id, db)` and return the result array
    - _Requirements: 25.1, 25.2, 25.3_

- [x] 30. New features Alembic migration
  - [x] 30.1 Create Alembic migration `migrations/versions/add_fiat_fields_and_new_features.py`
    - `upgrade()` must cover:
      - `payments`: add `fiat_amount_at_payment NUMERIC(18,2) NULL` and `fiat_currency VARCHAR(10) NULL DEFAULT 'USD'`
      - `api_keys`: add `allowed_ips TEXT NULL`
      - `webhook_endpoints`: add `previous_secret VARCHAR(200) NULL` and `previous_secret_expires_at DATETIME NULL`; increase `secret` column to VARCHAR(200)
      - Create table `org_members` with all columns from the `OrgMember` model: `id UUID PK`, `organization_id UUID FK`, `user_id UUID FK`, `role VARCHAR(20)`, `invited_by UUID NULL FK`, `accepted_at DATETIME NULL`, `created_at DATETIME NOT NULL`; add `UniqueConstraint` and `CheckConstraint`
    - `downgrade()`: drop each added column/table in reverse order
    - _Requirements: 17.1, 21.1, 22.1, 23.2_

- [ ] 31. Checkpoint — New Product Features
  - Ensure all tests pass, ask the user if questions arise.

---

### Section 5: Property-Based Tests

- [ ] 32. Property tests for core correctness properties
  - [ ]* 32.1 Write Hypothesis property test for idempotency (Property 1)
    - File: `tests/test_properties.py` (create if absent)
    - Tag: `# Feature: production-ready-platform, Property 1: idempotency_is_strict`
    - Strategy: generate arbitrary payment body dict + idempotency key string (1–255 chars) + repeat count N in [2, 5]
    - Test body: send N identical POST requests with same `Idempotency-Key` header; assert DB contains exactly 1 `Payment` record; assert all N responses have identical `id` and `status` fields; assert all responses after the first have `Idempotency-Replayed: true` header
    - Use a fresh test DB per invocation (or SQLite in-memory with test client)
    - _Requirements: 3.7_

  - [ ]* 32.2 Write Hypothesis property test for fiat arithmetic (Property 2)
    - Tag: `# Feature: production-ready-platform, Property 2: fiat_equivalent_arithmetic`
    - Strategy: `@given(amount=st.decimals(min_value=0, max_value=1_000_000, allow_nan=False, allow_infinity=False), rate=st.decimals(min_value=0.0001, max_value=100_000, allow_nan=False, allow_infinity=False))`
    - Import `compute_fiat_amount` (a small pure function to extract from `settle_payment` logic): `def compute_fiat_amount(amount: Decimal, rate: Decimal) -> Decimal: return (amount * rate).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)`
    - Assert `result == round(amount * rate, 2)` (using Python's `round` as oracle)
    - _Requirements: 17.7_

  - [ ]* 32.3 Write Hypothesis property test for AES-256-GCM round-trip (Property 3)
    - Tag: `# Feature: production-ready-platform, Property 3: webhook_secret_round_trip`
    - Strategy: `@given(plaintext=st.text(min_size=1, max_size=128))`
    - Set up a 32-byte test key via monkeypatch on `settings.webhook_encryption_key`
    - Assert `decrypt_secret(encrypt_secret(plaintext)) == plaintext`
    - _Requirements: 8.1, 8.2, 8.3_

  - [ ]* 32.4 Write Hypothesis property test for rate limiter boundary (Property 4)
    - Tag: `# Feature: production-ready-platform, Property 4: rate_limiter_boundary`
    - Strategy: `@given(limit=st.sampled_from([100, 200, 500, 1000]), count=st.integers(min_value=0, max_value=1500))`
    - Extract pure `evaluate_rate_limit(count: int, limit: int) -> RateLimitResult` function from `APIKeyRateLimitMiddleware` (or test the effective-count calculation logic directly)
    - Assert: if `count >= limit` → `result.blocked is True`; if `count < limit` → `result.blocked is False` and `result.remaining == limit - count - 1`
    - _Requirements: 4.2, 4.3_

  - [ ]* 32.5 Write Hypothesis property test for subscription tier enforcement (Property 5)
    - Tag: `# Feature: production-ready-platform, Property 5: subscription_tier_enforcement`
    - Strategy: `@given(tier=st.sampled_from(["free","growth","pro","enterprise"]), count=st.integers(min_value=0, max_value=10_000))`
    - Create `FakeUser` dataclass with `subscription_tier` and `monthly_tx_count` and no expiry
    - Import `check_monthly_limit` and `TIER_LIMITS` from `app.core.tier_limits`
    - Assert: if `tier == "enterprise"` → always `True`; else → `check_monthly_limit(user) == (count < TIER_LIMITS[tier].monthly_payments)`
    - _Requirements: 20.3_

  - [ ]* 32.6 Write Hypothesis property test for IP CIDR matching (Property 6)
    - Tag: `# Feature: production-ready-platform, Property 6: ip_allowlist_cidr_matching`
    - Strategy: generate valid IPv4 addresses and IPv4 CIDR blocks using `st.builds(...)` with `ipaddress` stdlib; min 1 CIDR, max 5
    - Import `_ip_in_allowlist` from `app.developer.auth`
    - Assert `_ip_in_allowlist(ip_str, ",".join(cidrs)) == any(ip_address(ip_str) in ip_network(c, strict=False) for c in cidrs)`
    - _Requirements: 22.3, 22.4_

  - [ ]* 32.7 Write Hypothesis property test for depeg alert deduplication (Property 7)
    - Tag: `# Feature: production-ready-platform, Property 7: depeg_deduplication`
    - Strategy: `@given(symbol=st.sampled_from(["USDC","USDT"]), n_calls=st.integers(min_value=2, max_value=10))`
    - Use a fake Redis dict to simulate the `depeg_alert_sent:{symbol}` key with 6-hour TTL
    - Call the core deduplication logic N times within the TTL window (no time progression)
    - Assert at most 1 notification created per merchant per window
    - _Requirements: 24.5_

---

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP delivery
- Each task references specific requirement numbers for full traceability
- The `consolidate_inline_migrations` Alembic migration (task 15.2) should be run against a fresh DB to validate correctness before removing the `_sync_sqlite_cols` code in production
- The `add_fiat_fields_and_new_features` migration (task 30.1) depends on the ORM model changes in tasks 20.2, 25.1, 26.1, and 9.3
- Both Alembic migrations must be created and tested before deploying to production
- Property tests require `hypothesis` package (`pip install hypothesis`) already present in the project (`.hypothesis/` directory exists)

---

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "20.1"] },
    { "id": 1, "tasks": ["1.2", "1.3", "2.1", "5.1", "7.1", "9.1", "10.1", "12.1", "12.2", "13.1", "13.2", "14.1", "24.1", "26.1", "20.2", "25.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "4.1", "4.2", "5.2", "8.1", "8.2", "9.2", "9.3", "10.2", "13.3", "15.1", "16.1", "16.2", "17.1", "17.2", "18.1", "18.2", "20.3", "20.4", "21.1", "23.1", "24.2", "24.3", "24.4", "25.2", "26.2", "27.1", "28.1", "29.1"] },
    { "id": 3, "tasks": ["3.1", "4.3", "9.4", "9.5", "15.2", "16.3", "17.3", "18.3", "18.4", "22.1", "23.2", "24.5", "25.3", "25.4", "26.3", "27.2", "29.2", "30.1"] },
    { "id": 4, "tasks": ["3.2", "23.3", "32.1", "32.2", "32.3", "32.4", "32.5", "32.6", "32.7"] }
  ]
}
```
