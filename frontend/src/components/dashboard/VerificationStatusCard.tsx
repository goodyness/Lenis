import { Button } from '../ui/Button'
import { StatusBadge } from '../ui/StatusBadge'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface VerificationStatusCardProps {
  status: 'pending' | 'approved' | 'rejected'
  rejectionReason?: string
  submittedAt?: string
  fullLegalName?: string
  country?: string
  businessType?: string
  websiteUrl?: string
  intendedUse?: string
  onResubmit?: () => void
}

// ---------------------------------------------------------------------------
// Icons
// ---------------------------------------------------------------------------

function ClockIcon() {
  return (
    <svg
      className="h-8 w-8 text-yellow-500"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z"
        clipRule="evenodd"
      />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg
      className="h-8 w-8 text-green-500"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
        clipRule="evenodd"
      />
    </svg>
  )
}

function XIcon() {
  return (
    <svg
      className="h-8 w-8 text-red-500"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
        clipRule="evenodd"
      />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Submitted details summary (shared between pending and rejected)
// ---------------------------------------------------------------------------

interface DetailRowProps {
  label: string
  value: string
}

function DetailRow({ label, value }: DetailRowProps) {
  return (
    <div className="flex flex-col gap-0.5 py-2">
      <span className="text-xs font-medium uppercase tracking-wider text-slate-400">
        {label}
      </span>
      <span className="text-sm text-slate-700">{value}</span>
    </div>
  )
}

interface SubmittedDetailsSummaryProps {
  fullLegalName?: string
  country?: string
  businessType?: string
  websiteUrl?: string
  intendedUse?: string
  submittedAt?: string
}

function SubmittedDetailsSummary({
  fullLegalName,
  country,
  businessType,
  websiteUrl,
  intendedUse,
  submittedAt,
}: SubmittedDetailsSummaryProps) {
  const hasDetails =
    fullLegalName || country || businessType || websiteUrl || intendedUse

  if (!hasDetails) return null

  return (
    <div className="mt-4 divide-y divide-slate-100 rounded-md border border-slate-200 bg-white px-4">
      <p className="py-3 text-xs font-semibold uppercase tracking-wider text-slate-500">
        Submitted information
      </p>
      {fullLegalName && <DetailRow label="Full legal name" value={fullLegalName} />}
      {country && <DetailRow label="Country" value={country} />}
      {businessType && <DetailRow label="Business type" value={businessType} />}
      {websiteUrl && <DetailRow label="Website URL" value={websiteUrl} />}
      {intendedUse && <DetailRow label="Intended use" value={intendedUse} />}
      {submittedAt && (
        <DetailRow
          label="Submitted"
          value={new Date(submittedAt).toLocaleString()}
        />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function VerificationStatusCard({
  status,
  rejectionReason,
  submittedAt,
  fullLegalName,
  country,
  businessType,
  websiteUrl,
  intendedUse,
  onResubmit,
}: VerificationStatusCardProps) {
  const containerClasses: Record<typeof status, string> = {
    pending: 'border-yellow-200 bg-yellow-50',
    approved: 'border-green-200 bg-green-50',
    rejected: 'border-red-200 bg-red-50',
  }

  const messages: Record<typeof status, string> = {
    pending:
      "Your verification request is under review. We'll notify you once a decision has been made.",
    approved:
      'Your account has been verified. You now have access to live-mode API keys.',
    rejected: 'Your request was rejected.',
  }

  const icons: Record<typeof status, React.ReactNode> = {
    pending: <ClockIcon />,
    approved: <CheckIcon />,
    rejected: <XIcon />,
  }

  return (
    <div
      className={[
        'rounded-lg border p-6',
        containerClasses[status],
      ].join(' ')}
      role="region"
      aria-label={`Verification status: ${status}`}
    >
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="shrink-0 pt-0.5">{icons[status]}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-3">
            <h2 className="text-base font-semibold text-slate-900">
              Developer Verification
            </h2>
            <StatusBadge status={status} />
          </div>
          <p className="mt-1 text-sm text-slate-700">{messages[status]}</p>
        </div>
      </div>

      {/* Rejection reason */}
      {status === 'rejected' && rejectionReason && (
        <div className="mt-4 rounded-md border border-red-200 bg-white px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-red-500">
            Reason for rejection
          </p>
          <p className="mt-1 text-sm text-slate-700">{rejectionReason}</p>
        </div>
      )}

      {/* Submitted details */}
      {(status === 'pending' || status === 'rejected') && (
        <SubmittedDetailsSummary
          fullLegalName={fullLegalName}
          country={country}
          businessType={businessType}
          websiteUrl={websiteUrl}
          intendedUse={intendedUse}
          submittedAt={submittedAt}
        />
      )}

      {/* Resubmit button for rejected */}
      {status === 'rejected' && onResubmit && (
        <div className="mt-4">
          <Button variant="secondary" size="sm" onClick={onResubmit}>
            Submit a new request
          </Button>
        </div>
      )}
    </div>
  )
}
