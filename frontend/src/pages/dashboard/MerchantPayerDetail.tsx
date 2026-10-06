import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { Card } from '../../components/ui/Card'
import {
  getMerchantPayerDetail,
  type PayerDetailResponse,
} from '../../services/merchant'

function formatDisplayDate(iso?: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function StatusBadge({ status }: { status: string }) {
  const s = status.toLowerCase()
  if (s === 'paid' || s === 'confirmed') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-700 border border-emerald-200">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Paid / Confirmed
      </span>
    )
  }
  if (s === 'pending') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2.5 py-0.5 text-xs font-bold text-blue-700 border border-blue-200">
        <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse" />
        Pending / Opened
      </span>
    )
  }
  if (s === 'expired') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-0.5 text-xs font-bold text-amber-700 border border-amber-200">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
        Expired (20m Timeout)
      </span>
    )
  }
  if (s === 'detected' || s === 'confirming') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-2.5 py-0.5 text-xs font-bold text-purple-700 border border-purple-200">
        <span className="h-1.5 w-1.5 rounded-full bg-purple-500 animate-ping" />
        Confirming On-Chain
      </span>
    )
  }
  return (
    <span className="inline-flex items-center rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
      {status}
    </span>
  )
}

export function MerchantPayerDetail() {
  const { email } = useParams<{ email: string }>()
  const [data, setData] = useState<PayerDetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!email) return
    let cancelled = false
    setLoading(true)
    setError(null)

    getMerchantPayerDetail(email)
      .then((res) => {
        if (!cancelled) setData(res)
      })
      .catch(() => {
        if (!cancelled) setError(`Failed to load customer profile for ${email}.`)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [email])

  return (
    <div className="space-y-6">
      {/* Navigation back */}
      <div>
        <Link
          to="/dashboard/customers"
          className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors"
        >
          ← Back to Customers & Payers
        </Link>
      </div>

      {/* Loading state */}
      {loading && (
        <div className="space-y-4 py-8">
          <div className="h-20 animate-pulse rounded-xl bg-slate-100" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-xl bg-slate-100" />
            ))}
          </div>
          <div className="h-64 animate-pulse rounded-xl bg-slate-100" />
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 shadow-xs">
          <p className="font-bold">Customer record not found</p>
          <p className="mt-1">{error}</p>
        </div>
      )}

      {/* Detail view */}
      {data && (
        <>
          {/* Customer Profile Header Card */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-slate-900 text-white font-extrabold text-xl shadow-xs">
                  {data.email.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h1 className="text-xl font-bold tracking-tight text-slate-900">{data.email}</h1>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                    {data.name && <span className="font-medium text-slate-700">{data.name} •</span>}
                    <span>First seen: {formatDisplayDate(data.first_seen_at)}</span>
                    {data.last_active_at && (
                      <span>• Last activity: {formatDisplayDate(data.last_active_at)}</span>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Metrics Grid */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Total Spent / Settled</p>
              <p className="mt-2 text-2xl font-extrabold text-emerald-600 font-mono">
                ${parseFloat(data.total_volume_usd || '0').toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </p>
              <p className="mt-1 text-xs text-slate-400">Total verified crypto volume paid to you</p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Total Checkout Attempts</p>
              <p className="mt-2 text-2xl font-extrabold text-slate-900">{data.total_attempts}</p>
              <p className="mt-1 text-xs text-slate-400">All sessions & invoices created</p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Successful Payments</p>
              <p className="mt-2 text-2xl font-extrabold text-emerald-600">{data.successful_payments}</p>
              <p className="mt-1 text-xs text-slate-400">
                {data.total_attempts > 0
                  ? `${Math.round((data.successful_payments / data.total_attempts) * 100)}% conversion rate`
                  : 'No attempts'}
              </p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Pending & Expired</p>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-xl font-bold text-blue-600">{data.pending_payments} pending</span>
                <span className="text-sm font-semibold text-amber-600">/ {data.expired_payments} expired</span>
              </div>
              <p className="mt-1 text-xs text-slate-400">Uncompleted checkout sessions</p>
            </div>
          </div>

          {/* Tokens & Networks Used */}
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-2">Tokens & Networks Used</p>
            <div className="flex flex-wrap gap-1.5">
              {data.tokens_used.map((t) => (
                <span
                  key={t}
                  className="inline-flex rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700"
                >
                  🪙 {t}
                </span>
              ))}
              {data.networks_used.map((n) => (
                <span
                  key={n}
                  className="inline-flex rounded-lg bg-indigo-50 px-2.5 py-1 text-xs font-semibold text-indigo-700 border border-indigo-100"
                >
                  🌐 {n}
                </span>
              ))}
            </div>
          </div>

          {/* Detailed Activity & Payment Session History */}
          <Card>
            <div className="p-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-base font-bold text-slate-900">Activity & Payment Session Logs</h2>
                <p className="text-xs text-slate-500">
                  Detailed history of customer checkout sessions, payment attempts, invoices, and confirmed transactions.
                </p>
              </div>
              <span className="text-xs font-bold text-slate-500">{data.activity_logs.length} Total Logs</span>
            </div>

            {data.activity_logs.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                No activity logs recorded for this customer yet.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                  <thead className="bg-slate-50/80 font-semibold uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="py-3 pl-4 pr-3">Event / Item</th>
                      <th className="px-3 py-3">Status</th>
                      <th className="px-3 py-3 text-right">Amount (Crypto / USD)</th>
                      <th className="px-3 py-3">Network & Token</th>
                      <th className="px-3 py-3">Tx Hash</th>
                      <th className="py-3 pl-3 pr-4">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {data.activity_logs.map((log) => (
                      <tr key={log.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="whitespace-nowrap py-3.5 pl-4 pr-3">
                          <div className="flex flex-col">
                            <span className="font-semibold text-slate-900">{log.title}</span>
                            <span className="text-[11px] text-slate-400">{log.type}</span>
                          </div>
                        </td>

                        <td className="whitespace-nowrap px-3 py-3.5">
                          <StatusBadge status={log.status} />
                        </td>

                        <td className="whitespace-nowrap px-3 py-3.5 text-right font-mono font-semibold">
                          {log.amount_crypto ? (
                            <div className="flex flex-col items-end">
                              <span className="text-slate-900">
                                {log.amount_crypto} {log.token_symbol}
                              </span>
                              {log.usd_amount && (
                                <span className="text-[11px] text-slate-500 font-normal">
                                  (${log.usd_amount} USD)
                                </span>
                              )}
                            </div>
                          ) : log.usd_amount ? (
                            `$${log.usd_amount} USD`
                          ) : (
                            '—'
                          )}
                        </td>

                        <td className="whitespace-nowrap px-3 py-3.5 text-slate-600">
                          {log.network ? `${log.network} (${log.token_symbol || '—'})` : '—'}
                        </td>

                        <td className="whitespace-nowrap px-3 py-3.5 font-mono text-[11px]">
                          {log.tx_hash ? (
                            <span
                              title={log.tx_hash}
                              className="inline-flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-slate-700"
                            >
                              {log.tx_hash.slice(0, 8)}...{log.tx_hash.slice(-6)}
                            </span>
                          ) : (
                            <span className="text-slate-400">None (no broadcast)</span>
                          )}
                        </td>

                        <td className="whitespace-nowrap py-3.5 pl-3 pr-4 text-slate-500">
                          {formatDisplayDate(log.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </>
      )}
    </div>
  )
}
