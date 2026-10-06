import { useEffect, useState } from 'react'
import { apiClient } from '../../lib/api'
import { Table, Column } from '../ui/Table'
import { Badge } from '../ui/Badge'

// Index signature required by Table<T extends Record<string, unknown>>
interface AuditLogEntry extends Record<string, unknown> {
  id: string
  event_type: string
  actor_id: string
  target_type: string
  target_id: string
  outcome: string
  client_ip: string | null
  created_at: string
}

interface PaginatedResult {
  items: AuditLogEntry[]
  total: number
  page: number
  page_size: number
  pages: number
}

type LoadState = 'loading' | 'ready' | 'error'

function formatTimestamp(iso: string): string {
  const date = new Date(iso)
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

function truncateId(id: string): string {
  if (id.length <= 12) return id
  return id.slice(0, 8) + '...' + id.slice(-4)
}

const auditLogColumns: Column<AuditLogEntry>[] = [
  {
    key: 'actor_id',
    header: 'Actor',
    render: (row) => (
      <span
        className="font-mono text-xs text-slate-600"
        title={row.actor_id}
        aria-label={`Actor ID: ${row.actor_id}`}
      >
        {truncateId(row.actor_id)}
      </span>
    ),
  },
  {
    key: 'event_type',
    header: 'Action',
    render: (row) => (
      <span className="font-medium text-slate-800">{row.event_type}</span>
    ),
  },
  {
    key: 'target_id',
    header: 'Target',
    render: (row) => (
      <span
        className="font-mono text-xs text-slate-600"
        title={`${row.target_type}: ${row.target_id}`}
        aria-label={`Target ${String(row.target_type)} ID: ${row.target_id}`}
      >
        {truncateId(row.target_id)}
      </span>
    ),
  },
  {
    key: 'outcome',
    header: 'Outcome',
    render: (row) => (
      <Badge variant={row.outcome === 'success' ? 'green' : 'red'}>
        {row.outcome}
      </Badge>
    ),
  },
  {
    key: 'created_at',
    header: 'Timestamp',
    render: (row) => (
      <time dateTime={row.created_at} className="whitespace-nowrap text-xs text-slate-500">
        {formatTimestamp(row.created_at)}
      </time>
    ),
    className: 'min-w-[180px]',
  },
]

export function AuditLogTable() {
  const [logEntries, setLogEntries] = useState<AuditLogEntry[]>([])
  const [loadState, setLoadState] = useState<LoadState>('loading')

  useEffect(() => {
    let cancelled = false

    async function fetchAuditLog() {
      try {
        const { data } = await apiClient.get<PaginatedResult>('/admin/audit-log', {
          params: { page: 1, page_size: 50 },
        })
        if (!cancelled) {
          // Sort descending by created_at (API should already return this order, but enforce it)
          const sorted = [...data.items].sort(
            (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
          )
          setLogEntries(sorted)
          setLoadState('ready')
        }
      } catch {
        if (!cancelled) {
          setLoadState('error')
        }
      }
    }

    fetchAuditLog()
    return () => {
      cancelled = true
    }
  }, [])

  if (loadState === 'error') {
    return (
      <p className="text-sm text-red-600" role="alert">
        Failed to load audit log. Please refresh the page.
      </p>
    )
  }

  return (
    <section aria-labelledby="audit-log-heading">
      <h2
        id="audit-log-heading"
        className="mb-3 text-base font-semibold text-slate-900"
      >
        Recent Activity
      </h2>
      <p className="mb-4 text-sm text-slate-500">
        The 50 most recent platform events, newest first.
      </p>
      <Table<AuditLogEntry>
        columns={auditLogColumns}
        data={logEntries}
        keyField="id"
        loading={loadState === 'loading'}
        emptyMessage="No audit log entries found."
      />
    </section>
  )
}
