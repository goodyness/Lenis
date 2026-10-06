# Requirements Document

## Introduction

The platform foundation is the foundational layer of a Web3 Financial Infrastructure SaaS (Lenis). It establishes the core identity, authentication, and administrative infrastructure required before any payment or escrow functionality can be built. The foundation covers user registration and authentication for merchants and developers, a developer verification process, a public-facing marketing site, a CLI-based superadmin creation mechanism, and a superadmin dashboard for platform governance. The entire system must project financial credibility through engineering-grade security and a professional, clean UI.

---

## Glossary

- **Platform**: The Lenis Web3 Financial Infrastructure SaaS application.
- **Merchant**: A business or individual that registers to accept crypto payments through the Platform.
- **Developer**: A technical user that registers to access the Platform API and build crypto payment integrations into external applications.
- **Superadmin**: A platform operator with full administrative privileges, created via CLI or environment variable bootstrap.
- **Admin**: A platform staff member with elevated privileges, created or promoted by a Superadmin.
- **Session**: An authenticated user context represented by a short-lived access token and a long-lived refresh token.
- **Access_Token**: A short-lived JWT issued on successful authentication, used to authorize API requests.
- **Refresh_Token**: A long-lived opaque token stored server-side, used to issue new Access_Tokens without re-authentication.
- **Verification_Request**: A developer's submission of identity and business information for KYC-like review.
- **Auth_Service**: The backend service responsible for registration, login, session management, and token lifecycle.
- **User_Service**: The backend service responsible for user profile management and role administration.
- **Verification_Service**: The backend service responsible for receiving, reviewing, and actioning Verification_Requests.
- **Admin_Service**: The backend service backing the superadmin dashboard.
- **CLI**: The command-line interface tool used to bootstrap a Superadmin account.
- **Landing_Page**: The public-facing marketing page at the root path of the Platform.
- **Dashboard**: The authenticated web interface used by Merchants, Developers, or Admins.
- **Rate_Limiter**: The middleware component that enforces request-per-window limits on specified endpoints.
- **Audit_Log**: An append-only record of significant platform events associated with a user or resource.

---

## Requirements

### Requirement 1: User Registration

**User Story:** As a Merchant or Developer, I want to create an account on the Platform, so that I can access payment and API features.

#### Acceptance Criteria

1. WHEN a registration request is received with a valid email, a password meeting complexity rules, a full name between 2 and 100 characters, and an account type of either "merchant" or "developer", THE Auth_Service SHALL create a new user record with a hashed password and return a 201 response containing the user's ID and email.
2. WHEN a registration request is received with an email that already exists in the database, THE Auth_Service SHALL return a 409 response with an error indicating the email is already registered.
3. WHEN a registration request is received with a password shorter than 8 characters, THE Auth_Service SHALL return a 400 response with a descriptive validation error.
4. WHEN a registration request is received with a password that does not contain at least one uppercase letter, one lowercase letter, and one digit, THE Auth_Service SHALL return a 400 response with a descriptive validation error.
5. WHEN a registration request is received with a missing or malformed email address, THE Auth_Service SHALL return a 400 response with a descriptive validation error.
6. WHEN a registration request is received with an account type other than "merchant" or "developer", THE Auth_Service SHALL return a 400 response with a descriptive validation error indicating the account type is invalid.
7. THE Auth_Service SHALL store passwords using bcrypt with a minimum cost factor of 12.
8. WHEN a new user record is created, THE Auth_Service SHALL assign the user an unverified status and send a verification email containing a confirmation token that expires after 24 hours.
9. WHEN a confirmation token is submitted and is valid, unexpired, and has not been previously used, THE Auth_Service SHALL mark the user's email as verified, invalidate the token to prevent reuse, and return a 200 response.
10. WHEN a confirmation token is submitted and has expired, THE Auth_Service SHALL return a 400 response with an error indicating the token has expired.
11. WHEN a confirmation token resend is requested for an unverified email, THE Auth_Service SHALL invalidate any previously issued unexpired token for that email and send a new verification email containing a confirmation token that expires after 24 hours.
12. WHEN a confirmation token resend is requested for an already-verified email, THE Auth_Service SHALL return a 400 response indicating the email is already verified.

---

### Requirement 2: User Authentication and Session Management

**User Story:** As a registered user, I want to log in securely and maintain my session, so that I can access the Platform without re-authenticating on every request.

#### Acceptance Criteria

1. WHEN a login request is received with a verified email and correct password, THE Auth_Service SHALL return a 200 response containing a short-lived Access_Token with a 15-minute expiry and a long-lived Refresh_Token with a 7-day expiry.
2. WHEN a login request is received with an unverified email, THE Auth_Service SHALL return a 403 response indicating email verification is required.
3. WHEN a login request is received with an incorrect password, THE Auth_Service SHALL return a 401 response without specifying whether the email or password was wrong.
4. WHEN a login request is received with an email that does not exist, THE Auth_Service SHALL return a 401 response without specifying whether the email or password was wrong.
5. WHEN 5 consecutive failed login attempts are made from the same IP address within a 10-minute window, THE Rate_Limiter SHALL block further login attempts from that IP for 15 minutes and return a 429 response.
6. WHEN a successful login or token refresh occurs from an IP address, THE Rate_Limiter SHALL reset the failed login attempt counter for that IP address to zero.
7. WHEN a token refresh request is received with a valid, unexpired Refresh_Token, THE Auth_Service SHALL revoke the presented Refresh_Token, issue a new Refresh_Token with a 7-day expiry and a new Access_Token with a 15-minute expiry, and return a 200 response containing both tokens.
8. WHEN a token refresh request is received with an expired or revoked Refresh_Token, THE Auth_Service SHALL return a 401 response.
9. WHEN a logout request is received with a valid Access_Token, THE Auth_Service SHALL revoke the associated Refresh_Token, add the Access_Token to a blocklist for the remainder of its validity period, and return a 200 response.
10. THE Auth_Service SHALL sign all Access_Tokens with a private key using the RS256 algorithm.
11. WHEN a protected API endpoint receives a request with an Access_Token whose associated user account has a suspended status, THE Auth_Service SHALL return a 403 response indicating the account is suspended.

---

### Requirement 3: Password Reset

**User Story:** As a registered user, I want to reset my password if I forget it, so that I can regain access to my account.

#### Acceptance Criteria

1. WHEN a password reset request is submitted with a registered email, THE Auth_Service SHALL send a password reset email containing a time-limited reset token valid for 30 minutes and return a 200 response.
2. WHEN a password reset request is submitted with an email that does not exist in the database, THE Auth_Service SHALL return a 200 response without revealing whether the email is registered.
3. WHEN a password reset is submitted with a valid reset token and a new password that is at least 8 characters long and contains at least one uppercase letter, one lowercase letter, one digit, and one special character, and is no longer than 128 characters, THE Auth_Service SHALL update the password hash, revoke all existing Refresh_Tokens and Access_Tokens for the user, and return a 200 response.
4. IF a password reset is submitted with an expired reset token, THEN THE Auth_Service SHALL return a 400 response indicating the token has expired.
5. IF a password reset is submitted with a reset token that has already been used, THEN THE Auth_Service SHALL return a 400 response indicating the token is no longer valid.
6. IF a password reset is submitted with a reset token that is not found in the system, THEN THE Auth_Service SHALL return a 400 response indicating the token is invalid.

---

### Requirement 4: Developer Verification Process

**User Story:** As a Developer, I want to submit my identity and business information for verification, so that I can be fully activated to access production API credentials.

#### Acceptance Criteria

1. WHEN a Developer submits a Verification_Request containing a full legal name between 1 and 200 characters, country, business type, website URL, and intended use description, THE Verification_Service SHALL create a Verification_Request record with a status of pending and return a 201 response.
2. WHILE a Developer's Verification_Request status is pending, THE Verification_Service SHALL restrict the Developer's account to test-mode API access only.
3. WHEN a Developer submits a Verification_Request and an existing pending or approved Verification_Request already exists for that account, THE Verification_Service SHALL return a 409 response.
4. WHEN a Superadmin or Admin approves a Verification_Request, THE Verification_Service SHALL update the Developer's account status to verified, grant production API access, and create an Audit_Log entry recording the approving admin's ID, the developer's ID, the action type, and a UTC timestamp.
5. WHEN a Superadmin or Admin rejects a Verification_Request, THE Verification_Service SHALL update the Verification_Request status to rejected, store the rejection reason, send a notification email to the Developer within 5 minutes of the rejection event, and create an Audit_Log entry recording the rejecting admin's ID, the developer's ID, the action type, and a UTC timestamp.
6. WHEN a Verification_Request is rejected, THE Verification_Service SHALL allow the Developer to submit a new Verification_Request after 24 hours have elapsed from the UTC timestamp of the rejection event.
7. IF the website URL field in a Verification_Request does not begin with "http://" or "https://", THEN THE Verification_Service SHALL return a 400 response with an error indicating the URL must include a valid scheme.
8. IF the intended use description field contains fewer than 50 characters or more than 500 characters, THEN THE Verification_Service SHALL return a 400 response with a descriptive validation error.
9. IF any required field (full legal name, country, business type, website URL, or intended use description) is missing or empty, THEN THE Verification_Service SHALL return a 400 response identifying the offending field.

---

### Requirement 5: Public Landing Page

**User Story:** As a potential customer, I want to view a professional marketing page, so that I can understand the Platform's value proposition and sign up.

#### Acceptance Criteria

1. WHEN a user navigates to the root path ("/"), THE Landing_Page SHALL render the Platform name, a headline describing the non-custodial crypto payment infrastructure proposition, a primary call-to-action button linking to the registration page, and navigation links to the sign-up and log-in pages.
2. THE Landing_Page SHALL include a features section containing exactly three subsections: Payment Gateway, Developer API, and Escrow System, each with a title and at least one descriptive sentence.
3. THE Landing_Page SHALL reach time-to-interactive in 3 seconds or less on a connection with a minimum download speed of 25 Mbps, as measured by Lighthouse in desktop mode.
4. THE Landing_Page SHALL render all content without horizontal scrolling at every integer viewport width from 320px to 2560px inclusive.
5. THE Landing_Page SHALL achieve a Lighthouse accessibility score of 90 or above when audited in Lighthouse desktop mode against the current stable version of Chrome.
6. IF the Landing_Page Lighthouse accessibility score falls below 90, THEN THE Platform SHALL prevent deployment of that build and display a build error indicating the accessibility threshold was not met.
7. THE Platform SHALL serve the Landing_Page via server-side rendering or static generation so that the full HTML content of the page is present in the initial HTTP response without requiring client-side JavaScript execution.

---

### Requirement 6: Superadmin Bootstrap

**User Story:** As a platform operator, I want to create the first Superadmin account via CLI or environment variable, so that I can access the admin panel immediately after deployment without a manual database step.

#### Acceptance Criteria

1. WHEN the CLI bootstrap command is executed with an email matching the format `local-part@domain.tld` and a password that is at least 8 characters long and contains at least one uppercase letter, one lowercase letter, one digit, and one special character, THE CLI SHALL create a user record with the superadmin role, output the created email address to stdout, and exit with code 0.
2. WHEN the CLI bootstrap command is executed and a Superadmin account already exists, THE CLI SHALL print a warning to stdout and exit with code 0 without creating a duplicate.
3. IF the CLI bootstrap command is executed with a password that does not meet complexity requirements (minimum 8 characters, at least one uppercase letter, one lowercase letter, one digit, and one special character), THEN THE CLI SHALL print an error message to stderr listing each unmet requirement and exit with code 1.
4. IF the CLI bootstrap command is executed with an email that does not match the format `local-part@domain.tld`, THEN THE CLI SHALL print an error message to stderr indicating the email is invalid and exit with code 1.
5. WHEN the Platform application starts and the ADMIN_EMAIL and ADMIN_PASSWORD environment variables are both set and no Superadmin account exists, THE Auth_Service SHALL automatically create a Superadmin account using those credentials and write a startup log entry recording the creation event.
6. WHEN the Platform application starts and the ADMIN_EMAIL and ADMIN_PASSWORD environment variables are set and a Superadmin account already exists, THE Auth_Service SHALL skip creation and write a startup log entry indicating the account already exists.
7. THE CLI SHALL hash the Superadmin password using the same bcrypt cost factor as regular user registration.
8. IF the Platform application starts and the ADMIN_PASSWORD environment variable is set and the password does not meet complexity requirements (minimum 8 characters, at least one uppercase letter, one lowercase letter, one digit, and one special character), THEN THE Auth_Service SHALL refuse to start and write an error to stderr indicating which complexity requirements are not met.
9. IF the Platform application starts and the ADMIN_EMAIL environment variable is set and the value does not match the format `local-part@domain.tld`, THEN THE Auth_Service SHALL refuse to start and write an error to stderr indicating the email format is invalid.

---

### Requirement 7: Superadmin Dashboard

**User Story:** As a Superadmin or Admin, I want a web-based dashboard to manage users and developer verification requests, so that I can operate the platform without direct database access.

#### Acceptance Criteria

1. WHEN a Superadmin or Admin authenticates and navigates to the admin dashboard, THE Dashboard SHALL display summary counts of total users, pending Verification_Requests, verified developers, and active merchants.
2. THE Admin_Service SHALL provide a paginated API endpoint returning a list of all users including their ID, email, role, account status, and registration date, with a default page size of 20 records and a maximum page size of 100 records.
3. WHEN a Superadmin submits a request to suspend a user account, THE Admin_Service SHALL update the account status to suspended, revoke all active Refresh_Tokens for that user, and create an Audit_Log entry recording the acting Superadmin's ID, the target user's ID, and a timestamp.
4. WHEN a Superadmin submits a request to reactivate a suspended user account, THE Admin_Service SHALL update the account status to active and create an Audit_Log entry recording the acting Superadmin's ID, the target user's ID, and a timestamp.
5. WHEN an Admin submits a request to suspend or reactivate a Superadmin account, THE Admin_Service SHALL return a 403 response indicating insufficient privileges without modifying the target account's status.
6. THE Admin_Service SHALL provide a paginated API endpoint returning all Verification_Requests filterable by status (pending, approved, rejected) with a default page size of 20 records and a maximum page size of 100 records.
7. WHEN a Superadmin or Admin views a Verification_Request detail, THE Admin_Service SHALL return the Developer's submitted information including full name, country, business type, website URL, and intended use description.
8. WHEN a Superadmin submits a request to promote a user to Admin role, THE Admin_Service SHALL update the user's role to Admin, create an Audit_Log entry recording the promoting Superadmin's ID and the target user's ID, and return a 200 response.
9. IF a non-Superadmin account submits a request to promote a user to Admin role, THEN THE Admin_Service SHALL return a 403 response indicating insufficient privileges without modifying the target user's role.
10. THE Dashboard SHALL display an activity log showing the 50 most recent Audit_Log entries with actor ID, action type, target ID, and timestamp, sorted in descending chronological order.
11. WHILE a user session does not have the superadmin or admin role, THE Dashboard SHALL return a 403 response for all admin API endpoints.

---

### Requirement 8: Audit Logging

**User Story:** As a Superadmin, I want all significant administrative actions to be logged with actor and timestamp, so that I have an auditable record for compliance and incident review.

#### Acceptance Criteria

1. THE Audit_Log SHALL record the following fields for every entry: event type, actor user ID, target resource type, target resource ID, a UTC timestamp accurate to the millisecond, a client IP address of up to 45 characters, and an outcome status indicating success or failure.
2. WHEN an Audit_Log entry is created, THE Admin_Service SHALL write the entry to the database within 5 milliseconds without blocking the originating request, and IF the write fails, THEN THE Admin_Service SHALL retry up to 3 times before recording the failure in a dead-letter store without discarding the entry.
3. THE Audit_Log SHALL be append-only; no entry SHALL be deleted or modified after creation, and IF a delete or update operation is attempted on any Audit_Log entry, THEN THE Admin_Service SHALL reject the operation with an error indicating the operation is not permitted.
4. THE Admin_Service SHALL provide an API endpoint to retrieve Audit_Log entries filterable by actor user ID, event type, and UTC date range, returning results in descending UTC timestamp order with a default page size of 50 records and a maximum page size of 200 records.
5. WHEN an administrative action is performed by a Superadmin, THE Admin_Service SHALL create an Audit_Log entry capturing that action before returning the response to the caller.

---

### Requirement 9: API Key Issuance (Foundation)

**User Story:** As a Developer, I want test-mode API keys issued automatically on account creation, so that I can begin integrating immediately after registering.

#### Acceptance Criteria

1. WHEN a Developer account is created and the email is verified, THE Auth_Service SHALL automatically generate a test-mode publishable key with the prefix `pk_test_` followed by 32 alphanumeric characters and a test-mode secret key with the prefix `sk_test_` followed by 32 alphanumeric characters, and associate both keys with the Developer's organization.
2. WHEN a Developer account is created and the email is verified, THE Auth_Service SHALL store the secret key as a one-way hash and return the plaintext secret key exactly once in the creation response; subsequent requests for the secret key SHALL NOT return the plaintext value.
3. WHEN a Developer requests to view their API keys, THE User_Service SHALL return the publishable key in plaintext and the secret key as a masked value displaying only the last 4 characters of the original plaintext key, with all preceding characters replaced by a masking character.
4. WHEN a Developer requests to regenerate their test secret key, THE User_Service SHALL immediately invalidate the existing secret key, generate a new secret key with the prefix `sk_test_` followed by 32 alphanumeric characters, store its one-way hash, and return the new plaintext secret key exactly once in the response; the old key SHALL be rejected for authentication immediately upon regeneration.
5. WHEN a Developer whose account status is verified requests to generate live-mode API keys, THE User_Service SHALL generate a live-mode publishable key with the prefix `pk_live_` followed by 32 alphanumeric characters and a live-mode secret key with the prefix `sk_live_` followed by 32 alphanumeric characters, and associate both keys with the Developer's organization.
6. IF a Developer attempts to generate live-mode API keys before their account status is verified, THEN THE User_Service SHALL reject the request with an error response indicating that account verification is required, without generating or storing any keys.

---

### Requirement 10: Session and Security Hardening

**User Story:** As a platform operator, I want the authentication layer to enforce security best practices, so that user accounts and platform data are protected from common attacks.

#### Acceptance Criteria

1. THE Auth_Service SHALL enforce HTTPS on all endpoints.
2. IF a request is received over HTTP, THEN THE Auth_Service SHALL redirect the request to the equivalent HTTPS URL, preserving the original path and query string, with a redirect response.
3. THE Auth_Service SHALL include the following HTTP security headers on all responses: Strict-Transport-Security, X-Content-Type-Options, X-Frame-Options, and Content-Security-Policy.
4. WHEN a registration or login request is received, THE Rate_Limiter SHALL allow a maximum of 10 requests per IP address per minute per endpoint; requests exceeding this limit SHALL receive a 429 response.
5. THE Auth_Service SHALL generate all tokens as values of at least 128 bits of entropy, such that no two tokens issued by the system are identical.
6. WHEN an Access_Token is validated, THE Auth_Service SHALL verify the token signature, expiry, issuer, and audience claims before granting access.
7. WHEN a login attempt succeeds or fails, THE Auth_Service SHALL record an entry in the Audit_Log containing the client IP address, user agent, timestamp, and outcome of the attempt.
