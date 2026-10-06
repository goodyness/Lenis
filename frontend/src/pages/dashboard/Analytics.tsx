import { useEffect, useState } from 'react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { apiClient } from '../../lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

interface RevenuePoint {
  date: string
  amount: string
  fiat_equivalent: string | null
}

interface TopToken {
  token_symbol: string
  total_amount: string
  payment_count: number
}

interface TopNetwork {
  network: string
  total_amount: string
  payment_count: number
}

interface AnalyticsData {
  revenue_series: RevenuePoint[]
  top_tokens: TopToken[]
  top_networks: TopNetwork[]
  conversion_rate: string
  average_payment_size: string | null
}

type Period = 'daily' | 'weekly' | 'monthly'

const PERIOD_OPTIONS: { label: string; value: Period }[] = [
  { label: 'Daily', value: 'daily' },
  { label: 'Weekly', value: 'weekly' },
  { label: 'Monthly', value: 'monthly' },
]

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function thirtyDaysAgoStr(): string {
  const d = new Date()
  d.setDate(d.getDate() - 30)
  return d.toISOString().slice(0, 10)
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function Analytics() {
  const [period, setPeriod] = useState<Period>('daily')
  const [startDate, setStartDate] = useState<string>(thirtyDaysAgoStr())
  const [endDate, setEndDate] = useState<string>(todayStr())
  const [data, setData] = useState<AnalyticsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hoveredBar, setHoveredBar] = useState<{ date: string; amount: number } | null>(null)

  async function loadAnalytics() {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({
        period,
        start_date: startDate,
        end_date: endDate,
      })
      const { data: result } = await apiClient.get<AnalyticsData>(
        `/merchant/analytics?${params.toString()}`,
      )
      setData(result)
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Failed to load analytics.'
      // Handle 403 onboarding-not-complete gracefully
      if (typeof err === 'object' && err !== null && 'response' in err) {
        const axiosErr = err as { response?: { data?: { error?: string } } }
        if (axiosErr.response?.data?.error === 'ONBOARDING_REQUIRED') {
          setError('Complete merchant onboarding to access analytics.')
          setLoading(false)
          return
        }
      }
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAnalytics()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, startDate, endDate])

  // ─── Chart helpers ─────────────────────────────────────────────────────────

  const revenueSeries = data?.revenue_series ?? []

  // Prefer fiat_equivalent for chart height; fall back to amount
  const chartValues = revenueSeries.map((p) => {
    const fiat = p.fiat_equivalent !== null ? parseFloat(p.fiat_equivalent ?? '0') : null
    const amount = parseFloat(p.amount)
    return fiat !== null ? fiat : amount
  })

  const maxValue = Math.max(...chartValues, 10)

  // Totals for percentage bars
  const totalTokenVolume = (data?.top_tokens ?? []).reduce(
    (sum, t) => sum + parseFloat(t.total_amount),
    0,
  )
  const totalNetworkVolume = (data?.top_networks ?? []).reduce(
    (sum, n) => sum + parseFloat(n.total_amount),
    0,
  )

  const conversionPct = data
    ? (parseFloat(data.conversion_rate) * 100).toFixed(1) + '%'
    : '—'

  const avgSizeDisplay = data?.average_payment_size
    ? '$' +
      parseFloat(data.average_payment_size).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    : 'N/A'

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Analytics</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Revenue trends, top tokens, networks, and conversion metrics.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={loadAnalytics}
          disabled={loading}
          className="flex items-center gap-1.5"
        >
          <span>🔄</span> Refresh
        </Button>
      </div>

      {/* Period selector + date range */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200/80 bg-white p-2 shadow-xs">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-400 px-2">
          Granularity:
        </span>
        {PERIOD_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setPeriod(opt.value)}
            className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition-all ${
              period === opt.value
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-600 hover:bg-slate-100'
            }`}
          >
            {opt.label}
          </button>
        ))}

        <div className="flex items-center gap-2 pl-2 border-l border-slate-200 ml-auto">
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-800"
          />
          <span className="text-xs text-slate-400">to</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-800"
          />
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-800">
          ⚠️ {error}
        </div>
      )}

      {/* KPI stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Conversion Rate */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Conversion Rate
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-purple-50 text-purple-600 text-sm">
              🎯
            </span>
          </div>
          <div className="mt-3">
            {loading ? (
              <div className="h-7 w-20 animate-pulse rounded bg-slate-100" />
            ) : (
              <p className="text-2xl font-extrabold text-slate-900 tracking-tight">
                {conversionPct}
              </p>
            )}
            <p className="text-xs text-slate-500 mt-0.5">confirmed ÷ total payments</p>
          </div>
        </div>

        {/* Average Payment Size */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Avg Payment Size
            </span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 text-sm">
              💵
            </span>
          </div>
          <div className="mt-3">
            {loading ? (
              <div className="h-7 w-24 animate-pulse rounded bg-slate-100" />
            ) : (
              <p className="text-2xl font-extrabold text-slate-900 tracking-tight">
                {avgSizeDisplay}
              </p>
            )}
            <p className="text-xs text-slate-500 mt-0.5">fiat equivalent at settlement</p>
          </div>
        </div>
      </div>

      {/* Revenue bar chart */}
      <Card title="Revenue Timeline (Fiat USD Equivalent)">
        {loading ? (
          <div className="h-56 flex items-center justify-center text-slate-400 text-sm animate-pulse">
            Loading revenue timeline...
          </div>
        ) : revenueSeries.length === 0 ? (
          <div className="h-56 flex items-center justify-center text-slate-400 text-sm">
            No confirmed payments found for this period.
          </div>
        ) : (
          <div className="space-y-3">
            {hoveredBar && (
              <div className="flex items-center justify-between text-xs text-slate-600 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                <span className="font-semibold text-slate-900">📅 {hoveredBar.date}</span>
                <span className="font-bold text-emerald-600">
                  ${hoveredBar.amount.toFixed(2)} USD
                </span>
              </div>
            )}

            <div className="h-56 flex items-end gap-1 sm:gap-2 pt-6 pb-2 border-b border-slate-100 overflow-x-auto">
              {revenueSeries.map((point, idx) => {
                const val = chartValues[idx]
                const heightPct = Math.max(val > 0 ? (val / maxValue) * 100 : 2, 2)
                return (
                  <div
                    key={point.date}
                    className="flex-1 flex flex-col items-center group relative min-w-[14px]"
                    onMouseEnter={() => setHoveredBar({ date: point.date, amount: val })}
                    onMouseLeave={() => setHoveredBar(null)}
                  >
                    <div
                      className={`w-full max-w-[32px] rounded-t-lg transition-all duration-200 ${
                        val > 0
                          ? 'bg-gradient-to-t from-violet-600 to-violet-500 hover:from-emerald-500 hover:to-emerald-400 shadow-xs'
                          : 'bg-slate-100'
                      }`}
                      style={{ height: `${heightPct}%` }}
                    />
                    <span className="text-[9px] text-slate-400 mt-1 transform -rotate-45 sm:rotate-0 origin-left truncate max-w-[28px]">
                      {point.date.slice(5)}
                    </span>
                  </div>
                )
              })}
            </div>

            <div className="flex justify-between text-[11px] text-slate-400">
              <span>{startDate}</span>
              <span>Revenue Trend</span>
              <span>{endDate}</span>
            </div>
          </div>
        )}
      </Card>

      {/* Top tokens & top networks */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top Tokens */}
        <Card title="Top Tokens by Volume">
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-8 w-full animate-pulse rounded bg-slate-100" />
              ))}
            </div>
          ) : (data?.top_tokens ?? []).length === 0 ? (
            <p className="text-xs text-slate-400 py-6 text-center">
              No token data available for this range.
            </p>
          ) : (
            <div className="space-y-3">
              {(data?.top_tokens ?? []).map((tok) => {
                const volNum = parseFloat(tok.total_amount)
                const pct =
                  totalTokenVolume > 0 ? Math.round((volNum / totalTokenVolume) * 100) : 0
                return (
                  <div key={tok.token_symbol} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-slate-800">{tok.token_symbol}</span>
                      <span className="text-slate-500">
                        {tok.payment_count} payments · {pct}%
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full bg-violet-600 rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>

        {/* Top Networks */}
        <Card title="Top Networks by Volume">
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-8 w-full animate-pulse rounded bg-slate-100" />
              ))}
            </div>
          ) : (data?.top_networks ?? []).length === 0 ? (
            <p className="text-xs text-slate-400 py-6 text-center">
              No network data available for this range.
            </p>
          ) : (
            <div className="space-y-3">
              {(data?.top_networks ?? []).map((net) => {
                const volNum = parseFloat(net.total_amount)
                const pct =
                  totalNetworkVolume > 0 ? Math.round((volNum / totalNetworkVolume) * 100) : 0
                return (
                  <div key={net.network} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-slate-800 capitalize">{net.network}</span>
                      <span className="text-slate-500">
                        {net.payment_count} payments · {pct}%
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-full transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
