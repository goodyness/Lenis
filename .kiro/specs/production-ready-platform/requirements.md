# Requirements Document

## Introduction

This spec covers the production hardening and new product features required to take the Lenis Web3 Financial Infrastructure SaaS from a functional development build to a deployable, observable, and commercially robust platform.

The Lenis platform allows African merchants to accept EVM-chain cryptocurrency payments (USDC, USDT, DAI, ETH, MATIC, BNB across Ethereum Mainnet, Base, Polygon, Arbitrum One, Optimism, and BNB Smart Chain) directly into their own wallets without custodying funds. The backend is a FastAPI + SQLAlchemy 2.0 async application deployed on a Google Cloud VM running Docker Compose with PostgreSQL, Redis, Celery, and Nginx.

This requirements document is organised into four groups:

1. **Critical Blockers** — features that block production launch (Blockchain Indexer, Idempotency, Per-Key Rate Limiting, Live API Key Generation)
2. **Security Hardening** — fixes to security weaknesses (CSP, Admin Route Protection, Webhook Secret Encryption, Testnet Isolation)
3. **Operational Concerns** — observability, resilience, and deployment quality (Health Endpoints, Structured Logging, DB Pool, Alembic-only migrations, Webhook Replay, Email Resilience, Docker libmagic)
4. **New Product Features** — capabilities that extend the platform's value (Fiat Equivalent Display, Customer Receipt Page, Merchant Analytics, Subscription Tier Enforcement, Team Members, IP Allowlisting, Webhook Secret Rotation, Stablecoin Depeg Alerts, Merchant Balances)

---

## Glossary

- **Blockchain_Indexer**: The subsystem responsible for detecting on-chain payment events and feeding them into the Payment_State_Machine. Operates in webhook mode (Alchemy/QuickNode push) or polling mode (self-hosted EVM RPC, `eth_getLogs`).
- **Payment_State_Machine**: The existing `app/web3/state_machine.py` module that manages `Payment` status transitions (`pending` → `detected` → `confirming` → `confirmed` → `paid`) and triggers settlement side-effects.
- **Idempotency_Middleware**: Redis-backed middleware in `app/developer/middleware.py` that deduplicates `POST /v1/*` requests using the `Idempotency-Key` header. Keyed as `idempotency:{api_key_id}:{sha256(idempotency_key)}`, TTL 86400 seconds.
- **API_Key_Rate_Limiter**: Sliding-window Redis counter enforcing 100 requests per 60 seconds per API key on all `/v1/*` endpoints.
- **Live_API_Key**: An API key with prefix `sk_live_` or `pk_live_` that operates against mainnet networks and live payment records. Requires the owning organization's KYC status to be `approved`.
- **CSP**: Content-Security-Policy HTTP response header controlling which origins the browser may load resources from.
- **Health_Endpoint**: `GET /health` — a lightweight synchronous endpoint returning HTTP 200 with no DB or Redis checks, used for container liveness probes.
- **Readiness_Endpoint**: `GET /ready` — an endpoint that checks DB reachability and Redis connectivity, returning HTTP 200 when both pass, used for container readiness probes.
- **Structured_Log**: A JSON-formatted log line containing at minimum `timestamp`, `level`, `logger`, `message`, `request_id`, `path`, `method`, and `duration_ms` fields suitable for ingestion by Google Cloud Logging.
- **Request_ID**: A UUID-4 string generated per HTTP request, injected as `X-Request-ID` response header and included in all log lines emitted during that request.
- **DB_Pool**: The SQLAlchemy async connection pool configured for production PostgreSQL with `pool_size=10`, `max_overflow=20`, `pool_pre_ping=True`.
- **Price_Oracle**: The CoinGecko public API (`/simple/price`) used to fetch real-time token-to-fiat exchange rates. Results cached in Redis with a 60-second TTL.
- **Fiat_Rate**: The exchange rate snapshot (token price in USD) captured at the moment a `Payment` transitions to `confirmed`, stored on the `Payment` record.
- **Receipt_Page**: The public, unauthenticated page at `/receipt/{tx_hash}` that renders a shareable proof-of-payment for a confirmed or paid `Payment`.
- **Subscription_Tier**: One of `free`, `growth`, `pro`, `enterprise`. Stored as `subscription_tier` on the `User` model. Controls the monthly transaction limit, API rate limit multiplier, and team member seat count.
- **Tier_Limit_Table**: The authoritative mapping of `Subscription_Tier` to enforced limits defined in code constants.
- **OrgMember**: A new join table (`org_members`) associating a `User` with an `Organization` and assigning a role (`owner`, `admin`, `developer`). Enables team access.
- **IP_Allowlist**: An optional ordered list of IPv4/IPv6 CIDR ranges stored on an `APIKey` record. When non-empty, requests from IPs outside the list are rejected with HTTP 403.
- **Webhook_Secret_Rotation**: The process of generating a new HMAC signing secret for a `WebhookEndpoint` while keeping the old secret valid for a 24-hour dual-signing window to prevent delivery interruptions.
- **Depeg_Alert**: An in-app notification and email sent to merchants when a monitored stablecoin (USDC, USDT) deviates more than 1% from $1.00 USD.
- **Merchant_Balance**: A real-time on-chain token balance for a merchant's registered `MerchantWallet` address, fetched via EVM RPC and returned by `GET /merchant/balances`.
- **Testnet_Mode**: When `TESTNET_MODE=True` in configuration, the Blockchain_Indexer routes all indexing to testnet RPC endpoints and `sk_test_*` keys are enforced. Mainnet RPCs are never called.
- **Alembic_Migration**: A database schema change managed exclusively via Alembic `alembic revision` files. In production, `alembic upgrade head` is the only permitted schema migration mechanism.
- **OrgMember_Role**: One of `owner`, `admin`, `developer`. Controls what actions a team member may perform within an organization.
- **Webhook_Event_Replay**: Re-enqueueing a `WebhookEvent` whose `status = 'failed'` for a new set of delivery attempts, resetting attempt counters.

---

## Requirements

---

### Requirement 1: Blockchain Indexer — Webhook Mode

**User Story:** As a platform operator, I want incoming blockchain payment events to be delivered to the platform in real time via managed webhook push from a node provider, so that payments are detected within seconds of on-chain confirmation.

#### Acceptance Criteria

1. THE System SHALL expose a `POST /webhooks/blockchain` endpoint that accepts signed event payloads from Alchemy and QuickNode webhook push services.
2. WHEN a webhook push payload is received at `POST /webhooks/blockchain`, THE Blockchain_Indexer SHALL validate the provider-specific HMAC signature using the shared secret configured in `BLOCKCHAIN_WEBHOOK_SECRET` before processing the payload.
3. IF the HMAC signature validation fails, THEN THE Blockchain_Indexer SHALL return HTTP 401 and SHALL NOT process the payload.
4. WHEN a valid webhook push payload contains an ERC-20 `Transfer` event whose `to` address matches a registered `MerchantWallet` address, THE Blockchain_Indexer SHALL call `PaymentStateMachine.record_detected_payment` within 5 seconds of receiving the event.
5. WHEN a valid webhook push payload contains a block confirmation update for a `Payment` with `status = 'detected'` or `status = 'confirming'`, THE Blockchain_Indexer SHALL call `PaymentStateMachine.update_confirmations` with the current block number.
6. WHERE `TESTNET_MODE = True`, THE Blockchain_Indexer SHALL process events exclusively from the testnet webhook stream and SHALL NOT process events from the mainnet webhook stream.
7. THE `POST /webhooks/blockchain` endpoint SHALL return HTTP 200 within 500 milliseconds by delegating all `PaymentStateMachine` calls to a Celery task, ensuring the provider does not retry due to slow response times.
8. WHEN a `PaymentStateMachine` call dispatched from the webhook handler fails, THE Celery task SHALL retry up to 3 times with delays of 5, 30, and 300 seconds before marking the task as failed.

---

### Requirement 2: Blockchain Indexer — Polling Fallback Mode

**User Story:** As a platform operator, I want a self-hosted EVM RPC polling fallback so that payments are still detected even if the managed webhook provider is unavailable or misconfigured.

#### Acceptance Criteria

1. THE System SHALL include a Celery beat periodic task named `poll_blockchain_events` that runs every 15 seconds when `INDEXER_POLLING_ENABLED = True` in configuration.
2. WHEN `poll_blockchain_events` executes, THE Blockchain_Indexer SHALL query each active network's RPC endpoint using `eth_getLogs` for `Transfer` events where the `topics[2]` (recipient address, padded) matches any active `MerchantWallet` address within the last 10 blocks.
3. WHEN a `Transfer` event is detected whose `to` address matches a registered `MerchantWallet`, THE Blockchain_Indexer SHALL call `PaymentStateMachine.record_detected_payment` with the event data.
4. WHEN `poll_blockchain_events` runs, THE Blockchain_Indexer SHALL persist the last processed block number per network in Redis under the key `indexer:last_block:{chain_id}` to avoid re-processing already-seen blocks.
5. IF an RPC endpoint is unreachable or returns an error during polling, THEN THE Blockchain_Indexer SHALL log the error with the chain ID and network display name and continue polling the remaining networks without raising an exception.
6. WHERE `TESTNET_MODE = True`, THE Blockchain_Indexer SHALL substitute testnet RPC endpoints (`BASE_SEPOLIA_RPC_URL`, `POLYGON_MUMBAI_RPC_URL`, etc.) for the corresponding mainnet RPC endpoints.
7. THE polling task SHALL NOT create duplicate `Payment` records for the same `tx_hash`; duplicate detection SHALL rely on the unique constraint on `payments.tx_hash`.

---

### Requirement 3: Idempotency Middleware Activation

**User Story:** As a developer integrating the Lenis API, I want duplicate `POST /v1/*` requests with the same `Idempotency-Key` to return the original response instead of creating duplicate records, so that network retries are safe.

#### Acceptance Criteria

1. THE Idempotency_Middleware SHALL be applied to all `POST` routes under `/v1/` in `app/developer/router.py`.
2. WHEN a `POST /v1/*` request is received with an `Idempotency-Key` header whose value has not been seen before, THE Idempotency_Middleware SHALL process the request normally and store the response in Redis under key `idempotency:{api_key_id}:{sha256(idempotency_key_value)}` with a TTL of 86400 seconds.
3. WHEN a `POST /v1/*` request is received with an `Idempotency-Key` that matches a cached entry for the same endpoint and request body hash, THE Idempotency_Middleware SHALL return the cached response with an `Idempotency-Replayed: true` header and SHALL NOT execute the route handler.
4. WHEN a `POST /v1/*` request is received with an `Idempotency-Key` that matches a cached entry but with a different endpoint or request body hash, THE Idempotency_Middleware SHALL return HTTP 422 with `{"error": "idempotency_key_reused_with_different_request"}`.
5. IF the `Idempotency-Key` header is empty or exceeds 255 characters, THEN THE Idempotency_Middleware SHALL return HTTP 422 with `{"error": "invalid_idempotency_key"}` and SHALL NOT execute the route handler.
6. WHEN Redis is unavailable, THE Idempotency_Middleware SHALL fail open by executing the route handler normally and logging a warning, rather than returning an error to the caller.
7. FOR ALL valid `POST /v1/payments` requests sent N times with the same `Idempotency-Key`, THE System SHALL create exactly 1 `Payment` record and all N responses SHALL have identical `id` and `status` fields.

---

### Requirement 4: Per-API-Key Rate Limiting on /v1/

**User Story:** As a platform operator, I want each API key to be limited to 100 requests per 60-second sliding window on all `/v1/` routes, so that a single misconfigured integration cannot degrade service for other API users.

#### Acceptance Criteria

1. THE API_Key_Rate_Limiter SHALL be applied to all routes under `/v1/` using the sliding-window algorithm implemented in `app/developer/middleware.py`.
2. WHEN a `/v1/*` request is made with an API key whose request count in the current 60-second sliding window is below 100, THE API_Key_Rate_Limiter SHALL allow the request and set `X-RateLimit-Limit: 100`, `X-RateLimit-Remaining: {remaining}`, and `X-RateLimit-Reset: {epoch_seconds}` headers on the response.
3. WHEN a `/v1/*` request is made with an API key whose sliding-window count reaches or exceeds 100, THE API_Key_Rate_Limiter SHALL return HTTP 429 with body `{"error": "rate_limit_exceeded", "retry_after": {seconds}}` and a `Retry-After: {seconds}` response header.
4. WHEN Redis is unavailable, THE API_Key_Rate_Limiter SHALL fail open by allowing the request and omitting the `X-RateLimit-*` headers, logging a single warning per unavailability window.
5. WHERE `subscription_tier = 'enterprise'`, THE API_Key_Rate_Limiter SHALL apply a limit of 1000 requests per 60-second window instead of 100 for keys belonging to that organization's owner.

---

### Requirement 5: Live API Key Generation

**User Story:** As a developer whose KYC has been approved, I want to generate live-mode API keys, so that I can process real payments on mainnet networks.

#### Acceptance Criteria

1. WHEN an authenticated developer calls `POST /users/me/api-keys/live`, THE System SHALL verify that the calling user's `status = 'verified'` before generating any key. IF `status != 'verified'`, THEN THE System SHALL return HTTP 403 with `{"error": "VERIFICATION_REQUIRED"}`.
2. WHEN `POST /users/me/api-keys/live` is called by a verified developer, THE System SHALL generate a `pk_live_` key (publishable, plaintext stored) and an `sk_live_` key (secret, SHA-256 hash stored, last 4 chars in `suffix_display`).
3. THE System SHALL return the `sk_live_` plaintext exactly once in the HTTP response body. After the response is sent, THE System SHALL NOT expose the full plaintext of the `sk_live_` key again in any API response.
4. WHEN live keys are generated, THE System SHALL write an `api_key.generate_live` entry to the `AuditLog` with the developer's User ID as `actor_id`.
5. IF the developer already has active `pk_live_` and `sk_live_` keys for their organization, THEN THE System SHALL return HTTP 409 with `{"error": "live_keys_already_exist"}` and SHALL NOT generate duplicate keys.

---

### Requirement 6: Content-Security-Policy Tuning

**User Story:** As a platform operator, I want the Content-Security-Policy header to permit the resources needed by the React SPA while still blocking malicious cross-origin loads, so that the frontend functions correctly in production without weakening security.

#### Acceptance Criteria

1. THE Security_Headers_Middleware SHALL apply a `Content-Security-Policy` header whose `default-src` directive is `'self'`.
2. THE CSP SHALL include a `script-src` directive permitting `'self'` and `'nonce-{per-request-nonce}'`; inline scripts without a nonce SHALL be blocked.
3. THE CSP SHALL include a `style-src` directive permitting `'self'` and `'unsafe-inline'` to support Tailwind CSS utility classes rendered at runtime.
4. THE CSP SHALL include a `font-src` directive permitting `'self'` and `data:` to support base64-embedded fonts.
5. THE CSP SHALL include a `connect-src` directive permitting `'self'` and the value of `settings.frontend_origin` to allow the React app to call the API from the browser.
6. THE CSP SHALL include an `img-src` directive permitting `'self'`, `data:`, and `blob:` to support QR code images and uploaded merchant logos.
7. THE CSP SHALL include a `frame-ancestors 'none'` directive to replace the existing `X-Frame-Options: DENY` header with an equivalent CSP-native directive.
8. WHERE `settings.app_env = 'development'`, THE Security_Headers_Middleware SHALL relax `script-src` to include `'unsafe-eval'` to support Vite hot-module replacement.

---

### Requirement 7: Admin Frontend Route Protection

**User Story:** As a platform operator, I want admin-only frontend pages to redirect non-admin users to the dashboard instead of rendering broken UI, so that the principle of least privilege is enforced at the routing layer.

#### Acceptance Criteria

1. WHEN an authenticated user whose `account_type` is not `admin` or `superadmin` navigates to any route under `/admin`, THE Frontend_Router SHALL redirect the user to `/dashboard` within 1 second.
2. WHEN an unauthenticated user navigates to any route under `/admin`, THE Frontend_Router SHALL redirect the user to `/login` with a `?next=/admin` query parameter.
3. THE `ProtectedRoute` component used for admin routes SHALL accept a `requiredRole` prop of type `'admin' | 'superadmin'` and SHALL enforce the redirect behaviour in criteria 1 and 2.
4. IF the authenticated user's role cannot be determined within 2 seconds of navigation (e.g., profile API call in flight), THEN THE Frontend_Router SHALL display a loading indicator and SHALL NOT render the admin page content or redirect prematurely.
5. THE role check SHALL read from the in-memory Zustand auth store and SHALL NOT make an additional API request on every navigation event.

---

### Requirement 8: Webhook Secret Encryption at Rest

**User Story:** As a platform operator, I want webhook endpoint secrets encrypted in the database rather than stored as plaintext, so that a database dump does not expose all webhook signing keys.

#### Acceptance Criteria

1. THE System SHALL encrypt all `WebhookEndpoint.secret` values at rest using AES-256-GCM with a key derived from `WEBHOOK_ENCRYPTION_KEY` in the environment configuration before writing to the database.
2. WHEN `emit_webhook_event` reads a `WebhookEndpoint` record to sign a delivery, THE System SHALL decrypt the `secret` field in memory before passing it to `build_signature_header`.
3. WHEN a new `WebhookEndpoint` is created, THE System SHALL encrypt the plaintext secret immediately before the INSERT, so that the plaintext is never persisted to the database.
4. THE `WEBHOOK_ENCRYPTION_KEY` environment variable SHALL be a base64-encoded 32-byte value. IF the key is missing or malformed at startup, THEN THE System SHALL log a critical error and raise `SystemExit(1)`.
5. THE encryption and decryption logic SHALL be encapsulated in `app/webhooks/crypto.py` with `encrypt_secret(plaintext: str) -> str` and `decrypt_secret(ciphertext: str) -> str` functions.

---

### Requirement 9: Testnet Isolation in the Payment State Machine

**User Story:** As a developer testing integrations, I want test-mode payments processed exclusively against testnet RPC endpoints so that test transactions can never interact with mainnet networks.

#### Acceptance Criteria

1. WHEN `PaymentStateMachine.record_detected_payment` is called with `is_test = True`, THE Payment_State_Machine SHALL set `payment.is_test = True` on the created `Payment` record.
2. WHEN the Blockchain_Indexer routes a confirmed event to `PaymentStateMachine.update_confirmations` for a `Payment` where `is_test = True`, THE Payment_State_Machine SHALL use the testnet network configuration (confirmation thresholds from testnet registry) rather than the mainnet configuration.
3. WHERE `TESTNET_MODE = True`, THE Blockchain_Indexer SHALL use the testnet RPC URL for each network (`BASE_SEPOLIA_RPC_URL`, `POLYGON_MUMBAI_RPC_URL`, `ARBITRUM_SEPOLIA_RPC_URL`, `OPTIMISM_SEPOLIA_RPC_URL`, `ETHEREUM_SEPOLIA_RPC_URL`) and SHALL NOT make any calls to mainnet RPC endpoints.
4. WHERE `TESTNET_MODE = False`, THE Blockchain_Indexer SHALL only process events on mainnet networks and SHALL log a warning and skip any event payload that carries a testnet chain ID.
5. WHEN a `Payment` with `is_test = True` transitions to `confirmed`, THE Payment_State_Machine SHALL emit the `payment.confirmed` webhook event with `livemode = False`.

---

### Requirement 10: Health and Readiness Endpoints

**User Story:** As a platform operator, I want dedicated health and readiness HTTP endpoints so that Docker, GCE health checks, and load balancer probes can determine the container's state without relying on application endpoints.

#### Acceptance Criteria

1. THE System SHALL expose a `GET /health` endpoint that returns HTTP 200 with body `{"status": "ok"}` without performing any database or Redis checks, completing within 100 milliseconds.
2. THE System SHALL expose a `GET /ready` endpoint that performs a `SELECT 1` query against the database and a `PING` command against Redis, returning HTTP 200 with body `{"status": "ready", "db": "ok", "redis": "ok"}` when both succeed.
3. IF the database `SELECT 1` fails during `GET /ready`, THEN THE System SHALL return HTTP 503 with body `{"status": "not_ready", "db": "error", "redis": "ok" | "error"}`.
4. IF the Redis `PING` fails during `GET /ready`, THEN THE System SHALL return HTTP 503 with body `{"status": "not_ready", "db": "ok" | "error", "redis": "error"}`.
5. THE `GET /health` and `GET /ready` endpoints SHALL NOT require authentication and SHALL NOT be subject to rate limiting middleware.
6. THE `GET /ready` endpoint SHALL complete within 2 seconds; IF either check does not respond within 2 seconds, THEN THE System SHALL treat that check as failed and return HTTP 503.

---

### Requirement 11: Structured JSON Logging and Request ID Correlation

**User Story:** As a platform operator, I want all application log output to be in JSON format with a per-request correlation ID, so that logs ingested into Google Cloud Logging can be searched, filtered, and correlated across services.

#### Acceptance Criteria

1. THE System SHALL configure Python's `logging` framework to emit JSON-formatted log lines using `python-json-logger` or `structlog` on every log record at `WARNING` level and above in production (`APP_ENV = production`).
2. EACH JSON log line SHALL include the fields: `timestamp` (ISO 8601 UTC), `level`, `logger`, `message`, `request_id` (when emitted in a request context), `path`, `method`, `status_code`, and `duration_ms`.
3. WHEN an HTTP request is received, THE Request_ID_Middleware SHALL generate a UUID-4 `request_id` if no `X-Request-ID` header is present, or use the value from the header if one is provided.
4. THE Request_ID_Middleware SHALL attach the `request_id` to the response as an `X-Request-ID` header on all responses under all routes.
5. THE `request_id` SHALL be propagated to Celery task log records by passing it as a task argument and including it in the task's structured log lines.
6. WHERE `APP_ENV = development`, THE System SHALL use the standard Python logging format (not JSON) to preserve readability during local development.
7. THE System SHALL log all unhandled exceptions at `ERROR` level with the full traceback included in the `message` field of the JSON log line.

---

### Requirement 12: PostgreSQL Connection Pool Configuration

**User Story:** As a platform operator, I want the SQLAlchemy engine configured with an appropriate connection pool for production PostgreSQL so that the application handles concurrent requests without exhausting database connections.

#### Acceptance Criteria

1. WHEN `settings.database_url` does not start with `sqlite`, THE System SHALL create the SQLAlchemy async engine with `pool_size=10`, `max_overflow=20`, `pool_pre_ping=True`, and `pool_recycle=1800`.
2. WHEN `settings.database_url` starts with `sqlite`, THE System SHALL continue to use the default single-connection engine with `connect_args={"check_same_thread": False}` and SHALL NOT apply pool settings.
3. THE System SHALL log the active pool configuration (`pool_size`, `max_overflow`) at `INFO` level during application startup.
4. WHERE `settings.app_env = 'production'` and `settings.database_url` starts with `sqlite`, THE System SHALL log a `WARNING` stating that SQLite is not recommended for production use.

---

### Requirement 13: Remove Inline SQLite Auto-Migration

**User Story:** As a platform operator, I want the application startup code free of raw SQL ALTER TABLE statements so that production schema management is exclusively controlled by Alembic migrations and the codebase is easier to maintain.

#### Acceptance Criteria

1. THE `_sync_sqlite_cols` function and its caller block inside the `lifespan` async context manager in `app/main.py` SHALL be removed.
2. ALL schema additions previously handled by `_sync_sqlite_cols` (new columns on `users`, `merchant_profiles`, `payment_links`, `payments`, `webhook_endpoints`, `webhook_events`, `webhook_deliveries`) SHALL be represented exclusively by Alembic migration files in `migrations/versions/`.
3. WHEN running `alembic upgrade head` against a fresh database, THE Migration SHALL create all tables and columns without requiring any application startup code.
4. THE `lifespan` function SHALL retain only the `engine.dispose()` and Redis pool close calls in its shutdown block, and SHALL contain no DDL or schema-inspection logic.
5. A consolidated Alembic migration file SHALL be created that captures all schema changes previously applied by `_sync_sqlite_cols`, named `consolidate_inline_migrations`.

---

### Requirement 14: Webhook Event Replay

**User Story:** As a developer, I want to replay failed webhook events from the dashboard or the API so that I can recover from temporary endpoint outages without losing event history.

#### Acceptance Criteria

1. THE System SHALL expose a `POST /v1/webhooks/events/{event_id}/replay` endpoint accessible with a valid API key belonging to the event's organization.
2. WHEN `POST /v1/webhooks/events/{event_id}/replay` is called for a `WebhookEvent` with `status = 'failed'`, THE System SHALL reset the `WebhookEvent.status` to `'pending'` and enqueue `deliver_webhook.delay(event_id, endpoint_id)` for each active subscribed endpoint in the organization.
3. IF `POST /v1/webhooks/events/{event_id}/replay` is called for a `WebhookEvent` with `status = 'delivered'`, THEN THE System SHALL return HTTP 422 with `{"error": "event_already_delivered"}` and SHALL NOT re-enqueue delivery.
4. IF the calling API key's organization does not own the `WebhookEvent`, THEN THE System SHALL return HTTP 404 with `{"error": "event_not_found"}`.
5. THE System SHALL expose a `GET /v1/webhooks/events` endpoint returning a cursor-paginated list of `WebhookEvent` records for the authenticated organization, filterable by `status` and `type` query parameters.
6. THE Merchant_Dashboard SHALL expose a "Retry" button on each failed webhook event in the developer portal webhook event log, calling `POST /v1/webhooks/events/{event_id}/replay` and displaying the updated status.

---

### Requirement 15: Email Delivery Resilience

**User Story:** As a platform operator, I want email dispatch failures to be detected and logged rather than silently swallowed, so that missing emails can be investigated and retried.

#### Acceptance Criteria

1. WHEN `send_email_task.delay()` is called and the Celery broker (Redis) is unavailable, THE System SHALL catch the `kombu.exceptions.OperationalError` (or equivalent broker connection error), log an `ERROR` record containing the recipient address and template name, and raise the exception so the calling request handler can decide whether to fail or continue.
2. WHEN `send_email_task` fails all 3 retry attempts, THE System SHALL write a dead-letter record to Redis under the key `email_dead_letter:{uuid}` containing the original `to`, `subject`, `template`, and `context` values, and log a `CRITICAL` record identifying the dead-letter key.
3. THE System SHALL expose an admin-only `GET /admin/email-dead-letters` endpoint returning the list of unprocessed dead-letter keys from Redis, with `to`, `subject`, and `template` fields visible.
4. THE System SHALL expose an admin-only `POST /admin/email-dead-letters/{key}/retry` endpoint that re-enqueues the dead-letter email as a new `send_email_task` and removes the key from Redis on success.
5. THE System SHALL expose an admin-only `DELETE /admin/email-dead-letters/{key}` endpoint that removes a dead-letter record without retrying.

---

### Requirement 16: Docker Image libmagic Documentation

**User Story:** As a platform operator, I want the Docker image for the Lenis application to declare and install the `libmagic1` system library so that `python-magic` MIME type detection works correctly in the containerised deployment.

#### Acceptance Criteria

1. THE `Dockerfile` for the Lenis application SHALL include `apt-get install -y libmagic1` (or the equivalent Alpine package `file` for Alpine-based images) in the `RUN` layer that installs system dependencies.
2. THE `Dockerfile` SHALL use a multi-stage build with a `builder` stage installing Python dependencies and a `runtime` stage containing only the compiled application and system libraries needed to run it.
3. THE deployment documentation (`README.md` or `docs/deployment.md`) SHALL list `libmagic1` as a required system dependency and document its purpose.
4. WHEN the application starts and `python-magic` attempts to load `libmagic`, THE System SHALL NOT fall back to the `_fallback_detect_mime` byte-header check in production. IF `libmagic` is not loadable in `APP_ENV = production`, THEN THE System SHALL log a `CRITICAL` error at startup.

---

### Requirement 17: Fiat Equivalent Display on Payments

**User Story:** As a merchant, I want to see the local fiat currency equivalent of each payment at the time it was received, so that I can reconcile crypto receipts with my business accounts in local currency.

#### Acceptance Criteria

1. THE `Payment` ORM model SHALL have two new columns: `fiat_amount_at_payment` (Numeric 18,2, nullable) and `fiat_currency` (VARCHAR 10, nullable, default `'USD'`).
2. WHEN a `Payment` transitions to `confirmed` status in `PaymentStateMachine.settle_payment`, THE System SHALL query the Price_Oracle for the token's current USD price, multiply by the payment amount in token units, and store the result in `fiat_amount_at_payment` rounded to 2 decimal places.
3. THE Price_Oracle query SHALL use the CoinGecko `/simple/price` endpoint with results cached in Redis under `price_oracle:{token_symbol}` with a TTL of 60 seconds.
4. IF the Price_Oracle is unreachable or returns an error, THEN THE System SHALL log a warning, set `fiat_amount_at_payment = None`, and continue the settlement without failing the payment status transition.
5. THE `GET /v1/payments/{id}` and `GET /v1/transactions/{id}` API responses SHALL include `fiat_amount_at_payment` and `fiat_currency` fields when non-null.
6. THE Merchant_Dashboard transaction list SHALL display the fiat equivalent amount alongside the token amount for each confirmed payment.
7. FOR ALL confirmed `Payment` records where `fiat_amount_at_payment` is non-null, the value SHALL equal `payment.amount * fiat_rate` rounded to 2 decimal places, where `fiat_rate` was the price at settlement time.

---

### Requirement 18: Customer Receipt Page

**User Story:** As a payer, I want a permanent, shareable URL showing proof of my completed payment, so that I can provide evidence of payment to the merchant or keep it for my records.

#### Acceptance Criteria

1. THE System SHALL expose a public, unauthenticated page at `/receipt/{tx_hash}` in the React frontend.
2. WHEN a customer navigates to `/receipt/{tx_hash}`, THE Receipt_Page SHALL call `GET /api/v1/receipt/{tx_hash}` and display: payer wallet address (`from_address`), merchant name, merchant wallet address (`to_address`), payment amount, token symbol, network display name, confirmation timestamp in ISO 8601 UTC, block number, number of confirmations, and transaction hash as a link to a block explorer for the relevant network.
3. IF the `tx_hash` does not match any `Payment` record with `status` in `('confirmed', 'paid')`, THEN THE Receipt_Page SHALL display a "Receipt not found" message and SHALL NOT show any payment details.
4. THE `GET /api/v1/receipt/{tx_hash}` backend endpoint SHALL be publicly accessible without authentication and SHALL return HTTP 200 with payment data or HTTP 404 if not found.
5. THE Receipt_Page SHALL include an `<meta name="description">` tag with the text `"Payment receipt: {amount} {token_symbol} on {network}"` for social media preview cards.
6. WHEN the `Payment.is_test = True`, THE Receipt_Page SHALL display a visible banner stating "This is a test-mode payment receipt" and SHALL NOT display the block explorer link.

---

### Requirement 19: Merchant Analytics

**User Story:** As a merchant, I want charts showing my revenue trends, top tokens, and conversion rates so that I can understand how my payment activity is evolving over time.

#### Acceptance Criteria

1. THE System SHALL expose a `GET /merchant/analytics` endpoint accessible only to authenticated merchants with `onboarding_complete = True`, accepting query parameters `period` (one of `daily`, `weekly`, `monthly`, default `daily`) and `start_date` / `end_date` (ISO 8601 date strings, default last 30 days).
2. THE `GET /merchant/analytics` response SHALL include:
   - `revenue_series`: an ordered list of `{date, amount, fiat_equivalent}` data points aggregated over confirmed and paid `Payment` records for the period.
   - `top_tokens`: an ordered list of `{token_symbol, total_amount, payment_count}` for up to 5 tokens by total amount.
   - `top_networks`: an ordered list of `{network, total_amount, payment_count}` for up to 5 networks by total amount.
   - `conversion_rate`: a decimal in [0, 1] representing the ratio of `Payment` records reaching `confirmed` or `paid` status to the total `Payment` records created in the period.
   - `average_payment_size`: the mean confirmed payment amount in USD equivalent for the period, rounded to 2 decimal places. Returns `null` if no confirmed payments exist.
3. IF `start_date` is after `end_date`, THEN THE System SHALL return HTTP 422 with `{"error": "invalid_date_range"}`.
4. IF `start_date` is more than 24 months before the current date, THEN THE System SHALL return HTTP 422 with `{"error": "date_range_too_large"}`.
5. THE analytics query results SHALL be cached in Redis under `analytics:{merchant_id}:{period}:{start_date}:{end_date}` with a TTL of 300 seconds to prevent repeated heavy aggregation queries.
6. THE Merchant_Dashboard analytics page SHALL render the `revenue_series` data as a line chart using the existing frontend charting library, with the date on the x-axis and confirmed amount in USD on the y-axis.

---

### Requirement 20: Subscription Tier Enforcement

**User Story:** As a platform operator, I want subscription tier limits enforced at runtime so that free-tier merchants cannot exceed their plan's transaction limit and paid-tier merchants receive the capacity their plan entitles them to.

#### Acceptance Criteria

1. THE System SHALL define the following `Tier_Limit_Table` as code constants:
   - `free`: 50 payments per calendar month, API rate limit multiplier 1×.
   - `growth`: 500 payments per calendar month, API rate limit multiplier 2×.
   - `pro`: 5000 payments per calendar month, API rate limit multiplier 5×.
   - `enterprise`: unlimited payments, API rate limit multiplier 10×.
2. WHEN a merchant's `Payment` record transitions to `confirmed` status, THE System SHALL increment `user.monthly_tx_count` by 1.
3. WHEN a new `PaymentLink` is created by a merchant (either via the merchant dashboard or the Developer API), THE System SHALL check whether `user.monthly_tx_count >= tier_limit` for the merchant's current `subscription_tier`. IF the limit is reached and the tier is not `enterprise`, THEN THE System SHALL return HTTP 402 with `{"error": "monthly_limit_reached", "tier": "{tier}", "limit": {limit}, "current": {current}}`.
4. THE `monthly_tx_count` value SHALL be reset to 0 on the first day of each calendar month by a Celery beat task named `reset_monthly_tx_counts` that runs daily at 00:05 UTC.
5. THE Merchant_Dashboard overview page SHALL display the merchant's current monthly transaction usage as `{monthly_tx_count} / {tier_limit}` (displaying "Unlimited" for enterprise tier).
6. WHERE `subscription_expires_at` is non-null and `subscription_expires_at < now()`, THE System SHALL treat the user's effective `subscription_tier` as `free` for enforcement purposes regardless of the stored `subscription_tier` value.

---

### Requirement 21: Team Members (Organization Members)

**User Story:** As a merchant business owner, I want to invite team members to my organization with specific roles so that my employees can manage payment links and view transactions without sharing my personal login credentials.

#### Acceptance Criteria

1. THE System SHALL create a new `org_members` database table with columns: `id` (UUID PK), `organization_id` (FK → organizations, CASCADE), `user_id` (FK → users, CASCADE), `role` (VARCHAR 20, CHECK IN `('owner', 'admin', 'developer')`), `invited_by` (FK → users nullable), `accepted_at` (DATETIME nullable), `created_at` (DATETIME).
2. THE System SHALL expose a `POST /merchant/team/invite` endpoint that sends an invitation email to a new email address with a time-limited (48-hour) invitation token. The inviting user's `OrgMember_Role` MUST be `owner` or `admin`.
3. WHEN an invitee clicks the invitation link and completes registration or login, THE System SHALL create an `OrgMember` record linking their `User` to the inviting `Organization` with the assigned role, and set `accepted_at = now()`.
4. THE System SHALL expose `GET /merchant/team` returning all active `OrgMember` records for the authenticated user's organization, including each member's `email`, `full_name`, `role`, and `accepted_at`.
5. THE System SHALL expose `DELETE /merchant/team/{member_id}` that removes an `OrgMember` record. IF the caller's role is not `owner` or `admin`, THEN THE System SHALL return HTTP 403.
6. THE System SHALL expose `PATCH /merchant/team/{member_id}/role` that updates a member's role. Only an `owner` may assign or remove the `owner` role. An `admin` may change `developer` to `admin` but may not elevate to or demote from `owner`.
7. THE System SHALL prevent an `owner` from removing themselves if they are the only `owner` in the organization. IF such removal is attempted, THE System SHALL return HTTP 409 with `{"error": "cannot_remove_sole_owner"}`.
8. WHERE an API key belongs to an organization, the `get_api_key_org` dependency SHALL resolve the full organization and the member's effective role, making the role available via `request.state.member_role`.

---

### Requirement 22: IP Allowlisting for API Keys

**User Story:** As an enterprise developer, I want to restrict my API keys to requests originating from specific IP ranges, so that even a leaked key cannot be used from an unauthorized network.

#### Acceptance Criteria

1. THE `APIKey` ORM model SHALL have a new `allowed_ips` column (TEXT nullable) storing a comma-separated list of IPv4 and IPv6 CIDR ranges (e.g., `"203.0.113.0/24,2001:db8::/32"`).
2. WHEN `allowed_ips` is null or empty for an `APIKey`, THE `get_api_key_org` dependency SHALL allow requests from any IP address.
3. WHEN `allowed_ips` is non-empty, THE `get_api_key_org` dependency SHALL extract the client IP from the `X-Forwarded-For` header (first non-private IP) or `request.client.host`, and check whether it falls within any of the listed CIDR ranges.
4. IF the client IP does not match any CIDR range in `allowed_ips`, THEN THE `get_api_key_org` dependency SHALL return HTTP 403 with `{"error": "ip_not_allowed"}`.
5. THE System SHALL expose `PATCH /merchant/api-keys/{key_id}/allowed-ips` accepting a JSON body `{"allowed_ips": ["203.0.113.0/24"]}`, validating each entry as a valid CIDR notation, and updating the `APIKey` record.
6. IF any entry in the `allowed_ips` list is not valid CIDR notation, THEN THE System SHALL return HTTP 422 with `{"error": "invalid_cidr", "param": "allowed_ips"}` and SHALL NOT modify the record.
7. WHERE `subscription_tier` is `free` or `growth`, THE System SHALL return HTTP 402 with `{"error": "feature_requires_pro_tier"}` when `PATCH /merchant/api-keys/{key_id}/allowed-ips` is called, as IP allowlisting is a Pro and Enterprise feature.

---

### Requirement 23: Webhook Endpoint Secret Rotation

**User Story:** As a developer, I want to rotate my webhook endpoint's signing secret without interrupting event delivery, so that I can follow security best practices without dropping webhook events during the key changeover.

#### Acceptance Criteria

1. THE System SHALL expose a `POST /v1/webhooks/{id}/rotate-secret` endpoint accessible with a valid secret API key belonging to the endpoint's organization.
2. WHEN `POST /v1/webhooks/{id}/rotate-secret` is called, THE System SHALL generate a new 32-byte hex secret, store it encrypted as `WebhookEndpoint.secret`, and store the previous secret encrypted in a new `WebhookEndpoint.previous_secret` column along with a `previous_secret_expires_at` timestamp set to 24 hours from now.
3. WHEN `deliver_webhook` in `app/webhooks/delivery.py` signs a payload, THE System SHALL include both the current and previous secret (if `previous_secret_expires_at > now()`) in the `Lenis-Signature` header using comma-separated `v1=` components, e.g. `t={ts},v1={sig_new},v1={sig_old}`.
4. AFTER `previous_secret_expires_at` has passed, THE System SHALL set `previous_secret = None` and `previous_secret_expires_at = None` on the next signature operation for that endpoint, effectively ending the dual-signing window.
5. THE `POST /v1/webhooks/{id}/rotate-secret` response SHALL include the new plaintext secret exactly once and SHALL include `{"expires_old_secret_at": "{iso_timestamp}"}` to communicate the dual-signing window end time to the developer.
6. IF `POST /v1/webhooks/{id}/rotate-secret` is called while a previous rotation's 24-hour window is still active, THEN THE System SHALL return HTTP 409 with `{"error": "rotation_already_in_progress", "expires_at": "{iso_timestamp}"}`.

---

### Requirement 24: Stablecoin Depeg Alerts

**User Story:** As a merchant accepting stablecoin payments, I want to be notified immediately if USDC or USDT deviates significantly from its $1.00 peg, so that I can pause accepting that stablecoin if needed to avoid financial loss.

#### Acceptance Criteria

1. THE System SHALL include a Celery beat periodic task named `check_stablecoin_pegs` that runs every 5 minutes.
2. WHEN `check_stablecoin_pegs` executes, THE System SHALL query the Price_Oracle for the current USD price of USDC and USDT on each active EVM network.
3. IF the price of USDC or USDT deviates by more than 1% from $1.00 USD (i.e., price < 0.99 or price > 1.01), THEN THE System SHALL create a `Notification` record of `type = 'depeg_alert'` for every merchant with `onboarding_complete = True` who has an active `PaymentLink` accepting that stablecoin.
4. WHEN a Depeg_Alert is created, THE System SHALL dispatch a `send_email_task` to the affected merchant's email address with the stablecoin symbol, current price, and a recommendation to temporarily disable that token on their payment links.
5. THE System SHALL NOT send duplicate Depeg_Alert notifications for the same stablecoin within a 6-hour window. The deduplication key SHALL be stored in Redis as `depeg_alert_sent:{token_symbol}` with a TTL of 21600 seconds.
6. WHEN the stablecoin price returns to within 0.5% of $1.00, THE System SHALL clear the deduplication key from Redis and create a `Notification` of `type = 'depeg_resolved'` for the previously alerted merchants.

---

### Requirement 25: Merchant Balance Endpoint

**User Story:** As a merchant, I want to see my current on-chain token balances for each registered wallet so that I can verify my funds without leaving the Lenis dashboard.

#### Acceptance Criteria

1. THE System SHALL expose a `GET /merchant/balances` endpoint accessible only to authenticated merchants with `onboarding_complete = True`.
2. WHEN `GET /merchant/balances` is called, THE System SHALL query the EVM RPC for each of the merchant's active `MerchantWallet` records, fetching the native token balance (`eth_getBalance`) and the balance of each configured ERC-20 token (`balanceOf`) on the wallet's network.
3. THE `GET /merchant/balances` response SHALL be an array of objects each containing: `wallet_address`, `network`, `balances` (array of `{token_symbol, raw_balance, formatted_balance, contract_address}`).
4. THE balance query results SHALL be cached in Redis under `balances:{merchant_id}:{wallet_id}` with a TTL of 30 seconds to limit RPC call frequency.
5. IF an RPC endpoint is unreachable for a given network during a balance query, THEN THE System SHALL include `{"error": "rpc_unavailable"}` in place of the `balances` array for that wallet and continue fetching balances for remaining wallets.
6. THE `formatted_balance` field SHALL be the human-readable decimal representation of the token balance divided by 10^decimals, rounded to 6 decimal places.
7. WHERE `TESTNET_MODE = True`, THE System SHALL read balances from testnet RPC endpoints for the corresponding networks rather than mainnet endpoints.

---

### Requirement 26: Docker Compose and Deployment Manifest

**User Story:** As a platform operator, I want a complete Docker Compose configuration for the production deployment on a Google Cloud VM so that all services start correctly with a single command.

#### Acceptance Criteria

1. THE `docker-compose.yml` (or `docker-compose.prod.yml`) SHALL define services for: `app` (FastAPI), `worker` (Celery worker), `beat` (Celery beat), `redis`, `postgres`, and `nginx`.
2. THE `app`, `worker`, and `beat` services SHALL use the same Docker image built from the project `Dockerfile`.
3. THE `nginx` service SHALL be configured as a reverse proxy forwarding port 443 (TLS) to the `app` service on port 8000, with TLS certificates mounted from a host volume at `/etc/letsencrypt`.
4. THE `postgres` service SHALL mount a named volume `pg_data` for persistent database storage.
5. THE `redis` service SHALL mount a named volume `redis_data` for persistence with `appendonly yes` in the Redis configuration.
6. ALL services SHALL define `restart: unless-stopped` policies.
7. THE `app` service health check SHALL call `GET /health` via `curl` with a 5-second timeout, retrying 3 times with a 10-second interval.
8. THE deployment `README.md` or `docs/deployment.md` SHALL document the minimum required environment variables and their purpose, referencing `.env.example`.

