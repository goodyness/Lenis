import { useEffect, useState } from 'react'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { getMerchantTransactions, type TransactionListResult } from '../../services/merchant'

type BadgeVariant = 'default' | 'blue' | 'green' | 'yellow' | 'red' | 'purple'

const statusVariant: Record<string, BadgeVariant> = {
  confirmed: 'green',
  paid: 'green',
  pending: 'yellow',
  detected: 'blue',
  confirming: 'blue',
  failed: 'red',
}

function truncate(s?: string | null, len: number = 10): string {
  if (!s) return '—'
  if (s.length <= len + 6) return s
  return `${s.slice(0, len)}…${s.slice(-4)}`
}

function formatDisplayDate(iso: string): string {
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

export function Transactions() {
  const [data, setData] = useState<TransactionListResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  async function loadTransactions(p = page, status = statusFilter) {
    setLoading(true)
    setError(null)
    try {
      const res = await getMerchantTransactions(p, 20, status || undefined)
      setData(res)
    } catch {
      setError('Failed to load transaction history. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTransactions(page, statusFilter)
  }, [page, statusFilter])

  function copyToClipboard(text: string, id: string) {
    navigator.clipboard.writeText(text)
    setCopiedId(id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  return (
    <div className="space-y-6">
      {/* Page Heading & Filters */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Transactions</h1>
          <p className="mt-1 text-sm text-slate-500">
            Real-time on-chain payments, settlements, and customer transaction logs.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value)
              setPage(1)
            }}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-xs focus:outline-none focus:ring-2 focus:ring-slate-400"
          >
            <option value="">All Statuses</option>
            <option value="confirmed">Confirmed / Paid</option>
            <option value="confirming">Confirming</option>
            <option value="detected">Detected</option>
            <option value="pending">Pending</option>
          </select>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => loadTransactions(page, statusFilter)}
            disabled={loading}
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* Analytics / Overview Cards */}
      {data && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Total Volume</p>
            <p className="mt-2 text-2xl font-extrabold text-slate-900">
              ${parseFloat(data.total_volume_usd || '0').toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </p>
            <p className="mt-1 text-xs text-slate-400">Total verified on-chain collections</p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Total Transactions</p>
            <p className="mt-2 text-2xl font-extrabold text-slate-900">{data.total}</p>
            <p className="mt-1 text-xs text-slate-400">Payments across all networks</p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
            <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Tokens Breakdown</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {Object.keys(data.tokens_breakdown || {}).length === 0 ? (
                <span className="text-xs text-slate-400">—</span>
              ) : (
                Object.entries(data.tokens_breakdown).map(([token, amt]) => (
                  <span
                    key={token}
                    className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700"
                  >
                    <strong>{amt}</strong> {token}
                  </span>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Transactions Table Card */}
      <Card>
        {loading && !data ? (
          <div className="space-y-3 py-6" aria-busy="true">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-12 animate-pulse rounded bg-slate-100" />
            ))}
          </div>
        ) : !data || data.items.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-base font-semibold text-slate-800">No transactions found</p>
            <p className="mt-1 text-xs text-slate-500">
              Payments made via your payment links and invoices will appear here automatically.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
              <thead className="bg-slate-50/70 font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="py-3 pl-4 pr-3">Date</th>
                  <th className="px-3 py-3">Source</th>
                  <th className="px-3 py-3">Payer Email</th>
                  <th className="px-3 py-3 text-right">Amount Paid</th>
                  <th className="px-3 py-3">Network / Payout Wallet</th>
                  <th className="px-3 py-3">Status</th>
                  <th className="py-3 pl-3 pr-4">Tx Hash</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 bg-white">
                {data.items.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-50/80 transition-colors">
                    {/* Date */}
                    <td className="whitespace-nowrap py-3.5 pl-4 pr-3 text-slate-600">
                      {formatDisplayDate(tx.created_at)}
                    </td>

                    {/* Source */}
                    <td className="whitespace-nowrap px-3 py-3.5">
                      <div className="flex flex-col gap-0.5">
                        <Badge variant={tx.source_type === 'payment_link' ? 'blue' : 'purple'}>
                          {tx.source_type === 'payment_link' ? 'Payment Link' : 'Invoice'}
                        </Badge>
                        <span className="text-[11px] font-medium text-slate-800 truncate max-w-[160px]" title={tx.source_title || ''}>
                          {tx.source_title || 'Direct payment'}
                        </span>
                      </div>
                    </td>

                    {/* Payer Email */}
                    <td className="whitespace-nowrap px-3 py-3.5 font-medium text-slate-900">
                      {tx.payer_email ? (
                        <span className="inline-flex items-center gap-1">
                          <svg className="h-3.5 w-3.5 text-slate-400" viewBox="0 0 20 20" fill="currentColor">
                            <path d="M3 4a2 2 0 00-2 2v1.161l8.441 4.221a1.25 1.25 0 001.118 0L19 7.162V6a2 2 0 00-2-2H3z" />
                            <path d="M19 8.839l-7.77 3.885a2.75 2.75 0 01-2.46 0L1 8.839V14a2 2 0 002 2h14a2 2 0 002-2V8.839z" />
                          </svg>
                          {tx.payer_email}
                        </span>
                      ) : (
                        <span className="text-slate-400 italic">Unspecified</span>
                      )}
                    </td>

                    {/* Amount Paid */}
                    <td className="whitespace-nowrap px-3 py-3.5 text-right font-mono font-bold text-slate-900">
                      <span className="text-emerald-600">
                        {tx.amount} {tx.token_symbol}
                      </span>
                    </td>

                    {/* Network & Payout Wallet */}
                    <td className="whitespace-nowrap px-3 py-3.5">
                      <div className="flex flex-col">
                        <span className="font-semibold capitalize text-slate-800">{tx.network}</span>
                        <span className="font-mono text-[11px] text-slate-400" title={tx.to_address}>
                          {truncate(tx.to_address, 6)}
                        </span>
                      </div>
                    </td>

                    {/* Status & Confirmations */}
                    <td className="whitespace-nowrap px-3 py-3.5">
                      <div className="flex items-center gap-1.5">
                        <Badge variant={statusVariant[tx.status.toLowerCase()] || 'default'}>
                          {tx.status}
                        </Badge>
                        {tx.confirmations > 0 && (
                          <span className="text-[10px] text-slate-400 font-mono">
                            ({tx.confirmations} conf)
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Tx Hash */}
                    <td className="whitespace-nowrap py-3.5 pl-3 pr-4 font-mono text-slate-500">
                      {tx.tx_hash ? (
                        <button
                          type="button"
                          onClick={() => copyToClipboard(tx.tx_hash!, tx.id)}
                          className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-0.5 text-[11px] hover:bg-slate-200 transition-colors"
                          title="Click to copy transaction hash"
                        >
                          {copiedId === tx.id ? 'Copied ✓' : truncate(tx.tx_hash, 6)}
                        </button>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {data && data.total_pages > 1 && (
          <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 sm:px-6">
            <p className="text-xs text-slate-500">
              Page {data.page} of {data.total_pages} ({data.total} total)
            </p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={data.page <= 1 || loading}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={data.page >= data.total_pages || loading}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}

