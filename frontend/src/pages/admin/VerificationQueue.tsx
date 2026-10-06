import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AppShell } from '../../components/layout/AppShell'
import { ProtectedRoute } from '../../components/routing/ProtectedRoute'
import { Modal } from '../../components/ui/Modal'
import { Button } from '../../components/ui/Button'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { Pagination } from '../../components/ui/Pagination'
import { apiClient } from '../../lib/api'
import { AxiosError } from 'axios'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type VerificationStatus = 'pending' | 'approved' | 'rejected'

interface VerificationRequest {
  id: string
  developer_id: string
  developer_email: string
  full_legal_name: string
  country: string
  business_type: string
  website_url: string
  intended_use: string
  status: VerificationStatus
  rejection_reason: string | null
  submitted_at: string
  reviewed_at: string | null
}

interface PaginatedVerificationRequests {
  items: VerificationRequest[]
  total: number
  page: number
  page_size: number
  pages: number
}

type FilterStatus = 'all' | VerificationStatus

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

// ---------------------------------------------------------------------------
// Filter tabs
// ---------------------------------------------------------------------------

const STATUS_FILTERS: { label: string; value: FilterStatus }[] = [
  { label: 'All', value: 'all' },
  { label: 'Pending', value: 'pending' },
  { label: 'Approved', value: 'approved' },
  { label: 'Rejected', value: 'rejected' },
]

// ---------------------------------------------------------------------------
// Detail field row
// ---------------------------------------------------------------------------

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-x-4 gap-y-1 py-2 text-sm border-b border-slate-100 last:border-b-0">
      <dt className="font-medium text-slate-500">{label}</dt>
      <dd className="break-words text-slate-800">{value}</dd>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

const PAGE_SIZE = 20

export function VerificationQueue() {
  const navigate = useNavigate()
  const [requests, setRequests] = useState<VerificationRequest[]>([])
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(1)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)

  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all')

  // Detail modal
  const [detailItem, setDetailItem] = useState<VerificationRequest | null>(null)

  // Approve modal
  const [approvingId, setApprovingId] = useState<string | null>(null)
  const [approveLoading, setApproveLoading] = useState(false)

  // Reject modal
  const [rejectingItem, setRejectingItem] = useState<VerificationRequest | null>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [rejectReasonError, setRejectReasonError] = useState<string | null>(null)
  const [rejectLoading, setRejectLoading] = useState(false)

  // Banners
  const [errorBanner, setErrorBanner] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [refreshTrigger, setRefreshTrigger] = useState(0)

  useEffect(() => {
    if (successMessage) {
      if (successTimerRef.current) clearTimeout(successTimerRef.current)
      successTimerRef.current = setTimeout(() => setSuccessMessage(null), 3000)
    }
    return () => {
      if (successTimerRef.current) clearTimeout(successTimerRef.current)
    }
  }, [successMessage])

  // Fetch list
  const fetchRequests = useCallback(
    async (targetPage: number) => {
      setLoading(true)
      setFetchError(false)
      try {
        const params: Record<string, unknown> = {
          page: targetPage,
          page_size: PAGE_SIZE,
        }
        if (statusFilter !== 'all') {
          params.status = statusFilter
        }
        const { data } = await apiClient.get<PaginatedVerificationRequests>(
          '/admin/verification-requests',
          { params },
        )
        setRequests(data.items)
        setTotal(data.total)
        setPages(data.pages)
        setPage(data.page)
      } catch {
        setFetchError(true)
      } finally {
        setLoading(false)
      }
    },
    [statusFilter],
  )

  useEffect(() => {
    fetchRequests(1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, refreshTrigger])

  function handlePageChange(newPage: number) {
    fetchRequests(newPage)
  }

  // Filter tab change resets to page 1
  function handleFilterChange(value: FilterStatus) {
    setStatusFilter(value)
    setPage(1)
  }

  // ---------------------------------------------------------------------------
  // Approve
  // ---------------------------------------------------------------------------

  async function handleApproveConfirm() {
    if (!approvingId) return
    setApproveLoading(true)
    try {
      await apiClient.post(`/admin/verification-requests/${approvingId}/approve`)
      setApprovingId(null)
      setRefreshTrigger((t) => t + 1)
      setSuccessMessage('Verification request approved.')
    } catch (err) {
      const axiosErr = err as AxiosError<{ detail?: string }>
      setApprovingId(null)
      setErrorBanner(
        axiosErr.response?.data?.detail ?? 'Failed to approve request. Please try again.',
      )
    } finally {
      setApproveLoading(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Reject
  // ---------------------------------------------------------------------------

  function openRejectModal(item: VerificationRequest) {
    setRejectingItem(item)
    setRejectReason('')
    setRejectReasonError(null)
  }

  function closeRejectModal() {
    if (rejectLoading) return
    setRejectingItem(null)
    setRejectReason('')
    setRejectReasonError(null)
  }

  async function handleRejectConfirm() {
    if (!rejectingItem) return
    if (!rejectReason.trim()) {
      setRejectReasonError('A rejection reason is required.')
      return
    }
    setRejectLoading(true)
    try {
      await apiClient.post(
        `/admin/verification-requests/${rejectingItem.id}/reject`,
        { reason: rejectReason.trim() },
      )
      setRejectingItem(null)
      setRefreshTrigger((t) => t + 1)
      setSuccessMessage('Verification request rejected.')
    } catch (err) {
      const axiosErr = err as AxiosError<{ detail?: string }>
      setRejectingItem(null)
      setErrorBanner(
        axiosErr.response?.data?.detail ?? 'Failed to reject request. Please try again.',
      )
    } finally {
      setRejectLoading(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const colCount = 6

  return (
    <ProtectedRoute requiredRole="admin">
      <AppShell>
        <div className="space-y-6">
          {/* Page header */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-xl font-semibold text-slate-900">Developer Verification Queue</h1>
              <p className="mt-0.5 text-sm text-slate-500">
                Review and action developer live API key verification requests.
              </p>
            </div>

            <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-100 p-1 w-fit">
              <span className="rounded-md bg-white px-3 py-1.5 text-xs font-semibold text-slate-900 shadow-sm">
                Developer Requests
              </span>
              <button
                type="button"
                onClick={() => navigate('/admin/merchants')}
                className="rounded-md px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors"
              >
                Merchant KYC Review →
              </button>
            </div>
          </div>

          {/* Error banner */}
          {errorBanner && (
            <div
              className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-3"
              role="alert"
              aria-live="assertive"
            >
              <p className="text-sm font-medium text-red-700">{errorBanner}</p>
              <button
                type="button"
                onClick={() => setErrorBanner(null)}
                aria-label="Dismiss error"
                className="ml-4 rounded p-1 text-red-500 hover:bg-red-100 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-1"
              >
                <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path
                    fillRule="evenodd"
                    d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            </div>
          )}

          {/* Success banner */}
          {successMessage && (
            <div
              className="rounded-lg border border-green-200 bg-green-50 px-4 py-3"
              role="status"
              aria-live="polite"
            >
              <p className="text-sm font-medium text-green-700">{successMessage}</p>
            </div>
          )}

          {/* Status filter tabs */}
          <div
            className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 w-fit"
            role="tablist"
            aria-label="Filter by status"
          >
            {STATUS_FILTERS.map(({ label, value }) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={statusFilter === value}
                onClick={() => handleFilterChange(value)}
                className={[
                  'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
                  'focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1',
                  statusFilter === value
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-500 hover:text-slate-700',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Table */}
          {fetchError ? (
            <div
              className="rounded-lg border border-red-200 bg-red-50 p-6 text-center"
              role="alert"
            >
              <p className="text-sm text-red-600">Failed to load verification requests. Please try again.</p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-3"
                onClick={() => fetchRequests(page)}
              >
                Retry
              </Button>
            </div>
          ) : (
            <div className="space-y-0">
              {/* Header row */}
              <div className="overflow-x-auto rounded-t-lg border border-b-0 border-slate-200">
                <table className="min-w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                        Developer
                      </th>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                        Country
                      </th>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                        Business Type
                      </th>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                        Status
                      </th>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500 min-w-[120px]">
                        Submitted
                      </th>
                      <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500 min-w-[200px]">
                        Actions
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
                      <th>Developer</th>
                      <th>Country</th>
                      <th>Business Type</th>
                      <th>Status</th>
                      <th>Submitted</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {loading ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <tr key={i}>
                          {Array.from({ length: colCount }).map((__, j) => (
                            <td key={j} className="px-4 py-3">
                              <div className="h-4 w-full animate-pulse rounded bg-slate-200" />
                            </td>
                          ))}
                        </tr>
                      ))
                    ) : requests.length === 0 ? (
                      <tr>
                        <td
                          colSpan={colCount}
                          className="px-4 py-10 text-center text-slate-400"
                        >
                          No verification requests found.
                        </td>
                      </tr>
                    ) : (
                      requests.map((row) => (
                        <tr key={row.id} className="transition-colors hover:bg-slate-50">
                          {/* Developer */}
                          <td className="px-4 py-3">
                            <div>
                              <span
                                className="block max-w-[200px] truncate font-medium text-slate-800"
                                title={row.developer_email}
                              >
                                {row.developer_email}
                              </span>
                              <span className="block max-w-[200px] truncate text-xs text-slate-500" title={row.full_legal_name}>
                                {row.full_legal_name}
                              </span>
                            </div>
                          </td>

                          {/* Country */}
                          <td className="px-4 py-3 text-slate-700">{row.country}</td>

                          {/* Business type */}
                          <td className="px-4 py-3 text-slate-700">{row.business_type}</td>

                          {/* Status */}
                          <td className="px-4 py-3">
                            <StatusBadge status={row.status} />
                          </td>

                          {/* Submitted date */}
                          <td className="px-4 py-3 min-w-[120px]">
                            <time dateTime={row.submitted_at} className="whitespace-nowrap text-xs text-slate-500">
                              {formatDate(row.submitted_at)}
                            </time>
                          </td>

                          {/* Actions */}
                          <td className="px-4 py-3 min-w-[200px]">
                            <div
                              className="flex flex-wrap items-center gap-2"
                              role="group"
                              aria-label={`Actions for ${row.developer_email}`}
                            >
                              <Button
                                variant="secondary"
                                size="sm"
                                onClick={() => setDetailItem(row)}
                              >
                                View
                              </Button>
                              {row.status === 'pending' && (
                                <>
                                  <Button
                                    variant="primary"
                                    size="sm"
                                    onClick={() => setApprovingId(row.id)}
                                  >
                                    Approve
                                  </Button>
                                  <Button
                                    variant="danger"
                                    size="sm"
                                    onClick={() => openRejectModal(row)}
                                  >
                                    Reject
                                  </Button>
                                </>
                              )}
                            </div>
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
          )}
        </div>

        {/* ---------- Detail modal ---------- */}
        {detailItem && (
          <Modal
            isOpen={true}
            onClose={() => setDetailItem(null)}
            title="Verification Request Detail"
            className="max-w-xl"
          >
            <dl>
              <DetailRow label="Full Legal Name" value={detailItem.full_legal_name} />
              <DetailRow label="Country" value={detailItem.country} />
              <DetailRow label="Business Type" value={detailItem.business_type} />
              <DetailRow label="Website URL" value={detailItem.website_url} />
              <DetailRow label="Intended Use" value={detailItem.intended_use} />
              <DetailRow label="Status" value={detailItem.status.charAt(0).toUpperCase() + detailItem.status.slice(1)} />
              <DetailRow label="Submitted" value={formatDate(detailItem.submitted_at)} />
              {detailItem.rejection_reason && (
                <DetailRow label="Rejection Reason" value={detailItem.rejection_reason} />
              )}
            </dl>

            <div className="mt-6 flex items-center justify-between gap-3">
              {/* Approve / Reject shortcuts from detail view */}
              {detailItem.status === 'pending' && (
                <div className="flex gap-2">
                  <Button
                    variant="primary"
                    size="md"
                    onClick={() => {
                      setDetailItem(null)
                      setApprovingId(detailItem.id)
                    }}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="danger"
                    size="md"
                    onClick={() => {
                      const item = detailItem
                      setDetailItem(null)
                      openRejectModal(item)
                    }}
                  >
                    Reject
                  </Button>
                </div>
              )}
              <div className="ml-auto">
                <Button variant="secondary" size="md" onClick={() => setDetailItem(null)}>
                  Close
                </Button>
              </div>
            </div>
          </Modal>
        )}

        {/* ---------- Approve confirmation modal ---------- */}
        {approvingId && (
          <Modal
            isOpen={true}
            onClose={() => { if (!approveLoading) setApprovingId(null) }}
            title="Approve Verification Request"
          >
            <p className="text-sm text-slate-600">
              This will mark the developer as verified and grant them production API access.
              Are you sure?
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <Button
                variant="secondary"
                size="md"
                onClick={() => setApprovingId(null)}
                disabled={approveLoading}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="md"
                loading={approveLoading}
                onClick={handleApproveConfirm}
              >
                Approve
              </Button>
            </div>
          </Modal>
        )}

        {/* ---------- Reject modal ---------- */}
        {rejectingItem && (
          <Modal
            isOpen={true}
            onClose={closeRejectModal}
            title="Reject Verification Request"
          >
            <p className="text-sm text-slate-600">
              Please provide a reason for rejecting{' '}
              <span className="font-medium">{rejectingItem.developer_email}</span>. This
              reason will be sent to the developer by email.
            </p>

            <div className="mt-4">
              <label
                htmlFor="reject-reason"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Rejection reason <span className="text-red-500" aria-hidden="true">*</span>
              </label>
              <textarea
                id="reject-reason"
                rows={4}
                value={rejectReason}
                onChange={(e) => {
                  setRejectReason(e.target.value)
                  if (rejectReasonError) setRejectReasonError(null)
                }}
                aria-required="true"
                aria-describedby={rejectReasonError ? 'reject-reason-error' : undefined}
                aria-invalid={rejectReasonError ? 'true' : 'false'}
                placeholder="Explain why the request is being rejected..."
                className={[
                  'w-full resize-y rounded-md border px-3 py-2 text-sm text-slate-800 shadow-sm',
                  'placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1',
                  rejectReasonError
                    ? 'border-red-400 focus:ring-red-400'
                    : 'border-slate-300',
                ].join(' ')}
              />
              {rejectReasonError && (
                <p
                  id="reject-reason-error"
                  role="alert"
                  className="mt-1 text-xs text-red-600"
                >
                  {rejectReasonError}
                </p>
              )}
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <Button
                variant="secondary"
                size="md"
                onClick={closeRejectModal}
                disabled={rejectLoading}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                size="md"
                loading={rejectLoading}
                onClick={handleRejectConfirm}
              >
                Reject
              </Button>
            </div>
          </Modal>
        )}
      </AppShell>
    </ProtectedRoute>
  )
}
