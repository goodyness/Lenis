import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMerchantStore, TIER_LIMITS, type RecentTransaction } from '../../stores/merchantStore'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'

// ─── Status badge helpers ─────────────────────────────────────────────────────

type PaymentStatus = RecentTransaction['status']
type BadgeVariant = 'default' | 'blue' | 'green' | 'yellow' | 'red' | 'purple'

const statusVariant: Record<PaymentStatus, BadgeVariant> = {
  confirmed: 'green',
  paid: 'green',
  pending: 'yellow',
  detected: 'blue',
  confirming: 'blue',
}

const statusLabel: Record<PaymentStatus, string> = {
  confirmed: 'Confirmed',
  paid: 'Paid',
  pending: 'Pending',
  detected: 'Detected',
  confirming: 'Confirming',
}

const networkColors: Record<string, string> = {
  ethereum: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  base: 'bg-blue-50 text-blue-700 border-blue-200',
  polygon: 'bg-purple-50 text-purple-700 border-purple-200',
  arbitrum: 'bg-sky-50 text-sky-700 border-sky-200',
  bsc: 'bg-amber-50 text-amber-700 border-amber-200',
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function formatAmount(amount: string | number | undefined | null): string {
  if (amount === undefined || amount === null) return '0.00'
  const n = typeof amount === 'number' ? amount : parseFloat(amount)
  return isNaN(n) ? '0.00' : n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDisplayTimestamp(val?: string | null): string {
  if (!val) return '—'
  try {
    const d = new Date(val)
    if (isNaN(d.getTime())) return '—'
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return '—'
  }
}

function formatRelativeTime(val?: string | null): string {
  if (!val) return ''
  try {
    const d = new Date(val)
    if (isNaN(d.getTime())) return ''
    const now = new Date()
    const diffSec = Math.floor((now.getTime() - d.getTime()) / 1000)
    if (diffSec < 60) return 'Just now'
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`
    return `${Math.floor(diffSec / 86400)}d ago`
  } catch {
    return ''
  }
}

function truncateHash(hash?: string | null): string {
  if (!hash) return ''
  if (hash.length <= 14) return hash
  return `${hash.slice(0, 6)}…${hash.slice(-4)}`
}

// ─── Loading Skeleton ────────────────────────────────────────────────────────

function OverviewSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading dashboard overview">
      {/* Header Skeleton */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="space-y-2">
          <div className="h-7 w-48 animate-pulse rounded-lg bg-slate-200" />
          <div className="h-4 w-72 animate-pulse rounded-lg bg-slate-100" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-32 animate-pulse rounded-lg bg-slate-200" />
          <div className="h-9 w-36 animate-pulse rounded-lg bg-slate-200" />
        </div>
      </div>

      {/* KPI Cards Skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="h-32 animate-pulse rounded-2xl border border-slate-100 bg-white p-5 shadow-xs" />
        ))}
      </div>

      {/* Charts Grid Skeleton */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 h-72 animate-pulse rounded-2xl bg-white border border-slate-100 shadow-xs" />
        <div className="h-72 animate-pulse rounded-2xl bg-white border border-slate-100 shadow-xs" />
      </div>

      {/* Table Skeleton */}
      <div className="h-64 animate-pulse rounded-2xl bg-white border border-slate-100 shadow-xs" />
    </div>
  )
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function Overview() {
  const navigate = useNavigate()
  const fetchOverview = useMerchantStore((s) => s.fetchOverview)
  const fetchSubscription = useMerchantStore((s) => s.fetchSubscription)
  const overview = useMerchantStore((s) => s.overview)
  const subscription = useMerchantStore((s) => s.subscription)

  const [loading, setLoading] = useState(overview === null)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hoveredPoint, setHoveredPoint] = useState<{ date: string; volume: number; count: number } | null>(null)
  const [copiedHash, setCopiedHash] = useState<string | null>(null)

  async function loadData(isRefresh = false) {
    if (isRefresh) setRefreshing(true)
    else setLoading(true)
    setError(null)
    try {
      await fetchOverview()
      // Fetch subscription in parallel; don't block the main view if it fails
      fetchSubscription().catch(() => undefined)
    } catch {
      setError('Failed to load dashboard overview. Please check your connection and try again.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function copyToClipboard(text: string) {
    navigator.clipboard.writeText(text)
    setCopiedHash(text)
    setTimeout(() => setCopiedHash(null), 2000)
  }

  if (loading) {
    return <OverviewSkeleton />
  }

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center space-y-4">
        <div className="flex justify-center text-3xl">⚠️</div>
        <h2 className="text-lg font-bold text-red-900">Dashboard Unavailable</h2>
        <p className="text-xs text-red-700 max-w-md mx-auto">{error}</p>
        <Button variant="secondary" size="sm" onClick={() => loadData()}>
          Try Again
        </Button>
      </div>
    )
  }

  const transactions = overview?.recent_transactions ?? []
  const lifetimeTotal = overview ? formatAmount(overview.lifetime_total) : '0.00'
  const volume30d = overview?.volume_30d ? formatAmount(overview.volume_30d) : '0.00'
  const pendingCount = overview?.pending_count ?? 0
  const confirmedCount = overview?.confirmed_count ?? 0
  const totalTransactions = overview?.total_transactions ?? 0
  const successRate = overview?.success_rate ?? (totalTransactions > 0 ? Math.round((confirmedCount / totalTransactions) * 100) : 100)
  const activeLinks = overview?.active_links_count ?? 0
  const openInvoices = overview?.open_invoices_count ?? 0

  // Subscription / tier usage helpers
  const tier = subscription?.tier ?? 'free'
  const tierLimit = TIER_LIMITS[tier] ?? 50
  const monthlyCount = subscription?.monthly_tx_count ?? 0
  const tierLimitDisplay = tierLimit === null ? 'Unlimited' : String(tierLimit)
  const usagePct = tierLimit !== null && tierLimit > 0 ? Math.min(100, Math.round((monthlyCount / tierLimit) * 100)) : 0
  const usageBarColor =
    tierLimit === null
      ? 'bg-emerald-500'
      : usagePct >= 90
      ? 'bg-red-500'
      : usagePct >= 70
      ? 'bg-amber-500'
      : 'bg-slate-900'

  const dailySeries = overview?.daily_volume ?? []
  const maxVolume = Math.max(
    ...dailySeries.map((d) => (typeof d.volume_usd === 'number' ? d.volume_usd : parseFloat(String(d.volume_usd)) || 0)),
    10,
  )

  const tokenBreakdown = overview?.token_breakdown ?? {}
  const networkBreakdown = overview?.network_breakdown ?? {}
  const grossRevNum = overview?.lifetime_total ? parseFloat(String(overview.lifetime_total)) || 0 : 0

  return (
    <div className="space-y-6">
      {/* ─── Hero Header & Quick Actions ─── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Dashboard Overview</h1>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 border border-emerald-200">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Settlement Live
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time multi-chain payment flows, revenue velocity, and transaction logs.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => loadData(true)}
            disabled={refreshing}
            className="flex items-center gap-1.5 text-xs font-medium"
          >
            <span className={refreshing ? 'animate-spin' : ''}>🔄</span>
            {refreshing ? 'Updating…' : 'Refresh'}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate('/dashboard/invoices/new')}
            className="flex items-center gap-1.5 text-xs font-medium"
          >
            <span>📄</span> New Invoice
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => navigate('/dashboard/payment-links/new')}
            className="flex items-center gap-1.5 text-xs font-medium shadow-xs"
          >
            <span>🔗</span> Create Payment Link
          </Button>
        </div>
      </div>

      {/* ─── 4-Card KPI Analytics Grid ─── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Gross Settled Volume */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs transition-all hover:shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Total Lifetime Volume</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 text-sm font-bold">
              💰
            </span>
          </div>
          <div className="mt-3">
            <p className="text-2xl font-extrabold text-slate-900 tracking-tight">
              ${lifetimeTotal} <span className="text-xs font-normal text-slate-400">USD</span>
            </p>
            <div className="flex items-center gap-1.5 mt-1 text-xs text-slate-500">
              <span className="text-emerald-600 font-semibold">+${volume30d}</span>
              <span>in last 30 days</span>
            </div>
          </div>
        </div>

        {/* Card 2: Settlement Success Rate */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs transition-all hover:shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Payment Success Rate</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-50 text-blue-600 text-sm font-bold">
              ⚡
            </span>
          </div>
          <div className="mt-3">
            <p className="text-2xl font-extrabold text-slate-900 tracking-tight">
              {successRate}%
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {confirmedCount} confirmed of {totalTransactions} attempts
            </p>
          </div>
        </div>

        {/* Card 3: In-Flight & Pending Payments */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs transition-all hover:shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">In-Flight Payments</span>
            <span className={`flex h-8 w-8 items-center justify-center rounded-xl text-sm font-bold ${
              pendingCount > 0 ? 'bg-amber-50 text-amber-600' : 'bg-slate-50 text-slate-400'
            }`}>
              ⏳
            </span>
          </div>
          <div className="mt-3">
            <div className="flex items-center gap-2">
              <p className="text-2xl font-extrabold text-slate-900 tracking-tight">
                {pendingCount}
              </p>
              {pendingCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-ping" />
                  Confirming
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              {pendingCount === 0 ? 'No payments awaiting on-chain blocks' : 'Payments detected & confirming'}
            </p>
          </div>
        </div>

        {/* Card 4: Active Payment Channels */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs transition-all hover:shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Active Channels</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-purple-50 text-purple-600 text-sm font-bold">
              🎯
            </span>
          </div>
          <div className="mt-3">
            <p className="text-2xl font-extrabold text-slate-900 tracking-tight">
              {activeLinks + openInvoices}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {activeLinks} Active Links • {openInvoices} Open Invoices
            </p>
          </div>
        </div>
      </div>

      {/* ─── Monthly Usage Widget ─── */}
      {subscription && (
        <div className="rounded-2xl border border-slate-200/80 bg-white px-5 py-4 shadow-xs">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            {/* Left: label + count */}
            <div className="flex items-center gap-3 min-w-0">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 text-sm font-bold">
                📊
              </span>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    Monthly Transactions
                  </span>
                  <span className="inline-flex items-center rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-white">
                    {subscription.tier_name || tier}
                  </span>
                  {usagePct >= 90 && tierLimit !== null && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">
                      ⚠ Near limit
                    </span>
                  )}
                </div>
                <p className="mt-0.5 text-xl font-extrabold tracking-tight text-slate-900">
                  {monthlyCount.toLocaleString()}
                  <span className="text-sm font-semibold text-slate-400 ml-1">
                    / {tierLimitDisplay}
                  </span>
                </p>
              </div>
            </div>

            {/* Right: progress bar + upgrade button */}
            <div className="flex flex-1 flex-col gap-1.5 sm:max-w-xs">
              {tierLimit !== null ? (
                <>
                  <div className="flex items-center justify-between text-[11px] text-slate-500">
                    <span>{usagePct}% used this month</span>
                    <span>
                      {tierLimit - monthlyCount > 0
                        ? `${(tierLimit - monthlyCount).toLocaleString()} remaining`
                        : 'Limit reached'}
                    </span>
                  </div>
                  <div
                    className="h-2 w-full overflow-hidden rounded-full bg-slate-100"
                    role="progressbar"
                    aria-valuenow={usagePct}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label={`${usagePct}% of monthly transaction limit used`}
                  >
                    <div
                      className={`h-full rounded-full transition-all ${usageBarColor}`}
                      style={{ width: `${Math.max(usagePct, 2)}%` }}
                    />
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-1.5 text-xs text-emerald-600 font-semibold">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" />
                  Unlimited transactions on Enterprise plan
                </div>
              )}
              <button
                type="button"
                onClick={() => navigate('/dashboard/settings?tab=billing')}
                className="mt-0.5 self-end rounded-lg border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-all"
              >
                {tier === 'enterprise' ? 'Manage Plan' : 'Upgrade Plan'} →
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── Analytical Charts & Breakdowns (2 Columns) ─── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left (2 cols): 14-Day Volume Velocity Timeline */}
        <div className="lg:col-span-2 rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Settlement Velocity (Last 14 Days)</h2>
              <p className="text-xs text-slate-400">Daily confirmed volume across all checkout sessions</p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => navigate('/dashboard/reports')}
              className="text-xs font-semibold py-1 px-2.5"
            >
              Full Analytics →
            </Button>
          </div>

          {hoveredPoint && (
            <div className="flex items-center justify-between text-xs bg-slate-900 text-white px-3 py-2 rounded-xl mb-3 shadow-xs animate-fadeIn">
              <span className="font-medium text-slate-300">📅 {hoveredPoint.date}</span>
              <span className="font-bold text-emerald-400">
                ${hoveredPoint.volume.toFixed(2)} USD
              </span>
              <span className="text-slate-300 font-medium">
                {hoveredPoint.count} payment{hoveredPoint.count !== 1 ? 's' : ''}
              </span>
            </div>
          )}

          {/* Bar / Velocity Graph */}
          {dailySeries.length === 0 ? (
            <div className="h-44 flex items-center justify-center text-xs text-slate-400">
              No transaction history recorded in the last 14 days.
            </div>
          ) : (
            <div>
              <div className="h-44 flex items-end gap-1.5 sm:gap-3 pt-6 pb-2 border-b border-slate-100">
                {dailySeries.map((point) => {
                  const vol = typeof point.volume_usd === 'number' ? point.volume_usd : parseFloat(String(point.volume_usd)) || 0
                  const heightPct = Math.max(vol > 0 ? (vol / maxVolume) * 100 : 4, 4)
                  return (
                    <div
                      key={point.date}
                      className="flex-1 flex flex-col items-center group relative cursor-pointer"
                      onMouseEnter={() => setHoveredPoint({ date: point.date, volume: vol, count: point.successful_count })}
                      onMouseLeave={() => setHoveredPoint(null)}
                    >
                      <div
                        className={`w-full max-w-[28px] rounded-t-md transition-all duration-200 ${
                          vol > 0
                            ? 'bg-slate-900 group-hover:bg-emerald-500 shadow-xs'
                            : 'bg-slate-100 group-hover:bg-slate-200'
                        }`}
                        style={{ height: `${heightPct}%` }}
                      />
                      <span className="text-[10px] text-slate-400 mt-1.5 truncate max-w-[24px]">
                        {point.date.slice(5)}
                      </span>
                    </div>
                  )
                })}
              </div>
              <div className="flex justify-between items-center text-[11px] text-slate-400 mt-2">
                <span>{dailySeries[0]?.date}</span>
                <span>Hover over bars for daily breakdown</span>
                <span>{dailySeries[dailySeries.length - 1]?.date}</span>
              </div>
            </div>
          )}
        </div>

        {/* Right (1 col): Multi-Chain & Token Distribution */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs space-y-5">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Settlement Breakdown</h2>
            <p className="text-xs text-slate-400">Supported tokens and settlement chains</p>
          </div>

          {/* Tokens */}
          <div className="space-y-3">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Tokens</span>
            {Object.keys(tokenBreakdown).length > 0 ? (
              Object.entries(tokenBreakdown).map(([tok, vol]) => {
                const volNum = typeof vol === 'number' ? vol : parseFloat(String(vol)) || 0
                const pct = grossRevNum > 0 ? Math.round((volNum / grossRevNum) * 100) : 0
                return (
                  <div key={tok} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-slate-800 flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-indigo-600" />
                        {tok}
                      </span>
                      <span className="font-semibold text-slate-900">
                        ${volNum.toFixed(2)} ({pct}%)
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full bg-slate-900 rounded-full" style={{ width: `${Math.max(pct, 5)}%` }} />
                    </div>
                  </div>
                )
              })
            ) : (
              <div className="text-xs text-slate-400 py-2">
                USDC, USDT, ETH, DAI supported
              </div>
            )}
          </div>

          {/* Networks */}
          <div className="space-y-3 pt-2 border-t border-slate-100">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Chains</span>
            {Object.keys(networkBreakdown).length > 0 ? (
              Object.entries(networkBreakdown).map(([net, vol]) => {
                const volNum = typeof vol === 'number' ? vol : parseFloat(String(vol)) || 0
                const pct = grossRevNum > 0 ? Math.round((volNum / grossRevNum) * 100) : 0
                return (
                  <div key={net} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold capitalize text-slate-800 flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-emerald-500" />
                        {net}
                      </span>
                      <span className="font-semibold text-slate-900">
                        ${volNum.toFixed(2)} ({pct}%)
                      </span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full bg-emerald-600 rounded-full" style={{ width: `${Math.max(pct, 5)}%` }} />
                    </div>
                  </div>
                )
              })
            ) : (
              <div className="text-xs text-slate-400 py-2">
                Base, Polygon, Arbitrum, Ethereum, BSC active
              </div>
            )}
          </div>

          {/* Payout Wallets Link */}
          <div className="pt-2">
            <button
              type="button"
              onClick={() => navigate('/dashboard/wallets')}
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 text-center text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-all"
            >
              ⚙️ Manage Settlement Wallets
            </button>
          </div>
        </div>
      </div>

      {/* ─── Recent Transactions Stream Table ─── */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
          <div>
            <h2 className="text-base font-bold text-slate-900">Live Payment Stream</h2>
            <p className="text-xs text-slate-400">Chronological feed of customer payment attempts and confirmations</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate('/dashboard/transactions')}
            className="text-xs font-semibold self-start sm:self-auto"
          >
            View All Transactions →
          </Button>
        </div>
        {transactions.length === 0 ? (
          <div className="py-12 text-center space-y-3">
            <div className="text-3xl">💳</div>
            <p className="text-sm font-semibold text-slate-800">No transactions yet</p>
            <p className="text-xs text-slate-500 max-w-sm mx-auto">
              Share your payment links or send invoices to start accepting decentralized crypto settlements.
            </p>
            <div className="flex justify-center gap-2 pt-2">
              <Button
                variant="primary"
                size="sm"
                onClick={() => navigate('/dashboard/payment-links/new')}
                className="text-xs"
              >
                Create Payment Link
              </Button>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200/80" aria-label="Recent transactions">
              <thead>
                <tr>
                  <th scope="col" className="py-3 pr-4 text-left text-xs font-bold uppercase tracking-wider text-slate-400">
                    Source & Type
                  </th>
                  <th scope="col" className="py-3 pr-4 text-right text-xs font-bold uppercase tracking-wider text-slate-400">
                    Amount
                  </th>
                  <th scope="col" className="py-3 pr-4 text-left text-xs font-bold uppercase tracking-wider text-slate-400">
                    Token & Chain
                  </th>
                  <th scope="col" className="py-3 pr-4 text-left text-xs font-bold uppercase tracking-wider text-slate-400">
                    Status
                  </th>
                  <th scope="col" className="py-3 pr-4 text-left text-xs font-bold uppercase tracking-wider text-slate-400">
                    Date & Time
                  </th>
                  <th scope="col" className="py-3 text-right text-xs font-bold uppercase tracking-wider text-slate-400">
                    Tx Hash
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {transactions.map((tx, i) => {
                  const paymentType = tx.type || tx.payment_type || 'link'
                  const rawDate = tx.created_at || tx.timestamp
                  const statusKey = (tx.status || 'pending').toLowerCase() as PaymentStatus
                  const netKey = (tx.network || '').toLowerCase()
                  const netStyle = networkColors[netKey] || 'bg-slate-100 text-slate-700 border-slate-200'

                  return (
                    <tr key={i} className="hover:bg-slate-50/80 transition-colors">
                      {/* Source & Type */}
                      <td className="whitespace-nowrap py-3.5 pr-4">
                        <div className="flex items-center gap-2.5">
                          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-xs">
                            {paymentType === 'invoice' ? '📄' : '🔗'}
                          </span>
                          <div>
                            <p className="text-xs font-semibold text-slate-900">
                              {tx.source_title || (paymentType === 'invoice' ? 'Invoice Payment' : 'Payment Link')}
                            </p>
                            <span className="text-[10px] text-slate-400 uppercase font-semibold">
                              {paymentType === 'invoice' ? 'Invoice' : 'Link'}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Amount */}
                      <td className="whitespace-nowrap py-3.5 pr-4 text-right">
                        <p className="text-xs font-bold text-slate-900">
                          {formatAmount(tx.amount)}
                        </p>
                        <span className="text-[10px] text-slate-400 font-medium">
                          {tx.token_symbol}
                        </span>
                      </td>

                      {/* Token & Chain */}
                      <td className="whitespace-nowrap py-3.5 pr-4">
                        <div className="flex items-center gap-1.5">
                          <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-800">
                            {tx.token_symbol}
                          </span>
                          <span className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase ${netStyle}`}>
                            {tx.network}
                          </span>
                        </div>
                      </td>

                      {/* Status */}
                      <td className="whitespace-nowrap py-3.5 pr-4">
                        <div className="flex items-center gap-1.5">
                          <Badge variant={statusVariant[statusKey] || 'default'}>
                            {statusLabel[statusKey] || tx.status}
                          </Badge>
                          {(statusKey === 'pending' || statusKey === 'confirming' || statusKey === 'detected') && (
                            <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-ping" />
                          )}
                        </div>
                      </td>

                      {/* Date & Time */}
                      <td className="whitespace-nowrap py-3.5 pr-4">
                        <div>
                          <p className="text-xs font-medium text-slate-700">
                            {formatDisplayTimestamp(rawDate)}
                          </p>
                          <p className="text-[10px] text-slate-400">
                            {formatRelativeTime(rawDate)}
                          </p>
                        </div>
                      </td>

                      {/* Tx Hash */}
                      <td className="whitespace-nowrap py-3.5 text-right">
                        {tx.tx_hash ? (
                          <div className="flex items-center justify-end gap-1.5">
                            <span className="font-mono text-[11px] text-slate-600">
                              {truncateHash(tx.tx_hash)}
                            </span>
                            <button
                              type="button"
                              onClick={() => copyToClipboard(tx.tx_hash!)}
                              className="rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 transition-all"
                              title="Copy transaction hash"
                            >
                              {copiedHash === tx.tx_hash ? '✓' : '📋'}
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-300">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
