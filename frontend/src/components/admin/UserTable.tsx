import { useCallback, useEffect, useState } from 'react'
import { apiClient } from '../../lib/api'
import { useAuthStore } from '../../lib/auth-store'
import { StatusBadge } from '../ui/StatusBadge'
import { Pagination } from '../ui/Pagination'
import { Button } from '../ui/Button'

// Must satisfy Record<string, unknown> for the Table generic constraint
export interface UserRow extends Record<string, unknown> {
  id: string
  email: string
  role: string
  account_type: string
  status: string
  created_at: string
}

interface PaginatedUsers {
  items: UserRow[]
  total: number
  page: number
  page_size: number
  pages: number
}

export interface UserTableProps {
  isSuperadmin: boolean
  onSuspend: (userId: string, email: string) => void
  onReactivate: (userId: string, email: string) => void
  onPromote: (userId: string, email: string) => void
  refreshTrigger: number
}

type SortOrder = 'asc' | 'desc'
type SortableColumn = 'email' | 'role' | 'status' | 'created_at'

const PAGE_SIZE = 20

function SortIcon({ column, sortBy, sortOrder }: { column: SortableColumn; sortBy: SortableColumn | null; sortOrder: SortOrder }) {
  const active = sortBy === column
  if (!active) {
    return (
      <svg className="ml-1 inline h-3.5 w-3.5 text-slate-300" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
      </svg>
    )
  }
  if (sortOrder === 'asc') {
    return (
      <svg className="ml-1 inline h-3.5 w-3.5 text-slate-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path fillRule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clipRule="evenodd" />
      </svg>
    )
  }
  return (
    <svg className="ml-1 inline h-3.5 w-3.5 text-slate-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
    </svg>
  )
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

export function UserTable({ isSuperadmin, onSuspend, onReactivate, onPromote, refreshTrigger }: UserTableProps) {
  const currentUserId = useAuthStore((s) => s.user?.id)

  const [users, setUsers] = useState<UserRow[]>([])
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(1)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)

  const [sortBy, setSortBy] = useState<SortableColumn | null>('created_at')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')

  const fetchUsers = useCallback(async (targetPage: number) => {
    setLoading(true)
    setFetchError(false)
    try {
      const params: Record<string, unknown> = {
        page: targetPage,
        page_size: PAGE_SIZE,
      }
      if (sortBy) {
        params.sort_by = sortBy
        params.sort_order = sortOrder
      }
      const { data } = await apiClient.get<PaginatedUsers>('/admin/users', { params })
      setUsers(data.items)
      setTotal(data.total)
      setPages(data.pages)
      setPage(data.page)
    } catch {
      setFetchError(true)
    } finally {
      setLoading(false)
    }
  }, [sortBy, sortOrder])

  useEffect(() => {
    fetchUsers(page)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchUsers, refreshTrigger])

  function handleSort(column: SortableColumn) {
    if (sortBy === column) {
      setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortBy(column)
      setSortOrder('asc')
    }
    setPage(1)
  }

  function handlePageChange(newPage: number) {
    fetchUsers(newPage)
  }

  function SortableHeader({ column, label }: { column: SortableColumn; label: string }) {
    return (
      <button
        type="button"
        onClick={() => handleSort(column)}
        className="inline-flex items-center gap-0.5 font-medium uppercase tracking-wide text-slate-500 transition-colors hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1 text-xs"
        aria-label={`Sort by ${label}`}
      >
        {label}
        <SortIcon column={column} sortBy={sortBy} sortOrder={sortOrder} />
      </button>
    )
  }

  if (fetchError) {
    return (
      <div
        className="rounded-lg border border-red-200 bg-red-50 p-6 text-center"
        role="alert"
        aria-live="assertive"
      >
        <p className="text-sm text-red-600">Failed to load users. Please try again.</p>
        <Button
          variant="secondary"
          size="sm"
          className="mt-3"
          onClick={() => fetchUsers(page)}
        >
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-0">
      {/* Custom header row with sortable buttons */}
      <div className="overflow-x-auto rounded-t-lg border border-b-0 border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th scope="col" className="px-4 py-3 text-left">
                <SortableHeader column="email" label="Email" />
              </th>
              <th scope="col" className="px-4 py-3 text-left">
                <SortableHeader column="role" label="Role" />
              </th>
              <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                Account Type
              </th>
              <th scope="col" className="px-4 py-3 text-left">
                <SortableHeader column="status" label="Status" />
              </th>
              <th scope="col" className="px-4 py-3 text-left min-w-[120px]">
                <SortableHeader column="created_at" label="Registered" />
              </th>
              {isSuperadmin && (
                <th scope="col" className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500 min-w-[220px]">
                  Actions
                </th>
              )}
            </tr>
          </thead>
        </table>
      </div>

      {/* Data table (header hidden, body shown) */}
      <div className="overflow-x-auto border border-t-0 border-slate-200">
        <table className="min-w-full divide-y divide-slate-100 text-sm">
          <thead className="sr-only">
            <tr>
              <th>Email</th>
              <th>Role</th>
              <th>Account Type</th>
              <th>Status</th>
              <th>Registered</th>
              {isSuperadmin && <th>Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: isSuperadmin ? 6 : 5 }).map((__, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-4 w-full animate-pulse rounded bg-slate-200" />
                    </td>
                  ))}
                </tr>
              ))
            ) : users.length === 0 ? (
              <tr>
                <td
                  colSpan={isSuperadmin ? 6 : 5}
                  className="px-4 py-8 text-center text-slate-400"
                >
                  No users found.
                </td>
              </tr>
            ) : (
              users.map((row) => (
                <tr key={row.id} className="transition-colors hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-700">
                    <span
                      className="block max-w-[200px] truncate text-slate-800"
                      title={row.email}
                    >
                      {row.email}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    <StatusBadge status={row.role} />
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    <StatusBadge status={row.account_type} />
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    <StatusBadge status={row.status} />
                  </td>
                  <td className="px-4 py-3 text-slate-700 min-w-[120px]">
                    <time dateTime={row.created_at} className="whitespace-nowrap text-xs text-slate-500">
                      {formatDate(row.created_at)}
                    </time>
                  </td>
                  {isSuperadmin && (
                    <td className="px-4 py-3 text-slate-700 min-w-[220px]">
                      {row.id !== currentUserId && (
                        <div className="flex items-center gap-2" role="group" aria-label={`Actions for ${row.email}`}>
                          {row.status !== 'suspended' ? (
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={() => onSuspend(row.id, row.email)}
                            >
                              Suspend
                            </Button>
                          ) : (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => onReactivate(row.id, row.email)}
                            >
                              Reactivate
                            </Button>
                          )}
                          {row.role !== 'admin' && row.role !== 'superadmin' && (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => onPromote(row.id, row.email)}
                            >
                              Promote to Admin
                            </Button>
                          )}
                        </div>
                      )}
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
          onPageChange={handlePageChange}
        />
      </div>
    </div>
  )
}
