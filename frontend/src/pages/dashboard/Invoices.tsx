import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Modal } from '../../components/ui/Modal'
import { Pagination } from '../../components/ui/Pagination'
import { useMerchantStore } from '../../stores/merchantStore'
import type { Invoice, InvoiceStatus } from '../../stores/merchantStore'

// ─── Types ────────────────────────────────────────────────────────────────────

type BadgeVariant = 'default' | 'blue' | 'green' | 'yellow' | 'red' | 'purple'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const statusVariant: Record<InvoiceStatus, BadgeVariant> = {
  draft: 'default',
  sent: 'blue',
  viewed: 'purple',
  paid: 'green',
  overdue: 'red',
  cancelled: 'default',
}

const statusLabel: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  viewed: 'Viewed',
  paid: 'Paid',
  overdue: 'Overdue',
  cancelled: 'Cancelled',
}

function computeTotal(invoice: Invoice): string {
  const sum = invoice.line_items.reduce((acc, item) => {
    const n = parseFloat(item.amount)
    return acc + (isNaN(n) ? 0 : n)
  }, 0)
  return sum.toFixed(2)
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    // due_date is YYYY-MM-DD; parse as local date to avoid UTC offset shift
    const [year, month, day] = iso.split('T')[0].split('-').map(Number)
    return new Date(year, month - 1, day).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return iso
  }
}

type FilterTab = 'all' | InvoiceStatus

const filterTabs: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Draft' },
  { key: 'sent', label: 'Sent' },
  { key: 'viewed', label: 'Viewed' },
  { key: 'paid', label: 'Paid' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'cancelled', label: 'Cancelled' },
]

const CANCELLABLE_STATUSES: InvoiceStatus[] = ['draft', 'sent', 'viewed', 'overdue']

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function ListSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading invoices">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="h-20 animate-pulse rounded-lg bg-slate-100" />
      ))}
    </div>
  )
}

// ─── Send confirmation modal ──────────────────────────────────────────────────

interface SendModalProps {
  invoice: Invoice | null
  onConfirm: () => Promise<void>
  onClose: () => void
  loading: boolean
}

function SendModal({ invoice, onConfirm, onClose, loading }: SendModalProps) {
  return (
    <Modal
      isOpen={invoice !== null}
      onClose={onClose}
      title="Send invoice"
    >
      <p className="text-sm text-slate-600">
        Are you sure you want to send the invoice to{' '}
        <span className="font-medium text-slate-900">"{invoice?.customer_name}"</span>?
        They will receive an email at{' '}
        <span className="font-medium text-slate-900">{invoice?.customer_email}</span>.
      </p>
      <div className="mt-6 flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button variant="primary" onClick={onConfirm} loading={loading}>
          Send invoice
        </Button>
      </div>
    </Modal>
  )
}

// ─── Cancel confirmation modal ────────────────────────────────────────────────

interface CancelModalProps {
  invoice: Invoice | null
  onConfirm: () => Promise<void>
  onClose: () => void
  loading: boolean
}

function CancelModal({ invoice, onConfirm, onClose, loading }: CancelModalProps) {
  return (
    <Modal
      isOpen={invoice !== null}
      onClose={onClose}
      title="Cancel invoice"
    >
      <p className="text-sm text-slate-600">
        Are you sure you want to cancel the invoice for{' '}
        <span className="font-medium text-slate-900">"{invoice?.customer_name}"</span>?
      </p>
      <p className="mt-2 text-xs text-slate-400">
        This action cannot be undone from the dashboard.
      </p>
      <div className="mt-6 flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose} disabled={loading}>
          Back
        </Button>
        <Button variant="danger" onClick={onConfirm} loading={loading}>
          Cancel invoice
        </Button>
      </div>
    </Modal>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function Invoices() {
  const navigate = useNavigate()
  const fetchInvoices = useMerchantStore((s) => s.fetchInvoices)
  const sendInvoice = useMerchantStore((s) => s.sendInvoice)
  const cancelInvoice = useMerchantStore((s) => s.cancelInvoice)
  const invoices = useMerchantStore((s) => s.invoices)

  const [page, setPage] = useState(1)
  const [activeTab, setActiveTab] = useState<FilterTab>('all')
  const [loading, setLoading] = useState(invoices === null)
  const [pageLoading, setPageLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [invoiceToSend, setInvoiceToSend] = useState<Invoice | null>(null)
  const [sending, setSending] = useState(false)

  const [invoiceToCancel, setInvoiceToCancel] = useState<Invoice | null>(null)
  const [cancelling, setCancelling] = useState(false)

  // ─── Data loading ──────────────────────────────────────────────────────────

  const load = useCallback(
    async (p: number, tab: FilterTab, showFullLoader: boolean) => {
      if (showFullLoader) setLoading(true)
      else setPageLoading(true)
      setError(null)
      try {
        const status = tab === 'all' ? undefined : tab
        await fetchInvoices(p, status)
      } catch {
        setError('Failed to load invoices. Please try again.')
      } finally {
        setLoading(false)
        setPageLoading(false)
      }
    },
    [fetchInvoices],
  )

  useEffect(() => {
    load(1, 'all', invoices === null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handlePageChange(newPage: number) {
    setPage(newPage)
    load(newPage, activeTab, false)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function handleTabChange(tab: FilterTab) {
    setActiveTab(tab)
    setPage(1)
    load(1, tab, false)
  }

  // ─── Send ──────────────────────────────────────────────────────────────────

  async function handleSend() {
    if (!invoiceToSend) return
    setSending(true)
    try {
      await sendInvoice(invoiceToSend.id)
    } catch {
      // store refreshes; ignore silently
    } finally {
      setSending(false)
      setInvoiceToSend(null)
    }
  }

  // ─── Cancel ───────────────────────────────────────────────────────────────

  async function handleCancel() {
    if (!invoiceToCancel) return
    setCancelling(true)
    try {
      await cancelInvoice(invoiceToCancel.id)
    } catch {
      // store refreshes; ignore silently
    } finally {
      setCancelling(false)
      setInvoiceToCancel(null)
    }
  }

  // ─── Render states ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-slate-900">Invoices</h1>
        </div>
        <ListSkeleton />
      </div>
    )
  }

  const items = invoices?.items ?? []
  const total = invoices?.total ?? 0
  const totalPages = invoices?.total_pages ?? 1

  return (
    <>
      <div className="space-y-6">
        {/* Page heading */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-slate-900">Invoices</h1>
          <Button
            variant="primary"
            size="sm"
            onClick={() => navigate('/dashboard/invoices/new')}
          >
            + New invoice
          </Button>
        </div>

        {/* Status filter tabs */}
        <div
          className="flex flex-wrap gap-1 border-b border-slate-200"
          role="tablist"
          aria-label="Filter invoices by status"
        >
          {filterTabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              onClick={() => handleTabChange(tab.key)}
              className={[
                'px-3 py-2 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1',
                activeTab === tab.key
                  ? 'border-b-2 border-slate-900 text-slate-900'
                  : 'text-slate-500 hover:text-slate-800',
              ].join(' ')}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div
            className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
            role="alert"
          >
            {error}{' '}
            <button
              type="button"
              className="underline"
              onClick={() => load(page, activeTab, false)}
            >
              Retry
            </button>
          </div>
        )}

        {/* Empty state */}
        {!error && items.length === 0 && (
          <Card>
            <div className="py-12 text-center">
              <p className="text-sm text-slate-500">
                You haven't created any invoices yet.
              </p>
              <Button
                variant="primary"
                size="sm"
                className="mt-4"
                onClick={() => navigate('/dashboard/invoices/new')}
              >
                Create invoice
              </Button>
            </div>
          </Card>
        )}

        {/* Invoice list */}
        {items.length > 0 && (
          <Card className={pageLoading ? 'opacity-60 transition-opacity' : ''}>
            <div className="overflow-x-auto">
              <table
                className="min-w-full divide-y divide-slate-200"
                aria-label="Invoices"
              >
                <thead>
                  <tr>
                    {[
                      'Customer Name',
                      'Customer Email',
                      'Due Date',
                      'Total Amount',
                      'Status',
                      'Actions',
                    ].map((col) => (
                      <th
                        key={col}
                        scope="col"
                        className="whitespace-nowrap py-3 pr-4 text-left text-xs font-medium uppercase tracking-wider text-slate-400 first:pl-0 last:pr-0"
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((invoice) => (
                    <tr key={invoice.id} className="hover:bg-slate-50">
                      {/* Customer Name */}
                      <td className="max-w-[180px] py-3 pr-4">
                        <p
                          className="truncate text-sm font-medium text-slate-900"
                          title={invoice.customer_name}
                        >
                          {invoice.customer_name}
                        </p>
                      </td>

                      {/* Customer Email */}
                      <td className="max-w-[200px] py-3 pr-4">
                        <p
                          className="truncate text-sm text-slate-600"
                          title={invoice.customer_email}
                        >
                          {invoice.customer_email}
                        </p>
                      </td>

                      {/* Due Date */}
                      <td className="whitespace-nowrap py-3 pr-4 text-sm text-slate-500">
                        {formatDate(invoice.due_date)}
                      </td>

                      {/* Total Amount */}
                      <td className="whitespace-nowrap py-3 pr-4 text-sm text-slate-700">
                        {computeTotal(invoice)}
                      </td>

                      {/* Status */}
                      <td className="whitespace-nowrap py-3 pr-4">
                        <Badge variant={statusVariant[invoice.status]}>
                          {statusLabel[invoice.status]}
                        </Badge>
                      </td>

                      {/* Actions */}
                      <td className="whitespace-nowrap py-3">
                        <div className="flex items-center gap-1">
                          {/* Send — only for draft */}
                          {invoice.status === 'draft' && (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => setInvoiceToSend(invoice)}
                              aria-label={`Send invoice to ${invoice.customer_name}`}
                            >
                              Send
                            </Button>
                          )}

                          {/* Cancel — draft, sent, viewed, overdue */}
                          {CANCELLABLE_STATUSES.includes(invoice.status) && (
                            <Button
                              variant="danger"
                              size="sm"
                              onClick={() => setInvoiceToCancel(invoice)}
                              aria-label={`Cancel invoice for ${invoice.customer_name}`}
                            >
                              Cancel
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <Pagination
                page={page}
                pages={totalPages}
                pageSize={20}
                total={total}
                onPageChange={handlePageChange}
              />
            )}
          </Card>
        )}
      </div>

      {/* Send confirmation modal */}
      <SendModal
        invoice={invoiceToSend}
        onConfirm={handleSend}
        onClose={() => setInvoiceToSend(null)}
        loading={sending}
      />

      {/* Cancel confirmation modal */}
      <CancelModal
        invoice={invoiceToCancel}
        onConfirm={handleCancel}
        onClose={() => setInvoiceToCancel(null)}
        loading={cancelling}
      />
    </>
  )
}
