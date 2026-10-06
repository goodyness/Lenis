import { useEffect, useState } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PaymentReceiptProps {
  merchantName: string
  amount: string
  tokenSymbol: string
  networkName: string
  transactionHash: string
  /** ISO 8601 timestamp, e.g. "2024-05-01T14:30:00Z" */
  confirmedAt: string
  customMessage?: string | null
  redirectUrl?: string | null
  brandLogoUrl?: string | null
  brandColor?: string | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Format an ISO 8601 string into a human-readable local date+time.
 * Falls back to the raw string if parsing fails.
 */
function formatTimestamp(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(iso))
  } catch {
    return iso
  }
}

/**
 * Truncate a transaction hash for display, keeping first 8 and last 6 chars.
 * e.g. "0xabcdef12…a1b2c3"
 */
function truncateHash(hash: string): string {
  if (!hash || hash === '—') return '—'
  if (hash.length <= 16) return hash
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`
}

// ─── Row helper ───────────────────────────────────────────────────────────────

function ReceiptRow({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 text-sm">
      <span className="shrink-0 font-medium text-slate-500">{label}</span>
      <span className="text-right text-slate-900">{children}</span>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function PaymentReceipt({
  merchantName,
  amount,
  tokenSymbol,
  networkName,
  transactionHash,
  confirmedAt,
  customMessage,
  redirectUrl,
  brandLogoUrl,
  brandColor = '#4F46E5',
}: PaymentReceiptProps) {
  const [countdown, setCountdown] = useState(5)
  const [redirectCancelled, setRedirectCancelled] = useState(false)
  const [logoError, setLogoError] = useState(false)

  useEffect(() => {
    if (!redirectUrl || redirectCancelled) return

    const timer = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(timer)
          window.location.href = redirectUrl
          return 0
        }
        return c - 1
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [redirectUrl, redirectCancelled])

  return (
    <div
      role="region"
      aria-label="Payment receipt"
      className="rounded-2xl border border-emerald-200 bg-emerald-50/70 p-6 shadow-sm space-y-6"
    >
      {/* Success header */}
      <div className="flex flex-col items-center gap-3 text-center">
        {brandLogoUrl && !logoError ? (
          <img
            src={brandLogoUrl}
            alt={merchantName}
            onError={() => setLogoError(true)}
            className="h-16 w-16 rounded-2xl object-cover border-2 border-emerald-300 shadow-sm bg-white"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600 shadow-md text-white"
          >
            <svg
              className="h-7 w-7"
              viewBox="0 0 24 24"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M5 13l4 4L19 7"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        )}

        <div>
          <h2 className="text-xl font-bold text-emerald-950">Payment Complete</h2>
          <p className="mt-0.5 text-sm text-emerald-800">
            Your payment to <span className="font-semibold">{merchantName}</span> has been confirmed.
          </p>
        </div>
      </div>

      {/* Custom Thank-You Note */}
      {customMessage && (
        <div className="rounded-xl border border-emerald-300/80 bg-white/90 p-4 text-center shadow-xs">
          <p className="text-xs font-bold uppercase tracking-wider text-emerald-800 mb-1">
            Note from {merchantName}
          </p>
          <p className="text-sm font-medium text-slate-800 italic">
            "{customMessage}"
          </p>
        </div>
      )}

      {/* Auto-Redirect Countdown Card */}
      {redirectUrl && (
        <div className="rounded-xl border border-indigo-200 bg-white p-4 text-center shadow-xs space-y-3">
          <div className="flex items-center justify-center gap-2">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-3 w-3 bg-indigo-500"></span>
            </span>
            <p className="text-xs font-bold text-indigo-900">
              Redirecting to merchant store in <span className="font-mono text-base font-extrabold text-indigo-600">{countdown}s</span>...
            </p>
          </div>

          <div className="flex items-center justify-center gap-3">
            <a
              href={redirectUrl}
              className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-bold text-white shadow-sm transition-all hover:opacity-90 active:scale-95"
              style={{ backgroundColor: brandColor || '#4F46E5' }}
            >
              Continue to Store →
            </a>
            <button
              type="button"
              onClick={() => setRedirectCancelled(true)}
              className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              Stay on Receipt
            </button>
          </div>
        </div>
      )}

      {/* Divider */}
      <div className="border-t border-emerald-200/80" aria-hidden="true" />

      {/* Receipt rows */}
      <dl className="divide-y divide-emerald-100/80 bg-white/60 rounded-xl p-4 border border-emerald-100">
        <ReceiptRow label="Merchant">
          <span className="font-bold">{merchantName}</span>
        </ReceiptRow>

        <ReceiptRow label="Amount Paid">
          <span className="font-bold text-emerald-900">
            {amount} {tokenSymbol}
          </span>
        </ReceiptRow>

        <ReceiptRow label="Network">
          <span>{networkName}</span>
        </ReceiptRow>

        <ReceiptRow label="Transaction Hash">
          <span
            title={transactionHash}
            aria-label={`Transaction hash: ${transactionHash}`}
            className="font-mono text-xs text-slate-700"
          >
            {truncateHash(transactionHash)}
          </span>
        </ReceiptRow>

        <ReceiptRow label="Confirmed at">
          <time dateTime={confirmedAt}>{formatTimestamp(confirmedAt)}</time>
        </ReceiptRow>
      </dl>
    </div>
  )
}

