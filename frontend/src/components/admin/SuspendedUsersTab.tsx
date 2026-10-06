import { useCallback, useEffect, useState } from 'react'
import { apiClient } from '../../lib/api'
import { StatusBadge } from '../ui/StatusBadge'
import { Pagination } from '../ui/Pagination'
import { Button } from '../ui/Button'
import { Modal } from '../ui/Modal'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SuspendedUser {
  id: string
  email: string
  account_type: string
  status: string
  created_at: string
}

interface PaginatedSuspendedUsers {
  items: SuspendedUser[]
  total: number
  page: number
  page_size: number
  pages: number
}

interface AppealItem {
  id: string
  user_id: string
  user_email: string
  user_full_name: string
  suspension_reason: string | null
  suspension_message: string | null
  message: string
  status: string
  admin_note: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
}

interface PaginatedAppeals {
  items: AppealItem[]
  total: number
  page: number
  page_size: number
  pages: number
}

const REASON_LABELS: Record<string, string> = {
  policy_violation: 'Policy Violation',
  fraud: 'Fraudulent Activity',
  spam: 'Spam or Abuse',
  identity_verification_failed: 'Identity Verification Failed',
  other: 'Other',
}

const PAGE_SIZE = 20

// ---------------------------------------------------------------------------
// Sub-component: Suspended users list
// ---------------------------------------------------------------------------

interface SuspendedUsersListProps {
  isSuperadmin: boolean
  onReactivate: (userId: string, email: string) => void
  refreshTrigger: number
}

function SuspendedUsersList({ isSuperadmin, onReactivate, refreshTrigger }: SuspendedUsersListProps) {
  const [users, setUsers] = useState<SuspendedUser[]>([])
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(1)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)

  const fetchUsers = useCallback(async (targetPage: number) => {
    setLoading(true)
    setFetchError(false)
    try {
      const { data } = await apiClient.get<PaginatedSuspendedUsers>('/admin/suspended-users', {
        params: { page: targetPage, page_size: PAGE_SIZE },
      })
      setUsers(data.items)
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
    fetchUsers(page)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchUsers, refreshTrigger])

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  if (fetchError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center" role="alert">
        <p className="text-sm text-red-600">Failed to load suspended users.</p>
        <Button variant="secondary" size="sm" className="mt-3" onClick={() => fetchUsers(page)}>
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-0">
      <div className="overflow-x-auto rounded-t-lg border border-b-0 border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Email</th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Account Type</th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Registered</th>
              {isSuperadmin && (
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Actions</th>
              )}
            </tr>
          </thead>
        </table>
      </div>

      <div className="overflow-x-auto border border-t-0 border-b-0 border-slate-200">
        <table className="min-w-full divide-y divide-slate-100 text-sm">
          <tbody className="divide-y divide-slate-100 bg-white">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: isSuperadmin ? 4 : 3 }).map((__, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-4 w-full animate-pulse rounded bg-slate-200" />
                    </td>
                  ))}
                </tr>
              ))
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={isSuperadmin ? 4 : 3} className="px-4 py-8 text-center text-slate-400">
                  No suspended users.
                </td>
              </tr>
            ) : (
              users.map((u) => (
                <tr key={u.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-800">{u.email}</td>
                  <td className="px-4 py-3 text-slate-600 capitalize">{u.account_type}</td>
                  <td className="px-4 py-3 text-slate-500">{formatDate(u.created_at)}</td>
                  {isSuperadmin && (
                    <td className="px-4 py-3">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => onReactivate(u.id, u.email)}
                      >
                        Reactivate
                      </Button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-b-lg border border-t-0 border-slate-200 bg-white">
        <Pagination
          page={page}
          pages={pages}
          pageSize={PAGE_SIZE}
          total={total}
          onPageChange={(p) => fetchUsers(p)}
        />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-component: Appeal detail modal
// ---------------------------------------------------------------------------

interface AppealDetailModalProps {
  appeal: AppealItem
  isSuperadmin: boolean
  onClose: () => void
  onReviewed: () => void
}

function AppealDetailModal({ appeal, isSuperadmin, onClose, onReviewed }: AppealDetailModalProps) {
  const [decision, setDecision] = useState<'approved' | 'rejected' | ''>('')
  const [adminNote, setAdminNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    if (!decision) return
    setLoading(true)
    setError(null)
    try {
      await apiClient.patch(`/admin/appeals/${appeal.id}`, {
        decision,
        admin_note: adminNote.trim() || null,
      })
      onReviewed()
      onClose()
    } catch {
      setError('Failed to submit review. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const reasonLabel = appeal.suspension_reason
    ? (REASON_LABELS[appeal.suspension_reason] ?? appeal.suspension_reason)
    : null

  const isPending = appeal.status === 'pending'

  return (
    <Modal isOpen title={`Appeal — ${appeal.user_email}`} onClose={onClose} className="max-w-xl">
      {/* User info */}
      <section className="space-y-1 rounded-md border border-slate-100 bg-slate-50 px-4 py-3">
        <p className="text-sm font-medium text-slate-800">{appeal.user_full_name}</p>
        <p className="text-xs text-slate-500">{appeal.user_email}</p>
      </section>

      {/* Suspension context */}
      {(reasonLabel || appeal.suspension_message) && (
        <section className="mt-4 space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Suspension Details
          </p>
          {reasonLabel && (
            <p className="text-sm text-slate-700">
              <span className="font-medium">Reason:</span>{' '}
              <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                {reasonLabel}
              </span>
            </p>
          )}
          {appeal.suspension_message && (
            <p className="mt-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              {appeal.suspension_message}
            </p>
          )}
        </section>
      )}

      {/* Appeal message */}
      <section className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
          User's Appeal
        </p>
        <p className="mt-1 rounded-md border border-slate-200 bg-white px-3 py-3 text-sm text-slate-700 leading-relaxed whitespace-pre-wrap">
          {appeal.message}
        </p>
        <p className="mt-1 text-xs text-slate-400">
          Submitted {new Date(appeal.created_at).toLocaleString()}
        </p>
      </section>

      {/* Current status (already reviewed) */}
      {!isPending && (
        <section className="mt-4 rounded-md border border-slate-100 bg-slate-50 px-4 py-3 space-y-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Decision</p>
          <div className="flex items-center gap-2">
            <StatusBadge
              status={appeal.status as 'active' | 'suspended' | 'unverified' | 'verified'}
            />
            {appeal.reviewed_at && (
              <span className="text-xs text-slate-400">
                {new Date(appeal.reviewed_at).toLocaleString()}
              </span>
            )}
          </div>
          {appeal.admin_note && (
            <p className="text-sm text-slate-600">{appeal.admin_note}</p>
          )}
        </section>
      )}

      {/* Review form (superadmin + pending only) */}
      {isSuperadmin && isPending && (
        <section className="mt-5 space-y-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Your Decision
          </p>

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setDecision('approved')}
              className={[
                'flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1',
                decision === 'approved'
                  ? 'border-green-500 bg-green-50 text-green-700 ring-2 ring-green-400 ring-offset-1'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50',
              ].join(' ')}
            >
              ✓ Approve &amp; Reactivate
            </button>
            <button
              type="button"
              onClick={() => setDecision('rejected')}
              className={[
                'flex-1 rounded-md border px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-1',
                decision === 'rejected'
                  ? 'border-red-400 bg-red-50 text-red-700 ring-2 ring-red-400 ring-offset-1'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50',
              ].join(' ')}
            >
              ✗ Reject
            </button>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="admin-note" className="text-sm font-medium text-slate-700">
              Note to user <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <textarea
              id="admin-note"
              rows={3}
              disabled={loading}
              placeholder="Add a note explaining your decision…"
              value={adminNote}
              onChange={(e) => setAdminNote(e.target.value)}
              maxLength={2000}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 resize-y focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:cursor-not-allowed disabled:bg-slate-50"
            />
          </div>

          {error && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-3">
            <Button variant="secondary" size="md" onClick={onClose} disabled={loading}>
              Cancel
            </Button>
            <Button
              variant={decision === 'approved' ? 'primary' : 'danger'}
              size="md"
              loading={loading}
              disabled={!decision}
              onClick={handleSubmit}
            >
              Confirm Decision
            </Button>
          </div>
        </section>
      )}

      {/* Close only (non-superadmin or already reviewed) */}
      {(!isSuperadmin || !isPending) && (
        <div className="mt-6 flex justify-end">
          <Button variant="secondary" size="md" onClick={onClose}>
            Close
          </Button>
        </div>
      )}
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Sub-component: Appeals queue
// ---------------------------------------------------------------------------

interface AppealsQueueProps {
  isSuperadmin: boolean
  refreshTrigger: number
  onRefresh: () => void
}

type AppealFilter = 'pending' | 'approved' | 'rejected' | 'all'

function AppealsQueue({ isSuperadmin, refreshTrigger, onRefresh }: AppealsQueueProps) {
  const [appeals, setAppeals] = useState<AppealItem[]>([])
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(1)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)
  const [filter, setFilter] = useState<AppealFilter>('pending')
  const [selectedAppeal, setSelectedAppeal] = useState<AppealItem | null>(null)

  const fetchAppeals = useCallback(
    async (targetPage: number, statusFilter: AppealFilter) => {
      setLoading(true)
      setFetchError(false)
      try {
        const params: Record<string, unknown> = {
          page: targetPage,
          page_size: PAGE_SIZE,
        }
        if (statusFilter !== 'all') params.status = statusFilter

        const { data } = await apiClient.get<PaginatedAppeals>('/admin/appeals', { params })
        setAppeals(data.items)
        setTotal(data.total)
        setPages(data.pages)
        setPage(data.page)
      } catch {
        setFetchError(true)
      } finally {
        setLoading(false)
      }
    },
    [],
  )

  useEffect(() => {
    fetchAppeals(1, filter)
  }, [fetchAppeals, filter, refreshTrigger])

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  const filterTabs: { label: string; value: AppealFilter }[] = [
    { label: 'Pending', value: 'pending' },
    { label: 'Approved', value: 'approved' },
    { label: 'Rejected', value: 'rejected' },
    { label: 'All', value: 'all' },
  ]

  if (fetchError) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center" role="alert">
        <p className="text-sm text-red-600">Failed to load appeals.</p>
        <Button variant="secondary" size="sm" className="mt-3" onClick={() => fetchAppeals(page, filter)}>
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Filter tabs */}
      <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 w-fit">
        {filterTabs.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => {
              setFilter(tab.value)
              setPage(1)
            }}
            className={[
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400',
              filter === tab.value
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700',
            ].join(' ')}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="space-y-0">
        <div className="overflow-x-auto rounded-t-lg border border-b-0 border-slate-200">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">User</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Reason</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Status</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">Submitted</th>
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                  <span className="sr-only">View</span>
                </th>
              </tr>
            </thead>
          </table>
        </div>

        <div className="overflow-x-auto border border-t-0 border-b-0 border-slate-200">
          <table className="min-w-full divide-y divide-slate-100 text-sm">
            <tbody className="divide-y divide-slate-100 bg-white">
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i}>
                    {Array.from({ length: 5 }).map((__, j) => (
                      <td key={j} className="px-4 py-3">
                        <div className="h-4 w-full animate-pulse rounded bg-slate-200" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : appeals.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                    No {filter === 'all' ? '' : filter} appeals found.
                  </td>
                </tr>
              ) : (
                appeals.map((appeal) => (
                  <tr key={appeal.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-800 truncate max-w-[200px]">
                        {appeal.user_full_name || appeal.user_email}
                      </p>
                      <p className="text-xs text-slate-400 truncate max-w-[200px]">
                        {appeal.user_email}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {appeal.suspension_reason
                        ? (REASON_LABELS[appeal.suspension_reason] ?? appeal.suspension_reason)
                        : <span className="text-slate-400">—</span>
                      }
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={[
                          'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                          appeal.status === 'pending'
                            ? 'bg-amber-100 text-amber-800'
                            : appeal.status === 'approved'
                            ? 'bg-green-100 text-green-800'
                            : 'bg-red-100 text-red-800',
                        ].join(' ')}
                      >
                        {appeal.status.charAt(0).toUpperCase() + appeal.status.slice(1)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(appeal.created_at)}</td>
                    <td className="px-4 py-3">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => setSelectedAppeal(appeal)}
                      >
                        {isSuperadmin && appeal.status === 'pending' ? 'Review' : 'View'}
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="rounded-b-lg border border-t-0 border-slate-200 bg-white">
          <Pagination
            page={page}
            pages={pages}
            pageSize={PAGE_SIZE}
            total={total}
            onPageChange={(p) => fetchAppeals(p, filter)}
          />
        </div>
      </div>

      {/* Appeal detail modal */}
      {selectedAppeal && (
        <AppealDetailModal
          appeal={selectedAppeal}
          isSuperadmin={isSuperadmin}
          onClose={() => setSelectedAppeal(null)}
          onReviewed={() => {
            onRefresh()
            fetchAppeals(page, filter)
          }}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main export: SuspendedUsersTab
// ---------------------------------------------------------------------------

export interface SuspendedUsersTabProps {
  isSuperadmin: boolean
  onReactivate: (userId: string, email: string) => void
  refreshTrigger: number
  onRefresh: () => void
}

export function SuspendedUsersTab({
  isSuperadmin,
  onReactivate,
  refreshTrigger,
  onRefresh,
}: SuspendedUsersTabProps) {
  const [section, setSection] = useState<'suspended' | 'appeals'>('suspended')

  const sectionTabs = [
    { label: 'Suspended Accounts', value: 'suspended' as const },
    { label: 'Appeals Queue', value: 'appeals' as const },
  ]

  return (
    <div className="space-y-4">
      {/* Section switcher */}
      <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 w-fit">
        {sectionTabs.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setSection(tab.value)}
            className={[
              'rounded-md px-4 py-1.5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400',
              section === tab.value
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700',
            ].join(' ')}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {section === 'suspended' ? (
        <SuspendedUsersList
          isSuperadmin={isSuperadmin}
          onReactivate={onReactivate}
          refreshTrigger={refreshTrigger}
        />
      ) : (
        <AppealsQueue
          isSuperadmin={isSuperadmin}
          refreshTrigger={refreshTrigger}
          onRefresh={onRefresh}
        />
      )}
    </div>
  )
}
