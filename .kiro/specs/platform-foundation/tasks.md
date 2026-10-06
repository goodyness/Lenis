# Implementation Plan: Platform Foundation

## Overview

Build the foundational layer of the Lenis Web3 Financial Infrastructure SaaS. This covers
project scaffolding, database models, the Auth / User / Verification / Admin service backends,
the CLI bootstrap tool, the React frontend (landing page, auth forms, dashboards), the email
service, audit logging, rate limiting, and security hardening. Property-based tests are
included alongside each implementation task using Hypothesis.

---

## Tasks

### 1. Project Scaffolding and Core Infrastructure

- [x] 1.1 Initialise the Python project structure
  - Create the directory layout defined in the design: `app/auth`, `app/users`,
    `app/verification`, `app/admin`, `app/core`, `app/cli`, `app/main.py`
  - Create `pyproject.toml` (or `requirements.txt`) pinning FastAPI, SQLAlchemy,
    Alembic, passlib[bcrypt], python-jose[cryptography], redis, celery, hypothesis,
    pytest, pytest-asyncio, httpx
  - Create `app/core/config.py` using Pydantic `BaseSettings` to load
    `DATABASE_URL`, `REDIS_URL`, `JWT_PRIVATE_KEY`, `JWT_PUBLIC_KEY`,
    `ADMIN_EMAIL`, `ADMIN_PASSWORD`, `CELERY_BROKER_URL`, `SMTP_*` env vars
  - Add `.env.example` with all required variable names and placeholder values
  - _Requirements: 10.1_

- [x] 1.2 Set up SQLAlchemy and Alembic
  - Create `app/core/db.py` with async `AsyncSession` factory and `Base` declarative
    base using SQLite for development (`sqlite+aiosqlite:///./lenis_dev.db`)
  - Initialise Alembic with `alembic init migrations`; configure `env.py` to use
    `Base.metadata` and the `DATABASE_URL` setting
  - _Requirements: 1.1_

- [x] 1.3 Set up Redis connection utility
  - Create `app/core/redis_client.py` that initialises an async Redis connection pool
    from the `REDIS_URL` setting; expose `get_redis()` dependency
  - _Requirements: 2.5, 10.4_

- [x] 1.4 Set up Celery application
  - Create `app/core/celery_app.py` that defines the Celery app with Redis as broker
    and result backend
  - _Requirements: 4.5, 8.2_

- [x] 1.5 Generate RS256 key pair and JWT utilities
  - Create `app/core/security.py` with:
    - `hash_password(plain: str) -> str` using `passlib` bcrypt, `rounds=12`
    - `verify_password(plain: str, hashed: str) -> bool`
    - `generate_token() -> str` using `secrets.token_hex(32)`
    - `hash_token(token: str) -> str` using SHA-256 hex digest
  - Create `app/core/tokens.py` with:
    - `create_access_token(payload: dict) -> str` signing with RS256 private key,
      `exp = now + 15 min`, `iss = "lenis"`, `aud = "lenis-api"`, `jti = uuid4()`
    - `decode_access_token(token: str) -> dict` verifying signature, `exp`, `iss`, `aud`
    - `blocklist_token(jti: str, ttl_seconds: int)` writing `blocklist:jti:{jti}` to Redis
    - `is_token_blocklisted(jti: str) -> bool` checking Redis
  - Add a `scripts/generate_keypair.py` helper that prints a fresh RSA-2048 PEM key pair
  - _Requirements: 2.10, 10.5, 10.6_

- [x] 1.6 Write middleware: HTTPS redirect and security headers
  - Create `app/core/middleware.py` with:
    - `HTTPSRedirectMiddleware` that redirects any `http://` request to the HTTPS
      equivalent, preserving path and query string, with `status_code=301`
    - `SecurityHeadersMiddleware` that injects `Strict-Transport-Security`,
      `X-Content-Type-Options`, `X-Frame-Options`, `Content-Security-Policy` on
      every response
  - Register both middleware in `app/main.py`
  - _Requirements: 10.1, 10.2, 10.3_

- [ ] 1.7 Write rate-limit middleware
  - Create `app/core/rate_limit.py` implementing a Redis-backed sliding-window counter:
    - `RateLimitMiddleware(endpoint_pattern, max_requests, window_seconds)` increments
      `rate_limit:{ip}:{endpoint}` and returns 429 with `Retry-After` header if exceeded
  - Apply to `/auth/register` and `/auth/login` (10 req / 60 s)
  - Separate login-failure lockout logic:
    - `record_login_failure(ip)` increments `login_fail:{ip}` (TTL 600 s)
    - `is_login_blocked(ip) -> bool` checks `login_block:{ip}`
    - `set_login_block(ip)` writes `login_block:{ip}` with TTL 900 s when counter >= 5
    - `reset_login_counter(ip)` deletes `login_fail:{ip}` and `login_block:{ip}`
  - _Requirements: 2.5, 2.6, 10.4_

- [x] 1.8 Bootstrap FastAPI app entry point
  - Create `app/main.py` that:
    - Creates the FastAPI instance
    - Registers all middleware (HTTPS redirect, security headers, rate limit)
    - Includes all service routers
    - Defines a `lifespan` async context manager that calls
      `bootstrap_superadmin_from_env()` on startup
  - _Requirements: 6.5, 6.6_

---

### 2. Database Models and Initial Migration

- [x] 2.1 Implement ORM models
  - Create `app/core/models.py` (or per-service `models.py` files) with SQLAlchemy
    mapped classes for all six tables defined in the design:
    `User`, `EmailToken`, `RefreshToken`, `Organization`, `APIKey`,
    `VerificationRequest`, `AuditLog`
  - `AuditLog` model must include the `AppendOnlyMixin` that raises
    `OperationNotPermittedError` on any `update()` or `delete()` call
  - All primary keys are UUIDs; all timestamps are UTC `TIMESTAMPTZ`
  - _Requirements: 1.1, 1.7, 8.3_

- [x] 2.2 Generate and apply initial Alembic migration
  - Run `alembic revision --autogenerate -m "initial_schema"` and verify the generated
    migration covers all seven tables with correct constraints and indexes
  - Apply with `alembic upgrade head` against the SQLite dev database
  - _Requirements: 1.1_

- [ ]* 2.3 Write property test for AppendOnlyMixin
  - **Property 19: Audit Log Is Append-Only**
  - **Validates: Requirements 8.3**
  - For any `AuditLog` instance, calling `.update()` or `.delete()` on the model
    must raise `OperationNotPermittedError` and leave the record in the database
    unchanged

---

### 3. Auth Service: Registration and Email Verification

- [x] 3.1 Implement registration endpoint
  - Create `app/auth/service.py` with `AuthService.register()`:
    - Validate email format, password complexity (length >= 8, uppercase, lowercase,
      digit), full_name length (2-100 chars), account_type in
      `{"merchant", "developer"}`; return 400 on any failure with a descriptive message
    - Check for duplicate email; return 409 with `EMAIL_ALREADY_REGISTERED` code
    - Hash password with bcrypt cost=12 via `hash_password()`
    - Create `User` record with `status="unverified"`, `email_verified=False`
    - Auto-create `Organization` linked to the new user
    - Generate a 256-bit opaque token, store its SHA-256 hash in `EmailToken`
      with `token_type="email_verification"`, `expires_at = now + 24h`
    - Enqueue `send_email_task` for the verification email
    - Return 201 `{ "user_id": ..., "email": ... }`
  - Create `app/auth/router.py` registering `POST /auth/register`
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_

- [ ]* 3.2 Write property tests for registration validation
  - **Property 1: Valid Registration Always Produces a Hashed Password**
  - **Property 2: Password Complexity Rejection**
  - **Property 3: Malformed Email Rejection**
  - **Validates: Requirements 1.1, 1.3, 1.4, 1.5, 1.7**

- [x] 3.3 Implement email verification endpoints
  - `AuthService.verify_email(token: str)`:
    - Hash the submitted token; look up `EmailToken` by hash with
      `token_type="email_verification"`, `used=False`, `expires_at > now`
    - If not found or expired, return 400 with `TOKEN_EXPIRED` or `TOKEN_INVALID`
    - Mark token `used=True`, set `user.email_verified=True`, set `user.status="active"`
    - Return 200
  - `AuthService.resend_verification(email: str)`:
    - If email already verified, return 400 with `EMAIL_ALREADY_VERIFIED`
    - Mark all existing unexpired tokens for that user/type as `used=True`
    - Generate new token, store hash, enqueue email
    - Return 200
  - Register `POST /auth/verify-email` and `POST /auth/resend-verification`
  - _Requirements: 1.9, 1.10, 1.11, 1.12_

- [ ]* 3.4 Write property tests for email verification
  - **Property 4: Email Verification Token Invalidation After Use**
  - **Property 5: Verification Resend Invalidates Prior Token**
  - **Validates: Requirements 1.9, 1.11**

---

### 4. Auth Service: Login, Tokens, and Session Management

- [x] 4.1 Implement login endpoint
  - `AuthService.login(payload, client_ip)`:
    - Check `is_login_blocked(client_ip)`; if blocked return 429
    - Look up user by email; if not found return 401 with a generic message
      (do not distinguish email vs password)
    - Check email_verified; if false return 403 with `EMAIL_VERIFICATION_REQUIRED` (and redirect to verification page to verify email)
    - Verify password with `verify_password()`; on failure call
      `record_login_failure(client_ip)`, check if counter >= 5 to set block,
      then return 401 with the same generic message as email-not-found
    - On success: `reset_login_counter(client_ip)`
    - Issue Access_Token (RS256, 15 min) and Refresh_Token (opaque 32-byte hex, 7 days)
    - Store Refresh_Token SHA-256 hash in `RefreshToken` table
    - Write `user.login.success` or `user.login.failure` Audit_Log entry
    - Return 200 `{ access_token, refresh_token, token_type: "bearer", expires_in: 900 }`
  - Register `POST /auth/login`
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 10.7_

- [ ]* 4.2 Write property tests for login behaviour
  - **Property 6: Login Returns RS256-Signed Tokens**
  - **Property 7: Login Error Messages Are Indistinguishable**
  - **Property 8: Rate Limiter Blocks After 5 Consecutive Failures**
  - **Validates: Requirements 2.1, 2.3, 2.4, 2.5, 2.6, 2.10**

- [x] 4.3 Implement token refresh endpoint
  - `AuthService.refresh_tokens(refresh_token)`:
    - Hash submitted token; look up in `RefreshToken` where `revoked=False` and
      `expires_at > now`; if not found return 401
    - Mark existing record `revoked=True`
    - Issue new Refresh_Token (7 days) and new Access_Token (15 min)
    - Call `reset_login_counter(client_ip)` (satisfies Requirement 2.6)
    - Return 200 with new token pair
  - Register `POST /auth/refresh`
  - _Requirements: 2.6, 2.7, 2.8_

- [ ]* 4.4 Write property test for refresh token rotation
  - **Property 9: Refresh Token Rotation - Old Token Rejected**
  - **Validates: Requirements 2.7**

- [ ] 4.5 Implement logout endpoint
  - `AuthService.logout(access_token)`:
    - Decode the access token to extract `jti` and `exp`
    - Compute remaining TTL (`exp - now`) and write `blocklist:jti:{jti}` to Redis
    - Revoke the associated Refresh_Token record in the database
    - Write `user.logout` Audit_Log entry
    - Return 200
  - Implement `get_current_user()` FastAPI dependency that validates the Bearer token
    (signature, exp, iss, aud, jti not blocklisted, user not suspended per Req 2.11)
  - Register `POST /auth/logout` behind Bearer auth
  - _Requirements: 2.9, 2.11_

- [ ]* 4.6 Write property test for logout
  - **Property 10: Logout Invalidates Both Tokens**
  - **Validates: Requirements 2.9**

---

### 5. Auth Service: Password Reset

- [x] 5.1 Implement password reset request endpoint
  - `AuthService.request_password_reset(email)`:
    - Always return 200 regardless of whether the email exists (prevents enumeration)
    - If email exists and is verified, generate a 256-bit token, store its SHA-256 hash, redirecto email verification if not verified
      in `EmailToken` with `token_type="password_reset"`, `expires_at = now + 30 min`
    - Enqueue `send_email_task` for the reset email
  - Register `POST /auth/password-reset/request`
  - _Requirements: 3.1, 3.2_

- [ ]* 5.2 Write property test for password reset email response
  - **Property 11: Password Reset Response Reveals Nothing About Email Registration**
  - **Validates: Requirements 3.2**

- [x] 5.3 Implement password reset confirmation endpoint
  - `AuthService.reset_password(token, new_password)`:
    - Hash submitted token; look up `EmailToken` by hash with
      `token_type="password_reset"`, `used=False`, `expires_at > now`
    - If expired: 400 `TOKEN_EXPIRED`; if used: 400 `TOKEN_ALREADY_USED`;
      if not found: 400 `TOKEN_INVALID`
    - Validate new password complexity (length 8-128, uppercase, lowercase, digit,
      special character); return 400 on failure
    - Update `user.password_hash`, mark token `used=True`
    - Revoke all active `RefreshToken` records for the user
    - Return 200
  - Register `POST /auth/password-reset/confirm`
  - _Requirements: 3.3, 3.4, 3.5, 3.6_

- [ ]* 5.4 Write property test for password reset session revocation
  - **Property 12: Password Reset Revokes All Active Sessions**
  - **Validates: Requirements 3.3**

---

### 6. Checkpoint

- [ ] 6. Checkpoint - Auth service complete
  - Ensure all auth tests pass, including property tests for Properties 1-12
  - Verify SQLite migrations apply cleanly with `alembic upgrade head`
  - Ask the user if questions arise before continuing

---

### 7. User Service: Profiles and API Keys

- [x] 7.1 Implement profile endpoint
  - Create `app/users/service.py` with `UserService.get_profile(user_id)` returning
    the user's ID, email, full_name, account_type, status, email_verified, created_at
  - Create `app/users/router.py` registering `GET /users/me` behind Bearer auth
  - _Requirements: 1.1_

- [x] 7.2 Implement automatic test-mode API key generation on email verification
  - After `AuthService.verify_email()` marks the user active, if `account_type ==
    "developer"`, call `UserService._generate_test_keys(user_id)`:
    - Generate `pk_test_` + 32 alphanumeric chars using `secrets.token_urlsafe(24)`
      re-encoded to alphanumeric
    - Generate `sk_test_` + 32 alphanumeric chars the same way
    - Store pk plaintext; store sk as SHA-256 hash with `suffix_display = last 4 chars`
    - Associate both with the user's Organization
    - Return the plaintext sk exactly once in a `SecretKeyResponse`
  - Register `GET /users/me/api-keys` returning masked secret key and plaintext
    publishable key
  - _Requirements: 9.1, 9.2, 9.3_

- [ ]* 7.3 Write property tests for API key format and masking
  - **Property 21: API Key Prefix and Format Invariant**
  - **Property 22: Secret Key Masking Invariant**
  - **Validates: Requirements 9.1, 9.3, 9.5**

- [x] 7.4 Implement test secret key regeneration endpoint
  - `UserService.regenerate_test_secret_key(user_id)`:
    - Find the active `sk_test` key for the user's organization; mark `active=False`,
      set `revoked_at = now`
    - Generate a new `sk_test_` key, store its hash and suffix_display
    - Write `api_key.regenerate` Audit_Log entry
    - Return the new plaintext sk exactly once
  - Register `POST /users/me/api-keys/regenerate-sk` behind Bearer auth
  - _Requirements: 9.4_

- [ ]* 7.5 Write property test for secret key rotation
  - **Property 23: Secret Key Rotation Invalidates Prior Key**
  - **Validates: Requirements 9.4**

- [~] 7.6 Implement live-mode API key generation endpoint
  - `UserService.generate_live_keys(user_id)`:
    - If `user.status != "verified"` return 403 with `VERIFICATION_REQUIRED`
    - Generate `pk_live_` and `sk_live_` keys using the same 32-char alphanumeric logic
    - Store both; return plaintext sk exactly once
    - Write `api_key.generate_live` Audit_Log entry
  - Register `POST /users/me/api-keys/live` behind Bearer auth
  - _Requirements: 9.5, 9.6_

---

### 8. Verification Service

- [x] 8.1 Implement verification request submission endpoint
  - Create `app/verification/service.py` with `VerificationService.submit_request()`:
    - Check caller `account_type == "developer"`; if not return 403
    - Validate all required fields present; return 400 identifying offending fields
    - Validate website_url starts with `http://` or `https://`; return 400 if not
    - Validate intended_use length 50-500 chars; return 400 if not
    - Check for existing pending or approved request; return 409 if found
    - Create `VerificationRequest` record with `status="pending"`
    - Return 201
  - Create `app/verification/router.py` registering `POST /verification/requests`
    behind Bearer auth
  - _Requirements: 4.1, 4.2, 4.3, 4.7, 4.8, 4.9_

- [ ]* 8.2 Write property tests for verification request validation
  - **Property 13: Verification Request Field Validation**
  - **Property 14: Verification Request Always Starts as Pending**
  - **Validates: Requirements 4.1, 4.7, 4.8, 4.9**

- [x] 8.3 Implement developer own-request view endpoint
  - `GET /verification/requests/mine` returns the caller's most recent
    `VerificationRequest` status and submitted details
  - _Requirements: 4.2_

- [x] 8.4 Implement admin approve and reject actions (verification service side)
  - `VerificationService.approve_request(request_id, admin_id)`:
    - Set `VerificationRequest.status = "approved"`, `reviewed_by = admin_id`
    - Set `user.status = "verified"` granting production API access
    - Write `verification.approve` Audit_Log entry
  - `VerificationService.reject_request(request_id, admin_id, reason)`:
    - Set status to `"rejected"`, store `rejection_reason`, set `rejected_at = now`
    - Enqueue `send_email_task` for the rejection notification (dispatched within
      the same request cycle, satisfying the 5-minute delivery requirement)
    - Write `verification.reject` Audit_Log entry
  - Enforce 24-hour re-submission cooldown in `submit_request()` by checking
    `rejected_at + 24h <= now`
  - _Requirements: 4.4, 4.5, 4.6_

---

### 9. Admin Service

- [x] 9.1 Create admin role guard dependency
  - Create `app/admin/dependencies.py` with:
    - `require_admin`: FastAPI dependency that asserts `role in {"admin", "superadmin"}`;
      returns 403 `INSUFFICIENT_PRIVILEGES` otherwise
    - `require_superadmin`: asserts `role == "superadmin"` only
  - _Requirements: 7.5, 7.9, 7.11_

- [ ]* 9.2 Write property test for non-admin endpoint protection
  - **Property 16: Non-Admin Sessions Cannot Access Admin Endpoints**
  - **Validates: Requirements 7.11**

- [x] 9.3 Implement admin user listing and dashboard summary
  - Create `app/admin/service.py` with:
    - `AdminService.list_users(filters, page, page_size)`: paginated query on `users`
      returning id, email, role, account_type, status, created_at; default page 20, max 100
    - `AdminService.get_dashboard_summary()`: counts for total users, pending
      verification requests, verified developers, active merchants
  - Create `app/admin/router.py` registering:
    - `GET /admin/users` (require_admin)
    - `GET /admin/dashboard` (require_admin)
  - _Requirements: 7.1, 7.2_

- [x] 9.4 Implement user suspension, reactivation, and promotion
  - `AdminService.suspend_user(actor_id, target_id)`:
    - If target is superadmin and caller is not superadmin, return 403
    - Set `user.status = "suspended"`, revoke all active Refresh_Tokens
    - Write `user.suspend` Audit_Log entry
  - `AdminService.reactivate_user(actor_id, target_id)`:
    - Same superadmin guard as above
    - Set `user.status = "active"`, write `user.reactivate` Audit_Log entry
  - `AdminService.promote_to_admin(actor_id, target_id)`:
    - Only superadmin may call; return 403 otherwise
    - Set `user.account_type = "admin"`, write `user.promote_admin` Audit_Log entry
  - Register:
    - `POST /admin/users/{user_id}/suspend` (require_superadmin)
    - `POST /admin/users/{user_id}/reactivate` (require_superadmin)
    - `POST /admin/users/{user_id}/promote-admin` (require_superadmin)
  - _Requirements: 7.3, 7.4, 7.5, 7.8, 7.9_

- [ ]* 9.5 Write property test for admin protection against superadmin modification
  - **Property 17: Admin Cannot Act on Superadmin Accounts**
  - **Validates: Requirements 7.5**

- [x] 9.6 Implement verification request admin endpoints
  - Register:
    - `GET /admin/verification-requests` with `status` filter, paginated (require_admin)
    - `GET /admin/verification-requests/{id}` returning full detail (require_admin)
    - `POST /admin/verification-requests/{id}/approve` calling
      `VerificationService.approve_request()` (require_admin)
    - `POST /admin/verification-requests/{id}/reject` calling
      `VerificationService.reject_request()` (require_admin)
  - _Requirements: 7.6, 7.7_

---

### 10. Audit Logging Service

- [x] 10.1 Implement AuditLogService and Celery write task
  - Create `app/admin/audit.py` with:
    - `AuditEntryPayload` dataclass: `event_type`, `actor_id`, `target_type`,
      `target_id`, `outcome`, `client_ip`, `created_at`
    - `AuditLogService.create_entry(payload)` that calls
      `write_audit_log_task.apply_async(...)` so the API response is not blocked
  - Create Celery task `write_audit_log_task` that inserts the record; on failure after
    3 retries, writes to `audit_dead_letter:{uuid}` in Redis
  - _Requirements: 8.1, 8.2, 8.5_

- [ ]* 10.2 Write property test for audit log entry completeness
  - **Property 18: Audit Log Entries Are Complete**
  - **Validates: Requirements 8.1**

- [x] 10.3 Implement audit log retrieval endpoint
  - `AdminService.list_audit_log(filters, page, page_size)`: filterable by `actor_id`,
    `event_type`, `date_from`, `date_to`; descending `created_at`; default 50, max 200
  - Register `GET /admin/audit-log` (require_admin)
  - _Requirements: 8.4_

- [ ]* 10.4 Write property test for audit log filter correctness
  - **Property 20: Audit Log Filter Correctness**
  - **Validates: Requirements 8.4**

---

### 11. CLI Superadmin Bootstrap

- [x] 11.1 Implement CLI bootstrap command
  - Create `app/cli/bootstrap.py` with `argparse` CLI:
    - Parse `--email` and `--password` arguments
    - Validate email with the same `validate_email()` used by Auth_Service; on failure
      print to stderr, exit code 1
    - Validate password complexity (length >= 8, uppercase, lowercase, digit, special
      character); on failure print each unmet rule to stderr, exit code 1
    - Check for existing superadmin; if found print warning to stdout, exit code 0
    - Hash password with bcrypt cost=12, insert `User` with `account_type="superadmin"`,
      `status="active"`, `email_verified=True`
    - Print `"Superadmin created: {email}"` to stdout, exit code 0
  - Implement `app/main.py` lifespan `bootstrap_superadmin_from_env()` as specified in
    the design, with `SystemExit(1)` on invalid env var values
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9_

- [ ]* 11.2 Write property test for CLI password complexity error reporting
  - **Property 15: CLI Password Complexity Error Lists All Unmet Rules**
  - **Validates: Requirements 6.3**

---

### 12. Email Service

- [x] 12.1 Implement email Celery task and templates
  - Create `app/core/email.py` with `EmailClient` that sends via SMTP using settings
    `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`
  - Create Celery task `send_email_task(to, subject, template, context)` with
    `max_retries=3`, `default_retry_delay=60`; on failure, use `self.retry(exc=exc)`
  - Create three plain-HTML email templates (no JavaScript, inline CSS):
    - `email_verification.html`: confirmation link with 24-hour expiry note
    - `password_reset.html`: reset link with 30-minute expiry note
    - `verification_rejected.html`: rejection reason and re-submission instructions
  - _Requirements: 1.8, 3.1, 4.5_

---

### 13. Checkpoint

- [ ] 13. Checkpoint - Backend services complete
  - Ensure all backend unit and property tests pass
  - Verify property tests for Properties 1-25 are implemented and passing
  - Confirm Alembic migration applies cleanly on a fresh SQLite file
  - Ask the user if questions arise before starting frontend work

---

### 14. Frontend: Project Setup and Shared Components

- [x] 14.1 Initialise the React frontend project
  - Create `frontend/` with Vite + React 18 + TypeScript
  - Install dependencies: `react-router-dom`, `axios`, `tailwindcss`, `zustand`,
    `@types/react`, pinned exact versions
  - Configure Tailwind: `tailwind.config.js` with content paths; add base, components,
    utilities to `frontend/src/index.css`
  - Set up ESLint + Prettier with no AI-generated template files
  - _Requirements: 5.1_

- [x] 14.2 Implement the API client and token management
  - Create `frontend/src/lib/api.ts` with an Axios instance pointed at the backend
  - Implement a response interceptor that:
    - On 401: calls `POST /auth/refresh` using the HttpOnly cookie Refresh_Token
    - On success: retries the original request once with the new Access_Token
    - On second 401: clears auth state and redirects to `/login`
  - Create `frontend/src/lib/auth-store.ts` (Zustand) storing the Access_Token in
    memory only (never localStorage or sessionStorage)
  - _Requirements: 2.1, 2.7_

- [x] 14.3 Build shared UI component library
  - Create `frontend/src/components/ui/` with:
    - `Button.tsx` (variants: primary, secondary, danger; sizes: sm, md, lg)
    - `Input.tsx` (label, error message, helper text)
    - `Badge.tsx` (colour variants for status values)
    - `Card.tsx` (standard container with padding and border)
    - `Modal.tsx` (accessible overlay with focus trap using `aria-modal`)
    - `Table.tsx` + `Pagination.tsx` (reusable data table with built-in pagination)
    - `StatusBadge.tsx` (maps status strings to colour-coded badges)
    - `Toaster.tsx` (success, error, info notification system)
  - Create `frontend/src/components/layout/AppShell.tsx` (sidebar nav + header for
    authenticated pages)
  - Create `frontend/src/components/routing/ProtectedRoute.tsx` (checks auth state;
    redirects to `/login` if unauthenticated)
  - _Requirements: 5.1, 5.4_

---

### 15. Frontend: Landing Page

- [x] 15.1 Build the landing page with SSR/static generation
  - Create `frontend/src/pages/Landing.tsx` composed of:
    - `LandingNav.tsx`: Platform name, links to `/sign-up` and `/login`
    - `HeroSection.tsx`: Headline describing non-custodial crypto payment infrastructure,
      primary CTA button linking to `/sign-up`
    - `FeatureGrid.tsx`: Exactly three feature cards in order:
      Payment Gateway, Developer API, Escrow System, each with title and description
    - `LandingFooter.tsx`
  - Configure Vite SSR or export as static HTML so the full page content is in the
    initial HTTP response without requiring client-side JS execution
  - Ensure layout uses responsive Tailwind classes to render without horizontal
    scrolling from 320px to 2560px
  - _Requirements: 5.1, 5.2, 5.4, 5.7_

- [-] 15.2 Configure Lighthouse CI for the landing page
  - Add `lighthouserc.json` at the project root:
    - `performance.interactive` budget: <= 3000 ms on desktop
    - `accessibility` minimum score: 0.9
    - `categories.accessibility.minScore: 0.9` with `assertionFailureType: "warn"`
      elevated to build error
  - Add Lighthouse CI step to the build script that fails the build when
    accessibility score < 0.9
  - _Requirements: 5.3, 5.5, 5.6_

---

### 16. Frontend: Authentication Forms

- [x] 16.1 Build the registration page
  - Create `frontend/src/pages/SignUp.tsx` with `RegisterForm.tsx`:
    - Step 1: account type selection (merchant / developer) as radio cards
    - Step 2: full name, email, password with inline validation feedback
    - On success: show a banner prompting the user to check their email
  - Route: `/sign-up`
  - _Requirements: 1.1, 5.1_

- [x] 16.2 Build the login page
  - Create `frontend/src/pages/Login.tsx` with `LoginForm.tsx`:
    - Email and password fields
    - Inline error for invalid credentials (generic, not distinguishing email vs password)
    - Inline error for unverified email with a "Resend verification email" link
    - On success: store Access_Token in Zustand, redirect to `/dashboard`
  - Route: `/login`
  - _Requirements: 2.1, 2.2, 2.3_

- [x] 16.3 Build the email verification result page
  - Create `frontend/src/pages/VerifyEmail.tsx` that reads the `?token=` query param,
    calls `POST /auth/verify-email`, and shows success or error state with a
    resend option on failure
  - Route: `/verify-email`
  - _Requirements: 1.9, 1.10, 1.12_

- [x] 16.4 Build the password reset pages
  - `PasswordResetRequest.tsx` at `/forgot-password`: single email input; calls
    `POST /auth/password-reset/request`; always shows the same success message
    regardless of whether email exists
  - `PasswordResetConfirm.tsx` at `/reset-password?token=...`: new password + confirm
    password fields; calls `POST /auth/password-reset/confirm`; shows success or error
  - _Requirements: 3.1, 3.2, 3.3_

---

### 17. Frontend: Authenticated Dashboards

- [x] 17.1 Build the main authenticated dashboard shell
  - Create `frontend/src/pages/Dashboard.tsx` wrapped in `AppShell` and `ProtectedRoute`
  - `DashboardOverview.tsx`: shows user's account type, email verified status;
    renders `EmailVerificationBanner` for unverified accounts
  - Route: `/dashboard`
  - _Requirements: 1.8_

- [x] 17.2 Build the API key management panel
  - Create `frontend/src/pages/ApiKeys.tsx`:
    - `APIKeyPanel.tsx`: displays masked sk (`sk_test_****...wxyz`), full pk, mode badge
    - "Regenerate secret key" button with a confirmation modal before calling
      `POST /users/me/api-keys/regenerate-sk`; shows the new sk once in a dismissable
      modal with a "Copy" button
    - "Generate live keys" button visible only for verified developers
  - Route: `/dashboard/api-keys`
  - _Requirements: 9.2, 9.3, 9.4, 9.5, 9.6_

- [x] 17.3 Build the developer verification submission form
  - Create `frontend/src/pages/Verify.tsx` with `VerificationRequestForm.tsx`:
    - Fields: full legal name, country (select), business type, website URL,
      intended use (textarea with character counter 50/500)
    - Inline validation for all fields
    - Calls `POST /verification/requests`
    - On success: show `VerificationStatusCard.tsx` with pending status
    - `VerificationStatusCard` also used to show approved/rejected status with reason
  - Route: `/dashboard/verify`
  - _Requirements: 4.1, 4.7, 4.8, 4.9_

---

### 18. Frontend: Admin Panel

- [x] 18.1 Build the admin dashboard
  - Create `frontend/src/pages/admin/AdminDashboard.tsx` at `/admin`:
    - `AdminSummaryCards.tsx`: four metric cards (total users, pending verifications,
      verified developers, active merchants) fetched from `GET /admin/dashboard`
    - `AuditLogTable.tsx`: most recent 50 Audit_Log entries with actor ID, action type,
      target ID, timestamp, outcome; descending chronological order
    - Route guarded by `ProtectedRoute` checking role is `admin` or `superadmin`
  - _Requirements: 7.1, 7.10_

- [x] 18.2 Build the admin user management table
  - Create `frontend/src/pages/admin/UserManagement.tsx` at `/admin/users`:
    - `UserTable.tsx`: sortable, paginated table from `GET /admin/users`
    - Inline "Suspend" / "Reactivate" action buttons (superadmin only); calls
      respective endpoints with a confirmation modal
    - "Promote to Admin" action (superadmin only)
    - Show 403 error state when admin tries to act on a superadmin account
  - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.8, 7.9_

- [x] 18.3 Build the verification request queue
  - Create `frontend/src/pages/admin/VerificationQueue.tsx` at `/admin/verification`:
    - Paginated list from `GET /admin/verification-requests`, filterable by status
    - Click-through to detail view showing all submitted fields
    - "Approve" and "Reject" (with required reason textarea) action buttons
  - _Requirements: 7.6, 7.7_

---

### 19. Security Hardening and Property Tests for Security

- [x] 19.1 Verify HTTPS enforcement and security headers end-to-end
  - Write integration tests using `httpx.AsyncClient` verifying:
    - Any HTTP request to any endpoint returns 301 redirect to the HTTPS equivalent
      with the path and query string intact
    - Every response (200, 400, 401, 403, 404, 429, 500) includes all four required
      security headers
  - _Requirements: 10.1, 10.2, 10.3_

- [ ]* 19.2 Write property tests for HTTPS redirect and security headers
  - **Property 24: HTTPS Redirect Preserves Path and Query**
  - **Property 25: Security Headers Present on All Responses**
  - **Validates: Requirements 10.2, 10.3**

- [x] 19.3 Verify token entropy and uniqueness
  - Write a unit test generating 10,000 tokens via `generate_token()` and asserting
    all are unique and each is at least 64 hex characters long (256 bits entropy)
  - _Requirements: 10.5_

---

### 20. Integration Tests and Final Wiring

- [ ] 20.1 Write database integration tests
  - Create `tests/integration/test_db_models.py` verifying round-trip persistence for
    all seven models; verify that `AuditLog` rows survive a read-back with all fields
    intact and that the append-only guard raises on update and delete
  - _Requirements: 8.1, 8.3_

- [ ] 20.2 Write Celery task integration tests
  - Create `tests/integration/test_celery_tasks.py` using an in-memory Celery worker
    to test `send_email_task` retry logic (mock SMTP failures) and
    `write_audit_log_task` dead-letter behaviour (mock DB failures)
  - _Requirements: 4.5, 8.2_

- [ ] 20.3 Write Redis state integration tests
  - Create `tests/integration/test_redis_state.py` verifying login failure counter
    increment, block key TTL, blocklist JTI expiry, and rate-limit sliding window
  - _Requirements: 2.5, 2.6, 10.4_

- [ ] 20.4 Wire all routers and run end-to-end smoke test
  - Confirm all routers are included in `app/main.py`
  - Write a single `tests/integration/test_smoke.py` that:
    - Registers a developer, verifies the email, logs in, refreshes the token,
      logs out, and verifies the session is terminated
    - Runs the CLI bootstrap with valid credentials and verifies superadmin creation
  - _Requirements: 1.1, 2.1, 2.7, 2.9, 6.1_

---

### 21. Final Checkpoint

- [ ] 21. Final checkpoint - Full test suite passes
  - Ensure all unit tests, property tests (Properties 1-25, minimum 100 iterations each),
    integration tests, and smoke tests pass
  - Confirm Alembic migration applies cleanly on a fresh SQLite file
  - Confirm Lighthouse CI configuration is in place for the landing page
  - Ask the user if questions arise

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster initial build;
  all other tasks are required
- Each task references specific acceptance criteria from the requirements document
  for full traceability
- Property tests use **Hypothesis** with `@settings(max_examples=100)`; each test is
  tagged `Feature: platform-foundation, Property N: <property_text>`
- Unit tests anchor specific known-good and known-bad examples; property tests handle
  wide-input coverage
- SQLite is used in development; all models and queries must also be compatible with
  PostgreSQL (use SQLAlchemy-standard types only, no SQLite-specific syntax)
- No long dashes (`--`) in any source code
- No AI-generated boilerplate or assistant artifacts in any file

---

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "1.3", "1.4"] },
    { "id": 1, "tasks": ["1.5", "1.6", "1.7", "2.1"] },
    { "id": 2, "tasks": ["1.8", "2.2"] },
    { "id": 3, "tasks": ["2.3", "3.1", "12.1"] },
    { "id": 4, "tasks": ["3.2", "3.3"] },
    { "id": 5, "tasks": ["3.4", "4.1"] },
    { "id": 6, "tasks": ["4.2", "4.3"] },
    { "id": 7, "tasks": ["4.4", "4.5"] },
    { "id": 8, "tasks": ["4.6", "5.1"] },
    { "id": 9, "tasks": ["5.2", "5.3"] },
    { "id": 10, "tasks": ["5.4", "7.1"] },
    { "id": 11, "tasks": ["7.2", "9.1", "10.1", "11.1"] },
    { "id": 12, "tasks": ["7.3", "7.4", "9.2", "10.2", "11.2"] },
    { "id": 13, "tasks": ["7.5", "7.6", "8.1", "9.3", "10.3"] },
    { "id": 14, "tasks": ["7.3", "8.2", "9.4", "9.5", "10.4"] },
    { "id": 15, "tasks": ["8.3", "8.4", "9.6"] },
    { "id": 16, "tasks": ["14.1", "14.2", "14.3"] },
    { "id": 17, "tasks": ["15.1", "16.1", "16.2"] },
    { "id": 18, "tasks": ["15.2", "16.3", "16.4", "17.1"] },
    { "id": 19, "tasks": ["17.2", "17.3", "18.1"] },
    { "id": 20, "tasks": ["18.2", "18.3", "19.1"] },
    { "id": 21, "tasks": ["19.2", "19.3", "20.1"] },
    { "id": 22, "tasks": ["20.2", "20.3"] },
    { "id": 23, "tasks": ["20.4"] }
  ]
}
```
