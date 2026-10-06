import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReceiptData {
  from_address: string
  merchant_name: string
  to_address: string
  amount: string
  token_symbol: string
  network_display_name: string
  confirmed_at: string       // ISO 8601 UTC
  block_number: number
  confirmations: number
  tx_hash: string
  block_explorer_url: string | null  // null when is_test = true
  is_test: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function truncateAddr(addr: string): string {
  if (addr.length <= 12) return addr
  return addr.slice(0, 6) + '…' + addr.slice(-4)
}

function truncateHash(hash: string): string {
  if (hash.length <= 12) return hash
  return hash.slice(0, 6) + '…' + hash.slice(-4)
}

function formatTimestamp(iso: string): string {
  return (
    new Date(iso).toLocaleString('en-GB', {
      timeZone: 'UTC',
      dateStyle: 'long',
      timeStyle: 'short',
    }) + ' UTC'
  )
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-4" aria-label="Loading receipt…" role="status">
      <div className="h-6 w-2/3 rounded bg-slate-200" />
      <div className="h-4 w-1/2 rounded bg-slate-200" />
      <div className="h-4 w-1/3 rounded bg-slate-200" />
      <div className="mt-6 h-24 rounded-xl bg-slate-100" />
      <div className="h-24 rounded-xl bg-slate-100" />
      <span className="sr-only">Loading payment receipt…</span>
    </div>
  )
}

// ─── Not-found state ──────────────────────────────────────────────────────────

function NotFoundMessage() {
  return (
    <div
      role="alert"
      className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm"
    >
      <span
        aria-hidden="true"
        className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100"
      >
        <svg
          className="h-7 w-7 text-slate-400"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M9.75 9.75l4.5 4.5M14.25 9.75l-4.5 4.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <h2 className="text-lg font-semibold text-slate-800">Receipt not found</h2>
      <p className="mt-1 text-sm text-slate-500">
        No payment receipt exists for this transaction hash. The URL may be
        incorrect or the transaction is not yet recorded.
      </p>
    </div>
  )
}

// ─── Receipt row helper ───────────────────────────────────────────────────────

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-3 sm:flex-row sm:items-baseline sm:gap-4">
      <dt className="w-full shrink-0 text-xs font-semibold uppercase tracking-wider text-slate-400 sm:w-44">
        {label}
      </dt>
      <dd className="break-all text-sm text-slate-800">{children}</dd>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ReceiptPage() {
  const { txHash } = useParams<{ txHash: string }>()

  type PageState =
    | { kind: 'loading' }
    | { kind: 'not_found' }
    | { kind: 'error'; message: string }
    | { kind: 'loaded'; data: ReceiptData }

  const [state, setState] = useState<PageState>({ kind: 'loading' })
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!txHash) {
      setState({ kind: 'not_found' })
      return
    }

    let cancelled = false

    async function fetchReceipt() {
      try {
        const res = await fetch(`/api/v1/receipt/${txHash}`)
        if (cancelled) return
        if (res.status === 404) {
          setState({ kind: 'not_found' })
          return
        }
        if (!res.ok) {
          const text = await res.text()
          setState({ kind: 'error', message: text || `HTTP ${res.status}` })
          return
        }
        const data: ReceiptData = await res.json()
        setState({ kind: 'loaded', data })
      } catch (err) {
        if (!cancelled) {
          setState({
            kind: 'error',
            message: err instanceof Error ? err.message : 'Network error',
          })
        }
      }
    }

    fetchReceipt()
    return () => {
      cancelled = true
    }
  }, [txHash])

  async function copyHash(hash: string) {
    try {
      await navigator.clipboard.writeText(hash)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // silently ignore clipboard errors
    }
  }

  // ── Render ──

  if (state.kind === 'loading') {
    return (
      <div className="flex min-h-screen items-start justify-center bg-slate-50 px-4 py-16">
        <div className="w-full max-w-xl">
          <LoadingSkeleton />
        </div>
      </div>
    )
  }

  if (state.kind === 'not_found') {
    return (
      <div className="flex min-h-screen items-start justify-center bg-slate-50 px-4 py-16">
        <div className="w-full max-w-xl">
          <NotFoundMessage />
        </div>
      </div>
    )
  }

  if (state.kind === 'error') {
    return (
      <div className="flex min-h-screen items-start justify-center bg-slate-50 px-4 py-16">
        <div className="w-full max-w-xl">
          <div
            role="alert"
            className="rounded-xl border border-red-200 bg-red-50 p-8 text-center shadow-sm"
          >
            <h2 className="text-lg font-semibold text-red-800">
              Could not load receipt
            </h2>
            <p className="mt-1 text-sm text-red-600">{state.message}</p>
          </div>
        </div>
      </div>
    )
  }

  // state.kind === 'loaded'
  const { data } = state
  const showExplorerLink =
    !data.is_test && data.block_explorer_url !== null

  return (
    <div className="flex min-h-screen items-start justify-center bg-slate-50 px-4 py-16">
      {/* React 19 native document metadata — hoisted to <head> automatically */}
      <title>Payment Receipt · {data.amount} {data.token_symbol}</title>
      <meta
        name="description"
        content={`Payment receipt: ${data.amount} ${data.token_symbol} on ${data.network_display_name}`}
      />

      <div className="w-full max-w-xl space-y-4">
        {/* Test-mode banner */}
        {data.is_test && (
          <div
            role="status"
            className="flex items-center gap-2 rounded-xl border border-orange-300 bg-orange-50 px-4 py-3 text-sm font-medium text-orange-700"
          >
            <svg
              className="h-4 w-4 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            This is a test-mode payment receipt
          </div>
        )}

        {/* Main receipt card */}
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          {/* Header */}
          <div className="border-b border-slate-100 px-6 py-5">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100">
                <svg
                  className="h-5 w-5 text-emerald-600"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M5 13l4 4L19 7"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <div>
                <h1 className="text-base font-bold text-slate-900">
                  Payment confirmed
                </h1>
                <p className="text-sm text-slate-500">
                  {formatTimestamp(data.confirmed_at)}
                </p>
              </div>
            </div>
          </div>

          {/* Amount highlight */}
          <div className="border-b border-slate-100 px-6 py-5 text-center">
            <p className="text-3xl font-bold tracking-tight text-slate-900">
              {data.amount}{' '}
              <span className="text-indigo-600">{data.token_symbol}</span>
            </p>
            <p className="mt-1 text-sm text-slate-500">
              on {data.network_display_name}
            </p>
          </div>

          {/* Details */}
          <dl className="divide-y divide-slate-100 px-6">
            <Row label="From (payer)">
              <span title={data.from_address} className="font-mono">
                {truncateAddr(data.from_address)}
              </span>
            </Row>

            <Row label="To (merchant)">
              <div className="flex flex-col gap-0.5">
                <span className="font-medium text-slate-900">
                  {data.merchant_name}
                </span>
                <span
                  title={data.to_address}
                  className="font-mono text-xs text-slate-500"
                >
                  {truncateAddr(data.to_address)}
                </span>
              </div>
            </Row>

            <Row label="Network">{data.network_display_name}</Row>

            <Row label="Block number">#{data.block_number.toLocaleString()}</Row>

            <Row label="Confirmations">{data.confirmations}</Row>

            <Row label="Transaction hash">
              <div className="flex flex-wrap items-center gap-2">
                {showExplorerLink ? (
                  <a
                    href={data.block_explorer_url + data.tx_hash}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-indigo-600 underline underline-offset-2 hover:text-indigo-800"
                    title={data.tx_hash}
                  >
                    {truncateHash(data.tx_hash)}
                  </a>
                ) : (
                  <span className="font-mono" title={data.tx_hash}>
                    {truncateHash(data.tx_hash)}
                  </span>
                )}

                {/* Copy button */}
                <button
                  type="button"
                  onClick={() => copyHash(data.tx_hash)}
                  aria-label="Copy transaction hash"
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
                >
                  {copied ? (
                    <>
                      <svg
                        className="h-3 w-3 text-emerald-500"
                        viewBox="0 0 24 24"
                        fill="none"
                        aria-hidden="true"
                      >
                        <path
                          d="M5 13l4 4L19 7"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                      Copied
                    </>
                  ) : (
                    <>
                      <svg
                        className="h-3 w-3"
                        viewBox="0 0 24 24"
                        fill="none"
                        aria-hidden="true"
                      >
                        <rect
                          x="9"
                          y="9"
                          width="13"
                          height="13"
                          rx="2"
                          stroke="currentColor"
                          strokeWidth="1.5"
                        />
                        <path
                          d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"
                          stroke="currentColor"
                          strokeWidth="1.5"
                        />
                      </svg>
                      Copy
                    </>
                  )}
                </button>
              </div>
            </Row>
          </dl>
        </div>

        {/* Footer note */}
        <p className="text-center text-xs text-slate-400">
          Powered by Lenis · Non-custodial crypto payments
        </p>
      </div>
    </div>
  )
}
