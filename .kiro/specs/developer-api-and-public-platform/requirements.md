# Requirements Document

## Introduction

This document specifies requirements for completing the Lenis platform with three major additions: a production-grade Developer API (`/v1/`) that lets external developers integrate crypto payments programmatically (Stripe-quality DX), a full Webhooks system with signed delivery, retry logic, and audit trail, and a public web presence including marketing pages and a rich developer documentation hub. The feature also specifies an official Python SDK (`lenis-python`) and JavaScript/TypeScript SDK (`lenis-node`), plus an idempotency layer and per-API-key rate limiting.

The backend is FastAPI + SQLAlchemy 2.0 (async) + PostgreSQL/SQLite + Celery + Redis. The existing `APIKey` model, `Organization` model, `Payment` model, `PaymentLink` model, and EVM indexer (`app/web3/`) are already in place and are reused rather than replaced.

---

## Glossary

- **Developer_API**: The versioned REST namespace (`/v1/`) exposed to external developers for programmatic crypto payment integration.
- **API_Key**: An `APIKey` record from `app/core/models.py`. Secret keys (`sk_test_*`, `sk_live_*`) authenticate Developer_API requests. Publishable keys (`pk_test_*`, `pk_live_*`) identify the client in browser-safe contexts.
- **Idempotency_Key**: A client-supplied string (via `Idempotency-Key` request header) that deduplicates POST requests within 24 hours.
- **WebhookEndpoint**: A registered HTTPS URL belonging to a merchant that receives outbound event notifications.
- **WebhookEvent**: The canonical record of a single platform event (e.g., `payment.confirmed`) stored before delivery is attempted.
- **WebhookDelivery**: A single delivery attempt record for a WebhookEvent to a WebhookEndpoint, including HTTP status, response body, and latency.
- **HMAC_Signature**: An HMAC-SHA256 digest computed over a timestamp-prefixed payload, sent as `X-Lenis-Signature` on every outbound webhook POST.
- **Payment_Intent**: A `Payment` record in `pending` status created via `POST /v1/payments`, representing the merchant's request for a customer to pay a specific amount.
- **Test_Mode**: Operation using `sk_test_*` API keys; the system routes requests to testnet RPC endpoints and prevents mainnet side-effects.
- **Live_Mode**: Operation using `sk_live_*` API keys; the system routes requests to mainnet RPC endpoints.
- **SDK**: A client library (Python or JavaScript/TypeScript) that wraps the Developer_API.
- **Rate_Limiter**: The per-API-key request throttle that enforces tier-based limits and returns standard `X-RateLimit-*` response headers.
- **Public_Pages**: Server-rendered or static HTML pages at the platform root domain for marketing and documentation (not behind authentication).
- **Docs_Hub**: The `/docs` public page providing structured developer documentation with code samples and a sidebar navigation.
- **Idempotency_Store**: A Redis-backed key-value store that caches POST responses keyed by `(API_Key.id, Idempotency_Key)` with a 24-hour TTL.

---

## Requirements

---

### Requirement 1: API Key Management for Merchants

**User Story:** As a merchant, I want to generate and manage API keys from my dashboard, so that I can authenticate Developer_API calls from my application.

#### Acceptance Criteria

1. WHEN a merchant sends `POST /merchant/api-keys` with a `key_type` of `sk_test`, `pk_test`, `sk_live`, or `pk_live`, THE API_Key_Service SHALL create a new `APIKey` record and return the full plaintext key exactly once in the response.
2. WHEN a new `APIKey` is created, THE API_Key_Service SHALL store the SHA-256 hash of the plaintext secret key in `key_hash`, store the last 4 characters in `suffix_display`, and never store the full plaintext in the database.
3. IF a merchant attempts to create an `APIKey` when their `Organization` already has 10 active keys across all key types, THEN THE API_Key_Service SHALL reject the request with HTTP 422 and `{"error": "api_key_limit_reached"}` and SHALL NOT create a new `APIKey` record.
4. WHEN a merchant sends `GET /merchant/api-keys`, THE API_Key_Service SHALL return all non-revoked `APIKey` records for the merchant's `Organization`, showing only `prefix` and `suffix_display` (not the full key).
5. WHEN a merchant sends `DELETE /merchant/api-keys/{key_id}`, THE API_Key_Service SHALL set `active = False` and record `revoked_at` on the `APIKey` record, returning HTTP 204.
6. IF a merchant attempts to delete an `APIKey` that does not belong to their `Organization`, THEN THE API_Key_Service SHALL return HTTP 404.
7. IF a merchant attempts to delete an `APIKey` that has already been revoked (`active = False`), THEN THE API_Key_Service SHALL return HTTP 404.
8. THE API_Key_Service SHALL enforce a maximum of 10 active API keys per `Organization` across all key types.

---

### Requirement 2: API Key Authentication Middleware

**User Story:** As a developer, I want to authenticate Developer_API requests using a secret key in the `Authorization` header, so that I can call `/v1/` endpoints without a JWT session.

#### Acceptance Criteria

1. WHEN a request arrives at any `/v1/*` endpoint with `Authorization: Bearer sk_test_<token>` or `Authorization: Bearer sk_live_<token>` where the token suffix is at least 32 characters, THE Auth_Middleware SHALL hash the token with SHA-256 and look it up in the `api_keys` table.
2. WHEN the API key lookup finds a record where `active = True` AND (`expires_at` is null OR `expires_at` is greater than current UTC timestamp), THE Auth_Middleware SHALL attach the owning `Organization` and `User` to the request context and allow the request to proceed.
3. IF the `Authorization` header is absent, does not match the `Bearer sk_test_*` or `Bearer sk_live_*` format, or the token does not match any `APIKey` record, THEN THE Auth_Middleware SHALL return HTTP 401 with `{"error": "invalid_api_key", "message": "No valid API key found in the Authorization header."}`.
4. IF the `Authorization` header is present and the token matches an `APIKey` record where `active = False`, THEN THE Auth_Middleware SHALL return HTTP 401 with `{"error": "api_key_revoked", "message": "This API key has been revoked."}`.
5. IF the token matches an `APIKey` record where `expires_at` is set and is in the past, THEN THE Auth_Middleware SHALL return HTTP 401 with `{"error": "api_key_expired", "message": "This API key has expired."}`.
6. WHEN a `sk_test_*` key is successfully authenticated, THE Auth_Middleware SHALL set `request.state.test_mode = True`.
7. WHEN a `sk_live_*` key is successfully authenticated, THE Auth_Middleware SHALL set `request.state.test_mode = False`.

---

### Requirement 3: Per-API-Key Rate Limiting

**User Story:** As a platform operator, I want to enforce per-API-key rate limits, so that no single developer can overload the infrastructure.

#### Acceptance Criteria

1. THE Rate_Limiter SHALL enforce a default limit of 100 requests per 60-second sliding window per `APIKey`.
2. WHEN a request is processed, THE Rate_Limiter SHALL set `X-RateLimit-Limit` (maximum allowed requests in window), `X-RateLimit-Remaining` (requests remaining in current window), and `X-RateLimit-Reset` (Unix timestamp when the current window expires) headers on every `/v1/*` response.
3. IF a Developer_API request exceeds the rate limit, THEN THE Rate_Limiter SHALL return HTTP 429 with `{"error": "rate_limit_exceeded", "retry_after": <seconds>}` and a `Retry-After` header set to the same seconds value.
4. THE Rate_Limiter SHALL store per-key counters in Redis using a sliding window algorithm with a 60-second TTL.
5. IF the Redis connection is unavailable when the Rate_Limiter attempts to check or increment a counter, THE Rate_Limiter SHALL allow the request to proceed (fail-open) and SHALL omit the `X-RateLimit-*` headers from the response.

---

### Requirement 4: Idempotency for POST Endpoints

**User Story:** As a developer, I want POST requests with an `Idempotency-Key` header to be deduplicated, so that network retries never create duplicate payments.

#### Acceptance Criteria

1. WHEN a POST request to any `/v1/*` endpoint includes an `Idempotency-Key` header and the key has NOT been seen before for this `APIKey` within 24 hours, THE Idempotency_Store SHALL cache the response (HTTP status code + body) after the request completes with a 2xx status code, keyed by `(api_key_id, idempotency_key)` with a 24-hour TTL.
2. WHEN a POST request to any `/v1/*` endpoint includes an `Idempotency-Key` header and an identical `(api_key_id, idempotency_key)` pair exists in the Idempotency_Store, THE Idempotency_Store SHALL return the cached response immediately without executing the handler again and SHALL set the `Idempotency-Replayed: true` response header.
3. IF an `Idempotency-Key` is reused with a different request body hash or a different endpoint path within 24 hours, THEN THE Idempotency_Store SHALL return HTTP 422 with `{"error": "idempotency_key_reused_with_different_request"}`.
4. THE System SHALL accept `Idempotency-Key` values of 1 to 255 characters in length.
5. IF an `Idempotency-Key` header value is empty (zero length) or exceeds 255 characters, THE Idempotency_Store SHALL return HTTP 422 with `{"error": "invalid_idempotency_key"}`.

---

### Requirement 5: Payment Intent Creation (POST /v1/payments)

**User Story:** As a developer, I want to create a payment intent via the API, so that I can request a specific crypto payment from my customer without using the merchant dashboard.

#### Acceptance Criteria

1. WHEN a developer sends `POST /v1/payments` with valid `amount`, `token_symbol`, `network`, and at least one `accepted_tokens` entry containing `token_symbol` and `network` pair, THE Payment_API SHALL create a `Payment` record in `pending` status and a corresponding `PaymentLink` record in `active` status, then return HTTP 201 with a `PaymentIntentResponse` body.
2. THE PaymentIntentResponse SHALL include `id`, `status`, `amount`, `token_symbol`, `network`, `checkout_url`, `created`, and `expires_at` fields.
3. IF `amount` is not a positive decimal between 0.01 and 999,999,999.99 with at most 8 decimal places, THEN THE Payment_API SHALL return HTTP 422 with `{"error": "invalid_amount", "param": "amount"}`.
4. IF `network` is not one of the platform-supported networks as returned by `NetworkRegistry.get_active_networks()`, THEN THE Payment_API SHALL return HTTP 422 with `{"error": "unsupported_network"}`.
5. IF `token_symbol` is not in the token list for the specified `network` in `NetworkRegistry`, THEN THE Payment_API SHALL return HTTP 422 with `{"error": "unsupported_token"}`.
6. WHEN `request.state.test_mode` is `True`, THE Payment_API SHALL tag the created `Payment` and `PaymentLink` with `is_test = True` and SHALL NOT trigger any mainnet blockchain indexing for those records.
7. THE Payment_API SHALL support an optional `metadata` field as a JSON object with a maximum of 16 keys, each key name at most 64 characters, and each value at most 500 characters.
8. THE Payment_API SHALL support an optional `expires_in` field as a positive integer representing seconds between 300 and 86400 inclusive; if omitted, THE Payment_API SHALL default to 3600 seconds.
9. IF `expires_in` is provided but is not a positive integer, is less than 300, or exceeds 86400, THE Payment_API SHALL return HTTP 422 with `{"error": "invalid_expires_in", "param": "expires_in"}`.
10. THE Payment_API SHALL support an optional `customer_email` field of at most 254 characters conforming to RFC 5322 format, stored as `Payment.payer_email`.
11. THE Payment_API SHALL support an optional `redirect_url` field as an HTTPS URL of at most 2048 characters, stored on the linked `PaymentLink`.

---

### Requirement 6: Payment Retrieval and Listing

**User Story:** As a developer, I want to retrieve and list payments associated with my API key, so that I can track payment statuses from my backend.

#### Acceptance Criteria

1. WHEN a developer sends `GET /v1/payments/{payment_id}`, THE Payment_API SHALL return the `Payment` record if it belongs to the authenticated `Organization`, with HTTP 200.
2. IF the `payment_id` does not exist or belongs to a different `Organization`, THEN THE Payment_API SHALL return HTTP 404 with `{"error": "payment_not_found"}`.
3. WHEN a developer sends `GET /v1/payments`, THE Payment_API SHALL return a paginated list of `Payment` records for the authenticated `Organization` ordered by `created_at` descending, with a default page size of 20 and a maximum of 100; if `limit` exceeds 100, THE Payment_API SHALL clamp it to 100.
4. THE Payment_API SHALL support `status`, `network`, `token_symbol`, `created_after`, and `created_before` (ISO 8601 datetime strings) as optional query filters on `GET /v1/payments`; if a filter value is present but invalid, THE Payment_API SHALL return HTTP 422 with `{"error": "invalid_filter", "param": "<field>"}`.
5. THE Payment_API SHALL return `has_more` (boolean), `next_cursor` (opaque string or null when no more pages exist), and `data` (array) on all list responses.

---

### Requirement 7: Payment Link API

**User Story:** As a developer, I want to create and manage payment links via the Developer_API, so that I can programmatically generate shareable payment pages without using the dashboard.

#### Acceptance Criteria

1. WHEN a developer sends `POST /v1/payment-links` with `title` (string, 1–200 chars), `amount_mode` (`fixed` or `flexible`), at least one `accepted_tokens` entry, and `amount` (required when `amount_mode` is `fixed`), THE Payment_Link_API SHALL create a `PaymentLink` record and return HTTP 201 with a `PaymentLinkResponse` including the full `checkout_url`.
2. WHEN a developer sends `GET /v1/payment-links/{id}`, THE Payment_Link_API SHALL return the `PaymentLink` record if it belongs to the authenticated `Organization`, with HTTP 200.
3. IF the `payment_link_id` does not exist or belongs to a different `Organization`, THEN THE Payment_Link_API SHALL return HTTP 404 with `{"error": "payment_link_not_found"}`.
4. WHEN a developer sends `GET /v1/payment-links`, THE Payment_Link_API SHALL return a paginated list of `PaymentLink` records for the authenticated `Organization` ordered by `created_at` descending, with a default page size of 20 and a maximum of 100.
5. THE Payment_Link_API SHALL support an optional `external_id` string of at most 128 characters on `POST /v1/payment-links` for developer reference, stored on the `PaymentLink` record.

---

### Requirement 8: Transactions Listing API

**User Story:** As a developer, I want to list confirmed transaction records via the API, so that I can reconcile completed payments in my own system.

#### Acceptance Criteria

1. WHEN a developer sends `GET /v1/transactions`, THE Transaction_API SHALL return a paginated list of `Payment` records with `status` of `confirmed` or `paid` for the authenticated `Organization`, ordered by `confirmed_at` descending, with a default page size of 20 and a maximum of 100.
2. WHEN a developer sends `GET /v1/transactions/{id}`, THE Transaction_API SHALL return the `Payment` record if it belongs to the authenticated `Organization` and has `status` of `confirmed` or `paid`, with HTTP 200.
3. IF the `transaction_id` does not exist, belongs to a different `Organization`, or has a status other than `confirmed` or `paid`, THEN THE Transaction_API SHALL return HTTP 404 with `{"error": "transaction_not_found"}`.
4. THE Transaction_API SHALL support `network`, `token_symbol`, `min_amount`, `max_amount`, `confirmed_after`, and `confirmed_before` (ISO 8601 datetime strings) as optional query filters on `GET /v1/transactions`; if a filter value is present but invalid, THE Transaction_API SHALL return HTTP 422 with `{"error": "invalid_filter", "param": "<field>"}`.

---

### Requirement 9: Webhook Endpoint Registration and Management

**User Story:** As a developer, I want to register and manage webhook endpoints via the API, so that my application receives real-time event notifications when payment states change.

#### Acceptance Criteria

1. WHEN a developer sends `POST /v1/webhooks` with a valid HTTPS `url` and a non-empty `events` array containing only recognized event types, THE Webhook_API SHALL create a `WebhookEndpoint` record with a randomly generated 32-byte hex `secret` and return HTTP 201 with the full `secret` value (returned only once at creation and never again).
2. IF the `url` does not start with `https://`, THEN THE Webhook_API SHALL return HTTP 422 with `{"error": "webhook_url_must_be_https"}`.
3. IF any value in the `events` array is not a recognized event type, THEN THE Webhook_API SHALL return HTTP 422 with `{"error": "unrecognized_event_types", "unrecognized": ["<type1>", ...]}` listing all unrecognized values.
4. WHEN a developer sends `GET /v1/webhooks`, THE Webhook_API SHALL return all `WebhookEndpoint` records for the authenticated `Organization` without the `secret` field.
5. WHEN a developer sends `DELETE /v1/webhooks/{id}`, THE Webhook_API SHALL delete the `WebhookEndpoint` record and return HTTP 204.
6. IF a developer attempts to delete a `WebhookEndpoint` that does not belong to their `Organization`, THEN THE Webhook_API SHALL return HTTP 404 with `{"error": "webhook_not_found"}`.
7. WHEN a developer sends `GET /v1/webhooks/{id}/deliveries`, THE Webhook_API SHALL return a paginated list of `WebhookDelivery` records for the endpoint ordered by `created_at` descending, with a default page size of 20 and a maximum of 100.
8. WHEN a developer sends `POST /v1/webhooks/{id}/test`, THE Webhook_API SHALL dispatch a synthetic `payment.confirmed` event to the endpoint synchronously and return the delivery result within 30 seconds.
9. IF a developer attempts to create a `WebhookEndpoint` when their `Organization` already has 20 active endpoints, THE Webhook_API SHALL return HTTP 422 with `{"error": "webhook_endpoint_limit_reached"}` and SHALL NOT create a new record.

---

### Requirement 10: Webhook Data Models

**User Story:** As a platform engineer, I want canonical data models for webhooks, so that event delivery is traceable and auditable.

#### Acceptance Criteria

1. THE System SHALL maintain a `WebhookEndpoint` table with columns: `id` (UUID PK), `organization_id` (FK → organizations), `url` (VARCHAR 2048), `secret` (VARCHAR 64, stored as plaintext for HMAC computation), `events` (JSON array of strings), `enabled` (BOOLEAN, default True), `disabled_at` (DATETIME nullable), `created_at` (DATETIME), `updated_at` (DATETIME).
2. THE System SHALL maintain a `WebhookEvent` table with columns: `id` (VARCHAR 32, `evt_` prefix), `organization_id` (FK → organizations), `type` (VARCHAR 100), `payload` (JSON), `created_at` (DATETIME). This table is append-only and rows SHALL never be updated or deleted.
3. THE System SHALL maintain a `WebhookDelivery` table with columns: `id` (UUID PK), `endpoint_id` (FK → webhook_endpoints, ondelete=CASCADE), `event_id` (FK → webhook_events), `status_code` (INTEGER nullable), `response_body` (TEXT nullable, first 4096 bytes stored), `duration_ms` (INTEGER nullable), `attempt_number` (INTEGER), `success` (BOOLEAN), `delivered_at` (DATETIME nullable), `created_at` (DATETIME).
4. WHEN 3 consecutive calendar days pass during which every delivery attempt to a `WebhookEndpoint` resulted in a non-2xx HTTP status or connection timeout, THE WebhookDelivery_Service SHALL set `WebhookEndpoint.enabled = False` and record `disabled_at` as the current UTC timestamp.

---

### Requirement 11: Webhook Event Types

**User Story:** As a developer, I want a well-defined set of webhook events, so that I can subscribe to exactly the notifications my application needs.

#### Acceptance Criteria

1. THE Webhook_Service SHALL support the following event types: `payment.created`, `payment.detected`, `payment.confirming`, `payment.confirmed`, `payment.expired`, `payment.underpaid`, `payment.link.created`, `payment.link.deactivated`.
2. WHEN a `Payment` record transitions to a new status via the state machine, THE Webhook_Service SHALL emit the corresponding event to each active `WebhookEndpoint` for the `Organization` that is subscribed to that event type within 5 seconds of the state transition being persisted.
3. WHEN a `PaymentLink` is created or deactivated, THE Webhook_Service SHALL emit `payment.link.created` or `payment.link.deactivated` respectively to each subscribed active `WebhookEndpoint` within 5 seconds of the action being persisted.
4. THE Webhook_Service SHALL construct every event payload in the following shape:
   ```json
   {
     "id": "evt_<32-char-hex>",
     "type": "<event_type>",
     "created": <unix_timestamp_integer>,
     "livemode": <boolean>,
     "data": { }
   }
   ```
5. THE Webhook_Service SHALL persist a `WebhookEvent` record before any delivery is attempted so that events are not lost if delivery fails.
6. IF the Webhook_Service fails to persist a `WebhookEvent` record due to a database error, THE Webhook_Service SHALL not attempt delivery and SHALL log an error message containing the event type and the associated `Organization` identifier.

---

### Requirement 12: Webhook Delivery and Retry

**User Story:** As a developer, I want webhook deliveries to be retried with exponential backoff, so that transient failures on my server do not cause me to miss events.

#### Acceptance Criteria

1. WHEN a `WebhookEvent` is emitted, THE Webhook_Delivery_Service SHALL attempt delivery to each subscribed `WebhookEndpoint` immediately as a Celery task.
2. THE Webhook_Delivery_Service SHALL retry failed deliveries on the following schedule (delay after the previous attempt): 5 seconds, 30 seconds, 5 minutes, 30 minutes, 2 hours — a maximum of 6 total attempts.
3. A delivery attempt is considered failed WHEN the endpoint returns a non-2xx HTTP status code OR WHEN the HTTP connection times out after 30 seconds.
4. THE Webhook_Delivery_Service SHALL record a `WebhookDelivery` row for each attempt including `status_code`, `response_body` (first 4096 bytes), `duration_ms`, `attempt_number`, and `success`.
5. WHEN a delivery succeeds (2xx response), THE Webhook_Delivery_Service SHALL set `WebhookDelivery.success = True`, record `delivered_at`, and cancel any scheduled retry tasks for that delivery.
6. WHEN all 6 delivery attempts have failed, THE Webhook_Delivery_Service SHALL set the `WebhookEvent` status to `failed` and SHALL NOT schedule any further retry tasks for that event.

---

### Requirement 13: Webhook Signature Verification

**User Story:** As a developer, I want every webhook POST to include a cryptographic signature, so that I can verify the payload came from Lenis and was not tampered with.

#### Acceptance Criteria

1. THE Webhook_Delivery_Service SHALL compute an HMAC-SHA256 signature over the string `"t={timestamp}\n{payload_json}"` using the `WebhookEndpoint.secret` as the HMAC key.
2. THE Webhook_Delivery_Service SHALL include the header `X-Lenis-Signature: t=<unix_timestamp>,v1=<hex_digest>` on every outbound webhook POST.
3. THE Python_SDK SHALL provide `LenisClient.webhooks.construct_event(payload_bytes, sig_header, secret)` that verifies the HMAC-SHA256 signature, checks the timestamp is within 300 seconds of `now()`, and returns the parsed event dict on success or raises `LenisWebhookSignatureError` on failure.
4. THE TypeScript_SDK SHALL provide `lenis.webhooks.constructEvent(payload, sigHeader, secret)` with identical verification semantics and SHALL throw `LenisWebhookSignatureError` on failure.
5. IF `WebhookEndpoint.enabled` is `False`, THE Webhook_Delivery_Service SHALL skip delivery to that endpoint without creating a `WebhookDelivery` row and SHALL NOT schedule retry tasks for that endpoint.
6. IF the `X-Lenis-Signature` header is absent or does not contain a `v1=` component, THE Python_SDK and TypeScript_SDK SHALL raise `LenisWebhookSignatureError` with a message indicating a malformed signature header.

---

### Requirement 14: Python SDK (`lenis-python`)

**User Story:** As a Python developer, I want an official SDK package, so that I can integrate Lenis payments without writing raw HTTP calls.

#### Acceptance Criteria

1. THE Python_SDK SHALL be installable as `pip install lenis-python` and expose a `LenisClient` class accepting `api_key` as a required constructor argument.
2. THE Python_SDK SHALL expose the following resource namespaces: `client.payments.create(...)`, `client.payments.retrieve(payment_id)`, `client.payments.list(...)`, `client.payment_links.create(...)`, `client.payment_links.retrieve(id)`, `client.payment_links.list(...)`, `client.webhooks.construct_event(payload, sig_header, secret)`.
3. WHEN a `5xx` response is received from the Developer_API, THE Python_SDK SHALL retry the request with exponential backoff delays of 1 second, 2 seconds, and 4 seconds (up to 3 retries total) before raising `LenisAPIError`.
4. THE Python_SDK SHALL raise `LenisAuthError` on HTTP 401, `LenisAPIError` on all other non-2xx responses, and `LenisWebhookSignatureError` when signature verification fails; each exception SHALL expose the HTTP status code and the `error` field from the response body where applicable.
5. THE Python_SDK SHALL be fully type-annotated (PEP 604+ style) and pass `mypy --strict` with no errors.
6. THE Python_SDK SHALL include a `pytest`-based unit test suite using `pytest-mock` to mock HTTP responses, covering: successful payment creation, duplicate idempotency key replay, API auth error, webhook signature success, and webhook signature failure.
7. IF the `api_key` constructor argument is `None` or an empty string, THE Python_SDK SHALL raise `LenisAuthError` at construction time before any network request is made.

---

### Requirement 15: JavaScript/TypeScript SDK (`lenis-node`)

**User Story:** As a JavaScript/TypeScript developer, I want an official SDK package, so that I can integrate Lenis payments from a Node.js backend without writing raw HTTP calls.

#### Acceptance Criteria

1. THE TypeScript_SDK SHALL be installable as `npm install lenis-node` and export a `Lenis` class accepting `{ apiKey: string }` as a constructor argument.
2. THE TypeScript_SDK SHALL expose: `lenis.payments.create(...)`, `lenis.payments.retrieve(paymentId)`, `lenis.payments.list(...)`, `lenis.paymentLinks.create(...)`, `lenis.paymentLinks.retrieve(id)`, `lenis.paymentLinks.list(...)`, `lenis.webhooks.constructEvent(payload, sigHeader, secret)`.
3. THE TypeScript_SDK SHALL export comprehensive TypeScript types for all request and response objects.
4. THE TypeScript_SDK SHALL produce both ESM and CommonJS (CJS) builds.
5. WHEN a `5xx` response is received, THE TypeScript_SDK SHALL retry with exponential backoff delays of 1 second, 2 seconds, and 4 seconds (up to 3 retries total) before throwing `LenisAPIError`.
6. THE TypeScript_SDK SHALL include a `vitest`-based unit test suite covering: successful payment creation, API auth error, webhook signature success, and webhook signature failure.
7. IF the `apiKey` constructor argument is `undefined`, `null`, or an empty string, THE TypeScript_SDK SHALL throw `LenisAuthError` at construction time before any network request is made.

---

### Requirement 16: Test Mode Enforcement

**User Story:** As a developer, I want test mode API keys to be fully isolated from live production data, so that I can safely develop and test integrations without risk.

#### Acceptance Criteria

1. WHEN `request.state.test_mode` is `True`, THE Payment_API SHALL only create `Payment` and `PaymentLink` records tagged with `is_test = True`.
2. WHEN `request.state.test_mode` is `True`, THE Payment_API SHALL resolve wallet addresses and RPC endpoints using testnet configuration from settings (distinct from mainnet RPC URLs).
3. WHEN a `sk_live_*` API key is used, THE Payment_API SHALL only return records where `is_test = False`.
4. WHEN a `sk_test_*` API key is used, THE Payment_API SHALL only return records where `is_test = True`.
5. WHEN a `sk_test_*` key triggers a webhook, THE Webhook_Service SHALL set `livemode: false` in the event payload.
6. IF a `sk_live_*` API key attempts to access a `Payment` or `PaymentLink` record tagged with `is_test = True`, THE Payment_API SHALL return HTTP 404 with `{"error": "payment_not_found"}` without disclosing that the record exists in test mode.

---

### Requirement 17: Public Marketing Pages

**User Story:** As a potential customer, I want a professional public-facing website, so that I can understand the platform's value, pricing, and terms before signing up.

#### Acceptance Criteria

1. THE System SHALL serve a homepage at `/` containing a hero section, feature highlights, supported networks/tokens, pricing summary, and a primary CTA button linking to the registration page.
2. THE System SHALL serve an `/about` page describing the platform mission and non-custodial model.
3. THE System SHALL serve a `/pricing` page listing at minimum three tiers (Free, Pro, Enterprise) with a feature-matrix table comparing transaction limits, API rate limits, team members, and support level.
4. THE System SHALL serve a `/terms` page containing the full Terms & Conditions text.
5. THE System SHALL serve a `/privacy` page containing the full Privacy Policy text.
6. THE System SHALL serve a `/contact` page with a contact form accepting name, email, and message.
7. WHEN a contact form is submitted with a name of 1–100 characters, a valid email address, and a message of 1–2000 characters, THE Contact_Service SHALL send an email notification to the platform support address and return HTTP 200 with a confirmation message.
8. IF a contact form submission contains a missing or invalid name, email, or message field, THE Contact_Service SHALL return HTTP 422 with an error identifying the failed field without sending any notification email.
9. THE System SHALL include appropriate SEO meta tags (`<title>`, `<meta name="description">`, Open Graph tags) on every public page.

---

### Requirement 18: Developer Documentation Hub (`/docs`)

**User Story:** As a developer evaluating the platform, I want a comprehensive, structured documentation site at `/docs`, so that I can go from zero to a working integration in under 30 minutes.

#### Acceptance Criteria

1. THE Docs_Hub SHALL be accessible at `/docs` without authentication and SHALL render with a persistent sidebar navigation covering: Getting Started, Core Concepts, API Reference, Webhooks, SDKs, Integration Guides, and Security.
2. THE Docs_Hub SHALL include a Getting Started section with sub-pages: Introduction, Quickstart (account → API key → first payment in ≤ 5 steps), Authentication, and Test Mode vs Live Mode.
3. THE Docs_Hub SHALL include a Core Concepts section covering: non-custodial model, payment lifecycle (pending → detected → confirming → confirmed), supported networks and tokens, and idempotency keys.
4. THE Docs_Hub SHALL include an API Reference section with one sub-page per resource (Payments, Payment Links, Transactions, Webhooks, API Keys), each containing the endpoint method, path, description, request parameters table, and a response schema table.
5. WHEN a reader views any API Reference endpoint page, THE Docs_Hub SHALL display complete, copyable code samples in at minimum three languages: `curl`, Python, and JavaScript/TypeScript.
6. THE Docs_Hub SHALL include a Webhooks section containing: a setup guide, event types reference table, signature verification guide with code samples in Python, Node.js, and PHP, retry logic explanation, and a link to the test webhook endpoint.
7. THE Docs_Hub SHALL include an SDKs section documenting the Python SDK and TypeScript SDK with install commands and working usage examples.
8. THE Docs_Hub SHALL include an Integration Guides section with step-by-step guides for: e-commerce integration, custom checkout flow, and webhook handler setup (with code samples in Python FastAPI, Node Express, and PHP).
9. WHEN a reader activates a copy button on a code sample, THE Docs_Hub SHALL write the full sample text to the clipboard via the browser Clipboard API within 500 milliseconds and SHALL update the copy button label to a confirmed state for at least 1 second.
10. THE Docs_Hub SHALL include a Security section covering: API key best practices, webhook signature verification, and idempotency key usage.

---

### Requirement 19: API Response Shape and Error Contract

**User Story:** As a developer, I want all Developer_API responses to follow a consistent shape, so that I can write robust error-handling code once and apply it everywhere.

#### Acceptance Criteria

1. THE Developer_API SHALL return all successful list responses in the shape `{"data": [...], "has_more": bool, "next_cursor": string|null, "total": int|null}`.
2. THE Developer_API SHALL return all error responses in the shape `{"error": "<machine_readable_code>", "message": "<human_readable_description>", "param": "<field_name_or_null>"}` with an appropriate HTTP status code.
3. THE Developer_API SHALL include an `X-Request-ID` header on every response containing a unique UUID for that request.
4. THE Developer_API SHALL set `Content-Type: application/json` on all responses.
5. THE Developer_API SHALL version all endpoints under the `/v1` prefix; no unversioned routes SHALL be registered under the `/v1` namespace.
6. IF the Developer_API receives a request body that cannot be parsed as valid JSON, THE Developer_API SHALL return HTTP 400 with `{"error": "invalid_request", "message": "Request body must be valid JSON."}`.

---

### Requirement 20: Webhook Test Endpoint Security

**User Story:** As a developer, I want the test webhook delivery to behave like a real delivery, so that I can verify my signature verification logic without waiting for a real payment.

#### Acceptance Criteria

1. WHEN `POST /v1/webhooks/{id}/test` is called, THE Webhook_API SHALL construct a synthetic `payment.confirmed` event with clearly marked test data (event id prefixed with `evt_test_`) and deliver it synchronously to the endpoint URL within 30 seconds.
2. THE Webhook_API SHALL sign the test delivery with the same HMAC-SHA256 algorithm used for real events, using the endpoint's `secret`.
3. THE Webhook_API SHALL record the test delivery as a `WebhookDelivery` row with `attempt_number = 0` to distinguish it from retry deliveries.
4. IF the test delivery fails (non-2xx response or timeout after 30 seconds), THE Webhook_API SHALL return HTTP 200 with `{"success": false, "status_code": <int_or_null>, "duration_ms": <int>}` rather than propagating an HTTP 5xx error.
5. IF `POST /v1/webhooks/{id}/test` is called with an `id` that does not belong to the authenticated `Organization`, THE Webhook_API SHALL return HTTP 404 with `{"error": "webhook_not_found"}`.
