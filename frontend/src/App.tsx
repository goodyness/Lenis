import { Route, Routes } from 'react-router-dom'
import { Landing } from './pages/Landing'
import { PublicLayout } from './layouts/PublicLayout'
import { HomePage } from './pages/public/HomePage'
import { AboutPage } from './pages/public/AboutPage'
import { PricingPage } from './pages/public/PricingPage'
import { TermsPage } from './pages/public/TermsPage'
import { PrivacyPage } from './pages/public/PrivacyPage'
import { ContactPage } from './pages/public/ContactPage'
import { SignUp } from './pages/auth/SignUp'
import { Login } from './pages/auth/Login'
import { VerifyEmail } from './pages/auth/VerifyEmail'
import { PasswordResetRequest } from './pages/auth/PasswordResetRequest'
import { PasswordResetConfirm } from './pages/auth/PasswordResetConfirm'
import { Dashboard } from './pages/dashboard/Dashboard'
import { ApiKeys } from './pages/dashboard/ApiKeys'
import { Verify } from './pages/dashboard/Verify'
import { Overview } from './pages/dashboard/Overview'
import { PaymentLinks } from './pages/dashboard/PaymentLinks'
import { CreatePaymentLink } from './pages/dashboard/CreatePaymentLink'
import { Invoices } from './pages/dashboard/Invoices'
import { CreateInvoice } from './pages/dashboard/CreateInvoice'
import { Wallets } from './pages/dashboard/Wallets'
import { Transactions } from './pages/dashboard/Transactions'
import { Reports } from './pages/dashboard/Reports'
import { Analytics } from './pages/dashboard/Analytics'
import { Team } from './pages/dashboard/Team'
import { PayersDirectory } from './pages/dashboard/PayersDirectory'
import { Settings } from './pages/dashboard/Settings'
import { CheckoutPage } from './pages/checkout/CheckoutPage'
import { ReceiptPage } from './pages/ReceiptPage'
import { AdminDashboard } from './pages/admin/AdminDashboard'
import { UserManagement } from './pages/admin/UserManagement'
import { VerificationQueue } from './pages/admin/VerificationQueue'
import { MerchantList } from './pages/admin/MerchantList'
import { MerchantDetail } from './pages/admin/MerchantDetail'
import { AdminPayersDirectory } from './pages/admin/AdminPayersDirectory'
import { AdminPayerDetail } from './pages/admin/AdminPayerDetail'
import { PlatformWallets } from './pages/admin/PlatformWallets'
import { MerchantPayerDetail } from './pages/dashboard/MerchantPayerDetail'
import { ProtectedRoute } from './components/routing/ProtectedRoute'
import { AdminRoute } from './routing/AdminRoute'
import { OnboardingWizard } from './pages/onboarding/OnboardingWizard'
import { DashboardLayout } from './components/layout/DashboardLayout'
import { SuspendedPage } from './pages/SuspendedPage'
import { AppealPage } from './pages/AppealPage'
// Developer documentation hub
import { DocsLayout } from './pages/docs/DocsLayout'
import { Introduction } from './pages/docs/getting-started/Introduction'
import { Quickstart } from './pages/docs/getting-started/Quickstart'
import { Authentication } from './pages/docs/getting-started/Authentication'
import { TestVsLive } from './pages/docs/getting-started/TestVsLive'
import { NonCustodialModel } from './pages/docs/core-concepts/NonCustodialModel'
import { PaymentLifecycle } from './pages/docs/core-concepts/PaymentLifecycle'
import { SupportedNetworks } from './pages/docs/core-concepts/SupportedNetworks'
import { IdempotencyKeys } from './pages/docs/core-concepts/IdempotencyKeys'
import { PaymentsDocs } from './pages/docs/api-reference/PaymentsDocs'
import { PaymentLinksDocs } from './pages/docs/api-reference/PaymentLinksDocs'
import { TransactionsDocs } from './pages/docs/api-reference/TransactionsDocs'
import { WebhooksDocs } from './pages/docs/api-reference/WebhooksDocs'
import { ApiKeysDocs } from './pages/docs/api-reference/ApiKeysDocs'
import { SetupGuide } from './pages/docs/webhooks/SetupGuide'
import { EventTypes } from './pages/docs/webhooks/EventTypes'
import { SignatureVerification } from './pages/docs/webhooks/SignatureVerification'
import { RetryLogic } from './pages/docs/webhooks/RetryLogic'
import { PythonSDKDocs } from './pages/docs/sdks/PythonSDKDocs'
import { TypeScriptSDKDocs } from './pages/docs/sdks/TypeScriptSDKDocs'
import { ECommerceIntegration } from './pages/docs/integration-guides/ECommerceIntegration'
import { CustomCheckout } from './pages/docs/integration-guides/CustomCheckout'
import { WebhookHandlerSetup } from './pages/docs/integration-guides/WebhookHandlerSetup'
import { ApiKeyBestPractices } from './pages/docs/security/ApiKeyBestPractices'
import { WebhookSigVerificationSecurity } from './pages/docs/security/WebhookSigVerificationSecurity'
import { IdempotencyKeyUsage } from './pages/docs/security/IdempotencyKeyUsage'
import { ErrorBoundary } from './components/errors/ErrorBoundary'
import {
  NotFoundPage,
  ForbiddenPage,
  ServerErrorPage,
  MaintenancePage,
  GenericErrorPage,
} from './pages/errors'

function App() {
  return (
    <ErrorBoundary>
      <Routes>
      {/* Public marketing pages â€” wrapped in shared nav + footer layout */}
      <Route element={<PublicLayout />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/about" element={<AboutPage />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="/contact" element={<ContactPage />} />
      </Route>

      {/* Legacy landing kept as fallback (no longer the index route) */}
      <Route path="/landing-legacy" element={<Landing />} />

      <Route path="/sign-up" element={<SignUp />} />
      <Route path="/login" element={<Login />} />
      <Route path="/verify-email" element={<VerifyEmail />} />
      <Route path="/forgot-password" element={<PasswordResetRequest />} />
      <Route path="/reset-password" element={<PasswordResetConfirm />} />
      <Route
        path="/onboarding"
        element={
          <ProtectedRoute requiredRole="merchant">
            <OnboardingWizard />
          </ProtectedRoute>
        }
      />

      {/* Merchant dashboard â€” nested layout routes */}
      <Route
        path="/dashboard"
        element={
          <ProtectedRoute requiredRole="merchant">
            <DashboardLayout />
          </ProtectedRoute>
        }
      >
        <Route index element={<Overview />} />
        <Route path="payment-links" element={<PaymentLinks />} />
        <Route path="payment-links/new" element={<CreatePaymentLink />} />
        <Route path="invoices" element={<Invoices />} />
        <Route path="invoices/new" element={<CreateInvoice />} />
        <Route path="wallets" element={<Wallets />} />
        <Route path="transactions" element={<Transactions />} />
        <Route path="reports" element={<Reports />} />
        <Route path="analytics" element={<Analytics />} />
        <Route path="team" element={<Team />} />
        <Route path="customers" element={<PayersDirectory />} />
        <Route path="customers/:email" element={<MerchantPayerDetail />} />
        <Route path="settings" element={<Settings />} />
        {/* Legacy routes retained for backwards compatibility */}
        <Route path="api-keys" element={<ApiKeys />} />
        <Route path="verify" element={<Verify />} />
      </Route>

      {/* Legacy flat dashboard route (kept as fallback) */}
      <Route path="/dashboard-old" element={<Dashboard />} />

      {/* Public receipt â€” no auth required */}
      <Route path="/receipt/:txHash" element={<ReceiptPage />} />

      {/* Public checkout â€” no auth required */}
      <Route path="/pay/:slug" element={<CheckoutPage />} />

      <Route
        path="/admin"
        element={
          <AdminRoute requiredRole="admin">
            <AdminDashboard />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/users"
        element={
          <AdminRoute requiredRole="admin">
            <UserManagement />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/platform-wallets"
        element={
          <AdminRoute requiredRole="admin">
            <PlatformWallets />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/verification"
        element={
          <AdminRoute requiredRole="admin">
            <VerificationQueue />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/payers"
        element={
          <AdminRoute requiredRole="admin">
            <AdminPayersDirectory />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/payers/:email"
        element={
          <AdminRoute requiredRole="admin">
            <AdminPayerDetail />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/merchants"
        element={
          <AdminRoute requiredRole="admin">
            <MerchantList />
          </AdminRoute>
        }
      />
      <Route
        path="/admin/merchants/:userId"
        element={
          <AdminRoute requiredRole="admin">
            <MerchantDetail />
          </AdminRoute>
        }
      />

      {/* Suspended account pages â€” accessible without active session */}
      <Route path="/suspended" element={<SuspendedPage />} />
      <Route path="/appeal" element={<AppealPage />} />

      {/* Developer documentation hub */}
      <Route path="/docs" element={<DocsLayout />}>
        <Route index element={<Introduction />} />
        <Route path="getting-started" element={<Introduction />} />
        <Route path="getting-started/quickstart" element={<Quickstart />} />
        <Route path="getting-started/authentication" element={<Authentication />} />
        <Route path="getting-started/test-vs-live" element={<TestVsLive />} />
        <Route path="core-concepts/non-custodial" element={<NonCustodialModel />} />
        <Route path="core-concepts/payment-lifecycle" element={<PaymentLifecycle />} />
        <Route path="core-concepts/supported-networks" element={<SupportedNetworks />} />
        <Route path="core-concepts/idempotency-keys" element={<IdempotencyKeys />} />
        <Route path="api-reference/payments" element={<PaymentsDocs />} />
        <Route path="api-reference/payment-links" element={<PaymentLinksDocs />} />
        <Route path="api-reference/transactions" element={<TransactionsDocs />} />
        <Route path="api-reference/webhooks" element={<WebhooksDocs />} />
        <Route path="api-reference/api-keys" element={<ApiKeysDocs />} />
        <Route path="webhooks/setup-guide" element={<SetupGuide />} />
        <Route path="webhooks/event-types" element={<EventTypes />} />
        <Route path="webhooks/signature-verification" element={<SignatureVerification />} />
        <Route path="webhooks/retry-logic" element={<RetryLogic />} />
        <Route path="sdks/python" element={<PythonSDKDocs />} />
        <Route path="sdks/typescript" element={<TypeScriptSDKDocs />} />
        <Route path="integration-guides/e-commerce" element={<ECommerceIntegration />} />
        <Route path="integration-guides/custom-checkout" element={<CustomCheckout />} />
        <Route path="integration-guides/webhook-handler" element={<WebhookHandlerSetup />} />
        <Route path="security/api-key-best-practices" element={<ApiKeyBestPractices />} />
        <Route path="security/webhook-signature" element={<WebhookSigVerificationSecurity />} />
        <Route path="security/idempotency-key-usage" element={<IdempotencyKeyUsage />} />
      </Route>

      {/* â”€â”€ Dedicated Error Pages â”€â”€ */}
      <Route path="/404" element={<NotFoundPage />} />
      <Route path="/403" element={<ForbiddenPage />} />
      <Route path="/500" element={<ServerErrorPage />} />
      <Route path="/503" element={<MaintenancePage />} />
      <Route path="/error" element={<GenericErrorPage />} />

      {/* â”€â”€ Catch-all 404 Route â”€â”€ */}
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  </ErrorBoundary>
  )
}

export default App
