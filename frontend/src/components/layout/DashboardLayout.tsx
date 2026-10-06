import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { apiClient } from '../../lib/api'
import { useAuthStore } from '../../lib/auth-store'
import { useOnboardingStore } from '../../stores/onboardingStore'
import { MerchantSetupModal } from '../dashboard/MerchantSetupModal'
import { VerificationBanner } from '../dashboard/VerificationBanner'
import { SandboxBanner } from '../dashboard/SandboxBanner'
import { EnvironmentToggle } from '../ui/EnvironmentToggle'
import { NotificationBell } from '../notifications/NotificationBell'

interface SubscriptionOverview {
  tier: string
  tier_name: string
  monthly_tx_count: number
  monthly_tx_cap: number
  period?: string | null
  expires_at?: string | null
  features: string[]
  is_active: boolean
}

interface NavItem {
  label: string
  to: string
  icon: React.ReactNode
  end?: boolean
}

const OverviewIcon = () => (
  <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path d="M5 3a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2V5a2 2 0 00-2-2H5zM5 11a2 2 0 00-2 2v2a2 2 0 002 2h2a2 2 0 002-2v-2a2 2 0 00-2-2H5zM11 5a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V5zM11 13a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
  </svg>
)

const PaymentLinksIcon = () => (
  <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path
      fillRule="evenodd"
      d="M12.586 4.586a2 2 0 112.828 2.828l-3 3a2 2 0 01-2.828 0 1 1 0 00-1.414 1.414 4 4 0 005.656 0l3-3a4 4 0 00-5.656-5.656l-1.5 1.5a1 1 0 101.414 1.414l1.5-1.5zm-5 5a2 2 0 012.828 0 1 1 0 101.414-1.414 4 4 0 00-5.656 0l-3 3a4 4 0 105.656 5.656l1.5-1.5a1 1 0 10-1.414-1.414l-1.5 1.5a2 2 0 11-2.828-2.828l3-3z"
      clipRule="evenodd"
    />
  </svg>
)

const InvoicesIcon = () => (
  <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path
      fillRule="evenodd"
      d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm2 6a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm1 3a1 1 0 100 2h6a1 1 0 100-2H7z"
      clipRule="evenodd"
    />
  </svg>
)

const TransactionsIcon = () => (
  <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path d="M8 5a1 1 0 100 2h5.586l-1.293 1.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L13.586 5H8zM12 15a1 1 0 100-2H6.414l1.293-1.293a1 1 0 10-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L6.414 15H12z" />
  </svg>
)

const WalletsIcon = () => (
  <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path d="M4 4a2 2 0 00-2 2v1h16V6a2 2 0 00-2-2H4z" />
    <path
      fillRule="evenodd"
      d="M18 9H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM4 13a1 1 0 011-1h1a1 1 0 110 2H5a1 1 0 01-1-1zm5-1a1 1 0 100 2h1a1 1 0 100-2H9z"
      clipRule="evenodd"
    />
  </svg>
)

const SettingsIcon = () => (
  <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path
      fillRule="evenodd"
      d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z"
      clipRule="evenodd"
    />
  </svg>
)

const LogoutIcon = () => (
  <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path
      fillRule="evenodd"
      d="M3 3a1 1 0 00-1 1v12a1 1 0 102 0V4a1 1 0 00-1-1zm10.293 9.293a1 1 0 001.414 1.414l3-3a1 1 0 000-1.414l-3-3a1 1 0 10-1.414 1.414L14.586 9H7a1 1 0 100 2h7.586l-1.293 1.293z"
      clipRule="evenodd"
    />
  </svg>
)

const CustomersIcon = () => (
  <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
  </svg>
)

const ReportsIcon = () => (
  <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
  </svg>
)

const CodeIcon = () => (
  <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path
      fillRule="evenodd"
      d="M12.316 3.051a1 1 0 01.633 1.265l-4 12a1 1 0 11-1.898-.632l4-12a1 1 0 011.265-.633zM5.707 6.293a1 1 0 010 1.414L3.414 10l2.293 2.293a1 1 0 11-1.414 1.414l-3-3a1 1 0 010-1.414l3-3a1 1 0 011.414 0zm8.586 0a1 1 0 011.414 0l3 3a1 1 0 010 1.414l-3 3a1 1 0 11-1.414-1.414L16.586 10l-2.293-2.293a1 1 0 010-1.414z"
      clipRule="evenodd"
    />
  </svg>
)

const AnalyticsIcon = () => (
  <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path d="M2 10a8 8 0 018-8v8h8a8 8 0 11-16 0z" />
    <path d="M12 2.252A8.014 8.014 0 0117.748 8H12V2.252z" />
  </svg>
)

const TeamIcon = () => (
  <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
  </svg>
)

const navItems: NavItem[] = [
  { label: 'Overview', to: '/dashboard', icon: <OverviewIcon />, end: true },
  { label: 'Payment Links', to: '/dashboard/payment-links', icon: <PaymentLinksIcon /> },
  { label: 'Invoices', to: '/dashboard/invoices', icon: <InvoicesIcon /> },
  { label: 'Transactions', to: '/dashboard/transactions', icon: <TransactionsIcon /> },
  { label: 'Reports & Analytics', to: '/dashboard/reports', icon: <ReportsIcon /> },
  { label: 'Analytics', to: '/dashboard/analytics', icon: <AnalyticsIcon /> },
  { label: 'Team', to: '/dashboard/team', icon: <TeamIcon /> },
  { label: 'Customers', to: '/dashboard/customers', icon: <CustomersIcon /> },
  { label: 'Wallets', to: '/dashboard/wallets', icon: <WalletsIcon /> },
  { label: 'API Keys', to: '/dashboard/api-keys', icon: <CodeIcon /> },
  { label: 'Settings', to: '/dashboard/settings', icon: <SettingsIcon /> },
]

export function DashboardLayout() {
  const navigate = useNavigate()

  const { user, clearAuth } = useAuthStore()

  const fetchStatus = useOnboardingStore((s) => s.fetchStatus)
  const onboardingStatus = useOnboardingStore((s) => s.status)

  const [showSetupModal, setShowSetupModal] = useState(false)
  // Track whether we have shown the modal during this mount cycle so we
  // don't re-show it if the user dismisses it and the status re-fetches.
  const modalShownRef = useRef(false)

  const [subscription, setSubscription] = useState<SubscriptionOverview | null>(null)

  useEffect(() => {
    if (user?.account_type === 'merchant') {
      apiClient
        .get<SubscriptionOverview>('/users/me/subscription')
        .then((res) => {
          if (res.data) setSubscription(res.data)
        })
        .catch(() => {
          // Silently ignore if unauthenticated or network error
        })
    }
  }, [user])

  // Fetch onboarding status on mount and decide whether to show the setup modal.
  useEffect(() => {
    fetchStatus()
      .then(() => {
        // fetchStatus updates the store; the effect below will pick up the change.
      })
      .catch(() => {
        // Non-fatal â€” if the backend is unreachable the modal just won't show.
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // React to onboardingStatus changes (persisted value on first render, then
  // fresh value after fetchStatus resolves).
  useEffect(() => {
    if (!onboardingStatus) return
    if (modalShownRef.current) return   // already shown once this mount

    // Show if setup is incomplete OR KYC has not been started at all
    const needsSetup =
      !onboardingStatus.onboarding_complete ||
      onboardingStatus.kyc_status === 'not_started'

    if (needsSetup) {
      setShowSetupModal(true)
      modalShownRef.current = true
    }
  }, [onboardingStatus])

  function handleDismissModal() {
    setShowSetupModal(false)
  }

  function handleLogout() {
    clearAuth()
    navigate('/login')
  }

  // Determine if we should show the verification banner.
  // Show whenever KYC is not approved so the merchant has an option to verify.
  const showBanner =
    onboardingStatus !== null &&
    onboardingStatus.kyc_status !== 'approved'

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50">
      {/* Sidebar */}
      <aside className="flex w-60 shrink-0 flex-col border-r border-slate-200 bg-white">
        {/* Brand */}
        <div className="flex h-16 items-center border-b border-slate-200 px-6">
          <Link
            to="/dashboard"
            className="text-lg font-bold tracking-tight text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400"
          >
            Lenis
          </Link>
        </div>

        {/* Nav */}
        <nav aria-label="Main navigation" className="flex-1 overflow-y-auto px-3 py-4">
          <ul className="flex flex-col gap-0.5" role="list">
            {navItems.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    [
                      'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                      'focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1',
                      isActive
                        ? 'bg-slate-100 text-slate-900'
                        : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900',
                    ].join(' ')
                  }
                >
                  {item.icon}
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        {/* Subscription Plan Management */}
        {user?.account_type === 'merchant' && (
          <div className="px-3 pb-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50/90 p-3 shadow-2xs">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Plan
                </span>
                <span className="inline-flex items-center rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-white">
                  {subscription?.tier || 'Free'}
                </span>
              </div>
              <div className="mt-2 flex items-center justify-between text-xs text-slate-600">
                <span className="text-[11px]">Monthly Usage</span>
                <span className="font-semibold text-slate-900 text-[11px]">
                  {subscription?.monthly_tx_cap && subscription.monthly_tx_cap > 0
                    ? `${subscription.monthly_tx_count} / ${subscription.monthly_tx_cap} txs`
                    : 'Unlimited'}
                </span>
              </div>
              {subscription?.monthly_tx_cap !== undefined && subscription.monthly_tx_cap > 0 && (
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-full bg-slate-900 transition-all"
                    style={{
                      width: `${Math.min(
                        100,
                        Math.round(
                          (subscription.monthly_tx_count / subscription.monthly_tx_cap) * 100
                        )
                      )}%`,
                    }}
                  />
                </div>
              )}
              <button
                type="button"
                onClick={() => navigate('/dashboard/settings?tab=billing')}
                className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-lg bg-slate-900 py-1.5 text-xs font-semibold text-white shadow-xs transition-colors hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-1"
              >
                <span>âš¡</span>
                <span>{subscription?.tier === 'enterprise' ? 'Manage Plan' : 'Upgrade Plan'}</span>
              </button>
            </div>
          </div>
        )}

        {/* User footer */}
        {user && (
          <div className="border-t border-slate-200 px-4 py-3">
            <p className="truncate text-xs font-medium text-slate-700">{user.email}</p>
            <p className="text-xs text-slate-400 capitalize">{user.account_type}</p>
          </div>
        )}
      </aside>

      {/* Main */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Top header */}
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-6">
          <div className="flex items-center gap-4">
            <span className="text-sm font-bold text-slate-800 hidden sm:inline">Merchant Dashboard</span>
            <EnvironmentToggle />
          </div>
          <div className="flex items-center gap-4">
            <NotificationBell />
            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-sm text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1"
            >
              <LogoutIcon />
              Log out
            </button>
          </div>
        </header>

        {/* Page content via React Router Outlet */}
        <main className="flex-1 overflow-y-auto p-6">
          <SandboxBanner />
          {/* Verification banner â€” shown when KYC is pending or rejected */}
          {showBanner && onboardingStatus && (
            <div className="mb-6">
              <VerificationBanner status={onboardingStatus} />
            </div>
          )}
          <Outlet />
        </main>
      </div>

      {/* Setup modal â€” shown once per session when setup is incomplete */}
      {showSetupModal && onboardingStatus && (
        <MerchantSetupModal
          status={onboardingStatus}
          onDismiss={handleDismissModal}
        />
      )}
    </div>
  )
}


