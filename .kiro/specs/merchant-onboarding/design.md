# Design Document — Merchant Onboarding & Payment Tools

## Overview

The Merchant Onboarding feature extends the Lenis platform to allow non-technical African merchants to complete a guided four-step setup wizard, verify their identity (KYC), add an EVM wallet address, create payment links and invoices, and share a public checkout page — all without writing code.

The feature sits on top of the existing FastAPI + SQLAlchemy 2.0 async stack. It introduces five new database tables (`merchant_profiles`, `merchant_wallets`, `payment_links`, `invoices`, `invoice_line_items`) and a placeholder `payments` table for a future blockchain indexer. New API modules are added under the `app/merchant/`, `app/checkout/`, and `app/networks/` namespaces. Existing `app/admin/` endpoints are extended with merchant-management routes.

The frontend adds an onboarding wizard, a full merchant dashboard, a public checkout page, and admin merchant management screens — all built with the existing React 19 + Tailwind CSS 3 + Zustand 5 + React Router DOM 7 stack.

Blockchain transaction monitoring is explicitly **out of scope**. The `payments` table schema is designed here; the indexer service that writes to it is a separate concern.

---

## Architecture

```mermaid
graph TD
    subgraph Frontend [React 19 SPA]
        OW[Onboarding Wizard\n/onboarding]
        MD[Merchant Dashboard\n/dashboard/*]
        CP[Checkout Page\n/pay/:slug]
        AM[Admin Merchant Mgmt\n/admin/merchants/*]
    end

    subgraph API [FastAPI Backend]
        MA[app/merchant/\nGET|PATCH /merchant/*]
        CA[app/checkout/\nGET /pay/:slug]
        NA[app/networks/\nGET /networks]
        AA[app/admin/ (extended)\nPOST /admin/merchants/*]
    end

    subgraph Workers [Celery Workers]
        KYC_EMAIL[send_kyc_decision_email]
        INV_EMAIL[send_invoice_email]
        OVERDUE[mark_overdue_invoices\n(beat, every 5 min)]
    end

    subgraph Storage
        DB[(PostgreSQL)]
        FS[File Storage\nlocal or S3]
        RD[(Redis)]
    end

    subgraph External
        CAPI[REST Countries API]
        DOJAH[Dojah KYC API\n(when USE_DOJAH=True)]
    end

    Frontend --> API
    API --> DB
    API --> FS
    API --> RD
    API --> Workers
    MA --> CAPI
    MA --> DOJAH
    Workers --> DB
```

### Key design decisions

**Lazy profile creation**: `MerchantProfile` is created on first `GET /merchant/onboarding-status` rather than at registration. This avoids polluting the DB with profiles for merchants who never start onboarding.

**KYC behind a feature flag**: `USE_DOJAH` in settings switches between the Dojah widget flow and a manual document-upload flow at runtime without code changes.

**File storage abstraction**: An abstract `StorageBackend` class allows `local` (dev/testing) and `s3` (production) backends to be swapped via a single env var (`UPLOAD_STORAGE`). MIME-type validation always uses server-side `python-magic`, never the declared `Content-Type` header.

**Network/token config as startup registry**: Supported EVM networks and token contract addresses are loaded from env vars into an in-memory `NetworkRegistry` singleton at startup. Missing values produce log warnings but do not crash the application.

**Slug generation with retry**: Payment link slugs are 12-character URL-safe strings generated via `secrets.token_urlsafe`. On DB collision the generator retries up to 5 times before failing.

**Invoice email atomicity**: Sending an invoice transitions `status` to `sent`. If the Celery email task fails, a failure-handler Celery task reverts the invoice to `draft` and deactivates the associated payment link.

**Suspension idempotency**: The admin suspend endpoint checks current status before acting. Suspending an already-suspended merchant returns an error with no side effects (no audit log, no link changes).

**Unsuspend scope**: Only payment links that were set to `suspended_by_admin` during the *most recent* suspension are reactivated on unsuspend. Links in any other non-active state are left unchanged.

---

## Components and Interfaces

### Backend modules

#### `app/merchant/`

```
app/merchant/
├── router.py     — FastAPI APIRouter, all /merchant/* endpoints
├── service.py    — MerchantService (onboarding, wallets, payment links, invoices, dashboard)
└── schemas.py    — Pydantic request/response models
```

**Endpoints summary**

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/merchant/onboarding-status` | merchant | Returns current step, flags, KYC status |
| PATCH | `/merchant/onboarding/1` | merchant | Submit Step 1 (personal info) |
| PATCH | `/merchant/onboarding/2` | merchant | Submit Step 2 (business info), multipart |
| PATCH | `/merchant/onboarding/3` | merchant | Submit Step 3 (KYC), multipart |
| PATCH | `/merchant/onboarding/4` | merchant | Submit Step 4 (wallet) |
| GET | `/merchant/wallets` | merchant | List wallets |
| POST | `/merchant/wallets` | merchant | Add wallet |
| DELETE | `/merchant/wallets/{wallet_id}` | merchant | Remove wallet |
| GET | `/merchant/payment-links` | merchant | Paginated list (default 20, max 100) |
| POST | `/merchant/payment-links` | merchant | Create payment link |
| PATCH | `/merchant/payment-links/{link_id}` | merchant | Deactivate link |
| GET | `/merchant/payment-links/{link_id}/qr` | merchant | PNG QR code |
| GET | `/merchant/invoices` | merchant | Paginated, filterable by status |
| POST | `/merchant/invoices` | merchant | Create invoice (draft) |
| POST | `/merchant/invoices/{invoice_id}/send` | merchant | Send invoice email |
| POST | `/merchant/invoices/{invoice_id}/cancel` | merchant | Cancel invoice |
| GET | `/merchant/dashboard/overview` | merchant | Dashboard metrics |

#### `app/checkout/`

```
app/checkout/
├── router.py
├── service.py
└── schemas.py
```

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/pay/{slug}` | none | Returns payment link data for checkout page |
| GET | `/pay/{slug}/status` | none | Returns current Payment_Status for polling |

Returns HTTP 410 for expired, exhausted, inactive, or suspended links.

#### `app/networks/`

```
app/networks/
└── router.py    — single GET /networks endpoint, reads from NetworkRegistry
```

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/networks` | none | List active EVM networks and supported tokens |

#### `app/admin/` extensions

New endpoints appended to the existing `app/admin/router.py`:

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/admin/merchants` | admin | Paginated merchant list with onboarding/KYC status |
| GET | `/admin/merchants/{user_id}` | admin | Full merchant profile detail |
| GET | `/admin/merchants/{user_id}/kyc-documents` | admin | Signed doc download URLs |
| POST | `/admin/merchants/{user_id}/kyc/approve` | admin | Approve KYC (pending → approved) |
| POST | `/admin/merchants/{user_id}/kyc/reject` | admin | Reject KYC (pending → rejected) |
| POST | `/admin/merchants/{user_id}/suspend` | admin | Suspend merchant + pause links |
| POST | `/admin/merchants/{user_id}/unsuspend` | admin | Unsuspend merchant + restore links |

#### `app/core/networks.py` — `NetworkRegistry`

```python
@dataclass
class TokenConfig:
    symbol: str
    contract_address: str | None  # None for native tokens

@dataclass
class NetworkConfig:
    chain_id: int
    display_name: str
    native_symbol: str
    rpc_url: str
    confirmation_count: int
    block_time_seconds: int
    tokens: list[TokenConfig]

class NetworkRegistry:
    def get_active_networks(self) -> list[NetworkConfig]: ...
    def get_network_by_id(self, chain_id: int) -> NetworkConfig | None: ...
    def get_supported_tokens(self, chain_id: int) -> list[TokenConfig]: ...
```

Loaded once at startup via `network_registry = NetworkRegistry(settings)`. Skips networks missing RPC URLs and tokens missing contract addresses, logging a warning for each.

#### `app/core/storage.py` — `StorageBackend`

```python
class StorageBackend(ABC):
    @abstractmethod
    async def upload_file(self, content: bytes, path: str, content_type: str) -> str: ...
    @abstractmethod
    async def get_presigned_url(self, key: str, expires_in: int) -> str: ...
    @abstractmethod
    async def delete_file(self, key: str) -> None: ...

class LocalStorageBackend(StorageBackend): ...
class S3StorageBackend(StorageBackend): ...
```

Path patterns:
- KYC identity docs: `kyc/{user_id}/{uuid4}.{ext}`
- Business registration docs: `reg/{user_id}/{uuid4}.{ext}`

MIME validation uses `python-magic` (server-side inspection). Declared `Content-Type` is ignored for validation purposes. Accepted types: `application/pdf`, `image/jpeg`, `image/png`.

#### `app/core/kyc.py` — `KYCService`

```python
class KYCService:
    @staticmethod
    async def initiate_dojah_verification(merchant_id: UUID, app_id: str, secret_key: str) -> str:
        """Returns Dojah session_id."""

    @staticmethod
    async def handle_dojah_webhook(payload: dict) -> KYCResult:
        """Parses Dojah callback, returns KYCResult(status, reason)."""

    @staticmethod
    async def submit_manual_kyc(
        merchant_id: UUID,
        nin: str | None,
        doc_type: str | None,
        doc_path: str,
        db: AsyncSession,
    ) -> None:
        """Stores doc reference, sets kyc_status = 'pending'."""
```

#### `app/core/slugs.py`

```python
def generate_slug(length: int = 12) -> str:
    """Returns a URL-safe string of exactly `length` characters."""
    return secrets.token_urlsafe(length)[:length]

async def ensure_unique_slug(db: AsyncSession, length: int = 12, max_retries: int = 5) -> str:
    """Generates a slug, checks PaymentLink table for collision, retries up to max_retries."""
```

#### `app/core/tasks.py` — Celery tasks

```python
@celery_app.task
def send_kyc_decision_email(merchant_id: str, decision: str, rejection_reason: str | None): ...

@celery_app.task
def send_invoice_email(invoice_id: str): ...

@celery_app.task(bind=True)
def send_invoice_email_failure_rollback(self, invoice_id: str): ...

@celery_app.task
def mark_overdue_invoices(): ...
# Registered in Celery Beat schedule: runs every 5 minutes.
# Queries invoices WHERE status IN ('sent','viewed') AND due_date < now()
# and bulk-updates them to 'overdue'.
```

### Frontend components

#### Onboarding Wizard

```
frontend/src/pages/onboarding/
├── OnboardingWizard.tsx       — shell, reads onboardingStore, renders active step
├── Step1Personal.tsx          — full_name, country (CountrySelect), phone
├── Step2Business.tsx          — business_name, website, socials, registration doc
├── Step3KYC.tsx               — Dojah widget OR manual upload (NIN/doc type/file)
└── Step4Wallet.tsx            — network selector, EVM address input

frontend/src/components/onboarding/
├── CountrySelect.tsx          — searchable dropdown, fetches /v3.1/region/africa
├── FileUpload.tsx             — drag-and-drop, client-side MIME + size pre-check
└── WizardProgress.tsx         — "Step N of 4" indicator
```

#### Merchant Dashboard

```
frontend/src/pages/dashboard/
├── Overview.tsx               — stats cards + recent transactions table
├── PaymentLinks.tsx           — paginated list, activate/deactivate actions
├── CreatePaymentLink.tsx      — form with TokenMultiSelect, optional expiry/max_uses
├── Invoices.tsx               — paginated list, filterable by status
├── CreateInvoice.tsx          — customer info, line items, token select, due date
├── Wallets.tsx                — wallet list, add/delete
└── Transactions.tsx           — read-only payment transaction list

frontend/src/components/dashboard/
└── TokenMultiSelect.tsx       — multi-select using /networks data
```

#### Checkout (public)

```
frontend/src/pages/checkout/
└── CheckoutPage.tsx           — top-level, reads :slug

frontend/src/components/checkout/
├── NetworkTokenSelector.tsx   — choose network + token
├── PaymentInstructions.tsx    — shows wallet address + QR code
├── PaymentStatusPoller.tsx    — polls /pay/:slug/status every 10s, drives status bar
└── PaymentReceipt.tsx         — displayed on status = 'paid'
```

#### Admin extensions

```
frontend/src/pages/admin/
├── MerchantList.tsx           — paginated merchant table with KYC/onboarding status
└── MerchantDetail.tsx         — full profile, KYC doc links, suspend/unsuspend actions

frontend/src/components/admin/
├── KYCReviewPanel.tsx         — approve/reject form with rejection_reason field
└── SuspendMerchantModal.tsx   — confirm modal for suspend/unsuspend
```

#### Zustand stores

```typescript
// frontend/src/stores/onboardingStore.ts
interface OnboardingStore {
  currentStep: number
  completedSteps: number[]
  formData: Record<number, object>
  status: OnboardingStatus | null
  setStep: (step: number) => void
  saveFormData: (step: number, data: object) => void
  fetchStatus: () => Promise<void>
}

// frontend/src/stores/merchantStore.ts
interface MerchantStore {
  overview: DashboardOverview | null
  paymentLinks: PaginatedResult<PaymentLink> | null
  invoices: PaginatedResult<Invoice> | null
  wallets: MerchantWallet[] | null
  fetchOverview: () => Promise<void>
  // ... fetch/mutate actions
}
```

#### API service layer

```typescript
// frontend/src/services/merchant.ts  — /merchant/* calls
// frontend/src/services/checkout.ts  — /pay/* calls
// frontend/src/services/networks.ts  — GET /networks
```

All services use the existing Axios instance from `lib/api.ts` (assumed) with JWT bearer token injection.

---

## Data Models

### `MerchantProfile` (`merchant_profiles`)

```python
class MerchantProfile(Base):
    __tablename__ = "merchant_profiles"
    __table_args__ = (
        UniqueConstraint("user_id"),
        CheckConstraint(
            "kyc_status IN ('not_started','pending','approved','rejected')",
            name="ck_merchant_profiles_kyc_status",
        ),
    )

    id: UUID (PK)
    user_id: UUID (FK → users.id, UNIQUE, NOT NULL)
    full_name: str(100)
    country: str(100)
    phone_number: str(30)
    business_name: str(200, nullable)
    website_url: str(2048, nullable)
    social_instagram: str(100, nullable)
    social_twitter: str(100, nullable)
    social_facebook: str(100, nullable)
    social_linkedin: str(100, nullable)
    social_tiktok: str(100, nullable)
    is_registered_business: bool (default False)
    registration_doc_path: str(500, nullable)
    kyc_status: str(20) = 'not_started'
    kyc_document_path: str(500, nullable)
    kyc_document_type: str(50, nullable)  # 'passport'|'national_id'|'drivers_license'|'nin_slip'
    nin: str(11, nullable)                # Nigeria only
    kyc_dojah_session_id: str(200, nullable)
    kyc_reviewed_by: UUID (FK → users.id, nullable)
    kyc_reviewed_at: datetime(tz, nullable)
    kyc_rejection_reason: str(500, nullable)
    onboarding_complete: bool = False
    onboarding_step: int = 1             # highest completed step + 1
    wallet_added: bool = False
    created_at: datetime(tz)
    updated_at: datetime(tz)
```

`kyc_reviewed_by` references `users.id` for the admin who reviewed. The relationship is not enforced as a cascade so audit history is preserved if the admin account is deleted.

---

### `MerchantWallet` (`merchant_wallets`)

```python
class MerchantWallet(Base):
    __tablename__ = "merchant_wallets"
    __table_args__ = (
        CheckConstraint(
            "status IN ('active','pending','inactive')",
            name="ck_merchant_wallets_status",
        ),
        # Partial unique index (active/pending per network per merchant)
        # implemented via a DB-level partial index in the Alembic migration:
        # CREATE UNIQUE INDEX uq_wallet_active ON merchant_wallets
        #   (merchant_id, network) WHERE status IN ('active','pending');
    )

    id: UUID (PK)
    merchant_id: UUID (FK → users.id, NOT NULL)
    network: str(64, NOT NULL)            # 'ethereum'|'base'|'polygon'|'arbitrum'|'optimism'|'bsc'
    address: str(42, NOT NULL)            # 0x + 40 hex chars
    status: str(20) = 'active'
    created_at: datetime(tz)
    updated_at: datetime(tz)
```

The partial unique index (`status IN ('active','pending')`) prevents duplicate active wallets per network while still allowing historical records and inactive entries. This requires a manual Alembic operation since SQLAlchemy's `UniqueConstraint` does not support WHERE clauses.

---

### `PaymentLink` (`payment_links`)

```python
class PaymentLink(Base):
    __tablename__ = "payment_links"
    __table_args__ = (
        CheckConstraint(
            "amount_mode IN ('fixed','flexible')",
            name="ck_payment_links_amount_mode",
        ),
        CheckConstraint(
            "status IN ('active','inactive','suspended_by_admin')",
            name="ck_payment_links_status",
        ),
        Index("idx_payment_links_slug", "slug"),
        Index("idx_payment_links_merchant", "merchant_id"),
    )

    id: UUID (PK)
    merchant_id: UUID (FK → users.id, NOT NULL)
    title: str(200, NOT NULL)
    slug: str(200, UNIQUE, NOT NULL)           # min 12 URL-safe chars
    amount_mode: str(10, NOT NULL)             # 'fixed'|'flexible'
    amount: Numeric(precision=28, scale=18, nullable)
    currency: str(10, nullable)                # reserved; currently unused
    accepted_tokens: JSON (NOT NULL)           # list of {network, token_symbol, contract_address}
    status: str(30) = 'active'
    expires_at: datetime(tz, nullable)
    max_uses: int(nullable)
    use_count: int = 0
    redirect_url: str(2048, nullable)
    total_collected: Numeric(precision=28, scale=18) = 0
    created_at: datetime(tz)
    updated_at: datetime(tz)
```

`accepted_tokens` is stored as a JSON column rather than a normalised join table to avoid needing a separate table for what is effectively a snapshot of the network/token config at link-creation time. The contract addresses captured at creation remain correct even if the global config changes later.

---

### `Invoice` (`invoices`)

```python
class Invoice(Base):
    __tablename__ = "invoices"
    __table_args__ = (
        CheckConstraint(
            "status IN ('draft','sent','viewed','paid','overdue','cancelled')",
            name="ck_invoices_status",
        ),
        Index("idx_invoices_merchant", "merchant_id"),
        Index("idx_invoices_status", "status"),
    )

    id: UUID (PK)
    merchant_id: UUID (FK → users.id, NOT NULL)
    payment_link_id: UUID (FK → payment_links.id, nullable)
    customer_name: str(200, NOT NULL)
    customer_email: str(254, NOT NULL)
    due_date: date (NOT NULL)
    status: str(20) = 'draft'
    notes: Text(nullable)                      # max 2000 chars enforced at app layer
    accepted_tokens: JSON (NOT NULL)
    created_at: datetime(tz)
    updated_at: datetime(tz)

    # Relationships
    line_items: list[InvoiceLineItem]
```

---

### `InvoiceLineItem` (`invoice_line_items`)

```python
class InvoiceLineItem(Base):
    __tablename__ = "invoice_line_items"

    id: UUID (PK)
    invoice_id: UUID (FK → invoices.id, CASCADE DELETE, NOT NULL)
    description: str(500, NOT NULL)
    amount: Numeric(precision=12, scale=2, NOT NULL)   # max 999,999.99
    sort_order: int (NOT NULL, default 0)
```

---

### `Payment` (`payments`) — schema only, no service logic

```python
class Payment(Base):
    """Placeholder table. Populated by a future blockchain indexer service.
    No application service code reads or writes this table in this spec."""
    __tablename__ = "payments"
    __table_args__ = (
        CheckConstraint(
            "status IN ('pending','detected','confirming','confirmed','paid')",
            name="ck_payments_status",
        ),
        Index("idx_payments_link", "payment_link_id"),
    )

    id: UUID (PK)
    payment_link_id: UUID (FK → payment_links.id, NOT NULL)
    invoice_id: UUID (FK → invoices.id, nullable)
    network: str(64, NOT NULL)
    token_symbol: str(20, NOT NULL)
    contract_address: str(42, nullable)
    from_address: str(42, nullable)
    to_address: str(42, NOT NULL)
    amount: Numeric(precision=28, scale=18, NOT NULL)
    tx_hash: str(66, nullable, UNIQUE)
    block_number: int(nullable)
    confirmations: int = 0
    status: str(20) = 'pending'
    confirmed_at: datetime(tz, nullable)
    created_at: datetime(tz)
    updated_at: datetime(tz)
```

---

### KYC State Machine (enforced in `MerchantService`)

```
not_started ──────────────────► pending
                                    │
                          ┌─────────┴─────────┐
                          ▼                   ▼
                       approved           rejected
                                              │
                                              └──► pending  (resubmission)
```

Valid transitions:
- `not_started` → `pending` (manual doc submission or Dojah success/failure)
- `pending` → `approved` (admin action)
- `pending` → `rejected` (admin action)
- `rejected` → `pending` (merchant resubmits)

Any other transition raises HTTP 409 with code `INVALID_KYC_TRANSITION`.

---

### Invoice Status Machine (enforced in `MerchantService` + Celery beat)

```
draft ──► sent ──► viewed ──► paid
              │          │
              └──► overdue◄─┘  (beat task, due_date passed)
              │
              └──► cancelled   (merchant cancels from sent/viewed/overdue)
              (draft can also be cancelled)
```

Valid cancellation source states: `draft`, `sent`, `viewed`, `overdue`.
Attempting to cancel `paid` or `cancelled` returns HTTP 409.

---

### Config additions (`app/core/config.py`)

The following fields are added to the existing `Settings` class:

```python
# KYC
use_dojah: bool = False
dojah_app_id: str = ""
dojah_secret_key: str = ""

# Countries API
rest_countries_api: str = "https://restcountries.com/v3.1"

# EVM RPC endpoints
ethereum_rpc_url: str = ""
base_rpc_url: str = ""
polygon_rpc_url: str = ""
arbitrum_rpc_url: str = ""
optimism_rpc_url: str = ""
bsc_rpc_url: str = ""

# ERC-20 contract addresses (defaults are mainnet addresses)
ethereum_usdc_contract: str = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48"
ethereum_usdt_contract: str = "0xdAC17F958D2ee523a2206206994597C13D831ec7"
ethereum_dai_contract: str = "0x6B175474E89094C44Da98b954EedeAC495271d0F"
base_usdc_contract: str = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
base_usdt_contract: str = ""
polygon_usdc_contract: str = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"
polygon_usdt_contract: str = "0xc2132D05D31c914a87C6611C10748AEb04B58e8F"
polygon_dai_contract: str = "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063"
arbitrum_usdc_contract: str = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831"
arbitrum_usdt_contract: str = "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9"
arbitrum_dai_contract: str = "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1"
optimism_usdc_contract: str = "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85"
optimism_usdt_contract: str = "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58"
optimism_dai_contract: str = "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1"
bsc_usdc_contract: str = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d"
bsc_usdt_contract: str = "0x55d398326f99059fF775485246999027B3197955"

# File storage
upload_storage: str = "local"        # 'local' | 's3'
upload_local_path: str = "./uploads"
max_upload_size_mb: int = 10
aws_s3_bucket: str = ""
aws_access_key_id: str = ""
aws_secret_access_key: str = ""
aws_region: str = "us-east-1"
```

---

### Routing additions (`frontend/src/App.tsx`)

New routes appended to the existing `<Routes>` tree:

```tsx
{/* Merchant onboarding — redirects to /onboarding if not complete */}
<Route path="/onboarding" element={
  <ProtectedRoute requiredRole="merchant">
    <OnboardingWizard />
  </ProtectedRoute>
} />

{/* Merchant dashboard */}
<Route path="/dashboard" element={
  <ProtectedRoute requiredRole="merchant">
    <DashboardLayout />
  </ProtectedRoute>
}>
  <Route index element={<Overview />} />
  <Route path="payment-links" element={<PaymentLinks />} />
  <Route path="payment-links/new" element={<CreatePaymentLink />} />
  <Route path="invoices" element={<Invoices />} />
  <Route path="invoices/new" element={<CreateInvoice />} />
  <Route path="wallets" element={<Wallets />} />
  <Route path="transactions" element={<Transactions />} />
</Route>

{/* Public checkout — no auth */}
<Route path="/pay/:slug" element={<CheckoutPage />} />

{/* Admin merchant management */}
<Route path="/admin/merchants" element={
  <ProtectedRoute requiredRole="admin">
    <MerchantList />
  </ProtectedRoute>
} />
<Route path="/admin/merchants/:userId" element={
  <ProtectedRoute requiredRole="admin">
    <MerchantDetail />
  </ProtectedRoute>
} />
```

The existing `ProtectedRoute` component accepts `requiredRole="admin"` which is satisfied by both `admin` and `superadmin` accounts. A `requiredRole="merchant"` variant needs to be added to `ProtectedRoute` to handle merchant-specific routes. The component will also read the merchant's `onboarding_complete` flag from the auth/user store and redirect to `/onboarding` when it is false, for any `/dashboard/*` navigation.

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: EVM address validation is a total function over all strings

*For any* string input, the EVM address validator returns `True` if and only if the string matches `^0x[0-9a-fA-F]{40}$` (case-insensitive). The validator never throws, never returns `True` for a non-matching string, and never returns `False` for a matching string.

**Validates: Requirements 5.4, 13.3**

---

### Property 2: Slug generation always produces URL-safe strings of exactly the requested length

*For any* requested length `n ≥ 1`, `generate_slug(n)` returns a string of exactly `n` characters where every character belongs to the URL-safe alphabet `[A-Za-z0-9_-]`.

**Validates: Requirements 8.14**

---

### Property 3: KYC state machine accepts valid transitions and rejects all others

*For any* `(current_status, target_status)` pair drawn from the full KYC status domain `{not_started, pending, approved, rejected}`, the system accepts the transition if and only if the pair is in the valid set `{(not_started, pending), (pending, approved), (pending, rejected), (rejected, pending)}`. Every invalid pair returns HTTP 409 and leaves `kyc_status` unchanged; every valid pair succeeds with no error.

**Validates: Requirements 12.1, 12.2**

---

### Property 4: Expired payment links always return HTTP 410

*For any* `PaymentLink` record with `status = 'active'` and `expires_at` set to a timestamp strictly before the current server time, the checkout endpoint `GET /pay/{slug}` SHALL return HTTP 410, regardless of `use_count`, `max_uses`, or any other field value.

**Validates: Requirements 9.4**

---

### Property 5: Exhausted payment links always return HTTP 410

*For any* `PaymentLink` with `status = 'active'`, a non-null `max_uses` value, and `use_count >= max_uses`, the checkout endpoint `GET /pay/{slug}` SHALL return HTTP 410, regardless of `expires_at` or any other field value.

**Validates: Requirements 9.5**

---

### Property 6: File upload MIME validation always rejects content-type spoofing

*For any* uploaded file whose actual binary content (as determined by server-side `python-magic` inspection) corresponds to a MIME type not in `{application/pdf, image/jpeg, image/png}`, the upload SHALL be rejected with HTTP 400, regardless of the `Content-Type` header declared by the client.

**Validates: Requirements 15.8, 3.10, 4.7**

---

### Property 7: Invoice cancellation is rejected for every non-cancellable status

*For any* invoice whose `status` is not in `{draft, sent, viewed, overdue}`, a cancel request SHALL return HTTP 409 and leave the invoice's `status` field unchanged. There is no status value outside that set for which cancellation succeeds.

**Validates: Requirements 10.13**

---

### Property 8: Phone number validation is equivalent to an explicit regex over all strings

*For any* string `s` (representing the phone number digits excluding the dial code prefix), the phone validator accepts it if and only if `s` matches `^[0-9 \-()\]{4,15}$`. The validator is deterministic — it produces the same result for the same input on every invocation.

**Validates: Requirements 2.9**

---

### Property 9: Onboarding step-skip guard rejects any request targeting a non-sequential step

*For any* merchant with `current_step = k` (where `k ∈ {1, 2, 3, 4}`), a `PATCH /merchant/onboarding/{step}` request with `step > k + 1` SHALL return an error and SHALL NOT persist any data. The guard holds for every valid combination of `(k, step)` where `step > k + 1`.

**Validates: Requirements 16.6**

---

### Property 10: Business name trimmed-length validation is total over all strings

*For any* string `s` submitted as `business_name`, the validator accepts it if and only if `len(s.strip()) >= 2` and `len(s.strip()) <= 200`. No string is both accepted and rejected, and no string raises an unhandled error.

**Validates: Requirements 3.1**

---

## Error Handling

### API error format

All error responses follow the existing platform convention:

```json
{
  "detail": "Human-readable message.",
  "code": "MACHINE_READABLE_CODE"
}
```

### Error codes introduced by this feature

| Code | HTTP | When |
|------|------|------|
| `PROFILE_NOT_FOUND` | 404 | Merchant profile does not exist (should not occur in normal flow) |
| `ONBOARDING_STEP_SKIPPED` | 400 | Request targets step > current_step + 1 |
| `ONBOARDING_INVALID_STEP` | 400 | Step value outside 1–4 |
| `INVALID_KYC_TRANSITION` | 409 | KYC state machine violation |
| `KYC_NOT_PENDING` | 409 | Admin tries to approve/reject when status ≠ pending |
| `WALLET_DUPLICATE_NETWORK` | 409 | Active wallet already exists for this network |
| `WALLET_NOT_FOUND` | 404 | wallet_id does not belong to merchant |
| `WALLET_LAST_ACTIVE` | 409 | Cannot delete the only active wallet linked to active payment links |
| `INVALID_EVM_ADDRESS` | 422 | Wallet address fails `^0x[0-9a-fA-F]{40}$` |
| `SLUG_COLLISION` | 500 | Slug uniqueness failed after 5 retries |
| `PAYMENT_LINK_GONE` | 410 | Link is expired, exhausted, inactive, or suspended |
| `PAYMENT_LINK_NOT_FOUND` | 404 | Slug does not match any record |
| `INVALID_AMOUNT_MODE` | 400 | amount_mode ≠ 'fixed' or 'flexible' |
| `AMOUNT_REQUIRED` | 400 | amount_mode='fixed' but amount is absent/zero |
| `NO_TOKENS_SELECTED` | 400 | Payment link or invoice created with no accepted tokens |
| `EXPIRES_AT_PAST` | 400 | expires_at is not a future timestamp |
| `MAX_USES_INVALID` | 400 | max_uses ≤ 0 or > 1,000,000 |
| `REDIRECT_URL_INVALID` | 400 | redirect_url fails URL validation |
| `INVOICE_NOT_CANCELLABLE` | 409 | Invoice status is paid or cancelled |
| `INVOICE_NOT_DRAFT` | 400 | Merchant tries to send a non-draft invoice |
| `INVOICE_EMAIL_FAILED` | 500 | Email delivery failed; invoice reverted to draft |
| `FILE_TOO_LARGE` | 400 | Uploaded file exceeds MAX_UPLOAD_SIZE_MB |
| `FILE_MIME_INVALID` | 400 | Server-side MIME type is not accepted |
| `STORAGE_UNAVAILABLE` | 503 | Storage backend unreachable |
| `MERCHANT_ALREADY_SUSPENDED` | 409 | Suspend called on already-suspended merchant |
| `REJECTION_REASON_REQUIRED` | 400 | KYC rejection submitted without reason |
| `COUNTRIES_API_TIMEOUT` | 503 | REST Countries API did not respond in time |
| `DOJAH_TIMEOUT` | 503 | Dojah widget timed out (> 30 seconds) |
| `NO_WALLET_FOR_NETWORK` | 404 | Checkout: no merchant wallet for selected network |

### Transactional integrity

- **Step submissions** (`PATCH /merchant/onboarding/{step}`): the `onboarding_step` counter and the profile field updates are committed in a single transaction. File storage writes happen before the DB commit; if the DB commit fails, orphaned files are cleaned up asynchronously by a maintenance task (or accepted as non-critical storage waste in the local backend).
- **Invoice send**: the status update to `sent` and the payment link creation are committed together. The Celery email task is dispatched after commit. The failure-handler task reverts the DB state if email delivery fails.
- **Merchant suspension**: the `user.status` update and the bulk `payment_links.status` update happen in one transaction.
- **KYC approval/rejection**: the profile update and the AuditLog insert happen in one transaction. The Celery notification email is dispatched after commit.

---

## Testing Strategy

### Unit tests (example-based)

- `test_kyc_state_machine.py` — all valid and invalid KYC transitions; verifies HTTP 409 on invalid paths
- `test_invoice_state_machine.py` — all valid and invalid invoice status transitions
- `test_evm_validator.py` — representative valid addresses, invalid prefix, wrong length, non-hex chars
- `test_slug.py` — length correctness, character set, collision-retry behaviour
- `test_file_validation.py` — valid PDF/JPEG/PNG; mismatched declared vs. actual type; oversized file
- `test_merchant_service.py` — onboarding step submission, profile lazy-creation, suspension/unsuspend logic
- `test_checkout_service.py` — expired link, exhausted link, inactive link all return 410; missing slug returns 404
- `test_network_registry.py` — missing RPC URL logs warning and excludes network; missing contract logs warning and excludes token

### Property-based tests (using Hypothesis)

Hypothesis is the standard property-based testing library for Python. Each test is configured with `@settings(max_examples=100)`.

**Tag format**: `# Feature: merchant-onboarding, Property {N}: {property_text}`

```python
# Feature: merchant-onboarding, Property 1: EVM address validation is a total function over all strings
@given(st.text())
@settings(max_examples=100)
def test_evm_address_validation_is_total(address: str):
    result = validate_evm_address(address)
    expected = bool(re.fullmatch(r'0x[0-9a-fA-F]{40}', address, re.IGNORECASE))
    assert result == expected

# Feature: merchant-onboarding, Property 2: Slug generation always produces URL-safe strings of exactly the requested length
@given(st.integers(min_value=1, max_value=64))
@settings(max_examples=100)
def test_slug_length_and_charset(n: int):
    slug = generate_slug(n)
    assert len(slug) == n
    assert re.fullmatch(r'[A-Za-z0-9_-]+', slug)

# Feature: merchant-onboarding, Property 3: KYC state machine accepts valid transitions and rejects all others
ALL_KYC_STATUSES = ['not_started', 'pending', 'approved', 'rejected']
VALID_KYC_TRANSITIONS = {
    ('not_started', 'pending'),
    ('pending', 'approved'),
    ('pending', 'rejected'),
    ('rejected', 'pending'),
}
@given(st.sampled_from(ALL_KYC_STATUSES), st.sampled_from(ALL_KYC_STATUSES))
@settings(max_examples=100)
def test_kyc_transition_validity(current: str, target: str):
    if (current, target) in VALID_KYC_TRANSITIONS:
        assert can_transition_kyc(current, target) is True
    else:
        assert can_transition_kyc(current, target) is False

# Feature: merchant-onboarding, Property 6: File upload MIME validation always rejects content-type spoofing
ACCEPTED_MIME_TYPES = {'application/pdf', 'image/jpeg', 'image/png'}
@given(st.binary(min_size=4, max_size=2048))
@settings(max_examples=100)
def test_mime_validation_uses_content_not_header(file_bytes: bytes):
    actual_mime = magic.from_buffer(file_bytes, mime=True)
    if actual_mime not in ACCEPTED_MIME_TYPES:
        with pytest.raises(HTTPException) as exc:
            validate_upload_mime(file_bytes, declared_type="application/pdf")
        assert exc.value.status_code == 400

# Feature: merchant-onboarding, Property 7: Invoice cancellation is rejected for every non-cancellable status
VALID_CANCEL_STATES = {'draft', 'sent', 'viewed', 'overdue'}
ALL_INVOICE_STATUSES = ['draft', 'sent', 'viewed', 'paid', 'overdue', 'cancelled']
@given(st.sampled_from(ALL_INVOICE_STATUSES))
@settings(max_examples=100)
def test_invoice_cancel_only_from_valid_states(status: str):
    if status not in VALID_CANCEL_STATES:
        assert can_cancel_invoice(status) is False
    else:
        assert can_cancel_invoice(status) is True

# Feature: merchant-onboarding, Property 8: Phone number validation is equivalent to an explicit regex over all strings
@given(st.text(max_size=30))
@settings(max_examples=100)
def test_phone_validation_matches_regex(phone: str):
    result = validate_phone_number(phone)
    expected = bool(re.fullmatch(r'[0-9 \-()\]{4,15}', phone))
    assert result == expected
    # Determinism check
    assert validate_phone_number(phone) == result

# Feature: merchant-onboarding, Property 9: Onboarding step-skip guard rejects any request targeting a non-sequential step
@given(
    st.integers(min_value=1, max_value=3),  # current_step k
    st.integers(min_value=1, max_value=4),  # target step
)
@settings(max_examples=100)
def test_step_skip_guard(current_step: int, target_step: int):
    if target_step > current_step + 1:
        assert validate_step_access(current_step, target_step) is False
    else:
        assert validate_step_access(current_step, target_step) is True

# Feature: merchant-onboarding, Property 10: Business name trimmed-length validation is total over all strings
@given(st.text(max_size=300))
@settings(max_examples=100)
def test_business_name_validation_matches_trim_length(name: str):
    result = validate_business_name(name)
    stripped_len = len(name.strip())
    expected = 2 <= stripped_len <= 200
    assert result == expected
```

### Integration tests (example-based)

- Full onboarding wizard flow (Steps 1–4) against a test database
- Payment link creation → checkout page retrieval → 410 on expiry
- Invoice creation → send → overdue transition via beat task
- Admin KYC approve/reject with email dispatch verification (mock Celery)
- File upload with local backend — upload, retrieve presigned URL, delete
- Merchant suspension → payment links suspended → unsuspend → links restored

### Frontend tests

The existing frontend has no test framework configured. For this feature, **Vitest** is recommended as the natural choice for a Vite project. Unit tests focus on:
- Validation logic in `Step1Personal`, `Step2Business`, `Step3KYC`, `Step4Wallet` (pure function extractions)
- `onboardingStore` state transitions
- `CountrySelect` filter logic
- `PaymentStatusPoller` polling interval and status transitions
- EVM address client-side pre-validation helper

PBT is not appropriate for the React component layer (UI rendering and interaction). Example-based unit tests and manual/visual testing are the right tools for the frontend.
