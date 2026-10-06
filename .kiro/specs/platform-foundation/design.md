# Design Document â€” Platform Foundation

## Overview

Lenis is a non-custodial Web3 Financial Infrastructure SaaS. The platform foundation is the
precondition for every downstream product: it establishes identity, authentication, session
management, developer verification, superadmin governance, and the public landing page.

The system is a **production-grade modular monolith** built with FastAPI (Python), SQLite in
development and PostgreSQL in production, Redis for session state and rate limiting, and Celery
for background tasks. The frontend is React with Tailwind CSS. Service boundaries are enforced
at the module level inside the single deployable; each service owns its database tables, its
router, and its internal logic. No service calls another service's internal functions directly â€”
communication goes through well-defined Python interfaces or internal API calls.

The design must project financial credibility. Every UI surface is clean, type-rich, and
intentionally minimal. Engineering choices favour correctness and auditability over clever
abstractions.

---

## Architecture

### High-Level Structure

```
lenis/
  app/
    auth/           # Auth_Service: registration, login, tokens, password reset
    users/          # User_Service: profiles, roles, API key management
    verification/   # Verification_Service: developer KYC workflow
    admin/          # Admin_Service: superadmin dashboard, audit log
    core/           # shared: DB session, config, security utilities, email
    cli/            # superadmin bootstrap CLI
    main.py         # FastAPI application entry point
  frontend/
    src/
      pages/        # Landing, SignUp, Login, Dashboard, AdminDashboard
      components/   # Shared UI components
      hooks/        # Custom React hooks
      lib/          # API client, token storage
  migrations/       # Alembic migration scripts
  tests/
    unit/
    integration/
    property/
```

### Request Flow

```
Client
  |
  v
FastAPI Application (HTTPS enforced, security headers middleware)
  |
  +-- Rate Limiter Middleware (Redis-backed sliding window)
  |
  +-- Auth Middleware (RS256 JWT verification)
  |
  +-- Routers
        |
        +-- /auth          -> auth service
        +-- /users         -> user service
        +-- /verification  -> verification service
        +-- /admin         -> admin service
        +-- /              -> landing (SSR / static)
```

### Infrastructure Components

| Component  | Development      | Production          |
|------------|------------------|---------------------|
| Database   | SQLite           | PostgreSQL          |
| Cache      | Redis            | Redis               |
| Queue      | Celery + Redis   | Celery + Redis      |
| Email      | Mailtrap / SMTP  | SendGrid / SMTP     |
| Secrets    | .env file        | Environment / Vault |

### Service Boundaries

Each service module exposes only its **router** and a narrow **service interface** (a Python
class). Other modules import from `core` only. Cross-service access (e.g. auth writing an
audit log entry) is done by calling `admin.service.AuditLogService.create_entry(...)` â€” a
thin, strongly typed call â€” never by touching another module's ORM models directly.

---

## Components and Interfaces

### Auth Service

Responsibilities: registration, email verification, login, token issuance, token refresh,
logout, password reset.

Public interface:

```python
class AuthService:
    async def register(payload: RegistrationPayload) -> UserCreatedResponse
    async def verify_email(token: str) -> OkResponse
    async def resend_verification(email: str) -> OkResponse
    async def login(payload: LoginPayload, client_ip: str) -> TokenPairResponse
    async def refresh_tokens(refresh_token: str) -> TokenPairResponse
    async def logout(access_token: str) -> OkResponse
    async def request_password_reset(email: str) -> OkResponse
    async def reset_password(token: str, new_password: str) -> OkResponse
```

### User Service

Responsibilities: user profile reads, role management, API key operations.

```python
class UserService:
    async def get_profile(user_id: UUID) -> UserProfile
    async def list_api_keys(user_id: UUID) -> APIKeyListResponse
    async def regenerate_test_secret_key(user_id: UUID) -> SecretKeyResponse
    async def generate_live_keys(user_id: UUID) -> APIKeyPairResponse
```

### Verification Service

Responsibilities: submission of developer verification requests, admin review actions.

```python
class VerificationService:
    async def submit_request(user_id: UUID, payload: VerificationPayload) -> VerificationResponse
    async def approve_request(request_id: UUID, admin_id: UUID) -> OkResponse
    async def reject_request(request_id: UUID, admin_id: UUID, reason: str) -> OkResponse
    async def get_request(request_id: UUID) -> VerificationDetail
    async def list_requests(filters: VerificationFilters, page: int, page_size: int) -> PaginatedResult
```

### Admin Service

Responsibilities: user listing, user suspension/reactivation, role promotion, audit log.

```python
class AdminService:
    async def list_users(filters: UserFilters, page: int, page_size: int) -> PaginatedResult
    async def suspend_user(actor_id: UUID, target_id: UUID) -> OkResponse
    async def reactivate_user(actor_id: UUID, target_id: UUID) -> OkResponse
    async def promote_to_admin(actor_id: UUID, target_id: UUID) -> OkResponse
    async def get_dashboard_summary() -> DashboardSummary
    async def list_audit_log(filters: AuditFilters, page: int, page_size: int) -> PaginatedResult

class AuditLogService:
    async def create_entry(entry: AuditEntryPayload) -> None
```

### Core Utilities

- `core.security`: bcrypt hashing, CSPRNG token generation, RS256 key loading
- `core.tokens`: JWT encode/decode, blocklist operations via Redis
- `core.rate_limit`: sliding-window rate limit middleware (Redis)
- `core.email`: async email dispatch via Celery task
- `core.db`: SQLAlchemy session factory, base model
- `core.config`: Pydantic Settings, environment variable loading
- `core.middleware`: HTTPS redirect, security headers injection

---

## Data Models

All models use UUIDs as primary keys. Timestamps are UTC. Soft deletes are not used â€” records
are status-flagged instead.

### User

```sql
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email           VARCHAR(254) NOT NULL UNIQUE,
    password_hash   VARCHAR(72)  NOT NULL,  -- bcrypt output is at most 60 chars
    full_name       VARCHAR(100) NOT NULL,
    account_type    VARCHAR(20)  NOT NULL CHECK (account_type IN ('merchant', 'developer', 'admin', 'superadmin')),
    status          VARCHAR(20)  NOT NULL DEFAULT 'unverified'
                       CHECK (status IN ('unverified', 'active', 'suspended')),
    email_verified  BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
```

### EmailToken

Covers both email verification tokens and password-reset tokens, distinguished by `token_type`.

```sql
CREATE TABLE email_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  VARCHAR(64) NOT NULL UNIQUE,  -- SHA-256 hex of the plaintext token
    token_type  VARCHAR(20) NOT NULL CHECK (token_type IN ('email_verification', 'password_reset')),
    expires_at  TIMESTAMPTZ NOT NULL,
    used        BOOLEAN     NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_email_tokens_user_type ON email_tokens(user_id, token_type);
```

### RefreshToken

```sql
CREATE TABLE refresh_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  VARCHAR(64) NOT NULL UNIQUE,
    revoked     BOOLEAN     NOT NULL DEFAULT FALSE,
    expires_at  TIMESTAMPTZ NOT NULL,
    issued_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    client_ip   VARCHAR(45)
);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);
```

### Organization

Every merchant or developer is associated with an organization. Auto-created on registration.

```sql
CREATE TABLE organizations (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id    UUID        NOT NULL REFERENCES users(id),
    name        VARCHAR(200) NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
```

### APIKey

```sql
CREATE TABLE api_keys (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    key_type        VARCHAR(20) NOT NULL CHECK (key_type IN ('pk_test', 'sk_test', 'pk_live', 'sk_live')),
    prefix          VARCHAR(12) NOT NULL,            -- e.g. 'pk_test_'
    suffix_display  VARCHAR(4)  NOT NULL,            -- last 4 chars of plaintext, for masking
    key_hash        VARCHAR(64) NOT NULL UNIQUE,     -- SHA-256 hex of plaintext
    active          BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    revoked_at      TIMESTAMPTZ
);
CREATE INDEX idx_api_keys_org ON api_keys(organization_id);
```

The publishable keys are stored plaintext (they are public by design). The secret key is
stored as a one-way SHA-256 hash. The `suffix_display` column holds the last 4 characters of
the original plaintext secret key, supporting masked display.

### VerificationRequest

```sql
CREATE TABLE verification_requests (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    developer_id        UUID        NOT NULL REFERENCES users(id),
    full_legal_name     VARCHAR(200) NOT NULL,
    country             VARCHAR(100) NOT NULL,
    business_type       VARCHAR(100) NOT NULL,
    website_url         VARCHAR(2048) NOT NULL,
    intended_use        TEXT         NOT NULL,  -- 50..500 chars enforced at app layer
    status              VARCHAR(20)  NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending', 'approved', 'rejected')),
    rejection_reason    TEXT,
    reviewed_by         UUID         REFERENCES users(id),
    rejected_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_vr_developer ON verification_requests(developer_id);
CREATE INDEX idx_vr_status    ON verification_requests(status);
```

### AuditLog

Append-only. No UPDATE or DELETE is ever issued against this table from application code.
The database user used by the application is granted INSERT and SELECT only on this table.

```sql
CREATE TABLE audit_logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type      VARCHAR(100) NOT NULL,
    actor_id        UUID         NOT NULL,
    target_type     VARCHAR(50)  NOT NULL,
    target_id       UUID         NOT NULL,
    outcome         VARCHAR(20)  NOT NULL CHECK (outcome IN ('success', 'failure')),
    client_ip       VARCHAR(45),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_actor      ON audit_logs(actor_id);
CREATE INDEX idx_audit_event_type ON audit_logs(event_type);
CREATE INDEX idx_audit_created_at ON audit_logs(created_at DESC);
```

### LoginAttempt (Rate Limit State)

Login rate limiting state is stored in Redis, not the database. Key schema:

```
login_fail:{ip}        -> integer counter, TTL = 10 minutes
login_block:{ip}       -> sentinel value, TTL = 15 minutes
rate_limit:{ip}:{endpoint} -> sliding window counter, TTL = 60 seconds
```

### Access Token Blocklist (Redis)

On logout, the access token JTI is written to Redis with TTL equal to the token's remaining
lifetime.

```
blocklist:jti:{jti}    -> "1", TTL = remaining seconds until token expiry
```

---

## API Design

All endpoints return `application/json`. Error responses follow the structure:
```json
{ "detail": "Human-readable message", "code": "MACHINE_READABLE_CODE" }
```

Pagination responses follow:
```json
{ "items": [...], "total": 0, "page": 1, "page_size": 20, "pages": 1 }
```

### Authentication Endpoints â€” `/auth`

| Method | Path                         | Auth     | Description                          |
|--------|------------------------------|----------|--------------------------------------|
| POST   | /auth/register               | None     | Register merchant or developer       |
| POST   | /auth/verify-email           | None     | Confirm email with token             |
| POST   | /auth/resend-verification    | None     | Resend verification email            |
| POST   | /auth/login                  | None     | Login; returns token pair            |
| POST   | /auth/refresh                | None     | Rotate refresh token                 |
| POST   | /auth/logout                 | Bearer   | Logout; revokes session              |
| POST   | /auth/password-reset/request | None     | Request password reset email         |
| POST   | /auth/password-reset/confirm | None     | Submit new password with reset token |

**POST /auth/register** â€” Request body:
```json
{
  "email": "user@example.com",
  "password": "SecurePass1",
  "full_name": "Ada Lovelace",
  "account_type": "developer"
}
```
Response 201:
```json
{ "user_id": "...", "email": "user@example.com" }
```

**POST /auth/login** â€” Request body:
```json
{ "email": "user@example.com", "password": "SecurePass1" }
```
Response 200:
```json
{
  "access_token": "...",
  "refresh_token": "...",
  "token_type": "bearer",
  "expires_in": 900
}
```

**POST /auth/refresh** â€” Request body:
```json
{ "refresh_token": "..." }
```
Response 200: same shape as login response.

**POST /auth/logout** â€” Header: `Authorization: Bearer <access_token>` â€” Body:
```json
{ "refresh_token": "..." }
```

### User / API Key Endpoints â€” `/users`

| Method | Path                             | Auth          | Description                          |
|--------|----------------------------------|---------------|--------------------------------------|
| GET    | /users/me                        | Bearer        | Get current user profile             |
| GET    | /users/me/api-keys               | Bearer (dev)  | List API keys (sk masked)            |
| POST   | /users/me/api-keys/regenerate-sk | Bearer (dev)  | Regenerate test secret key           |
| POST   | /users/me/api-keys/live          | Bearer (dev)  | Generate live-mode key pair          |

**GET /users/me/api-keys** â€” Response 200:
```json
{
  "publishable_key": "pk_test_abc123...",
  "secret_key_masked": "sk_test_****...wxyz",
  "has_live_keys": false
}
```

**POST /users/me/api-keys/regenerate-sk** â€” Response 200:
```json
{ "secret_key": "sk_test_newvalue..." }
```
The plaintext `secret_key` is returned exactly once. All subsequent reads are masked.

### Developer Verification â€” `/verification`

| Method | Path                             | Auth          | Description                             |
|--------|----------------------------------|---------------|-----------------------------------------|
| POST   | /verification/requests           | Bearer (dev)  | Submit verification request             |
| GET    | /verification/requests/mine      | Bearer (dev)  | View own verification request status    |

### Admin Endpoints â€” `/admin`

All admin endpoints require a session with role `admin` or `superadmin`.

| Method | Path                                    | Auth    | Description                                   |
|--------|-----------------------------------------|---------|-----------------------------------------------|
| GET    | /admin/dashboard                        | Admin   | Summary counts                                |
| GET    | /admin/users                            | Admin   | Paginated user list (max page_size=100)       |
| POST   | /admin/users/{user_id}/suspend          | Superadmin | Suspend user account                      |
| POST   | /admin/users/{user_id}/reactivate       | Superadmin | Reactivate user account                   |
| POST   | /admin/users/{user_id}/promote-admin    | Superadmin | Promote user to admin role                |
| GET    | /admin/verification-requests            | Admin   | Paginated list, filterable by status          |
| GET    | /admin/verification-requests/{id}       | Admin   | View request detail                           |
| POST   | /admin/verification-requests/{id}/approve | Admin | Approve developer verification              |
| POST   | /admin/verification-requests/{id}/reject  | Admin | Reject with reason                          |
| GET    | /admin/audit-log                        | Admin   | Paginated, filterable audit log               |

**GET /admin/users** â€” Query params: `page`, `page_size` (default 20, max 100), `status`, `role`.
**GET /admin/audit-log** â€” Query params: `actor_id`, `event_type`, `date_from`, `date_to`, `page`, `page_size` (default 50, max 200).

---

## Frontend Architecture

### Technology

- React 18 with React Router v6
- Tailwind CSS (utility-first, no component framework dependency)
- Axios for API calls, with an interceptor that refreshes tokens transparently
- No AI-generated boilerplate or assistant artifacts in templates

### Page Structure

```
/                       Landing page (SSR or static-generated)
/sign-up                Registration form
/login                  Login form
/verify-email           Email verification result page
/forgot-password        Password reset request
/reset-password         New password form
/dashboard              Authenticated merchant/developer dashboard
  /dashboard/api-keys   API key management
  /dashboard/verify     Developer verification submission form
/admin                  Admin dashboard (role-gated)
  /admin/users          User management table
  /admin/verification   Verification request queue
  /admin/audit-log      Audit log viewer
```

### Component Breakdown

**Shared components:**
- `AppShell` â€” authenticated layout with sidebar navigation and header
- `Button`, `Input`, `Badge`, `Card` â€” base UI components with Tailwind variants
- `Table` + `Pagination` â€” reusable data table with built-in pagination controls
- `StatusBadge` â€” renders status values (active, suspended, pending, etc.) as coloured badges
- `Modal` â€” accessible modal overlay
- `Toaster` â€” notification system (success, error, info)
- `ProtectedRoute` â€” HOC that checks auth state before rendering children

**Landing page components:**
- `LandingNav` â€” top navigation bar
- `HeroSection` â€” headline, sub-headline, primary CTA
- `FeatureGrid` â€” exactly three feature cards (Payment Gateway, Developer API, Escrow System)
- `LandingFooter`

**Auth components:**
- `RegisterForm` â€” two-step: account type selection, then credentials
- `LoginForm`
- `PasswordResetRequestForm`, `PasswordResetConfirmForm`
- `EmailVerificationBanner` â€” shown on dashboard for unverified accounts

**Dashboard components:**
- `DashboardOverview` â€” summary metrics
- `APIKeyPanel` â€” shows masked sk, publishable key, regenerate action
- `VerificationRequestForm` â€” developer KYC submission
- `VerificationStatusCard` â€” shows current request status

**Admin components:**
- `AdminSummaryCards` â€” four count cards
- `UserTable` â€” sortable, paginated; inline suspend/reactivate actions
- `VerificationQueue` â€” paginated list with approve/reject actions
- `AuditLogTable` â€” most recent 50 entries, descending

### Token Storage and Refresh

Access tokens are stored in memory (React state / Zustand store). Refresh tokens are stored in
an `HttpOnly`, `Secure`, `SameSite=Strict` cookie. The Axios interceptor catches 401 responses,
calls `/auth/refresh` automatically, and retries the original request once. On a second 401, the
user is redirected to `/login`.

---

## Authentication Flow

### RS256 JWT Access Tokens

Key pair is generated once and stored as environment variables:
- `JWT_PRIVATE_KEY` â€” PEM-encoded RSA-2048 private key
- `JWT_PUBLIC_KEY` â€” PEM-encoded RSA-2048 public key

Access token payload:
```json
{
  "sub": "<user_id>",
  "email": "<email>",
  "role": "developer",
  "iss": "lenis",
  "aud": "lenis-api",
  "exp": 1700000000,
  "iat": 1699999100,
  "jti": "<uuid4>"
}
```

Validation sequence (enforced on every protected request):
1. Decode and verify RS256 signature against the public key
2. Assert `exp` has not passed
3. Assert `iss == "lenis"`
4. Assert `aud == "lenis-api"`
5. Assert `jti` is not in the Redis blocklist
6. Assert user `status != "suspended"` (checked against DB or short-lived Redis cache)

### Rotating Refresh Tokens

Refresh tokens are opaque 32-byte CSPRNG values (`secrets.token_hex(32)`), stored as
SHA-256 hashes in the `refresh_tokens` table. On each use:

1. Token hash is looked up; if not found or revoked, return 401.
2. Existing token record is marked `revoked = True`.
3. A new refresh token is generated, hashed, and inserted.
4. A new access token is issued.
5. Both new tokens are returned to the client.

### Login Rate Limiting

The rate limiter is implemented as FastAPI middleware using Redis pipelines for atomic
increment-and-expire operations. Two layers:

1. **General endpoint rate limit**: 10 requests per IP per minute on `/auth/register` and
   `/auth/login`. Returns 429 when exceeded.
2. **Login failure lockout**: After 5 consecutive failed logins from the same IP within
   10 minutes, the IP is blocked for 15 minutes (`login_block:{ip}` key with 900s TTL).
   A successful login or token refresh resets `login_fail:{ip}` to 0 (by deleting the key).

---

## Security Design

### Password Hashing

All user passwords and Superadmin passwords (including CLI bootstrap) use bcrypt with
`rounds=12`. The hash is generated with `passlib[bcrypt]`:

```python
from passlib.context import CryptContext
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=12)
```

### Token Entropy

All opaque tokens (refresh tokens, email verification tokens, password reset tokens, API keys)
are generated with `secrets.token_hex(32)`, producing 256 bits of entropy. This guarantees
uniqueness across all issued tokens under any practical issuance volume.

For API keys specifically:
- 32 alphanumeric characters after the prefix are generated using `secrets.token_urlsafe(24)`,
  base64url-decoded and re-encoded to the alphanumeric character set, yielding the required
  32-character suffix.

### HTTPS Enforcement

HTTPS is enforced via middleware:

```python
@app.middleware("http")
async def https_redirect(request, call_next):
    if request.url.scheme == "http":
        url = request.url.replace(scheme="https")
        return RedirectResponse(url, status_code=301)
    return await call_next(request)
```

In production this is supplemented by reverse-proxy (nginx/caddy) HTTPS termination.

### Security Headers

A middleware injects the following headers on every response:

```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Content-Security-Policy: default-src 'self'; script-src 'self'; object-src 'none'
```

### CSRF Protection

Auth cookies are `SameSite=Strict`. API endpoints that mutate state require a valid Bearer
token (for API clients) or the cookie plus a CSRF token header (for browser clients). The CSRF
token is a CSPRNG value stored in a non-HttpOnly cookie, read by JavaScript and sent as a
request header.

---

## Superadmin Bootstrap

### CLI Design

Location: `app/cli/bootstrap.py`
Invocation: `python -m app.cli.bootstrap --email admin@example.com --password "P@ssw0rd!1"`

Flow:

```
parse_args()
  |
  v
validate_email(email) -> on failure: stderr + exit(1)
  |
  v
validate_password_complexity(password) -> on failure: stderr listing each unmet rule + exit(1)
  |
  v
db_session = get_sync_db()
  |
  v
existing = db_session.query(User).filter_by(account_type='superadmin').first()
  |
  +-- exists -> print warning to stdout, exit(0)
  |
  v
hashed = pwd_context.hash(password)  # bcrypt rounds=12
  |
  v
user = User(email=email, password_hash=hashed, account_type='superadmin', ...)
db_session.add(user)
db_session.commit()
  |
  v
print(f"Superadmin created: {email}")
exit(0)
```

Validation rules enforced identically to `AuthService.register`:
- Email matches `local-part@domain.tld` (RFC 5322 simplified)
- Password: length >= 8, contains uppercase, lowercase, digit, special character
- Password maximum: 128 characters

### Environment Variable Bootstrap

On application startup (`app/main.py` lifespan event):

```python
async def bootstrap_superadmin_from_env(db: AsyncSession):
    email = settings.ADMIN_EMAIL
    password = settings.ADMIN_PASSWORD
    if not email or not password:
        return
    if not validate_email(email):
        logger.error("ADMIN_EMAIL is not a valid email address. Aborting startup.")
        raise SystemExit(1)
    errors = validate_password_complexity(password)
    if errors:
        logger.error(f"ADMIN_PASSWORD does not meet complexity requirements: {errors}")
        raise SystemExit(1)
    existing = await db.execute(select(User).where(User.account_type == "superadmin"))
    if existing.scalar_one_or_none():
        logger.info("Superadmin already exists, skipping bootstrap.")
        return
    hashed = pwd_context.hash(password)
    db.add(User(email=email, password_hash=hashed, account_type="superadmin",
                full_name="Platform Operator", status="active", email_verified=True))
    await db.commit()
    logger.info(f"Superadmin account created from environment: {email}")
```

If either validation fails, the application refuses to start (`SystemExit(1)`) and writes the
error to stderr via the standard logging handler.

---

## Email Service Design

All outbound email is dispatched asynchronously via Celery tasks. The API endpoint returns
immediately; the email is enqueued and delivered by the worker.

### Celery Task

```python
@celery_app.task(bind=True, max_retries=3, default_retry_delay=60)
def send_email_task(self, to: str, subject: str, template: str, context: dict):
    try:
        email_client.send(to=to, subject=subject, template=template, context=context)
    except Exception as exc:
        raise self.retry(exc=exc)
```

### Email Templates

| Template                  | Trigger                              | Content                                     |
|---------------------------|--------------------------------------|---------------------------------------------|
| `email_verification`      | Registration                         | Confirmation link with token (24h expiry)   |
| `password_reset`          | Password reset request               | Reset link with token (30min expiry)        |
| `verification_rejected`   | Admin rejects Verification_Request   | Rejection reason, re-submission instructions |

Templates are plain HTML with inline Tailwind-equivalent CSS. No JavaScript in email templates.

### Token Generation for Email Links

For email verification and password reset:
1. Generate `secrets.token_hex(32)` (plaintext token)
2. Compute `hashlib.sha256(token.encode()).hexdigest()` (stored in DB)
3. Embed plaintext token in the link: `https://lenis.io/verify-email?token=<plaintext>`
4. On submission, hash the submitted token and compare against the DB record

This ensures the database never stores a value that can be directly used without the hash step.

### Rejection Notification Timing

The Celery task for rejection notifications is dispatched within the same request-response
cycle as the rejection action (before the response is returned), satisfying the requirement
that notification is sent within 5 minutes. The Celery worker is expected to deliver within
that window under normal operating conditions.

---

## Audit Logging Design

### Append-Only Enforcement

The database user (`lenis_app`) is granted `INSERT` and `SELECT` on `audit_logs` only. No
`UPDATE` or `DELETE` grant is issued. This is enforced at the database permission level, not
only at the application layer.

Additionally, application-level guards reject any ORM update or delete targeting `AuditLog`:

```python
class AppendOnlyMixin:
    def update(self, *args, **kwargs):
        raise OperationNotPermittedError("AuditLog entries cannot be modified.")
    def delete(self, *args, **kwargs):
        raise OperationNotPermittedError("AuditLog entries cannot be deleted.")
```

### Async Write with Retry

Audit log writes are non-blocking. The write is dispatched to a Celery task so that the
originating API response is not held for the log write:

```python
async def create_entry(payload: AuditEntryPayload) -> None:
    write_audit_log_task.apply_async(
        args=[payload.dict()],
        retry=True,
        retry_policy={"max_retries": 3, "interval_start": 0.1, "interval_step": 0.5}
    )
```

The `write_audit_log_task` Celery task attempts the DB insert. On failure after 3 retries, the
payload is written to a dead-letter Redis key (`audit_dead_letter:{uuid}`) rather than
discarded. A separate reconciliation job periodically re-attempts dead-letter entries.

### Audit Event Types

| Event Type                     | Produced By           |
|--------------------------------|-----------------------|
| `user.register`                | Auth Service          |
| `user.login.success`           | Auth Service          |
| `user.login.failure`           | Auth Service          |
| `user.logout`                  | Auth Service          |
| `user.password_reset`          | Auth Service          |
| `user.suspend`                 | Admin Service         |
| `user.reactivate`              | Admin Service         |
| `user.promote_admin`           | Admin Service         |
| `verification.approve`         | Verification Service  |
| `verification.reject`          | Verification Service  |
| `api_key.regenerate`           | User Service          |
| `api_key.generate_live`        | User Service          |

---

## Correctness Properties

Tests use **Hypothesis** (Python) for property-based verification. Each test runs a minimum of 100 iterations.


### Property 1: Valid Registration Always Produces a Hashed Password

For any valid registration payload (email, password meeting complexity rules, full name 2â€“100
chars, account_type in {"merchant", "developer"}), the stored password hash must begin with
`$2b$12$`, confirming bcrypt with cost factor 12 was applied and the plaintext is never stored.

**Validates: Requirements 1.1, 1.7**

---

### Property 2: Password Complexity Rejection

For any password string that violates at least one complexity rule (fewer than 8 characters,
or missing an uppercase letter, or missing a lowercase letter, or missing a digit), submitting
it as a registration password must return a 400 response.

**Validates: Requirements 1.3, 1.4**

---

### Property 3: Malformed Email Rejection

For any string that does not conform to the `local-part@domain.tld` pattern (no `@`, multiple
`@`, no domain, no TLD), submitting it as a registration email must return a 400 response.

**Validates: Requirements 1.5**

---

### Property 4: Email Verification Token Invalidation After Use

For any valid email confirmation token, confirming it once marks the user as verified and
marks the token as used; a second submission of the same token must return a 400 response.

**Validates: Requirements 1.9**

---

### Property 5: Verification Resend Invalidates Prior Token

For any unverified user, requesting a token resend invalidates all previously issued unexpired
tokens for that user, such that the old token is rejected and the new token is accepted.

**Validates: Requirements 1.11**

---

### Property 6: Login Returns RS256-Signed Tokens

For any valid (verified email, correct password) pair, the login response must contain an
`access_token` whose decoded header contains `{"alg": "RS256", "typ": "JWT"}`, and a
`refresh_token` of at least 64 hex characters.

**Validates: Requirements 2.1, 2.10**

---

### Property 7: Login Error Messages Are Indistinguishable

For any pair of invalid credential submissions â€” one with a correct email and wrong password,
one with a nonexistent email and any password â€” the HTTP status code (401) and the error
message body must be byte-for-byte identical.

**Validates: Requirements 2.3, 2.4**

---

### Property 8: Rate Limiter Blocks After 5 Consecutive Failures

For any IP address, after exactly 5 consecutive failed login attempts within a 10-minute
window, the next login attempt from that IP must return 429. After a successful login from
that IP, the failure counter is reset such that the next 5 attempts would need to occur
again before the block triggers.

**Validates: Requirements 2.5, 2.6**

---

### Property 9: Refresh Token Rotation â€” Old Token Rejected

For any valid refresh token, after it is used to obtain a new token pair, submitting the
original refresh token again must return 401. The new refresh token must be accepted.

**Validates: Requirements 2.7**

---

### Property 10: Logout Invalidates Both Tokens

For any authenticated session (access token + refresh token pair), after a logout request, the
access token's JTI must be present in the Redis blocklist and the refresh token record must be
marked revoked, such that both the access token and the refresh token are rejected on any
subsequent use.

**Validates: Requirements 2.9**

---

### Property 11: Password Reset Response Reveals Nothing About Email Registration

For any email address (whether or not it exists in the database), the HTTP status code and
response body of a password reset request must be identical.

**Validates: Requirements 3.2**

---

### Property 12: Password Reset Revokes All Active Sessions

For any user with active refresh tokens, after a successful password reset, all previously
issued refresh tokens for that user must be revoked, such that any attempt to use one returns
401.

**Validates: Requirements 3.3**

---

### Property 13: Verification Request Field Validation

For any submission where the intended use description is outside [50, 500] characters, or
where the website URL does not begin with `http://` or `https://`, or where any required
field is absent, the response must be 400 and the response body must identify the offending
field.

**Validates: Requirements 4.7, 4.8, 4.9**

---

### Property 14: Verification Request Always Starts as Pending

For any valid Verification_Request payload submitted by a developer with no existing pending
or approved request, the created record must have status `pending` and the response must be 201.

**Validates: Requirements 4.1**

---

### Property 15: CLI Password Complexity Error Lists All Unmet Rules

For any password submitted to the CLI bootstrap command that violates one or more complexity
rules, the exit code must be 1 and stderr must contain an entry for each individual unmet rule
(not a single generic message).

**Validates: Requirements 6.3**

---

### Property 16: Non-Admin Sessions Cannot Access Admin Endpoints

For any HTTP request to any `/admin` endpoint where the bearer token's `role` claim is neither
`admin` nor `superadmin`, the response must be 403.

**Validates: Requirements 7.11**

---

### Property 17: Admin Cannot Act on Superadmin Accounts

For any request from an `admin`-role session to suspend, reactivate, or otherwise modify a
`superadmin` account, the response must be 403 and the target account must remain unchanged.

**Validates: Requirements 7.5**

---

### Property 18: Audit Log Entries Are Complete

For any action that produces an audit log entry, the stored entry must contain non-null values
for all seven required fields: event_type, actor_id, target_type, target_id, outcome, client_ip,
and created_at (UTC).

**Validates: Requirements 8.1**

---

### Property 19: Audit Log Is Append-Only

For any audit log entry that exists in the database, any attempt to delete or update it through
the application layer must raise an error and leave the entry unchanged.

**Validates: Requirements 8.3**

---

### Property 20: Audit Log Filter Correctness

For any combination of filter parameters (actor_id, event_type, date_from, date_to), every
entry returned by the audit log API must satisfy all supplied filter predicates; no entry
failing any single predicate may appear in the result set.

**Validates: Requirements 8.4**

---

### Property 21: API Key Prefix and Format Invariant

For any newly created developer account (after email verification), the generated test-mode
publishable key must match `^pk_test_[A-Za-z0-9]{32}$` and the test-mode secret key (plaintext,
returned once) must match `^sk_test_[A-Za-z0-9]{32}$`. For any verified developer generating
live-mode keys, the same pattern applies with prefixes `pk_live_` and `sk_live_`.

**Validates: Requirements 9.1, 9.5**

---

### Property 22: Secret Key Masking Invariant

For any secret key (test or live mode) of known plaintext, the masked representation returned
by the API must expose exactly the last 4 characters of the plaintext and replace all preceding
characters with a masking character, with the total displayed length matching the original.

**Validates: Requirements 9.3**

---

### Property 23: Secret Key Rotation Invalidates Prior Key

For any active test-mode secret key, after a regeneration request, authenticating with the old
secret key must be rejected; the new secret key (returned once in the regeneration response)
must be accepted.

**Validates: Requirements 9.4**

---

### Property 24: HTTPS Redirect Preserves Path and Query

For any HTTP request with an arbitrary path and query string, the redirect response must point
to the exact HTTPS equivalent URL with the original path and query string preserved and the
scheme changed to `https`.

**Validates: Requirements 10.2**

---

### Property 25: Security Headers Present on All Responses

For any endpoint and any valid or invalid request, the response must contain all four required
security headers: `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options`,
and `Content-Security-Policy`.

**Validates: Requirements 10.3**

---

## Error Handling

### Validation Errors (400)

FastAPI's Pydantic integration produces field-level validation errors. The error handler
normalises the output to the standard `{ "detail": "...", "code": "VALIDATION_ERROR" }` shape.
For multi-field failures (e.g. missing required fields in a verification request), all failing
fields are enumerated in the `detail` array.

### Authentication Errors

| Condition                          | Status | Code                    |
|------------------------------------|--------|-------------------------|
| Invalid or expired access token    | 401    | `INVALID_TOKEN`         |
| Revoked access token               | 401    | `TOKEN_REVOKED`         |
| Suspended account                  | 403    | `ACCOUNT_SUSPENDED`     |
| Insufficient role                  | 403    | `INSUFFICIENT_PRIVILEGES` |

### Duplicate Resource (409)

Returned for duplicate email registration and duplicate verification request submission.

### Rate Limit (429)

Returns `Retry-After` header indicating seconds until the block expires.

### Server Errors (500)

Unhandled exceptions are caught by a global handler. The response body contains only a generic
message. Full error detail is written to the structured log. Stack traces are never sent to
clients.

---

## Testing Strategy

### Dual Testing Approach

Every acceptance criterion is covered by at least one of:

1. **Unit tests** â€” specific scenarios, error conditions, boundary values
2. **Property-based tests** â€” universal correctness properties (Properties 1â€“25 above),
   implemented with Hypothesis, minimum 100 iterations each
3. **Integration tests** â€” database round-trips, Celery task execution, Redis state

Unit tests and property-based tests are complementary. Unit tests anchor specific known-good
and known-bad examples. Property-based tests discover edge cases through randomised input
generation.

### Property-Based Test Configuration

```python
from hypothesis import given, settings
from hypothesis import strategies as st

@settings(max_examples=100)
@given(st.emails())
def test_property_1_valid_registration_hashes_bcrypt(email):
    # ...
```

Each property test is tagged:

```
Feature: platform-foundation, Property N: <property_text>
```

### Test File Layout

```
tests/
  unit/
    test_auth_service.py
    test_user_service.py
    test_verification_service.py
    test_admin_service.py
    test_audit_log_service.py
    test_email_tokens.py
    test_rate_limiter.py
    test_cli_bootstrap.py
  property/
    test_registration_properties.py    # Properties 1â€“5
    test_auth_flow_properties.py       # Properties 6â€“12
    test_verification_properties.py    # Properties 13â€“14
    test_bootstrap_properties.py       # Property 15
    test_admin_properties.py           # Properties 16â€“17
    test_audit_log_properties.py       # Properties 18â€“20
    test_api_key_properties.py         # Properties 21â€“23
    test_security_properties.py        # Properties 24â€“25
  integration/
    test_db_models.py
    test_celery_tasks.py
    test_email_dispatch.py
    test_redis_state.py
```

### Landing Page Testing

The landing page is validated by:
- Playwright snapshot tests for component structure and SSR correctness
- Lighthouse CI run in the build pipeline for performance (TTI <= 3s), accessibility (>= 90),
  and SSR verification
- A build-fail assertion on the Lighthouse accessibility score threshold (Requirement 5.6)

### Unit Test Balance

Property-based tests handle wide-input coverage. Unit tests focus on:
- Specific examples demonstrating correct happy-path behavior
- Integration points (e.g. audit log written before response returned)
- Error conditions not easily expressed as universal properties (suspended account mid-session)

