import { useEffect, useState } from 'react'
import { Card } from '../../components/ui/Card'
import { Button } from '../../components/ui/Button'
import { useMerchantStore, type ReportSummary } from '../../stores/merchantStore'

const PERIOD_OPTIONS = [
  { label: 'Last 7 Days', value: '7d' },
  { label: 'Last 30 Days', value: '30d' },
  { label: 'Last 90 Days', value: '90d' },
  { label: 'This Month', value: 'this_month' },
  { label: 'Last Month', value: 'last_month' },
  { label: 'Year to Date', value: 'ytd' },
  { label: 'All Time', value: 'all' },
  { label: 'Custom Range', value: 'custom' },
]

export function Reports() {
  const fetchReportsSummary = useMerchantStore((s) => s.fetchReportsSummary)
  const downloadReportsCsv = useMerchantStore((s) => s.downloadReportsCsv)

  const [period, setPeriod] = useState<string>('30d')
  const [startDate, setStartDate] = useState<string>('')
  const [endDate, setEndDate] = useState<string>('')
  const [summary, setSummary] = useState<ReportSummary | null>(null)
  const [loading, setLoading] = useState<boolean>(true)
  const [exporting, setExporting] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [hoveredPoint, setHoveredPoint] = useState<{ date: string; volume: number; count: number } | null>(null)

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchReportsSummary(
        period,
        period === 'custom' ? startDate : undefined,
        period === 'custom' ? endDate : undefined,
      )
      setSummary(data)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load report analytics.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (period !== 'custom' || (startDate && endDate)) {
      loadData()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [period, startDate, endDate])

  async function handleExportCsv() {
    setExporting(true)
    try {
      await downloadReportsCsv(
        period,
        period === 'custom' ? startDate : undefined,
        period === 'custom' ? endDate : undefined,
      )
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : 'Failed to export CSV.')
    } finally {
      setExporting(false)
    }
  }

  // Calculate chart max height & scale
  const dailySeries = summary?.daily_volume_series || []
  const maxVolume = Math.max(
    ...dailySeries.map((d) => (typeof d.volume_usd === 'number' ? d.volume_usd : parseFloat(d.volume_usd as string) || 0)),
    10,
  )

  const grossRevNum = summary
    ? typeof summary.gross_revenue_usd === 'number'
      ? summary.gross_revenue_usd
      : parseFloat(summary.gross_revenue_usd as string) || 0
    : 0

  const aovNum = summary
    ? typeof summary.average_order_value_usd === 'number'
      ? summary.average_order_value_usd
      : parseFloat(summary.average_order_value_usd as string) || 0
    : 0

  return (
    <div className="space-y-6">
      {/* Top Header & Actions */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Financial Reports & Analytics
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time accounting summaries, payment conversion analytics, and CSV exports.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-1.5"
          >
            <span>🔄</span> Refresh
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={handleExportCsv}
            loading={exporting}
            className="flex items-center gap-1.5 shadow-xs"
          >
            <span>📥</span> Export CSV Report
          </Button>
        </div>
      </div>

      {/* Period Filter Selector Pills */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200/80 bg-white p-2 shadow-xs">
        <span className="text-xs font-bold uppercase tracking-wider text-slate-400 px-2">
          Period:
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

        {period === 'custom' && (
          <div className="flex items-center gap-2 pl-2 border-l border-slate-200">
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
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-800">
          ⚠️ {error}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Gross Revenue */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Gross Settled Revenue</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 text-sm font-bold">
              💰
            </span>
          </div>
          <div className="mt-3">
            <p className="text-2xl font-extrabold text-slate-900 tracking-tight">
              ${grossRevNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              {summary?.start_date} to {summary?.end_date}
            </p>
          </div>
        </div>

        {/* Successful Payments */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Successful Payments</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-50 text-blue-600 text-sm font-bold">
              ⚡
            </span>
          </div>
          <div className="mt-3">
            <p className="text-2xl font-extrabold text-slate-900 tracking-tight">
              {summary?.successful_payments ?? 0}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              of {summary?.total_transactions ?? 0} total attempts
            </p>
          </div>
        </div>

        {/* Average Order Value (AOV) */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Average Order Value</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 text-sm font-bold">
              📊
            </span>
          </div>
          <div className="mt-3">
            <p className="text-2xl font-extrabold text-slate-900 tracking-tight">
              ${aovNum.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">per completed payment</p>
          </div>
        </div>

        {/* Conversion Rate */}
        <div className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">Payment Conversion</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-purple-50 text-purple-600 text-sm font-bold">
              🎯
            </span>
          </div>
          <div className="mt-3">
            <p className="text-2xl font-extrabold text-slate-900 tracking-tight">
              {summary?.conversion_rate ?? 0}%
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              {summary?.expired_payments ?? 0} expired • {summary?.pending_payments ?? 0} active
            </p>
          </div>
        </div>
      </div>

      {/* Revenue Time-Series Chart */}
      <Card title="Daily Revenue Timeline ($ USD)">
        {loading ? (
          <div className="h-64 flex items-center justify-center text-slate-400 text-sm animate-pulse">
            Loading analytics timeline...
          </div>
        ) : dailySeries.length === 0 ? (
          <div className="h-64 flex items-center justify-center text-slate-400 text-sm">
            No transactions found for this period.
          </div>
        ) : (
          <div className="space-y-4">
            {hoveredPoint && (
              <div className="flex items-center justify-between text-xs text-slate-600 bg-slate-50 p-2.5 rounded-xl border border-slate-100">
                <span className="font-semibold text-slate-900">📅 {hoveredPoint.date}</span>
                <span className="font-bold text-emerald-600">
                  Revenue: ${hoveredPoint.volume.toFixed(2)} USD
                </span>
                <span>{hoveredPoint.count} payment{hoveredPoint.count !== 1 ? 's' : ''}</span>
              </div>
            )}

            {/* SVG / HTML Bar Chart */}
            <div className="h-56 flex items-end gap-1 sm:gap-2 pt-6 pb-2 border-b border-slate-100 overflow-x-auto">
              {dailySeries.map((point) => {
                const vol = typeof point.volume_usd === 'number' ? point.volume_usd : parseFloat(point.volume_usd as string) || 0
                const heightPct = Math.max(vol > 0 ? (vol / maxVolume) * 100 : 2, 2)
                return (
                  <div
                    key={point.date}
                    className="flex-1 flex flex-col items-center group relative min-w-[14px]"
                    onMouseEnter={() => setHoveredPoint({ date: point.date, volume: vol, count: point.successful_count })}
                    onMouseLeave={() => setHoveredPoint(null)}
                  >
                    <div
                      className={`w-full max-w-[32px] rounded-t-lg transition-all duration-200 ${
                        vol > 0
                          ? 'bg-gradient-to-t from-indigo-600 to-indigo-500 hover:from-emerald-500 hover:to-emerald-400 shadow-xs'
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
              <span>{summary?.start_date}</span>
              <span>Daily Volume Trend</span>
              <span>{summary?.end_date}</span>
            </div>
          </div>
        )}
      </Card>

      {/* Breakdowns: Tokens & Networks & Top Links */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Token Breakdown */}
        <Card title="Revenue by Token">
          {summary && Object.keys(summary.token_breakdown).length > 0 ? (
            <div className="space-y-3">
              {Object.entries(summary.token_breakdown).map(([tok, vol]) => {
                const volNum = typeof vol === 'number' ? vol : parseFloat(vol as string) || 0
                const pct = grossRevNum > 0 ? Math.round((volNum / grossRevNum) * 100) : 0
                return (
                  <div key={tok} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-slate-800">{tok}</span>
                      <span className="font-semibold text-slate-900">
                        ${volNum.toFixed(2)} ({pct}%)
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full bg-indigo-600 rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-xs text-slate-400 py-6 text-center">No token data available for this range.</p>
          )}
        </Card>

        {/* Network Breakdown */}
        <Card title="Revenue by Network">
          {summary && Object.keys(summary.network_breakdown).length > 0 ? (
            <div className="space-y-3">
              {Object.entries(summary.network_breakdown).map(([net, vol]) => {
                const volNum = typeof vol === 'number' ? vol : parseFloat(vol as string) || 0
                const pct = grossRevNum > 0 ? Math.round((volNum / grossRevNum) * 100) : 0
                return (
                  <div key={net} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-slate-800">{net}</span>
                      <span className="font-semibold text-slate-900">
                        ${volNum.toFixed(2)} ({pct}%)
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-xs text-slate-400 py-6 text-center">No network data available for this range.</p>
          )}
        </Card>

        {/* Top Payment Links */}
        <Card title="Top Performing Links">
          {summary && summary.top_links.length > 0 ? (
            <div className="space-y-3">
              {summary.top_links.map((link) => {
                const volNum = typeof link.total_volume_usd === 'number' ? link.total_volume_usd : parseFloat(link.total_volume_usd as string) || 0
                return (
                  <div key={link.id} className="flex items-center justify-between p-2 rounded-xl bg-slate-50 border border-slate-100">
                    <div className="truncate pr-2">
                      <p className="text-xs font-bold text-slate-900 truncate">{link.title}</p>
                      <p className="text-[11px] font-mono text-slate-400 truncate">/pay/{link.slug}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-xs font-bold text-emerald-600">${volNum.toFixed(2)}</p>
                      <p className="text-[10px] text-slate-400">{link.successful_transactions} sales</p>
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-xs text-slate-400 py-6 text-center">No payment links data in this period.</p>
          )}
        </Card>
      </div>

      {/* Accounting Export Callout Card */}
      <div className="rounded-2xl border border-indigo-200 bg-gradient-to-r from-indigo-50 to-blue-50 p-6 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xs">
        <div className="space-y-1 text-center sm:text-left">
          <h3 className="text-sm font-bold text-indigo-950">Export Official Accounting CSV Statement</h3>
          <p className="text-xs text-indigo-700 max-w-xl">
            Download your full settlement history with customer details, crypto amounts, fiat USD valuations, and on-chain transaction hashes. Formatted for QuickBooks, Xero, Excel, and tax filing.
          </p>
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={handleExportCsv}
          loading={exporting}
          className="shrink-0 bg-indigo-600 hover:bg-indigo-700 shadow-xs text-xs"
        >
          📥 Download .CSV Spreadsheet
        </Button>
      </div>
    </div>
  )
}
