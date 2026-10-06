import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { AppShell } from '../../components/layout/AppShell'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { getGlobalPayers, type PaginatedAdminPayersResponse } from '../../services/admin'

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

export function AdminPayersDirectory() {
  const [data, setData] = useState<PaginatedAdminPayersResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')

  async function loadPayers(p = page, q = search) {
    setLoading(true)
    setError(null)
    try {
      const res = await getGlobalPayers(p, 20, q || undefined)
      setData(res)
    } catch {
      setError('Failed to load global payers directory.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPayers(page, search)
  }, [page, search])

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault()
    setSearch(searchInput.trim())
    setPage(1)
  }

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">Platform Payers Directory</h1>
            <p className="mt-1 text-sm text-slate-500">
              Global directory of all customer wallets and emails that have opened checkout sessions or made payments across the entire platform.
            </p>
          </div>

          <form onSubmit={handleSearchSubmit} className="flex items-center gap-2">
            <Input
              placeholder="Search payer email or name…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-60"
            />
            <Button type="submit" variant="secondary" size="sm">
              Search
            </Button>
            {search && (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  setSearch('')
                  setSearchInput('')
                  setPage(1)
                }}
              >
                Clear
              </Button>
            )}
          </form>
        </div>

        {/* Stats Cards */}
        {data && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Total Unique Payers</p>
              <p className="mt-2 text-2xl font-extrabold text-slate-900">{data.total}</p>
              <p className="mt-1 text-xs text-slate-400">Total customers across all merchants</p>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-xs">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Total Platform Volume</p>
              <p className="mt-2 text-2xl font-extrabold text-slate-900">
                ${parseFloat(data.total_volume_usd || '0').toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </p>
              <p className="mt-1 text-xs text-slate-400">Total USD volume settled from customers</p>
            </div>
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Table Card */}
        <Card>
          {loading && !data ? (
            <div className="space-y-3 py-6" aria-busy="true">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="h-12 animate-pulse rounded bg-slate-100" />
              ))}
            </div>
          ) : !data || data.items.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-base font-semibold text-slate-800">No payers found</p>
              <p className="mt-1 text-xs text-slate-500">
                {search ? 'No payers matched the search term.' : 'Completed payments and opened sessions will register payer records here.'}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                <thead className="bg-slate-50/70 font-semibold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="py-3 pl-4 pr-3">Payer Customer</th>
                    <th className="px-3 py-3">Merchants</th>
                    <th className="px-3 py-3">Payment Statuses & Attempts</th>
                    <th className="px-3 py-3 text-right">Total Spent (USD)</th>
                    <th className="px-3 py-3">Tokens & Networks</th>
                    <th className="py-3 pl-3 pr-4">Last Activity</th>
                    <th className="py-3 pr-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {data.items.map((payer) => (
                    <tr key={payer.email} className="hover:bg-slate-50/80 transition-colors group">
                      {/* Email / Name */}
                      <td className="whitespace-nowrap py-3.5 pl-4 pr-3">
                        <Link
                          to={`/admin/payers/${encodeURIComponent(payer.email)}`}
                          className="flex flex-col hover:underline text-indigo-600 font-semibold"
                        >
                          <span className="font-semibold text-slate-900 group-hover:text-indigo-600 transition-colors">
                            {payer.email}
                          </span>
                          {payer.name && (
                            <span className="text-[11px] text-slate-500">{payer.name}</span>
                          )}
                        </Link>
                      </td>

                      {/* Merchants */}
                      <td className="whitespace-nowrap px-3 py-3.5">
                        <div className="flex flex-wrap gap-1 max-w-[200px]">
                          {payer.merchants.map((m) => (
                            <span
                              key={m}
                              className="inline-flex rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 border border-blue-100"
                            >
                              {m}
                            </span>
                          ))}
                        </div>
                      </td>

                      {/* Status Breakdown & Total Payments */}
                      <td className="whitespace-nowrap px-3 py-3.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          {(payer.successful_payments ?? 0) > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-700 border border-emerald-200">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                              {payer.successful_payments} Paid
                            </span>
                          )}
                          {(payer.pending_payments ?? 0) > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700 border border-blue-200">
                              <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
                              {payer.pending_payments} Pending
                            </span>
                          )}
                          {(payer.expired_payments ?? 0) > 0 && (
                            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-700 border border-amber-200">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                              {payer.expired_payments} Expired
                            </span>
                          )}
                          {!payer.successful_payments && !payer.pending_payments && !payer.expired_payments && (
                            <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                              {payer.total_payments} Attempt(s)
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Total Volume */}
                      <td className="whitespace-nowrap px-3 py-3.5 text-right font-mono font-bold text-emerald-600">
                        ${parseFloat(payer.total_volume_usd || '0').toLocaleString('en-US', { minimumFractionDigits: 2 })}
                      </td>

                      {/* Tokens & Networks */}
                      <td className="whitespace-nowrap px-3 py-3.5">
                        <div className="flex flex-wrap gap-1">
                          {payer.tokens_used.map((t) => (
                            <span
                              key={t}
                              className="inline-flex rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700"
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      </td>

                      {/* Last Payment Date */}
                      <td className="whitespace-nowrap py-3.5 pl-3 pr-4 text-slate-500">
                        {formatDisplayDate(payer.last_payment_at || payer.first_seen_at)}
                      </td>

                      {/* Action */}
                      <td className="whitespace-nowrap py-3.5 pr-4 text-right">
                        <Link
                          to={`/admin/payers/${encodeURIComponent(payer.email)}`}
                          className="inline-flex items-center rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 transition-colors"
                        >
                          View Logs →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Pagination */}
          {data && data.pages > 1 && (
            <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 sm:px-6">
              <p className="text-xs text-slate-500">
                Page {data.page} of {data.pages} ({data.total} total)
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
                  disabled={data.page >= data.pages || loading}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  )
}
