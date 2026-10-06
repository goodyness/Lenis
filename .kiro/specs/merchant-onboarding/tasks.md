# Implementation Plan: Merchant Onboarding & Payment Tools

## Overview

Extend the Lenis platform to support African merchant onboarding via a four-step guided wizard, KYC verification (manual or Dojah), EVM wallet management, payment link and invoice creation, a public checkout page, and admin merchant management. The feature adds five new backend modules (`app/merchant/`, `app/checkout/`, `app/networks/`, extended `app/admin/`, and core utilities), six new database tables, a full merchant dashboard in React, and property-based tests for ten correctness properties.

---

## Tasks

### 1. Infrastructure & Config

- [x] 1. Extend `app/core/config.py` with all new environment variables
  - [x] 1.1 Add KYC, Countries API, EVM RPC, ERC-20 contract, and file storage settings to `Settings`
    - Add fields: `use_dojah`, `dojah_app_id`, `dojah_secret_key`, `rest_countries_api`
    - Add RPC fields: `ethereum_rpc_url`, `base_rpc_url`, `polygon_rpc_url`, `arbitrum_rpc_url`, `optimism_rpc_url`, `bsc_rpc_url`
    - Add contract fields for USDC/USDT/DAI per network (18 fields) with mainnet defaults as specified in design
    - Add storage fields: `upload_storage`, `upload_local_path`, `max_upload_size_mb`, `aws_s3_bucket`, `aws_access_key_id`, `aws_secret_access_key`, `aws_region`
    - _Requirements: 7.2, 7.5, 15.1, 15.2_

### 2. Database Models & Migration

- [x] 2. Add ORM models for all six new tables and generate the Alembic migration
  - [x] 2.1 Implement `MerchantProfile` ORM model in `app/core/models.py`
    - Map `merchant_profiles` table with all columns from design: `id`, `user_id` (FK → users.id, UNIQUE), `full_name`, `country`, `phone_number`, `business_name`, `website_url`, social handle fields (×5), `is_registered_business`, `registration_doc_path`, `kyc_status` (default `not_started`), `kyc_document_path`, `kyc_document_type`, `nin`, `kyc_dojah_session_id`, `kyc_reviewed_by` (FK → users.id, nullable), `kyc_reviewed_at`, `kyc_rejection_reason`, `onboarding_complete`, `onboarding_step` (default 1), `wallet_added`, `created_at`, `updated_at`
    - Add `CheckConstraint` for `kyc_status IN ('not_started','pending','approved','rejected')`
    - Add relationship back to `User`
    - _Requirements: 2.11, 4.11, 5.6, 12.3, 12.4_

  - [x] 2.2 Implement `MerchantWallet` ORM model in `app/core/models.py`
    - Map `merchant_wallets` table: `id`, `merchant_id` (FK → users.id), `network` (str 64), `address` (str 42), `status` (default `active`), `created_at`, `updated_at`
    - Add `CheckConstraint` for `status IN ('active','pending','inactive')`
    - Note in docstring: partial unique index `(merchant_id, network) WHERE status IN ('active','pending')` is created in the Alembic migration manually
    - _Requirements: 5.6, 13.1, 13.3, 13.4_

  - [x] 2.3 Implement `PaymentLink` ORM model in `app/core/models.py`
    - Map `payment_links` table: `id`, `merchant_id` (FK → users.id), `title` (str 200), `slug` (str 200, UNIQUE), `amount_mode`, `amount` (Numeric 28,18 nullable), `currency`, `accepted_tokens` (JSON), `status` (default `active`), `expires_at`, `max_uses`, `use_count` (default 0), `redirect_url`, `total_collected` (Numeric 28,18 default 0), `created_at`, `updated_at`
    - Add `CheckConstraint` for `amount_mode` and `status` enums
    - Add `Index` on `slug` and `merchant_id`
    - _Requirements: 8.14, 8.15, 9.1, 9.2_

  - [x] 2.4 Implement `Invoice` and `InvoiceLineItem` ORM models in `app/core/models.py`
    - `Invoice`: `id`, `merchant_id` (FK → users.id), `payment_link_id` (FK → payment_links.id, nullable), `customer_name`, `customer_email`, `due_date`, `status` (default `draft`), `notes`, `accepted_tokens` (JSON), `created_at`, `updated_at`; relationship to `line_items`
    - `InvoiceLineItem`: `id`, `invoice_id` (FK → invoices.id CASCADE DELETE), `description` (str 500), `amount` (Numeric 12,2), `sort_order` (int default 0)
    - Add `CheckConstraint` for `Invoice.status` enum; add `Index` on `merchant_id` and `status`
    - _Requirements: 10.3, 10.7, 10.11_

  - [x] 2.5 Implement `Payment` placeholder ORM model in `app/core/models.py`
    - Map `payments` table as specified in design with all columns; add docstring stating this table is populated only by a future blockchain indexer — no service code reads or writes it in this spec
    - Add `CheckConstraint` for `status` enum and `Index` on `payment_link_id`
    - _Requirements: 6.3, 6.4, 11.9_

  - [x] 2.6 Generate Alembic migration for all six new tables
    - Run `alembic revision --autogenerate -m "add_merchant_onboarding_tables"` and review the generated file
    - Manually add the partial unique index for `merchant_wallets`: `CREATE UNIQUE INDEX uq_wallet_active ON merchant_wallets (merchant_id, network) WHERE status IN ('active','pending')`
    - Add corresponding `DROP INDEX` in `downgrade()`
    - _Requirements: 5.6, 13.4_

### 3. Core Services

- [x] 3. Implement core infrastructure: NetworkRegistry, StorageBackend, KYCService, slug utility, Celery tasks
  - [x] 3.1 Implement `NetworkRegistry` in `app/core/networks.py`
    - Define `TokenConfig` and `NetworkConfig` dataclasses as specified in design
    - Implement `NetworkRegistry.__init__(settings)` that reads RPC URLs and contract addresses from `Settings`, logs a warning and excludes any network missing its RPC URL, logs a warning and excludes any token missing its contract address
    - Implement `get_active_networks()`, `get_network_by_id(chain_id)`, `get_supported_tokens(chain_id)`
    - Wire all six networks (Ethereum, Base, Polygon, Arbitrum, Optimism, BSC) with correct `chain_id`, `display_name`, `native_symbol`, `confirmation_count`, and `block_time_seconds` from Requirement 7.3 and 7.4
    - Expose module-level singleton `network_registry = NetworkRegistry(settings)`
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.8, 7.9_

  - [x] 3.2 Implement `StorageBackend` abstraction in `app/core/storage.py`
    - Define abstract `StorageBackend` with `upload_file(content, path, content_type) -> str`, `get_presigned_url(key, expires_in) -> str`, `delete_file(key) -> None`
    - Implement `LocalStorageBackend`: writes files under `settings.upload_local_path`, `get_presigned_url` returns a local file path reference, `delete_file` removes the file
    - Implement `S3StorageBackend`: uses `boto3` async client with `AWS_S3_BUCKET`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`; `get_presigned_url` generates a pre-signed URL with `expires_in` seconds (max 900 seconds per Req 15.6); raises `StorageUnavailableError` on connection failure
    - Implement `get_storage_backend() -> StorageBackend` factory that reads `settings.upload_storage` and returns the appropriate backend
    - Add path builder helpers: `kyc_path(user_id, ext) -> str` → `kyc/{user_id}/{uuid4}.{ext}`, `reg_path(user_id, ext) -> str` → `reg/{user_id}/{uuid4}.{ext}`
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 15.7_

  - [x] 3.3 Implement MIME validation utility in `app/core/storage.py`
    - Add `validate_upload(content: bytes, declared_content_type: str, max_size_mb: int) -> None` that uses `python-magic` (`magic.from_buffer(content, mime=True)`) for server-side inspection
    - Raises `FileMimeInvalidError` (HTTP 400, code `FILE_MIME_INVALID`) if actual MIME not in `{application/pdf, image/jpeg, image/png}` regardless of declared type
    - Raises `FileTooLargeError` (HTTP 400, code `FILE_TOO_LARGE`) if `len(content) > max_size_mb * 1024 * 1024`
    - _Requirements: 3.10, 3.11, 4.7, 4.8, 15.8_

  - [x] 3.4 Implement `KYCService` in `app/core/kyc.py`
    - Implement `initiate_dojah_verification(merchant_id, app_id, secret_key) -> str` that returns a Dojah session ID
    - Implement `handle_dojah_webhook(payload: dict) -> KYCResult` that parses Dojah callback and returns `KYCResult(status, reason)`
    - Implement `submit_manual_kyc(merchant_id, nin, doc_type, doc_path, db) -> None` that stores doc reference and sets `kyc_status = 'pending'`
    - Implement `can_transition_kyc(current: str, target: str) -> bool` that encodes the valid transitions: `{(not_started, pending), (pending, approved), (pending, rejected), (rejected, pending)}`
    - _Requirements: 4.1, 4.2, 12.1, 12.2, 12.8_

  - [x] 3.5 Implement slug generation utility in `app/core/slugs.py`
    - Implement `generate_slug(length: int = 12) -> str` using `secrets.token_urlsafe(length)[:length]` ensuring URL-safe chars only
    - Implement `async ensure_unique_slug(db: AsyncSession, length: int = 12, max_retries: int = 5) -> str` that queries `PaymentLink.slug` for collision and retries up to `max_retries` times; raises `SlugCollisionError` (HTTP 500, code `SLUG_COLLISION`) on exhaustion
    - _Requirements: 8.14_

  - [x] 3.6 Implement new Celery tasks in `app/core/tasks.py`
    - Add `send_kyc_decision_email(merchant_id: str, decision: str, rejection_reason: str | None)` — sends approval or rejection email using existing email infrastructure; includes rejection reason in rejection email
    - Add `send_invoice_email(invoice_id: str)` — fetches invoice and sends email to `customer_email` with invoice details and payment URL
    - Add `send_invoice_email_failure_rollback(invoice_id: str)` (bound task) — reverts invoice status to `draft` and deactivates associated payment link
    - Add `mark_overdue_invoices()` — queries `WHERE status IN ('sent','viewed') AND due_date < now()` and bulk-updates to `overdue`; register in Celery Beat schedule with a 5-minute interval
    - _Requirements: 10.8, 10.11, 12.6, 12.7_

### 4. Merchant API Module

- [ ] 4. Build `app/merchant/` module — schemas, service, and router
  - [x] 4.1 Create Pydantic schemas in `app/merchant/schemas.py`
    - Onboarding: `OnboardingStatusResponse`, `Step1Request`, `Step2Request` (with optional `registration_doc`), `Step3Request`, `Step4Request`
    - Wallet: `WalletCreate`, `WalletResponse`
    - Payment link: `PaymentLinkCreate`, `PaymentLinkResponse`, `PaymentLinkListResponse`
    - Invoice: `InvoiceCreate` (with nested `LineItemCreate`), `InvoiceResponse`, `InvoiceListResponse`
    - Dashboard: `DashboardOverviewResponse` (lifetime total, pending count, 10 recent transactions)
    - All monetary amounts as `Decimal`; all UUIDs as `uuid.UUID`; all datetimes as `datetime` with timezone
    - _Requirements: 6.3, 8.1–8.3, 9.2, 10.1–10.6, 16.1_

  - [x] 4.2 Implement onboarding service methods in `app/merchant/service.py`
    - `get_or_create_profile(user_id, db) -> MerchantProfile` — lazy creation: creates profile with defaults if none exists
    - `get_onboarding_status(user_id, db) -> OnboardingStatusResponse` — returns current step, `onboarding_complete`, `kyc_status`, `wallet_added`; step is computed as `onboarding_step` field
    - `submit_step_1(user_id, data: Step1Request, db) -> OnboardingStatusResponse` — validates full_name (2–100 non-whitespace), country (African), phone (regex `^[0-9 \-()\]{4,15}$` excluding dial code); persists; advances `onboarding_step` to max(current, 2)
    - `submit_step_2(user_id, data: Step2Request, file_content, db) -> OnboardingStatusResponse` — validates business_name trim length (2–200), website_url scheme, social handles (at least one non-empty), registration doc (if `is_registered_business`); uploads doc via `StorageBackend`; persists; advances step
    - `validate_step_access(current_step: int, target_step: int) -> bool` — returns False when `target_step > current_step + 1`; used by all PATCH handlers to enforce Requirement 16.6
    - _Requirements: 2.7–2.12, 3.1–3.13, 16.1–16.7_

  - [x] 4.3 Implement KYC step service methods in `app/merchant/service.py`
    - `submit_step_3_manual(user_id, data: Step3Request, file_content, db) -> OnboardingStatusResponse` — branches on country (Nigeria vs. non-Nigeria); validates NIN (11 digits) or (doc_type + file) as required; validates and uploads identity doc via `StorageBackend`; sets `kyc_status = 'pending'`; advances step
    - `submit_step_3_dojah(user_id, session_id: str, db) -> OnboardingStatusResponse` — records Dojah session ID; sets `kyc_status` per Dojah result; advances step
    - `resubmit_kyc(user_id, data, file_content, db)` — validates current status is `rejected`, clears `kyc_rejection_reason`, transitions to `pending`, stores new docs
    - _Requirements: 4.1–4.15_

  - [x] 4.4 Implement wallet step and wallet CRUD service methods in `app/merchant/service.py`
    - `submit_step_4(user_id, data: Step4Request, db) -> OnboardingStatusResponse` — validates EVM address regex (`^0x[0-9a-fA-F]{40}$`), upserts `MerchantWallet` (creates or updates existing record for same network), atomically sets `wallet_added = True` and `onboarding_complete = True`, redirects signal in response
    - `list_wallets(user_id, db) -> list[WalletResponse]`
    - `add_wallet(user_id, data: WalletCreate, db) -> WalletResponse` — validates EVM address; checks no active/pending wallet for same network (HTTP 409 `WALLET_DUPLICATE_NETWORK`); creates record
    - `delete_wallet(user_id, wallet_id, db) -> None` — verifies ownership (404 if not found); checks it is not the only active wallet linked to active/pending payment links (HTTP 409 `WALLET_LAST_ACTIVE`); soft-deletes (sets `status = 'inactive'`)
    - _Requirements: 5.1–5.10, 13.1–13.6_

  - [x] 4.5 Implement payment link service methods in `app/merchant/service.py`
    - `create_payment_link(user_id, data: PaymentLinkCreate, db) -> PaymentLinkResponse` — validates title (1–200), amount_mode, amount (if fixed), tokens (at least one), `expires_at` (future), `max_uses` (positive ≤ 1 000 000), `redirect_url` (scheme check); generates unique slug via `ensure_unique_slug`; stores with status `active`; returns full URL `{FRONTEND_ORIGIN}/pay/{slug}`
    - `list_payment_links(user_id, page, page_size, db) -> PaymentLinkListResponse` — paginated (default 20, max 100), ordered by `created_at DESC`
    - `deactivate_payment_link(user_id, link_id, db) -> PaymentLinkResponse` — sets status to `inactive`
    - `generate_qr_code(user_id, link_id, db) -> bytes` — generates PNG QR code of the payment URL using `qrcode` library; returns raw bytes
    - _Requirements: 8.1–8.18, 9.1–9.6_

  - [x] 4.6 Implement invoice service methods in `app/merchant/service.py`
    - `create_invoice(user_id, data: InvoiceCreate, db) -> InvoiceResponse` — validates customer_name (1–200), customer_email (well-formed), line items (1–50 items, description ≤ 500 chars, amount ≤ 999 999.99 with ≤ 2 dp), `due_date` (future), tokens (at least one), notes (≤ 2000 chars); persists with status `draft`
    - `send_invoice(user_id, invoice_id, db) -> InvoiceResponse` — validates status is `draft` (HTTP 400 `INVOICE_NOT_DRAFT`); atomically creates associated `PaymentLink` and sets invoice `status = 'sent'`; dispatches `send_invoice_email` Celery task after commit; on email failure the failure-handler task reverts status to `draft` and deactivates the payment link
    - `cancel_invoice(user_id, invoice_id, db) -> InvoiceResponse` — validates status in `{draft, sent, viewed, overdue}` else HTTP 409; sets `status = 'cancelled'`; deactivates associated payment link
    - `list_invoices(user_id, page, page_size, status_filter, db) -> InvoiceListResponse` — paginated (default 20, max 100), filterable by status
    - _Requirements: 10.1–10.15_

  - [x] 4.7 Implement dashboard overview service method in `app/merchant/service.py`
    - `get_dashboard_overview(user_id, db) -> DashboardOverviewResponse` — computes: (1) total lifetime received (sum of `Payment.amount` WHERE `status = 'confirmed'`); (2) pending count (payments in `pending`, `detected`, or `confirming`); (3) 10 most recent payments ordered by `created_at DESC`, each with type, amount, token, network, status, ISO 8601 timestamp
    - _Requirements: 6.1–6.9_

  - [x] 4.8 Implement `app/merchant/router.py` with all 16 endpoints
    - Mount all endpoints from the design's endpoint table: `GET /merchant/onboarding-status`, `PATCH /merchant/onboarding/{step}` (1–4), `GET|POST|DELETE /merchant/wallets`, `GET|POST /merchant/payment-links`, `PATCH /merchant/payment-links/{link_id}`, `GET /merchant/payment-links/{link_id}/qr`, `GET|POST /merchant/invoices`, `POST /merchant/invoices/{invoice_id}/send`, `POST /merchant/invoices/{invoice_id}/cancel`, `GET /merchant/dashboard/overview`
    - All authenticated endpoints require valid JWT; verify `account_type = 'merchant'`
    - `PATCH /merchant/onboarding/{step}` validates step in range 1–4 (HTTP 400 `ONBOARDING_INVALID_STEP`) and calls `validate_step_access` (HTTP 400 `ONBOARDING_STEP_SKIPPED`)
    - QR endpoint (`GET /merchant/payment-links/{link_id}/qr`) returns `Response(content=bytes, media_type="image/png")`
    - `GET /merchant/onboarding-status` returns HTTP 401 for unauthenticated requests
    - _Requirements: 16.1–16.7, 8.16, 9.6_

### 5. Checkout API Module

- [x] 5. Build `app/checkout/` module — public payment link endpoints
  - [x] 5.1 Create schemas and service in `app/checkout/`
    - `CheckoutLinkResponse` schema: merchant name, title, amount/amount_mode, accepted tokens list, `PaymentStatusResponse` schema: current status
    - `CheckoutService.get_checkout_data(slug, db) -> CheckoutLinkResponse` — looks up `PaymentLink` by slug; returns HTTP 404 (`PAYMENT_LINK_NOT_FOUND`) if not found; returns HTTP 410 (`PAYMENT_LINK_GONE`) for inactive, suspended, expired (`expires_at < now()`), or exhausted (`use_count >= max_uses`) links; fetches merchant name from `User`; returns checkout data including `MerchantWallet` address for the selected network
    - `CheckoutService.get_payment_status(slug, db) -> PaymentStatusResponse` — returns current `Payment.status` for the most recent payment on this link (or `pending` if none yet)
    - _Requirements: 11.1–11.11, 9.4, 9.5_

  - [x] 5.2 Implement `app/checkout/router.py` with two public endpoints
    - `GET /pay/{slug}` — no auth; calls `get_checkout_data`; returns 410 with `PAYMENT_LINK_GONE` for dead links; returns 404 for unknown slugs
    - `GET /pay/{slug}/status` — no auth; calls `get_payment_status`; polls-safe (no side effects)
    - _Requirements: 11.1, 11.9_

### 6. Networks API Module

- [x] 6. Build `app/networks/` module — EVM network listing endpoint
  - [x] 6.1 Implement `app/networks/router.py` with single `GET /networks` endpoint
    - No authentication required
    - Calls `network_registry.get_active_networks()` and serialises each `NetworkConfig` into a response with `display_name`, `chain_id`, `native_symbol`, and a list of `{symbol, contract_address}` per token (`contract_address` is `null` for native tokens)
    - _Requirements: 7.7_

### 7. Admin Merchant Management (Backend)

- [x] 7. Extend `app/admin/` with merchant management endpoints
  - [x] 7.1 Create merchant management schemas in `app/admin/schemas.py`
    - `MerchantListItem`: `user_id`, `email`, `full_name`, `onboarding_status`, `kyc_status`, `wallet_count`
    - `MerchantDetailResponse`: full `MerchantProfile` fields + wallet list + KYC doc references + `payment_link_count` + `invoice_count` + `total_confirmed_volume`
    - `KYCApproveRequest` (empty body), `KYCRejectRequest` (`rejection_reason`: 1–500 chars)
    - `SuspendRequest` (empty body), `UnsuspendRequest` (empty body)
    - `KYCDocumentsResponse`: signed download URLs or file data for identity and registration docs
    - _Requirements: 14.1–14.10_

  - [x] 7.2 Implement merchant management service methods in `app/admin/service.py`
    - `list_merchants(page, page_size, db) -> PaginatedResult[MerchantListItem]` — joins `User` and `MerchantProfile`; computes `onboarding_status` as one of `incomplete`, `pending_kyc_review`, `kyc_approved`, `kyc_rejected`; counts wallets per merchant; paginates (default 20, max 100)
    - `get_merchant_detail(user_id, db) -> MerchantDetailResponse` — fetches full profile + wallets + KYC doc references + counts
    - `get_kyc_documents(user_id, db) -> KYCDocumentsResponse` — generates presigned URLs (max 15 min) via `StorageBackend`; gated by admin auth
    - `approve_kyc(admin_id, merchant_id, db)` — verifies `kyc_status = 'pending'` (HTTP 409 `KYC_NOT_PENDING`); sets `kyc_status = 'approved'`, records `kyc_reviewed_by`, `kyc_reviewed_at`; inserts `AuditLog` with `event_type = 'kyc_approved'`; dispatches `send_kyc_decision_email` Celery task; all in one transaction
    - `reject_kyc(admin_id, merchant_id, rejection_reason, db)` — validates `rejection_reason` (1–500 chars); verifies `kyc_status = 'pending'`; sets `kyc_status = 'rejected'`, stores reason, reviewer, timestamp; inserts `AuditLog` with `event_type = 'kyc_rejected'`; dispatches email task
    - `suspend_merchant(admin_id, merchant_id, db)` — checks current `User.status ≠ 'suspended'` (HTTP 409 `MERCHANT_ALREADY_SUSPENDED`); sets `status = 'suspended'`; bulk-updates all active `PaymentLink` records for that merchant to `suspended_by_admin`; inserts `AuditLog` with `event_type = 'merchant_suspended'`; entire operation in one transaction
    - `unsuspend_merchant(admin_id, merchant_id, db)` — sets `User.status = 'active'`; reactivates only payment links with `status = 'suspended_by_admin'` (most recent suspension batch); inserts `AuditLog` with `event_type = 'merchant_unsuspended'`
    - _Requirements: 12.3, 12.4, 12.5, 12.6, 12.7, 14.1–14.10_

  - [x] 7.3 Add merchant management endpoints to `app/admin/router.py`
    - `GET /admin/merchants` — paginated merchant list; accessible only to `admin` or `superadmin`; returns HTTP 403 for non-admin users
    - `GET /admin/merchants/{user_id}` — full merchant detail
    - `GET /admin/merchants/{user_id}/kyc-documents` — signed doc download URLs
    - `POST /admin/merchants/{user_id}/kyc/approve` — approve KYC
    - `POST /admin/merchants/{user_id}/kyc/reject` — reject KYC with reason
    - `POST /admin/merchants/{user_id}/suspend` — suspend merchant
    - `POST /admin/merchants/{user_id}/unsuspend` — unsuspend merchant
    - _Requirements: 14.1–14.10_

### 8. Router Registration

- [x] 8. Register all new routers in `app/main.py`
  - [x] 8.1 Add `_include_router_if_available` calls for all three new modules
    - Register `app/merchant/router` at prefix `/merchant` with tag `merchant`
    - Register `app/checkout/router` at prefix `` (empty prefix; slug path is `/pay/{slug}`) with tag `checkout`
    - Register `app/networks/router` at prefix `/networks` with tag `networks`
    - _Requirements: 16.1, 7.7, 11.1_

### 9. Frontend Infrastructure

- [x] 9. Set up frontend state management and API service layer
  - [x] 9.1 Create `onboardingStore` in `frontend/src/stores/onboardingStore.ts`
    - Implement Zustand store with: `currentStep: number`, `completedSteps: number[]`, `formData: Record<number, object>`, `status: OnboardingStatus | null`
    - Actions: `setStep(step)`, `saveFormData(step, data)`, `fetchStatus()` (calls `GET /merchant/onboarding-status` and syncs store state)
    - On `fetchStatus`, resume from the lowest-numbered step whose required fields are not fully submitted
    - _Requirements: 1.6, 1.7, 16.1, 16.2_

  - [x] 9.2 Create `merchantStore` in `frontend/src/stores/merchantStore.ts`
    - Implement Zustand store with: `overview`, `paymentLinks`, `invoices`, `wallets`, `networks`
    - Actions: `fetchOverview()`, `fetchPaymentLinks(page)`, `fetchInvoices(page, status)`, `fetchWallets()`, `createPaymentLink(data)`, `deactivatePaymentLink(id)`, `createInvoice(data)`, `sendInvoice(id)`, `cancelInvoice(id)`, `addWallet(data)`, `deleteWallet(id)`
    - _Requirements: 6.1–6.9, 8.1–8.18, 10.1–10.15, 13.1–13.6_

  - [x] 9.3 Create API service layer in `frontend/src/services/`
    - `merchant.ts` — typed wrappers for all `/merchant/*` API calls using the existing Axios instance with JWT bearer injection
    - `checkout.ts` — typed wrappers for `GET /pay/{slug}` and `GET /pay/{slug}/status`
    - `networks.ts` — typed wrapper for `GET /networks`, cached in memory for the session
    - All functions return typed response objects; errors are re-thrown as typed `ApiError`
    - _Requirements: 6.1, 7.7, 8.15, 11.1_

  - [x] 9.4 Update `ProtectedRoute` component to handle merchant and onboarding redirect
    - Add `requiredRole="merchant"` support in `frontend/src/components/routing/ProtectedRoute.tsx`
    - When `requiredRole="merchant"` and `onboarding_complete = false`, redirect to `/onboarding`
    - When `requiredRole="admin"`, allow both `admin` and `superadmin` account types
    - _Requirements: 1.1, 1.2_

### 10. Onboarding Wizard (Frontend)

- [x] 10. Build the onboarding wizard pages and shared components
  - [x] 10.1 Create `WizardProgress` and `FileUpload` shared components
    - `frontend/src/components/onboarding/WizardProgress.tsx` — renders "Step N of 4" indicator; accepts `currentStep` and `totalSteps` props; _Requirements: 1.5_
    - `frontend/src/components/onboarding/FileUpload.tsx` — drag-and-drop file input; validates MIME type (PDF/JPEG/PNG) and size (≤ `MAX_UPLOAD_SIZE_MB`) client-side before upload; displays error inline; _Requirements: 3.10, 3.11, 4.7, 4.8_

  - [x] 10.2 Create `CountrySelect` component
    - `frontend/src/components/onboarding/CountrySelect.tsx`
    - On mount, fetches African countries from `https://restcountries.com/v3.1/region/africa` with a 10-second timeout
    - Displays inline error and retry button on fetch failure; does not refresh the page on retry
    - Supports text-based search filtering on each keystroke
    - On country selection, emits selected country and primary dial code to parent via `onChange`
    - _Requirements: 2.3, 2.4, 2.5, 2.6_

  - [x] 10.3 Implement `Step1Personal` page component
    - `frontend/src/pages/onboarding/Step1Personal.tsx`
    - Pre-populates `full_name` from auth user store; renders email as read-only
    - Renders `CountrySelect`; auto-populates dial code prefix on selection
    - Client-side validation before submit: full_name (2–100), country (required), phone (4–15 digits/separators only)
    - On success, saves to `onboardingStore` and advances to step 2; displays field-level errors on failure
    - _Requirements: 2.1–2.12_

  - [x] 10.4 Implement `Step2Business` page component
    - `frontend/src/pages/onboarding/Step2Business.tsx`
    - Fields: `business_name`, `website_url`, five social handle inputs, `is_registered_business` toggle, conditional `FileUpload` for registration doc
    - Clears file selection when toggle flipped back to false
    - Client-side validation: business_name trim (2–200), website_url scheme, at least one social handle non-empty, reg doc required when toggle is true
    - Submits as `multipart/form-data`; displays inline errors; advances to step 3 on success
    - _Requirements: 3.1–3.13_

  - [x] 10.5 Implement `Step3KYC` page component
    - `frontend/src/pages/onboarding/Step3KYC.tsx`
    - When `USE_DOJAH` setting is `true` (read from a public config endpoint or environment): renders Dojah widget; on success dispatches PATCH /merchant/onboarding/3 with session ID; on widget failure or 30-second timeout shows error with retry
    - When `USE_DOJAH` is `false`: for Nigerian merchants renders NIN text input + `FileUpload`; for others renders document type selector (Passport, National ID, Driver's License) + `FileUpload`
    - Validates all required fields before submit; displays field-level errors; advances to step 4 on success
    - _Requirements: 4.1–4.15_

  - [x] 10.6 Implement `Step4Wallet` page component
    - `frontend/src/pages/onboarding/Step4Wallet.tsx`
    - Renders explanatory message (no wallet app, no private key/seed phrase, paste public address only)
    - Network selector populated from `GET /networks`; no default selection
    - Wallet address input (max 42 chars); client-side EVM address pattern check (`^0x[0-9a-fA-F]{40}$`)
    - On success dispatches PATCH /merchant/onboarding/4; shows field-level errors; on success redirects to `/dashboard`
    - _Requirements: 5.1–5.10_

  - [x] 10.7 Implement `OnboardingWizard` shell page
    - `frontend/src/pages/onboarding/OnboardingWizard.tsx`
    - On mount, calls `onboardingStore.fetchStatus()` and routes to lowest incomplete step
    - Renders `WizardProgress` at top; renders active step component
    - Intercepts any navigation away from `/onboarding` when `onboarding_complete = false`; redirects back within 1 second
    - Pre-populates each step's fields with previously saved data from `onboardingStore.formData`
    - _Requirements: 1.1–1.7_

  - [x] 10.8 Add onboarding route to `frontend/src/App.tsx`
    - Add `/onboarding` route wrapped in `<ProtectedRoute requiredRole="merchant">`
    - _Requirements: 1.1_

### 11. Merchant Dashboard (Frontend)

- [x] 11. Build all merchant dashboard pages
  - [x] 11.1 Create `DashboardLayout` and navigation
    - `frontend/src/components/layout/DashboardLayout.tsx` — side-navigation with links to Overview, Payment Links, Invoices, Transactions, Wallets, Settings; active link visually distinguished; renders `<Outlet />`
    - _Requirements: 6.9_

  - [x] 11.2 Implement `Overview` dashboard page
    - `frontend/src/pages/dashboard/Overview.tsx`
    - On mount, calls `merchantStore.fetchOverview()`
    - Displays: total lifetime received (2 dp + token symbol), pending payment count, 10 most recent transactions table (type, amount, token, network, status, ISO 8601 timestamp)
    - "Create Payment Link" and "Create Invoice" quick-action buttons navigate to respective creation forms
    - Renders without placeholder rows when fewer than 10 transactions exist
    - _Requirements: 6.1–6.9_

  - [x] 11.3 Implement `PaymentLinks` list page and `CreatePaymentLink` form page
    - `frontend/src/pages/dashboard/PaymentLinks.tsx` — paginated list (20 per page); shows title, slug, amount_mode, amount, tokens, status, expires_at, use_count/max_uses; activate/deactivate toggle per link; copy-to-clipboard for payment URL; QR code download button
    - `frontend/src/pages/dashboard/CreatePaymentLink.tsx` — form: title, amount_mode toggle, conditional amount field, `TokenMultiSelect` (from `/networks`), optional expires_at, optional max_uses, optional redirect_url; client-side validation mirrors Requirement 8; on success navigates to payment links list
    - `frontend/src/components/dashboard/TokenMultiSelect.tsx` — multi-select UI populated from `networks.ts` service
    - _Requirements: 8.1–8.18, 9.1–9.6_

  - [x] 11.4 Implement `Invoices` list page and `CreateInvoice` form page
    - `frontend/src/pages/dashboard/Invoices.tsx` — paginated list filterable by status; shows customer name, email, due date, total amount, status badge; send/cancel action buttons per row; empty state message
    - `frontend/src/pages/dashboard/CreateInvoice.tsx` — form: customer_name, customer_email, due_date, dynamic line items (add/remove rows, description + amount per row, max 50), `TokenMultiSelect`, optional notes; running total display; client-side validation mirrors Requirement 10; on success navigates to invoices list
    - _Requirements: 10.1–10.15_

  - [x] 11.5 Implement `Wallets` management page
    - `frontend/src/pages/dashboard/Wallets.tsx`
    - Lists all merchant wallets (network, address, status)
    - "Add Wallet" form: network selector (from `/networks`), address input with client-side EVM validation
    - Delete button per wallet with confirmation; shows error toast when deletion is rejected (HTTP 409)
    - _Requirements: 13.1–13.6_

  - [x] 11.6 Implement `Transactions` read-only page
    - `frontend/src/pages/dashboard/Transactions.tsx`
    - Paginated, read-only list of all payment transactions: type (link/invoice), amount, token, network, status badge, timestamp
    - _Requirements: 6.5_

  - [x] 11.7 Add all dashboard routes to `frontend/src/App.tsx`
    - Add nested `/dashboard/*` route tree with `DashboardLayout` as parent and `ProtectedRoute requiredRole="merchant"` guard; includes Overview (index), payment-links, payment-links/new, invoices, invoices/new, wallets, transactions routes
    - _Requirements: 6.1, 6.2_

### 12. Public Checkout Page (Frontend)

- [x] 12. Build the public checkout experience
  - [x] 12.1 Create `NetworkTokenSelector` and `PaymentInstructions` components
    - `frontend/src/components/checkout/NetworkTokenSelector.tsx` — renders accepted tokens from checkout data; on selection emits `{network, token}` pair to parent
    - `frontend/src/components/checkout/PaymentInstructions.tsx` — displays: merchant wallet address for selected network (or error if no wallet), QR code (uses `qrcode` or `qrcode.react` library encoding address + amount), instruction text in format "Send exactly {amount} {TOKEN} on {NETWORK} to the address below", error message when no wallet exists for the combination
    - _Requirements: 11.5, 11.6, 11.7, 11.8_

  - [x] 12.2 Create `PaymentStatusPoller` and `PaymentReceipt` components
    - `frontend/src/components/checkout/PaymentStatusPoller.tsx` — polls `GET /pay/{slug}/status` at an interval no greater than 10 seconds using `setInterval`; displays status bar: PENDING → DETECTED → CONFIRMING → CONFIRMED → PAID; stops polling when status is `paid`
    - `frontend/src/components/checkout/PaymentReceipt.tsx` — shown when status transitions to `paid`; displays: merchant name, amount, token symbol, network name, transaction hash, confirmation timestamp
    - _Requirements: 11.9, 11.10_

  - [x] 12.3 Implement `CheckoutPage` top-level component
    - `frontend/src/pages/checkout/CheckoutPage.tsx`
    - On mount, calls `checkout.ts` `getCheckoutData(slug)`; handles 404 (link not found message), 410 (link gone/expired message), and success
    - Renders: merchant name, payment title, fixed amount or flexible amount input, `NetworkTokenSelector`
    - Flexible amount input validates 0.01–999,999,999.99 before showing wallet address
    - Composes `PaymentInstructions` and `PaymentStatusPoller`
    - Does not request, display, or store any wallet credentials, private keys, or seed phrases
    - _Requirements: 11.1–11.11_

  - [x] 12.4 Add `/pay/:slug` route to `frontend/src/App.tsx`
    - Public route, no `ProtectedRoute` wrapper
    - _Requirements: 11.1_

### 13. Admin Frontend Extensions

- [x] 13. Build admin merchant management UI
  - [x] 13.1 Implement `KYCReviewPanel` and `SuspendMerchantModal` components
    - `frontend/src/components/admin/KYCReviewPanel.tsx` — shows KYC status badge; approve button; reject form with `rejection_reason` textarea (1–500 chars) and submit; calls respective admin API endpoints; displays success/error toasts
    - `frontend/src/components/admin/SuspendMerchantModal.tsx` — confirm modal for suspend and unsuspend actions with descriptive warning text; calls respective admin API endpoints
    - _Requirements: 12.3–12.8, 14.4–14.8_

  - [x] 13.2 Implement `MerchantList` admin page
    - `frontend/src/pages/admin/MerchantList.tsx`
    - Paginated table (20 per page): merchant name, email, onboarding status badge, KYC status badge, wallet count, created date
    - Clicking a row navigates to `MerchantDetail`
    - _Requirements: 14.1_

  - [x] 13.3 Implement `MerchantDetail` admin page
    - `frontend/src/pages/admin/MerchantDetail.tsx`
    - Displays: full onboarding profile, wallet list, KYC document download links (signed URLs), payment link count, invoice count, total confirmed volume
    - Embeds `KYCReviewPanel` for approve/reject actions
    - Embeds `SuspendMerchantModal` trigger for suspend/unsuspend
    - _Requirements: 14.2, 14.3, 14.6, 14.8_

  - [x] 13.4 Add admin merchant routes to `frontend/src/App.tsx`
    - `/admin/merchants` and `/admin/merchants/:userId` wrapped in `<ProtectedRoute requiredRole="admin">`
    - _Requirements: 14.9_

### 14. Property-Based Tests

- [ ] 14. Implement all ten property-based tests from design.md
  - [ ]* 14.1 Write property test for Property 1: EVM address validation is total over all strings
    - **Property 1: EVM address validation is a total function over all strings**
    - Use `@given(st.text())` to test `validate_evm_address` against `re.fullmatch(r'0x[0-9a-fA-F]{40}', address, re.IGNORECASE)`
    - Assert result always equals expected; assert no exceptions are raised
    - **Validates: Requirements 5.4, 13.3**

  - [ ]* 14.2 Write property test for Property 2: Slug generation length and charset
    - **Property 2: Slug generation always produces URL-safe strings of exactly the requested length**
    - Use `@given(st.integers(min_value=1, max_value=64))` to test `generate_slug(n)` — assert `len(slug) == n` and `re.fullmatch(r'[A-Za-z0-9_-]+', slug)` for all n
    - **Validates: Requirements 8.14**

  - [ ]* 14.3 Write property test for Property 3: KYC state machine accepts valid transitions and rejects all others
    - **Property 3: KYC state machine accepts valid transitions and rejects all others**
    - Use `@given(st.sampled_from(ALL_KYC_STATUSES), st.sampled_from(ALL_KYC_STATUSES))` to test `can_transition_kyc(current, target)` against `VALID_KYC_TRANSITIONS` set
    - **Validates: Requirements 12.1, 12.2**

  - [ ]* 14.4 Write property test for Property 4: Expired payment links return HTTP 410
    - **Property 4: Expired payment links always return HTTP 410**
    - Use `@given(st.datetimes())` to test that any `PaymentLink` with `expires_at < now()` and `status = 'active'` produces a 410 from `CheckoutService.get_checkout_data`
    - **Validates: Requirements 9.4**

  - [ ]* 14.5 Write property test for Property 5: Exhausted payment links return HTTP 410
    - **Property 5: Exhausted payment links always return HTTP 410**
    - Use `@given(st.integers(min_value=0))` to test that a link with `use_count >= max_uses` (non-null) and `status = 'active'` always returns 410
    - **Validates: Requirements 9.5**

  - [ ]* 14.6 Write property test for Property 6: MIME validation rejects content-type spoofing
    - **Property 6: File upload MIME validation always rejects content-type spoofing**
    - Use `@given(st.binary(min_size=4, max_size=2048))` to test `validate_upload_mime(file_bytes, declared_type="application/pdf")` raises HTTP 400 when `magic.from_buffer(file_bytes)` is not an accepted MIME type
    - **Validates: Requirements 15.8, 3.10, 4.7**

  - [ ]* 14.7 Write property test for Property 7: Invoice cancellation rejected for non-cancellable statuses
    - **Property 7: Invoice cancellation is rejected for every non-cancellable status**
    - Use `@given(st.sampled_from(ALL_INVOICE_STATUSES))` to test `can_cancel_invoice(status)` returns `False` for every status not in `{draft, sent, viewed, overdue}` and `True` for all that are
    - **Validates: Requirements 10.13**

  - [ ]* 14.8 Write property test for Property 8: Phone number validation matches explicit regex
    - **Property 8: Phone number validation is equivalent to an explicit regex over all strings**
    - Use `@given(st.text(max_size=30))` to test `validate_phone_number(phone)` against `re.fullmatch(r'[0-9 \-()\]{4,15}', phone)` and confirm determinism by calling twice
    - **Validates: Requirements 2.9**

  - [ ]* 14.9 Write property test for Property 9: Onboarding step-skip guard rejects non-sequential steps
    - **Property 9: Onboarding step-skip guard rejects any request targeting a non-sequential step**
    - Use `@given(st.integers(min_value=1, max_value=3), st.integers(min_value=1, max_value=4))` to test `validate_step_access(current_step, target_step)` — assert `False` when `target_step > current_step + 1`, `True` otherwise
    - **Validates: Requirements 16.6**

  - [ ]* 14.10 Write property test for Property 10: Business name trimmed-length validation is total
    - **Property 10: Business name trimmed-length validation is total over all strings**
    - Use `@given(st.text(max_size=300))` to test `validate_business_name(name)` against `2 <= len(name.strip()) <= 200`; assert no exceptions are raised for any input
    - **Validates: Requirements 3.1**

### 15. Environment & Documentation

- [ ] 15. Update `.env.example` and main .env with all new environment variables
  - [ ] 15.1 Add all new variables from `app/core/config.py` additions to `.env.example`
    - Add commented sections for: KYC settings (`USE_DOJAH`, `DOJAH_APP_ID`, `DOJAH_SECRET_KEY`), Countries API (`REST_COUNTRIES_API`), EVM RPC URLs (×6), ERC-20 contracts (×18 with mainnet defaults pre-filled), File storage (`UPLOAD_STORAGE`, `UPLOAD_LOCAL_PATH`, `MAX_UPLOAD_SIZE_MB`, AWS settings)
    - Each variable should have a brief inline comment explaining its purpose and valid values
    - _Requirements: 7.2, 7.5, 15.1, 15.2_

- [ ] 16. Final checkpoint — ensure all tests pass
  - Run all backend tests: `pytest tests/ -v`
  - Run frontend lint: `npm run lint` in `frontend/`
  - Ensure all property-based tests pass with `max_examples=100`
  - Ask the user if any questions arise before proceeding.

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP; all unmarked sub-tasks are required
- Each task references specific requirements for traceability
- The partial unique index in migration 2.6 must be written manually — SQLAlchemy's `UniqueConstraint` does not support WHERE clauses
- The `payments` table (task 2.5) has no service code in this spec; it is a schema-only placeholder for the future blockchain indexer
- `USE_DOJAH=False` is the safe default for development; manual KYC flow must work end-to-end before Dojah integration is tested
- File upload tasks depend on `python-magic` (libmagic system dependency) and `boto3` (for S3 backend)
- The `qrcode` library is required for QR code generation (task 4.5 backend) and optionally `qrcode.react` for the frontend (task 12.1)
- Celery Beat task `mark_overdue_invoices` requires the Beat scheduler to be running separately from the worker

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "2.2", "2.3", "2.4", "2.5"] },
    { "id": 2, "tasks": ["2.6", "3.1", "3.2", "3.3"] },
    { "id": 3, "tasks": ["3.4", "3.5", "3.6", "4.1"] },
    { "id": 4, "tasks": ["4.2", "4.3", "4.4", "4.5", "4.6", "4.7", "5.1", "6.1"] },
    { "id": 5, "tasks": ["4.8", "5.2", "7.1"] },
    { "id": 6, "tasks": ["7.2", "8.1"] },
    { "id": 7, "tasks": ["7.3", "9.1", "9.2", "9.3"] },
    { "id": 8, "tasks": ["9.4", "10.1", "10.2"] },
    { "id": 9, "tasks": ["10.3", "10.4", "10.5", "10.6", "11.1"] },
    { "id": 10, "tasks": ["10.7", "11.2", "11.3", "11.4", "11.5", "11.6", "12.1", "12.2", "13.1"] },
    { "id": 11, "tasks": ["10.8", "11.7", "12.3", "13.2", "13.3"] },
    { "id": 12, "tasks": ["12.4", "13.4", "14.1", "14.2", "14.3", "14.4", "14.5", "14.6", "14.7", "14.8", "14.9", "14.10"] },
    { "id": 13, "tasks": ["15.1"] }
  ]
}
```
