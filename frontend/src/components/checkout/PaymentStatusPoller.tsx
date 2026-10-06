import { useEffect, useRef, useState } from 'react'
import { getPaymentStatus } from '../../services/checkout'
import type { PaymentStatusResponse } from '../../services/checkout'

// ─── Types ────────────────────────────────────────────────────────────────────

type PaymentStatus = PaymentStatusResponse['status']

interface PaymentStatusPollerProps {
  slug: string
  onStatusChange?: (status: PaymentStatus) => void
}

// ─── Constants ────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 10_000

const STATUS_STEPS: { status: PaymentStatus; label: string }[] = [
  { status: 'pending', label: 'Pending' },
  { status: 'detected', label: 'Detected' },
  { status: 'confirming', label: 'Confirming' },
  { status: 'confirmed', label: 'Confirmed' },
  { status: 'paid', label: 'Paid' },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getStepIndex(status: PaymentStatus): number {
  return STATUS_STEPS.findIndex((s) => s.status === status)
}

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * Polls GET /pay/{slug}/status every 10 seconds and renders a progress bar
 * showing the payment lifecycle: PENDING → DETECTED → CONFIRMING → CONFIRMED → PAID.
 *
 * Stops polling once status reaches `paid`.
 * Emits each new status to `onStatusChange` if provided.
 *
 * Requirement 11.9 — polls for payment status at ≤ 10 second intervals.
 */
export function PaymentStatusPoller({
  slug,
  onStatusChange,
}: PaymentStatusPollerProps) {
  const [status, setStatus] = useState<PaymentStatus>('pending')
  const [error, setError] = useState<string | null>(null)

  // Keep a stable ref to the callback so the interval closure doesn't go stale
  const onStatusChangeRef = useRef(onStatusChange)
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange
  })

  useEffect(() => {
    let cancelled = false

    async function poll() {
      try {
        const result = await getPaymentStatus(slug)
        if (cancelled) return
        setStatus((prev) => {
          if (prev !== result.status) {
            onStatusChangeRef.current?.(result.status)
          }
          return result.status
        })
        setError(null)
      } catch {
        if (!cancelled) {
          setError('Unable to fetch payment status. Retrying…')
        }
      }
    }

    // Fetch immediately on mount, then on each interval tick
    poll()

    const id = setInterval(() => {
      // Stop the interval once we already know status is `paid`
      setStatus((current) => {
        if (current === 'paid') {
          clearInterval(id)
        }
        return current
      })
      poll()
    }, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [slug])

  const activeIndex = getStepIndex(status)

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={`Payment status: ${status}`}
      className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm"
    >
      {/* Step progress bar */}
      <div className="relative flex items-start justify-between">
        {/* Connector line behind the dots */}
        <div
          className="absolute left-0 right-0 top-3.5 h-px bg-slate-200"
          aria-hidden="true"
        />

        {STATUS_STEPS.map((step, idx) => {
          const isCompleted = idx < activeIndex
          const isActive = idx === activeIndex

          return (
            <div
              key={step.status}
              className="relative flex flex-1 flex-col items-center gap-2"
            >
              {/* Dot */}
              <span
                aria-hidden="true"
                className={[
                  'z-10 flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-bold transition-colors',
                  isCompleted || isActive
                    ? 'border-slate-800 bg-slate-800 text-white'
                    : 'border-slate-300 bg-white text-slate-400',
                ].join(' ')}
              >
                {isCompleted ? (
                  /* Checkmark for completed steps */
                  <svg
                    className="h-3.5 w-3.5"
                    viewBox="0 0 16 16"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M3 8l3.5 3.5L13 4"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : (
                  idx + 1
                )}
              </span>

              {/* Label */}
              <span
                className={[
                  'text-center text-xs font-medium',
                  isActive
                    ? 'text-slate-900'
                    : isCompleted
                      ? 'text-slate-600'
                      : 'text-slate-400',
                ].join(' ')}
              >
                {step.label}
              </span>
            </div>
          )
        })}
      </div>

      {/* Accessible current-status summary (visually hidden but announced) */}
      <p className="sr-only">
        Current payment status: {status}
      </p>

      {/* Status message */}
      <div className="mt-4 text-center">
        {status === 'paid' ? (
          <p className="text-sm font-semibold text-green-700">
            Payment confirmed — thank you!
          </p>
        ) : (
          <p className="text-sm text-slate-500">
            {status === 'pending' && 'Waiting for your payment to be detected…'}
            {status === 'detected' && 'Payment detected on the network.'}
            {status === 'confirming' && 'Waiting for block confirmations…'}
            {status === 'confirmed' && 'Payment confirmed — finalising…'}
          </p>
        )}
      </div>

      {/* Non-critical polling error */}
      {error && (
        <p
          role="alert"
          className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-center text-xs text-amber-700"
        >
          {error}
        </p>
      )}
    </div>
  )
}
