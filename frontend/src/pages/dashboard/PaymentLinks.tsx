import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Modal } from '../../components/ui/Modal'
import { Pagination } from '../../components/ui/Pagination'
import { QRCodeSVG } from 'qrcode.react'
import { getPaymentLinkQR } from '../../services/merchant'
import { useMerchantStore } from '../../stores/merchantStore'
import type { PaymentLink } from '../../stores/merchantStore'

// ─── Helpers ──────────────────────────────────────────────────────────────────

type LinkStatus = PaymentLink['status']
type BadgeVariant = 'default' | 'blue' | 'green' | 'yellow' | 'red' | 'purple'

const statusVariant: Record<LinkStatus, BadgeVariant> = {
  active: 'green',
  inactive: 'default',
  suspended_by_admin: 'red',
}

const statusLabel: Record<LinkStatus, string> = {
  active: 'Active',
  inactive: 'Inactive',
  suspended_by_admin: 'Suspended',
}

function formatAmount(amount: string | null, mode: PaymentLink['amount_mode']): string {
  if (mode === 'flexible') return 'Customer chooses'
  if (!amount) return '—'
  const n = parseFloat(amount)
  return isNaN(n) ? amount : n.toFixed(2)
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return iso
  }
}

function isLinkExpired(link: PaymentLink): boolean {
  if (!link.expires_at) return false
  return new Date(link.expires_at) <= new Date()
}

function isLinkExhausted(link: PaymentLink): boolean {
  if (link.max_uses == null) return false
  return link.use_count >= link.max_uses
}

// ─── Copy-to-clipboard hook ───────────────────────────────────────────────────

function useCopyToClipboard() {
  const [copiedId, setCopiedId] = useState<string | null>(null)

  async function copy(text: string, id: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopiedId(id)
      setTimeout(() => setCopiedId((prev) => (prev === id ? null : prev)), 2000)
    } catch {
      // Clipboard API unavailable — silent fail
    }
  }

  return { copiedId, copy }
}

// ─── QR download helper ───────────────────────────────────────────────────────

async function downloadQR(linkId: string, title: string) {
  try {
    const blob = await getPaymentLinkQR(linkId)
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `qr-${title.replace(/[^a-z0-9]/gi, '-').toLowerCase()}.png`
    a.click()
    URL.revokeObjectURL(url)
  } catch {
    // ignore — user can retry
  }
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function ListSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading payment links">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="h-20 animate-pulse rounded-lg bg-slate-100" />
      ))}
    </div>
  )
}

// ─── Token pill list ──────────────────────────────────────────────────────────

function TokenPills({ tokens }: { tokens: PaymentLink['accepted_tokens'] }) {
  if (tokens.length === 0) return <span className="text-xs text-slate-400">—</span>
  // Show up to 3 pills then "+N"
  const visible = tokens.slice(0, 3)
  const extra = tokens.length - visible.length
  return (
    <span className="flex flex-wrap gap-1">
      {visible.map((t, i) => (
        <span
          key={i}
          className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600"
          title={t.network}
        >
          {t.token_symbol}
        </span>
      ))}
      {extra > 0 && (
        <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
          +{extra}
        </span>
      )}
    </span>
  )
}

// ─── QR Code Modal ────────────────────────────────────────────────────────────

interface QRCodeModalProps {
  link: PaymentLink | null
  onClose: () => void
}

function QRCodeModal({ link, onClose }: QRCodeModalProps) {
  const [downloading, setDownloading] = useState(false)
  const [copied, setCopied] = useState(false)

  if (!link) return null

  const checkoutUrl =
    link.payment_url ||
    (typeof window !== 'undefined'
      ? `${window.location.origin}/pay/${link.slug}`
      : `/pay/${link.slug}`)

  async function handleDownload() {
    if (!link) return
    setDownloading(true)
    try {
      await downloadQR(link.id, link.title)
    } finally {
      setDownloading(false)
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(checkoutUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore
    }
  }

  return (
    <Modal isOpen={link !== null} onClose={onClose} title="Payment Link QR Code">
      <div className="space-y-5">
        {/* Link Header Summary */}
        <div className="text-center">
          <h3 className="text-base font-bold text-slate-900">{link.title}</h3>
          <p className="text-xs text-slate-500 mt-0.5 font-mono">/{link.slug}</p>
          <div className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-800">
            <span>Price:</span>
            <span className="font-bold">
              {link.amount_mode === 'fixed' && link.amount
                ? `${formatAmount(link.amount, link.amount_mode)} USD`
                : 'Flexible / Customer chooses'}
            </span>
          </div>
        </div>

        {/* QR Code Container */}
        <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
          <div className="rounded-xl border border-slate-100 bg-white p-3 shadow-xs">
            <QRCodeSVG
              value={checkoutUrl}
              size={200}
              level="H"
              includeMargin
              className="rounded-lg"
            />
          </div>
          <p className="mt-3 text-xs text-slate-400">
            Scan with any camera or Web3 mobile wallet
          </p>
        </div>

        {/* URL Box with copy */}
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
          <input
            type="text"
            readOnly
            value={checkoutUrl}
            className="min-w-0 flex-1 bg-transparent text-xs font-mono text-slate-700 focus:outline-none"
          />
          <Button variant="secondary" size="sm" onClick={handleCopy} className="text-xs">
            {copied ? '✓ Copied' : 'Copy Link'}
          </Button>
        </div>

        {/* Modal Action Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
          <a
            href={checkoutUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-indigo-600 hover:text-indigo-800 hover:underline"
          >
            ↗ Open Checkout Page
          </a>
          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <Button variant="secondary" size="sm" onClick={onClose}>
              Close
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={downloading}
              onClick={handleDownload}
              className="flex items-center gap-1.5"
            >
              <span>📥</span> Download QR Code
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ─── Deactivate confirmation modal ────────────────────────────────────────────

interface DeactivateModalProps {
  link: PaymentLink | null
  onConfirm: () => Promise<void>
  onClose: () => void
  loading: boolean
}

function DeactivateModal({ link, onConfirm, onClose, loading }: DeactivateModalProps) {
  return (
    <Modal
      isOpen={link !== null}
      onClose={onClose}
      title="Deactivate payment link"
    >
      <p className="text-sm text-slate-600">
        Are you sure you want to deactivate{' '}
        <span className="font-medium text-slate-900">"{link?.title}"</span>?
        Customers will see an error page until you create a new link.
      </p>
      <p className="mt-2 text-xs text-slate-400">
        This action cannot be undone from the dashboard.
      </p>
      <div className="mt-6 flex justify-end gap-3">
        <Button variant="secondary" onClick={onClose} disabled={loading}>
          Cancel
        </Button>
        <Button variant="danger" onClick={onConfirm} loading={loading}>
          Deactivate
        </Button>
      </div>
    </Modal>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function PaymentLinks() {
  const navigate = useNavigate()
  const fetchPaymentLinks = useMerchantStore((s) => s.fetchPaymentLinks)
  const deactivatePaymentLink = useMerchantStore((s) => s.deactivatePaymentLink)
  const paymentLinks = useMerchantStore((s) => s.paymentLinks)

  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(paymentLinks === null)
  const [pageLoading, setPageLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { copiedId, copy } = useCopyToClipboard()

  const [linkToDeactivate, setLinkToDeactivate] = useState<PaymentLink | null>(null)
  const [deactivating, setDeactivating] = useState(false)
  const [qrModalLink, setQrModalLink] = useState<PaymentLink | null>(null)

  // ─── Data loading ─────────────────────────────────────────────────────────

  const load = useCallback(
    async (p: number, showFullLoader: boolean) => {
      if (showFullLoader) setLoading(true)
      else setPageLoading(true)
      setError(null)
      try {
        await fetchPaymentLinks(p)
      } catch {
        setError('Failed to load payment links. Please try again.')
      } finally {
        setLoading(false)
        setPageLoading(false)
      }
    },
    [fetchPaymentLinks],
  )

  useEffect(() => {
    load(1, paymentLinks === null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handlePageChange(newPage: number) {
    setPage(newPage)
    load(newPage, false)
    // Scroll back to top of list
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // ─── Deactivate ───────────────────────────────────────────────────────────

  async function handleDeactivate() {
    if (!linkToDeactivate) return
    setDeactivating(true)
    try {
      await deactivatePaymentLink(linkToDeactivate.id)
    } catch {
      // store already refreshes; ignore individual failure silently
    } finally {
      setDeactivating(false)
      setLinkToDeactivate(null)
    }
  }

  // ─── Render states ────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-slate-900">Payment links</h1>
        </div>
        <ListSkeleton />
      </div>
    )
  }

  const links = paymentLinks?.items ?? []
  const total = paymentLinks?.total ?? 0
  const totalPages = paymentLinks?.total_pages ?? 1

  return (
    <>
      <div className="space-y-6">
        {/* Page heading */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-slate-900">Payment links</h1>
          <Button
            variant="primary"
            size="sm"
            onClick={() => navigate('/dashboard/payment-links/new')}
          >
            + New payment link
          </Button>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700" role="alert">
            {error}{' '}
            <button
              type="button"
              className="underline"
              onClick={() => load(page, false)}
            >
              Retry
            </button>
          </div>
        )}

        {/* Empty state */}
        {!error && links.length === 0 && (
          <Card>
            <div className="py-12 text-center">
              <p className="text-sm text-slate-500">
                You haven't created any payment links yet.
              </p>
              <Button
                variant="primary"
                size="sm"
                className="mt-4"
                onClick={() => navigate('/dashboard/payment-links/new')}
              >
                Create your first payment link
              </Button>
            </div>
          </Card>
        )}

        {/* Link list */}
        {links.length > 0 && (
          <Card className={pageLoading ? 'opacity-60 transition-opacity' : ''}>
            <div className="overflow-x-auto">
              <table
                className="min-w-full divide-y divide-slate-200"
                aria-label="Payment links"
              >
                <thead>
                  <tr>
                    {[
                      'Title',
                      'Price type',
                      'Amount',
                      'Tokens',
                      'Status',
                      'Expires',
                      'Uses',
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
                  {links.map((link) => {
                    const expired = isLinkExpired(link)
                    const exhausted = isLinkExhausted(link)
                    const effectivelyGone =
                      expired || exhausted || link.status !== 'active'

                    return (
                      <tr
                        key={link.id}
                        className="hover:bg-slate-50"
                      >
                        {/* Title */}
                        <td className="max-w-[180px] py-3 pr-4">
                          <p
                            className="truncate text-sm font-medium text-slate-900"
                            title={link.title}
                          >
                            {link.title}
                          </p>
                          <p className="truncate text-xs text-slate-400 font-mono" title={link.slug}>
                            /{link.slug}
                          </p>
                        </td>

                        {/* Price type */}
                        <td className="whitespace-nowrap py-3 pr-4 text-sm capitalize text-slate-600">
                          {link.amount_mode}
                        </td>

                        {/* Amount */}
                        <td className="whitespace-nowrap py-3 pr-4 text-sm font-medium text-slate-800">
                          {formatAmount(link.amount, link.amount_mode)}
                        </td>

                        {/* Tokens */}
                        <td className="py-3 pr-4">
                          <TokenPills tokens={link.accepted_tokens} />
                        </td>

                        {/* Status */}
                        <td className="whitespace-nowrap py-3 pr-4">
                          <div className="flex flex-col gap-0.5">
                            <Badge variant={statusVariant[link.status]}>
                              {statusLabel[link.status]}
                            </Badge>
                            {link.status === 'active' && expired && (
                              <Badge variant="yellow">Expired</Badge>
                            )}
                            {link.status === 'active' && !expired && exhausted && (
                              <Badge variant="yellow">Exhausted</Badge>
                            )}
                          </div>
                        </td>

                        {/* Expires */}
                        <td className="whitespace-nowrap py-3 pr-4 text-sm text-slate-500">
                          {formatDate(link.expires_at)}
                        </td>

                        {/* Uses */}
                        <td className="whitespace-nowrap py-3 pr-4 text-sm text-slate-600">
                          {link.use_count}
                          {link.max_uses != null ? ` / ${link.max_uses}` : ''}
                        </td>

                        {/* Actions */}
                        <td className="whitespace-nowrap py-3">
                          <div className="flex items-center gap-1">
                            {/* Copy URL */}
                            <button
                              type="button"
                              onClick={() => copy(link.payment_url, link.id)}
                              aria-label={`Copy payment URL for ${link.title}`}
                              title="Copy payment URL"
                              className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1"
                            >
                              {copiedId === link.id ? (
                                <svg
                                  className="h-4 w-4 text-green-500"
                                  viewBox="0 0 20 20"
                                  fill="currentColor"
                                  aria-hidden="true"
                                >
                                  <path
                                    fillRule="evenodd"
                                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                                    clipRule="evenodd"
                                  />
                                </svg>
                              ) : (
                                <svg
                                  className="h-4 w-4"
                                  viewBox="0 0 20 20"
                                  fill="currentColor"
                                  aria-hidden="true"
                                >
                                  <path d="M8 2a1 1 0 000 2h2a1 1 0 100-2H8z" />
                                  <path d="M3 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v6h-4.586l1.293-1.293a1 1 0 00-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L10.414 13H15v3a2 2 0 01-2 2H5a2 2 0 01-2-2V5zM15 11h2a1 1 0 110 2h-2v-2z" />
                                </svg>
                              )}
                            </button>

                            {/* View & Download QR Modal */}
                            <button
                              type="button"
                              onClick={() => setQrModalLink(link)}
                              aria-label={`Show QR code for ${link.title}`}
                              title="Show QR code & download"
                              className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1"
                            >
                              <svg
                                className="h-4 w-4"
                                viewBox="0 0 20 20"
                                fill="currentColor"
                                aria-hidden="true"
                              >
                                <path
                                  fillRule="evenodd"
                                  d="M3 4a1 1 0 011-1h3a1 1 0 010 2H5v2a1 1 0 01-2 0V4zm9-1a1 1 0 000 2h2v2a1 1 0 102 0V4a1 1 0 00-1-1h-3zM3 13a1 1 0 011 1v2h2a1 1 0 110 2H4a1 1 0 01-1-1v-3a1 1 0 011-1zm12 0a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 110-2h2v-2a1 1 0 011-1z"
                                  clipRule="evenodd"
                                />
                                <path d="M5 8a1 1 0 000 2h1v1a1 1 0 002 0V9a1 1 0 00-1-1H5zm8-1a1 1 0 00-1 1v2a1 1 0 001 1h2a1 1 0 001-1V8a1 1 0 00-1-1h-2zM8 13a1 1 0 00-1 1v2a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 00-1-1H8z" />
                              </svg>
                            </button>

                            {/* Deactivate toggle (only for active, non-suspended links) */}
                            {link.status === 'active' && !effectivelyGone && (
                              <button
                                type="button"
                                onClick={() => setLinkToDeactivate(link)}
                                aria-label={`Deactivate ${link.title}`}
                                title="Deactivate"
                                className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-1"
                              >
                                <svg
                                  className="h-4 w-4"
                                  viewBox="0 0 20 20"
                                  fill="currentColor"
                                  aria-hidden="true"
                                >
                                  <path
                                    fillRule="evenodd"
                                    d="M13.477 14.89A6 6 0 015.11 6.524l8.367 8.368zm1.414-1.414L6.524 5.11a6 6 0 018.367 8.367zM18 10a8 8 0 11-16 0 8 8 0 0116 0z"
                                    clipRule="evenodd"
                                  />
                                </svg>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
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

      {/* QR Code modal */}
      <QRCodeModal
        link={qrModalLink}
        onClose={() => setQrModalLink(null)}
      />

      {/* Deactivate confirmation modal */}
      <DeactivateModal
        link={linkToDeactivate}
        onConfirm={handleDeactivate}
        onClose={() => setLinkToDeactivate(null)}
        loading={deactivating}
      />
    </>
  )
}
