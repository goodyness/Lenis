# Implementation Plan: Developer API & Public Platform

## Overview

Implements three major additions to the Lenis platform: a production-grade Developer API (`/v1/`) with API-key auth, idempotency, per-key rate limiting, and test/live mode isolation; a signed webhook delivery pipeline with retry logic and audit trail; and a public web presence with marketing pages, a developer documentation hub, and official Python + TypeScript SDKs. Builds on existing `app/core/models.py`, `app/core/security.py`, `app/web3/state_machine.py`, and the Celery infrastructure.

---

## Tasks

### 1. Database Schema & Migration

- [x] 1. Add new tables and columns via Alembic migration
  - [x] 1.1 Add `WebhookEndpoint`, `WebhookEvent`, `WebhookDelivery` models to `app/core/models.py`
    - Add `WebhookEndpoint` with columns: `id` (UUID PK), `organization_id` (FK → organizations, CASCADE), `url` (VARCHAR 2048), `secret` (VARCHAR 64), `events` (JSON), `enabled` (BOOLEAN default True), `disabled_at` (DATETIME nullable), `created_at`, `updated_at`
    - Add `WebhookEvent` with columns: `id` (VARCHAR 32, `evt_` prefix PK), `organization_id` (FK → organizations), `type` (VARCHAR 100), `payload` (JSON), `livemode` (BOOLEAN), `status` (VARCHAR 20, CHECK IN `pending|delivered|failed`), `created_at`; include indexes on `organization_id`, `type`, `created_at`
    - Add `WebhookDelivery` with columns: `id` (UUID PK), `endpoint_id` (FK → webhook_endpoints, CASCADE), `event_id` (FK → webhook_events), `status_code` (INTEGER nullable), `response_body` (TEXT nullable), `duration_ms` (INTEGER nullable), `attempt_number` (INTEGER), `success` (BOOLEAN), `delivered_at` (DATETIME nullable), `created_at`; include indexes on `endpoint_id`, `event_id`, `created_at`
    - _Requirements: 10.1, 10.2, 10.3_

  - [x] 1.2 Add new columns to existing `Payment` and `PaymentLink` models in `app/core/models.py`
    - On `Payment`: add `is_test` (BOOLEAN default False), `metadata_json` (JSON nullable), `organization_id` (UUID FK → organizations nullable)
    - On `PaymentLink`: add `is_test` (BOOLEAN default False), `external_id` (VARCHAR 128 nullable), `organization_id` (UUID FK → organizations nullable)
    - _Requirements: 5.6, 16.1, 7.5_

  - [x] 1.3 Create Alembic migration `add_developer_api_and_webhooks`
    - Write migration file in `migrations/versions/` creating all three webhook tables with constraints and indexes
    - Add `ALTER TABLE payments ADD COLUMN is_test`, `metadata_json`, `organization_id`
    - Add `ALTER TABLE payment_links ADD COLUMN is_test`, `external_id`, `organization_id`
    - Create indexes: `idx_payments_is_test`, `idx_payments_org`, `idx_payment_links_is_test`, `idx_payment_links_org`
    - Implement downgrade: drop new tables, drop added columns (SQLite downgrade is a no-op with comment)
    - _Requirements: 10.1, 10.2, 10.3, 5.6, 16.1_

  - [x] 1.4 Add SQLite auto-migration columns to `app/main.py` lifespan
    - In the existing `_sync_sqlite_cols` function inside the `lifespan` handler, add `is_test`, `metadata_json`, `organization_id` to `add_p_cols` dict for `payments`
    - Add `is_test`, `external_id`, `organization_id` to `add_pl_cols` dict for `payment_links`
    - Add similar dicts for `webhook_endpoints`, `webhook_events`, `webhook_deliveries` tables
    - _Requirements: 10.1_

---

### 2. Webhook Infrastructure

- [x] 2. Build the webhook signing, emission, and delivery subsystem
  - [x] 2.1 Create `app/webhooks/__init__.py` and `app/webhooks/signing.py`
    - Create the `app/webhooks/` package with an empty `__init__.py`
    - Implement `compute_signature(secret: str, timestamp: int, payload_json: str) -> str` using `hmac.new(secret.encode(), f"t={timestamp}\n{payload_json}".encode(), hashlib.sha256).hexdigest()`
    - Implement `build_signature_header(secret: str, payload_json: str) -> tuple[str, int]` returning `(f"t={ts},v1={sig}", ts)`
    - Implement `verify_signature(payload_bytes: bytes, sig_header: str, secret: str, tolerance_seconds: int = 300) -> dict` that parses `t=` and `v1=` components, validates timestamp within tolerance, recomputes HMAC, raises `LenisWebhookSignatureError` (imported from `app/webhooks/exceptions.py`) on any failure
    - Create `app/webhooks/exceptions.py` with `LenisWebhookSignatureError(Exception)` exposing a `message` attribute
    - _Requirements: 13.1, 13.2, 13.3, 13.5, 13.6_

  - [ ]* 2.2 Write property tests for webhook signing
    - **Property 5: Webhook Signature Round-Trip** — `verify_signature(payload.encode(), build_signature_header(secret, payload)[0], secret)` never raises for any payload and secret
    - **Property 5b: Wrong Secret Always Raises** — if `secret_a != secret_b`, calling `verify_signature` with `secret_b` on a header signed with `secret_a` always raises `LenisWebhookSignatureError`
    - **Validates: Requirements 13.1, 13.2, 13.3, 13.4**

  - [x] 2.3 Create `app/webhooks/schemas.py`
    - Define `WebhookEndpointCreate(url: str, events: list[str])`, `WebhookEndpointResponse`, `WebhookEventResponse`, `WebhookDeliveryResponse`, `WebhookTestResponse`
    - Define canonical event envelope schema `WebhookEventEnvelope(id, type, created, livemode, data)`
    - Define `SUPPORTED_EVENT_TYPES: frozenset[str]` containing all 8 event types from the design
    - _Requirements: 11.1, 11.4, 9.1, 9.3_

  - [x] 2.4 Create `app/webhooks/service.py`
    - Implement `create_webhook_endpoint(org_id, url, events, db)` — validates HTTPS URL, validates all event types in `SUPPORTED_EVENT_TYPES`, enforces 20-endpoint limit per org, generates 32-byte hex secret via `secrets.token_hex(32)`, creates `WebhookEndpoint` record; returns full secret only at creation
    - Implement `list_webhook_endpoints(org_id, db)` — returns all endpoints without the `secret` field
    - Implement `delete_webhook_endpoint(org_id, endpoint_id, db)` — deletes record, returns 404 if not found or wrong org
    - Implement `list_webhook_deliveries(org_id, endpoint_id, page, page_size, db)` — paginates `WebhookDelivery` rows for endpoint, verifies org ownership
    - Implement `emit_webhook_event(db, organization_id, event_type, payload_data, livemode)` — creates `WebhookEvent` record with `id = "evt_" + secrets.token_hex(14)`, queries active subscribed endpoints, enqueues `deliver_webhook.delay(event_id, endpoint_id)` for each; on DB error logs `event_type` + `org_id` and does NOT attempt delivery
    - Implement `check_endpoint_auto_disable(endpoint_id, db)` — counts distinct calendar days in last 3 days with only failed deliveries; if 3 such days found, sets `enabled=False`, `disabled_at=now()`
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.9, 11.2, 11.3, 11.5, 11.6, 10.4_

  - [x] 2.5 Create `app/webhooks/delivery.py` (Celery task)
    - Define `RETRY_DELAYS = [5, 30, 300, 1800, 7200]` (seconds between attempts)
    - Implement `@celery_app.task(bind=True, name="app.webhooks.delivery.deliver_webhook", max_retries=5)` that: loads `WebhookEvent` and `WebhookEndpoint`; skips if `endpoint.enabled=False` (no `WebhookDelivery` row created); builds payload JSON, calls `build_signature_header`; POSTs to endpoint URL with 30-second timeout; creates `WebhookDelivery` row recording all fields; on success sets `WebhookEvent.status="delivered"`; on failure schedules retry with `countdown=RETRY_DELAYS[attempt-1]` if `attempt < 6`, else sets `WebhookEvent.status="failed"`; always calls `check_endpoint_auto_disable` after each failed delivery
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 13.5_

  - [ ]* 2.6 Write property tests for webhook delivery audit completeness
    - **Property 6: Webhook Delivery Audit Completeness** — for any `WebhookEvent` ID, the count of `WebhookDelivery` rows must equal the total number of delivery attempts made
    - **Validates: Requirements 12.4, 12.5, 12.6**

  - [x] 2.7 Hook `PaymentStateMachine` status transitions to `emit_webhook_event`
    - In `app/web3/state_machine.py`, after each status transition persisted via `db.flush()`, call `emit_webhook_event` via `asyncio.create_task` or direct `await` in the async context for: `detected` → `payment.detected`, `confirming` → `payment.confirming`, `confirmed` → `payment.confirmed`, `underpaid` → `payment.underpaid`, `expired` → `payment.expired`
    - Wrap each call in try/except so webhook emission failures never break payment processing
    - Also emit `payment.created` from `app/developer/service.py` when a payment intent is created via the API
    - Also emit `payment.link.created` / `payment.link.deactivated` from `app/developer/service.py` when payment links are created or deactivated
    - _Requirements: 11.2, 11.3_

  - [x] 2.8 Create `app/webhooks/router.py`
    - Implement `POST /v1/webhooks`, `GET /v1/webhooks`, `DELETE /v1/webhooks/{id}`, `GET /v1/webhooks/{id}/deliveries`, `POST /v1/webhooks/{id}/test` routes
    - All routes use the `get_api_key_org` dependency from `app/developer/auth.py`
    - `POST /v1/webhooks/{id}/test` constructs a synthetic `payment.confirmed` event with id prefixed `evt_test_`, signs it with `build_signature_header`, delivers synchronously with 30-second timeout, records `WebhookDelivery(attempt_number=0)`, returns `{"success": bool, "status_code": int|null, "duration_ms": int}` — never propagates 5xx even on failure
    - Return `X-Request-ID` header on all responses
    - _Requirements: 9.1–9.9, 20.1–20.5_

---

### 3. API Key Authentication & Middleware

- [x] 3. Build the authentication layer for `/v1/*` endpoints
  - [x] 3.1 Create `app/developer/__init__.py` and `app/developer/auth.py`
    - Create the `app/developer/` package with an empty `__init__.py`
    - Implement `get_api_key_org(request: Request, db: AsyncSession) -> tuple[Organization, User, str]` FastAPI dependency:
      - Extracts `Authorization: Bearer <token>` header
      - Validates format: must start with `sk_test_` or `sk_live_` with ≥ 32-character suffix
      - SHA-256 hashes the token via existing `hash_token()` from `app/core/security.py`, looks up `api_keys.key_hash`
      - Checks `active=True` and `expires_at` not in the past
      - Sets `request.state.test_mode`, `request.state.organization`, `request.state.user`, `request.state.api_key_id`
      - Returns HTTP 401 `{"error": "invalid_api_key"}` on missing/invalid token, `{"error": "api_key_revoked"}` on revoked key, `{"error": "api_key_expired"}` on expired key
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [x] 3.2 Create `app/developer/middleware.py` — Idempotency middleware
    - Implement `IdempotencyMiddleware` class:
      - Redis key: `idempotency:{api_key_id}:{sha256(idempotency_key_value)}`
      - Stored value JSON: `{status_code, body, endpoint, body_hash}`; TTL 86400 seconds
      - Empty or >255-char `Idempotency-Key` header → HTTP 422 `{"error": "invalid_idempotency_key"}`
      - Cache miss: execute handler, store 2xx response in Redis
      - Cache hit, same endpoint + body_hash: return cached response + `Idempotency-Replayed: true` header
      - Cache hit, different endpoint or body_hash: HTTP 422 `{"error": "idempotency_key_reused_with_different_request"}`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 3.3 Create `app/developer/middleware.py` — API key rate limit middleware (add to same file)
    - Implement `APIKeyRateLimitMiddleware` class using sliding window algorithm in Redis:
      - Keys: `ratelimit:{api_key_id}:{current_window_minute}` and `ratelimit:{api_key_id}:{previous_window_minute}`
      - Sliding window approximation: `effective = prev * (1 - elapsed_fraction) + curr`
      - On exceed: HTTP 429 `{"error": "rate_limit_exceeded", "retry_after": <seconds>}` + `Retry-After` header
      - Always sets `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` headers on `/v1/*` responses
      - On Redis failure: fail-open, omit rate-limit headers
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [ ]* 3.4 Write property tests for rate limit enforcement
    - **Property 7: Rate Limit Enforcement** — making exactly 101 requests within a 60-second sliding window must result in request 101 receiving HTTP 429 and requests 1-100 receiving non-429 responses
    - **Validates: Requirements 3.1, 3.3**

  - [x] 3.5 Add `X-Request-ID` middleware to `app/developer/middleware.py`
    - Implement lightweight middleware that injects `X-Request-ID: <uuid4>` on every `/v1/*` response
    - _Requirements: 19.3_

  - [ ]* 3.6 Write property tests for idempotency record invariant
    - **Property 4: Idempotency Record Invariant** — sending the same POST N times with the same Idempotency-Key creates exactly 1 database record and all N responses have identical status codes and bodies
    - **Validates: Requirements 4.1, 4.2**

---

### 4. Merchant API Key Management

- [x] 4. Add API key CRUD endpoints to `app/merchant/router.py`
  - [x] 4.1 Create merchant API key service logic in `app/merchant/service.py`
    - Implement `create_api_key(merchant_id, key_type, db)`:
      - Validates `key_type` in `{"sk_test", "pk_test", "sk_live", "pk_live"}`
      - Counts active keys for org; if ≥ 10, raises HTTP 422 `{"error": "api_key_limit_reached"}`
      - Generates `{prefix}_{32-char alphanumeric suffix}` using `secrets.token_urlsafe(24)`
      - For secret keys (`sk_*`): stores SHA-256 hash in `key_hash`, stores last 4 chars in `suffix_display`; returns plaintext once
      - For publishable keys (`pk_*`): stores plaintext as `key_hash` (public by design), sets `suffix_display`
      - Creates `APIKey` record linked to the merchant's `Organization`
    - Implement `list_api_keys(merchant_id, db)` — returns all `active=True` keys showing only `id`, `key_type`, `prefix`, `suffix_display`, `created_at` (never full plaintext or hash)
    - Implement `revoke_api_key(merchant_id, key_id, db)` — sets `active=False`, sets `revoked_at=now()`; returns HTTP 404 if key not in org or already revoked
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_

  - [x] 4.2 Register API key routes in `app/merchant/router.py`
    - Add `POST /merchant/api-keys` → `create_api_key`; response includes full plaintext once
    - Add `GET /merchant/api-keys` → `list_api_keys`; masked output only
    - Add `DELETE /merchant/api-keys/{key_id}` → `revoke_api_key`; returns HTTP 204
    - All three routes use the existing `require_merchant` dependency
    - _Requirements: 1.1, 1.4, 1.5, 1.6, 1.7_

  - [ ]* 4.3 Write property tests for API key masking and hash integrity
    - **Property 1: API Key Hash Integrity** — for any created key, `key_hash == sha256(plaintext)` and no column in `api_keys` stores the full plaintext
    - **Property 8: API Key Masking Invariant** — every object in `GET /merchant/api-keys` response contains `prefix` and `suffix_display` but never the full plaintext or its SHA-256 hash
    - **Validates: Requirements 1.2, 1.4**

---

### 5. Checkpoint — Schema, Webhooks & Auth

- [x] 5. Checkpoint — Schema, webhook infrastructure, and auth middleware complete
  - Ensure all migrations apply cleanly: `alembic upgrade head`
  - Ensure webhook signing property tests pass (Properties 5, 5b)
  - Ensure idempotency and rate-limit tests pass (Properties 4, 7)
  - Ensure API key masking tests pass (Properties 1, 8)
  - Ask the user if questions arise before proceeding to Developer API routes

---

### 6. Developer API Schemas & Service Foundation

- [ ] 6. Create `app/developer/schemas.py` and `app/developer/service.py` foundation
  - [ ] 6.1 Create `app/developer/schemas.py`
    - Define `AcceptedTokenEntry(token_symbol: str, network: str, contract_address: Optional[str])`
    - Define `PaymentIntentRequest`: `amount` (Decimal 0.01–999,999,999.99 max 8dp), `token_symbol`, `network`, `accepted_tokens` (list min 1), optional `customer_email`, `redirect_url` (HTTPS), `expires_in` (int 300–86400 default 3600), `metadata` (dict max 16 keys)
    - Define `PaymentIntentResponse`: `id`, `status`, `amount`, `token_symbol`, `network`, `checkout_url`, `created` (Unix ts), `expires_at` (Unix ts), `is_test`, `livemode`
    - Define `PaymentLinkCreateRequest`: `title` (1–200 chars), `amount_mode`, `accepted_tokens`, `amount` (required if fixed), optional `external_id` (max 128 chars), `redirect_url`, `expires_in`, `max_uses`, `custom_message`
    - Define `PaymentLinkResponse` including `checkout_url`
    - Define generic `ListResponse[T]` with `data: list[T]`, `has_more: bool`, `next_cursor: Optional[str]`, `total: Optional[int]`
    - Define `ErrorResponse(error: str, message: str, param: Optional[str])`
    - _Requirements: 5.2, 6.5, 7.1, 19.1, 19.2_

  - [ ] 6.2 Create `app/developer/service.py` — validation and org isolation helpers
    - Implement `validate_amount(amount: Decimal)` — checks range 0.01–999,999,999.99, at most 8 decimal places
    - Implement `validate_network(network: str)` — looks up `NetworkRegistry.get_active_networks()`, raises HTTP 422 `{"error": "unsupported_network"}` if not found
    - Implement `validate_token(network: str, token_symbol: str)` — checks token in network token list, raises HTTP 422 `{"error": "unsupported_token"}`
    - Implement `validate_expires_in(expires_in: int)` — enforces 300–86400 range
    - Implement `validate_metadata(metadata: dict | None)` — enforces ≤16 keys, key length ≤64, value length ≤500
    - Implement `build_org_payment_filter(org, test_mode)` — returns SQLAlchemy filter combining `organization_id` and `is_test` for isolation; used by all list/retrieve handlers
    - _Requirements: 5.3, 5.4, 5.5, 5.8, 5.9, 5.7, 16.3, 16.4, 16.6_

---

### 7. Developer API — Payments & Transactions

- [x] 7. Implement `/v1/payments` and `/v1/transactions` endpoints
  - [x] 7.1 Implement payment intent creation in `app/developer/service.py`
    - Implement `create_payment_intent(org, user, test_mode, data, db)`:
      - Runs all validation helpers from task 6.2
      - Creates a `PaymentLink` in `active` status with `is_test=test_mode`, `organization_id=org.id`, `merchant_id=user.id`, accepted tokens snapshot, expiry from `expires_in`
      - Creates a `Payment` in `pending` status with `is_test=test_mode`, `organization_id=org.id`, amount, token, network, `payer_email` from `customer_email`, `metadata_json`
      - Constructs `checkout_url = f"{settings.frontend_origin}/pay/{slug}"`
      - Emits `payment.created` webhook event via `emit_webhook_event`
      - Returns `PaymentIntentResponse`
    - _Requirements: 5.1, 5.2, 5.6, 5.7, 5.8, 5.10, 5.11, 11.2_

  - [x] 7.2 Implement payment retrieval and listing in `app/developer/service.py`
    - Implement `get_payment(org, payment_id, test_mode, db)` — applies org + mode filter, returns 404 `{"error": "payment_not_found"}` if not found or wrong mode
    - Implement `list_payments(org, test_mode, filters, limit, cursor, db)` — applies org + mode filter; supports `status`, `network`, `token_symbol`, `created_after`, `created_before` optional filters; validates filter values returning HTTP 422 `{"error": "invalid_filter", "param": "<field>"}` on bad input; clamps limit to 100; returns cursor-paginated `ListResponse`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 16.3, 16.4, 16.6_

  - [ ]* 7.3 Write property tests for organization isolation
    - **Property 2: Organization Isolation** — a list or retrieve request from org A's key must never return a Payment whose `organization_id` equals org B's ID
    - **Validates: Requirements 6.1, 6.2**

  - [ ]* 7.4 Write property tests for test/live mode isolation
    - **Property 3: Test/Live Mode Isolation** — a payment created with `sk_test_*` (tagged `is_test=True`) must return HTTP 404 when retrieved with `sk_live_*` and vice versa
    - **Validates: Requirements 16.3, 16.4, 16.6**

  - [x] 7.5 Implement transaction listing in `app/developer/service.py`
    - Implement `list_transactions(org, test_mode, filters, limit, cursor, db)` — only returns `Payment` records with `status IN ('confirmed', 'paid')`; applies org + mode filter; supports `network`, `token_symbol`, `min_amount`, `max_amount`, `confirmed_after`, `confirmed_before` filters; cursor-paginated
    - Implement `get_transaction(org, transaction_id, test_mode, db)` — returns 404 `{"error": "transaction_not_found"}` if status not confirmed/paid or wrong org/mode
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [x] 7.6 Register routes in `app/developer/router.py`
    - Create `app/developer/router.py` with FastAPI `APIRouter(prefix="/v1")`
    - Register `POST /v1/payments`, `GET /v1/payments`, `GET /v1/payments/{id}`, `GET /v1/transactions`, `GET /v1/transactions/{id}`
    - All routes depend on `get_api_key_org` from `auth.py`
    - Apply `IdempotencyMiddleware` on POST routes
    - Apply `APIKeyRateLimitMiddleware` on all routes
    - Set `Content-Type: application/json` and add `X-Request-ID` on all responses
    - _Requirements: 5.1, 6.1, 8.1, 19.4, 19.5_

---

### 8. Developer API — Payment Links & Webhooks

- [x] 8. Implement `/v1/payment-links` endpoints in `app/developer/service.py` and `router.py`
  - [x] 8.1 Implement payment link creation in `app/developer/service.py`
    - Implement `create_developer_payment_link(org, user, test_mode, data, db)`:
      - Validates title (1–200 chars), amount_mode, accepted_tokens (min 1), amount (required for fixed mode), optional `external_id` (max 128 chars), `redirect_url` (HTTPS max 2048)
      - Creates `PaymentLink` with `is_test=test_mode`, `organization_id=org.id`
      - Emits `payment.link.created` webhook event
      - Returns `PaymentLinkResponse` with `checkout_url`
    - Implement `get_developer_payment_link(org, link_id, test_mode, db)` — org + mode isolation, returns 404 `{"error": "payment_link_not_found"}`
    - Implement `list_developer_payment_links(org, test_mode, limit, cursor, db)` — cursor-paginated, max 100
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 8.2 Register payment link routes in `app/developer/router.py`
    - Register `POST /v1/payment-links`, `GET /v1/payment-links`, `GET /v1/payment-links/{id}`
    - `POST /v1/payment-links` participates in idempotency middleware
    - _Requirements: 7.1, 7.4_

---

### 9. Public Contact Endpoint

- [x] 9. Create `app/public/` contact form backend
  - [x] 9.1 Create `app/public/__init__.py`, `app/public/schemas.py`, and `app/public/router.py`
    - In `schemas.py`: define `ContactFormRequest(name: str [1-100], email: EmailStr, message: str [1-2000])` and `ContactFormResponse(success: bool, message: str)`
    - In `router.py`: implement `POST /v1/contact` that validates fields, enqueues a `send_email_task` to `settings.smtp_from_address` with subject `"Contact Form: {name}"` and body containing name, email, message; returns HTTP 200 on success, HTTP 422 with field-level error on validation failure
    - _Requirements: 17.6, 17.7, 17.8_

---

### 10. Router Registration & Celery Wiring

- [x] 10. Wire all new modules into the application
  - [x] 10.1 Register new routers in `app/main.py`
    - Add three `_include_router_if_available` calls for `app.developer.router` (prefix `""`), `app.webhooks.router` (prefix `""`), and `app.public.router` (prefix `""`)
    - Register `app.developer.router` before the existing merchant and checkout routers
    - _Requirements: 19.5_

  - [x] 10.2 Add `app.webhooks.delivery` to Celery include list in `app/core/celery_app.py`
    - Append `"app.webhooks.delivery"` to the `include` list so `deliver_webhook` task is auto-discovered by Celery workers
    - _Requirements: 12.1_

  - [x] 10.3 Add testnet RPC URL settings to `app/core/config.py`
    - Add optional fields: `base_sepolia_rpc_url: str = ""`, `polygon_mumbai_rpc_url: str = ""`, `arbitrum_sepolia_rpc_url: str = ""`, `optimism_sepolia_rpc_url: str = ""`, `ethereum_sepolia_rpc_url: str = ""`
    - Add `testnet_mode: bool = False` flag used by Developer API test-mode payment routing
    - Update `.env.example` with the new optional fields
    - _Requirements: 16.2_

---

### 11. Checkpoint — Developer API Complete

- [ ] 11. Checkpoint — Developer API, webhooks, and public endpoint integrated
  - Run existing test suite; ensure no regressions in auth, merchant, or checkout modules
  - Verify `/v1/payments` create → retrieve flow works end-to-end with test API key
  - Verify webhook emission fires from `PaymentStateMachine` test transitions
  - Verify contact form returns 422 on missing fields and sends email on valid input
  - Ask the user if questions arise before starting SDK work

---

### 12. Python SDK (`sdks/python/`)

- [x] 12. Build the `lenis-python` SDK package
  - [x] 12.1 Create SDK package structure and `pyproject.toml`
    - Create directory tree: `sdks/python/lenis/__init__.py`, `exceptions.py`, `models.py`, `_http.py`, `client.py`, `resources/payments.py`, `resources/payment_links.py`, `resources/webhooks.py`
    - Create `sdks/python/pyproject.toml` with `[project]` name `lenis-python`, dependencies pinned: `httpx>=0.27,<1`, `typing_extensions>=4`
    - Create `sdks/python/README.md` with install and quick-start examples
    - _Requirements: 14.1_

  - [x] 12.2 Implement `lenis/exceptions.py`
    - Define `LenisAuthError(Exception)` with `status_code: int` and `error: str` attributes; raised on HTTP 401 or empty `api_key`
    - Define `LenisAPIError(Exception)` with `status_code: int`, `error: str`, `param: Optional[str]` attributes; raised on all other non-2xx
    - Define `LenisWebhookSignatureError(Exception)` with `message: str`; raised on HMAC failure
    - _Requirements: 14.4, 14.7_

  - [x] 12.3 Implement `lenis/_http.py`
    - Wrap `httpx.Client` (sync) with optional `httpx.AsyncClient` (async) with base URL configurable (default `https://api.lenis.io`), 30-second timeout, `Authorization: Bearer {api_key}` header on all requests
    - Implement retry logic for 5xx responses: delays `[1, 2, 4]` seconds, max 3 retries before raising `LenisAPIError`
    - Raise `LenisAuthError` on HTTP 401, `LenisAPIError` on all other non-2xx
    - _Requirements: 14.3, 14.4_

  - [x] 12.4 Implement `lenis/resources/payments.py`, `payment_links.py`, and `webhooks.py`
    - `PaymentsResource`: `create(**kwargs) -> dict`, `retrieve(payment_id: str) -> dict`, `list(**filters) -> dict`
    - `PaymentLinksResource`: `create(**kwargs) -> dict`, `retrieve(id: str) -> dict`, `list(**filters) -> dict`
    - `WebhooksResource`: `construct_event(payload_bytes: bytes, sig_header: str, secret: str) -> dict` — delegates to `verify_signature` from `sdks/python/lenis/signing.py` (port of `app/webhooks/signing.py`)
    - Create `sdks/python/lenis/signing.py` as a standalone copy of the HMAC logic (no FastAPI imports)
    - _Requirements: 14.2, 14.5_

  - [x] 12.5 Implement `lenis/client.py` — `LenisClient`
    - `LenisClient(api_key: str, base_url: str = "https://api.lenis.io")` constructor:
      - Raises `LenisAuthError` immediately if `api_key` is `None` or empty string
      - Instantiates `_http.py` HTTP client
      - Exposes `.payments`, `.payment_links`, `.webhooks` resource attributes
    - Ensure all methods are fully type-annotated (PEP 604 style), compatible with `mypy --strict`
    - Export `LenisClient`, all exception classes, and resource classes from `lenis/__init__.py`
    - _Requirements: 14.1, 14.5, 14.7_

  - [x] 12.6 Write pytest unit tests for Python SDK
    - Create `sdks/python/tests/test_client.py` using `pytest-mock` to mock `httpx` responses
    - Test cases: successful payment creation returns correct fields; idempotency replay sets `Idempotency-Replayed: true`; HTTP 401 raises `LenisAuthError`; HTTP 422 raises `LenisAPIError` with `param`; webhook `construct_event` succeeds with valid signature; webhook `construct_event` raises `LenisWebhookSignatureError` with wrong secret; constructing `LenisClient` with empty key raises `LenisAuthError`
    - _Requirements: 14.6_

  - [ ]* 12.7 Write hypothesis property-based tests for Python SDK
    - **Property 5: Webhook Signature Round-Trip (Python SDK)** — `construct_event(payload, build_header(secret, payload), secret)` never raises for any payload and secret
    - **Property 1: API Key Hash Integrity (SDK layer)** — created keys returned by mock server always satisfy hash invariant
    - **Validates: Requirements 13.3, 14.6**

---

### 13. TypeScript SDK (`sdks/typescript/`)

- [x] 13. Build the `lenis-node` SDK package
  - [x] 13.1 Create SDK package structure, `package.json`, and `tsconfig.json`
    - Create directory tree: `sdks/typescript/src/index.ts`, `errors.ts`, `types.ts`, `client.ts`, `_http.ts`, `resources/payments.ts`, `resources/paymentLinks.ts`, `resources/webhooks.ts`
    - Create `sdks/typescript/package.json` with `name: "lenis-node"`, dual `exports` field for ESM and CJS, devDependencies: `typescript`, `vitest`, `fast-check`; no runtime dependencies beyond built-in Node.js `https`
    - Create `sdks/typescript/tsconfig.json` targeting ES2020 with `strict: true`; separate `tsconfig.esm.json` and `tsconfig.cjs.json` for dual build targeting `dist/esm/` and `dist/cjs/`
    - Create `sdks/typescript/README.md` with install and usage examples
    - _Requirements: 15.1, 15.4_

  - [x] 13.2 Implement `src/errors.ts`
    - Export `LenisAuthError extends Error` with `statusCode: number` and `error: string`
    - Export `LenisAPIError extends Error` with `statusCode: number`, `error: string`, `param?: string`
    - Export `LenisWebhookSignatureError extends Error` with `message: string`
    - _Requirements: 15.5, 15.7_

  - [x] 13.3 Implement `src/types.ts`
    - Export `CreatePaymentParams`, `PaymentIntent`, `ListPaymentsParams`, `ListObject<T>`, `CreatePaymentLinkParams`, `PaymentLink`, all fully typed
    - Export request/response types for all resource methods
    - _Requirements: 15.3_

  - [x] 13.4 Implement `src/_http.ts` and `src/resources/`
    - `HttpClient` using Node.js built-in `https.request` (no external HTTP lib); 30-second timeout; `Authorization: Bearer {apiKey}` on all requests; retry on 5xx with delays `[1000, 2000, 4000]` ms; throws `LenisAuthError` on 401, `LenisAPIError` on other non-2xx
    - `PaymentsResource`: `create(params)`, `retrieve(paymentId)`, `list(params?)`
    - `PaymentLinksResource`: `create(params)`, `retrieve(id)`, `list(params?)`
    - `WebhooksResource`: `constructEvent(payload: Buffer, sigHeader: string, secret: string): object` — port of HMAC verify logic; throws `LenisWebhookSignatureError` on failure; validates timestamp within 300 seconds
    - _Requirements: 15.2, 15.5_

  - [x] 13.5 Implement `src/client.ts` and `src/index.ts`
    - `Lenis` class constructor `({ apiKey }: { apiKey: string })`: throws `LenisAuthError` immediately if `apiKey` is `undefined`, `null`, or empty string; instantiates `HttpClient`; exposes `payments`, `paymentLinks`, `webhooks` resources
    - Export `Lenis`, all error classes, and all types from `src/index.ts`
    - _Requirements: 15.1, 15.7_

  - [x] 13.6 Write vitest unit tests for TypeScript SDK
    - Create `sdks/typescript/tests/client.test.ts`
    - Test cases: successful payment creation; HTTP 401 throws `LenisAuthError`; `constructEvent` succeeds with valid signature; `constructEvent` throws `LenisWebhookSignatureError` with wrong secret; constructing `Lenis` with empty key throws `LenisAuthError`
    - _Requirements: 15.6_

  - [ ]* 13.7 Write fast-check property-based tests for TypeScript SDK
    - **Property 5: Webhook Signature Round-Trip (TypeScript SDK)** — `constructEvent(Buffer.from(payload), buildHeader(secret, payload), secret)` never throws for any payload + secret
    - Run with `fc.assert(fc.property(...), { numRuns: 100 })`
    - **Validates: Requirements 13.4, 15.6**

---

### 14. Checkpoint — SDKs Complete

- [ ] 14. Checkpoint — Python and TypeScript SDKs complete
  - Run `pytest sdks/python/tests/ --tb=short` — all tests must pass
  - Run `npx vitest --run sdks/typescript/tests/` — all tests must pass
  - Run `mypy --strict sdks/python/lenis/` — zero errors
  - Ask the user if questions arise before starting frontend work

---

### 15. Frontend Public Pages

- [~] 15. Implement public-facing React pages (add to existing frontend project)
  - [x] 15.1 Create public page layout and shared SEO component
    - Create `frontend/src/components/seo/SEOMeta.tsx` that renders `<title>`, `<meta name="description">`, and Open Graph `og:title`, `og:description`, `og:url` tags via React Helmet or equivalent
    - Create `frontend/src/layouts/PublicLayout.tsx` with a top navigation bar (links: Home, Pricing, Docs, Sign In, Get Started) and a footer (links: Terms, Privacy, Contact)
    - _Requirements: 17.9_

  - [-] 15.2 Implement `HomePage` at route `/`
    - Create `frontend/src/pages/public/HomePage.tsx` with sections: hero (headline + primary CTA → `/sign-up`), feature highlights (at least 3 cards), supported networks/tokens grid, pricing summary teaser (Free / Pro / Enterprise), and CTA footer banner
    - Wrap with `PublicLayout` and `SEOMeta`
    - _Requirements: 17.1_

  - [-] 15.3 Implement `AboutPage` at route `/about`
    - Create `frontend/src/pages/public/AboutPage.tsx` describing the platform mission and non-custodial model; include `SEOMeta`
    - _Requirements: 17.2_

  - [-] 15.4 Implement `PricingPage` at route `/pricing`
    - Create `frontend/src/pages/public/PricingPage.tsx` with a feature-matrix table comparing Free, Pro, and Enterprise tiers across: transaction limits, API rate limits, team members, and support level
    - _Requirements: 17.3_

  - [-] 15.5 Implement `TermsPage` and `PrivacyPage` at `/terms` and `/privacy`
    - Create `frontend/src/pages/public/TermsPage.tsx` and `PrivacyPage.tsx` with static text content and `SEOMeta` tags
    - _Requirements: 17.4, 17.5_

  - [-] 15.6 Implement `ContactPage` at route `/contact`
    - Create `frontend/src/pages/public/ContactPage.tsx` with a form: name (1–100 chars), email, message (1–2000 chars)
    - On submit: POST to `/v1/contact`; show success message on 200; show field-level error on 422
    - Include client-side validation before submission
    - _Requirements: 17.6, 17.7, 17.8_

  - [ ] 15.7 Register all public routes in the React Router config
    - Add routes `/`, `/about`, `/pricing`, `/terms`, `/privacy`, `/contact` in `frontend/src/App.tsx` (or equivalent router config file) under `PublicLayout`
    - _Requirements: 17.1–17.6_

---

### 16. Frontend Developer Documentation Hub

- [x] 16. Implement the `/docs` documentation hub
  - [x] 16.1 Create `DocsLayout` and sidebar navigation component
    - Create `frontend/src/pages/docs/DocsLayout.tsx` with a persistent left sidebar and right content area
    - Sidebar sections and links (per design): Getting Started (Introduction, Quickstart, Authentication, Test Mode vs Live Mode), Core Concepts (Non-Custodial Model, Payment Lifecycle, Supported Networks & Tokens, Idempotency Keys), API Reference (Payments, Payment Links, Transactions, Webhooks, API Keys), Webhooks (Setup Guide, Event Types, Signature Verification, Retry Logic), SDKs (Python SDK, TypeScript SDK), Integration Guides (E-Commerce, Custom Checkout, Webhook Handler Setup), Security (API Key Best Practices, Webhook Signature Verification, Idempotency Key Usage)
    - Route: `/docs` with nested routes for all sub-pages
    - _Requirements: 18.1_

  - [x] 16.2 Implement `CodeSample` component with copy button
    - Create `frontend/src/components/docs/CodeSample.tsx` that renders syntax-highlighted code blocks
    - Copy button: calls `navigator.clipboard.writeText(sampleText)` within 500 ms of click; updates button label to a confirmed state for at least 1 second then reverts
    - _Requirements: 18.9_

  - [x] 16.3 Implement Getting Started section pages
    - `frontend/src/pages/docs/getting-started/Introduction.tsx`
    - `frontend/src/pages/docs/getting-started/Quickstart.tsx` — account → API key → first payment in ≤ 5 numbered steps
    - `frontend/src/pages/docs/getting-started/Authentication.tsx`
    - `frontend/src/pages/docs/getting-started/TestVsLive.tsx`
    - _Requirements: 18.2_

  - [x] 16.4 Implement Core Concepts section pages
    - `NonCustodialModel.tsx`, `PaymentLifecycle.tsx`, `SupportedNetworks.tsx`, `IdempotencyKeys.tsx` under `frontend/src/pages/docs/core-concepts/`
    - _Requirements: 18.3_

  - [x] 16.5 Implement API Reference section pages
    - Create one page per resource: `PaymentsDocs.tsx`, `PaymentLinksDocs.tsx`, `TransactionsDocs.tsx`, `WebhooksDocs.tsx`, `ApiKeysDocs.tsx` under `frontend/src/pages/docs/api-reference/`
    - Each page: endpoint method + path, description, request parameters table, response schema table, code samples in `curl`, Python, and JavaScript/TypeScript using the `CodeSample` component
    - _Requirements: 18.4, 18.5_

  - [x] 16.6 Implement Webhooks section pages
    - `SetupGuide.tsx`, `EventTypes.tsx` (reference table of all 8 event types), `SignatureVerification.tsx` (code samples in Python, Node.js, PHP), `RetryLogic.tsx` with retry schedule explanation + link to test webhook endpoint
    - _Requirements: 18.6_

  - [x] 16.7 Implement SDKs, Integration Guides, and Security section pages
    - `PythonSDKDocs.tsx` and `TypeScriptSDKDocs.tsx` with install commands and usage examples under `frontend/src/pages/docs/sdks/`
    - `ECommerceIntegration.tsx`, `CustomCheckout.tsx`, `WebhookHandlerSetup.tsx` (code samples in Python FastAPI, Node Express, PHP) under `frontend/src/pages/docs/integration-guides/`
    - `ApiKeyBestPractices.tsx`, `WebhookSigVerificationSecurity.tsx`, `IdempotencyKeyUsage.tsx` under `frontend/src/pages/docs/security/`
    - _Requirements: 18.7, 18.8, 18.10_

  - [x] 16.8 Register all `/docs/*` routes in the React Router config
    - Add nested routes under `/docs` in the router config with `DocsLayout` as the parent outlet
    - _Requirements: 18.1_

---

### 17. Final Checkpoint

- [ ] 17. Final Checkpoint — All phases complete
  - Run full backend test suite: `pytest --tb=short`
  - Run Python SDK tests: `pytest sdks/python/tests/`
  - Run TypeScript SDK tests: `npx vitest --run`
  - Verify Alembic migration applies cleanly on a fresh database
  - Verify all 8 webhook event types emit correctly in Celery eager mode
  - Verify `/docs` sidebar renders all sections and copy button works
  - Verify contact form integration test: valid POST returns 200, invalid returns 422
  - Ask the user if questions arise

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation before moving to the next phase
- Property tests validate universal correctness properties (isolation, hash integrity, HMAC round-trip)
- Existing files modified: `app/core/models.py`, `app/core/celery_app.py`, `app/core/config.py`, `app/main.py`, `app/web3/state_machine.py`, `app/merchant/router.py`, `app/merchant/service.py`
- New modules created: `app/developer/`, `app/webhooks/`, `app/public/`, `sdks/python/`, `sdks/typescript/`

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2"] },
    { "id": 1, "tasks": ["1.3", "1.4", "2.1", "2.3"] },
    { "id": 2, "tasks": ["2.4", "2.2", "3.1", "6.1"] },
    { "id": 3, "tasks": ["2.5", "2.7", "3.2", "3.3", "3.5", "4.1", "6.2"] },
    { "id": 4, "tasks": ["2.6", "2.8", "3.4", "3.6", "4.2", "7.1", "7.5", "8.1", "9.1"] },
    { "id": 5, "tasks": ["4.3", "7.2", "7.6", "8.2", "10.1", "10.2", "10.3"] },
    { "id": 6, "tasks": ["7.3", "7.4", "12.1", "13.1"] },
    { "id": 7, "tasks": ["12.2", "12.3", "13.2", "13.3", "15.1"] },
    { "id": 8, "tasks": ["12.4", "12.5", "13.4", "13.5", "15.2", "15.3", "15.4", "15.5", "15.6"] },
    { "id": 9, "tasks": ["12.6", "13.6", "15.7", "16.1", "16.2"] },
    { "id": 10, "tasks": ["12.7", "13.7", "16.3", "16.4", "16.5"] },
    { "id": 11, "tasks": ["16.6", "16.7"] },
    { "id": 12, "tasks": ["16.8"] }
  ]
}
```
