import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppShell } from '../../components/layout/AppShell'
import { ProtectedRoute } from '../../components/routing/ProtectedRoute'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { Pagination } from '../../components/ui/Pagination'
import { Button } from '../../components/ui/Button'
import { listMerchants, type MerchantListItem } from '../../services/admin'

const PAGE_SIZE = 20

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function MerchantList() {
  const navigate = useNavigate()

  const [merchants, setMerchants] = useState<MerchantListItem[]>([])
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(1)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)

  const fetchMerchants = useCallback(async (targetPage: number) => {
    setLoading(true)
    setFetchError(false)
    try {
      const data = await listMerchants(targetPage, PAGE_SIZE)
      setMerchants(data.items)
      setTotal(data.total)
      setPages(data.pages)
      setPage(data.page)
    } catch {
      setFetchError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchMerchants(1)
  }, [fetchMerchants])

  function handlePageChange(newPage: number) {
    fetchMerchants(newPage)
  }

  function handleRowClick(userId: string) {
    navigate(`/admin/merchants/${userId}`)
  }

  function handleRowKeyDown(e: React.KeyboardEvent, userId: string) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      navigate(`/admin/merchants/${userId}`)
    }
  }

  if (fetchError) {
    return (
      <ProtectedRoute requiredRole="admin">
        <AppShell>
          <div
            className="rounded-lg border border-red-200 bg-red-50 p-6 text-center"
            role="alert"
            aria-live="assertive"
          >
            <p className="text-sm text-red-600">Failed to load merchants. Please try again.</p>
            <Button
              variant="secondary"
              size="sm"
              className="mt-3"
              onClick={() => fetchMerchants(page)}
            >
              Retry
            </Button>
          </div>
        </AppShell>
      </ProtectedRoute>
    )
  }

  return (
    <ProtectedRoute requiredRole="admin">
      <AppShell>
        <div className="space-y-6">
          {/* Page header */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-xl font-semibold text-slate-900">Merchant KYC & Accounts</h1>
              <p className="mt-0.5 text-sm text-slate-500">Review submitted KYC documents and manage merchant accounts.</p>
            </div>

            <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1 w-fit">
              <span className="rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 shadow-sm">
                Merchant KYC
              </span>
              <button
                type="button"
                onClick={() => navigate('/admin/verification')}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors"
              >
                Developer Queue →
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="space-y-0">
            {/* Visible header row */}
            <div className="overflow-x-auto rounded-t-lg border border-b-0 border-slate-200">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th
                      scope="col"
                      className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500"
                    >
                      Merchant Name
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500"
                    >
                      Email
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500"
                    >
                      Onboarding Status
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500"
                    >
                      KYC Status
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500"
                    >
                      Wallets
                    </th>
                    <th
                      scope="col"
                      className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500 min-w-[120px]"
                    >
                      Created
                    </th>
                  </tr>
                </thead>
              </table>
            </div>

            {/* Body */}
            <div className="overflow-x-auto border border-t-0 border-slate-200">
              <table className="min-w-full divide-y divide-slate-100 text-sm">
                <thead className="sr-only">
                  <tr>
                    <th>Merchant Name</th>
                    <th>Email</th>
                    <th>Onboarding Status</th>
                    <th>KYC Status</th>
                    <th>Wallets</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {loading ? (
                    Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i}>
                        {Array.from({ length: 6 }).map((__, j) => (
                          <td key={j} className="px-4 py-3">
                            <div className="h-4 w-full animate-pulse rounded bg-slate-200" />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : merchants.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-8 text-center text-slate-400"
                      >
                        No merchants found.
                      </td>
                    </tr>
                  ) : (
                    merchants.map((item) => (
                      <tr
                        key={item.user_id}
                        className="cursor-pointer transition-colors hover:bg-slate-50 focus-within:bg-slate-50"
                        onClick={() => handleRowClick(item.user_id)}
                        onKeyDown={(e) => handleRowKeyDown(e, item.user_id)}
                        tabIndex={0}
                        role="link"
                        aria-label={`View details for ${item.full_name || item.email}`}
                      >
                        <td className="px-4 py-3">
                          <span
                            className="block max-w-[180px] truncate text-slate-800"
                            title={item.full_name || undefined}
                          >
                            {item.full_name || '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className="block max-w-[200px] truncate text-slate-700"
                            title={item.email}
                          >
                            {item.email}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={item.onboarding_status} />
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={item.kyc_status} />
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {item.wallet_count}
                        </td>
                        <td className="px-4 py-3 min-w-[120px]">
                          <time
                            dateTime={item.created_at}
                            className="whitespace-nowrap text-xs text-slate-500"
                          >
                            {formatDate(item.created_at)}
                          </time>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            <div className="rounded-b-lg border border-t-0 border-slate-200 bg-white">
              <Pagination
                page={page}
                pages={pages}
                pageSize={PAGE_SIZE}
                total={total}
                onPageChange={handlePageChange}
              />
            </div>
          </div>
        </div>
      </AppShell>
    </ProtectedRoute>
  )
}
