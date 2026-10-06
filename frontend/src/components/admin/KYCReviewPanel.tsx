import { useId, useRef, useState } from 'react'
import { approveKYC, rejectKYC, revokeKYC } from '../../services/admin'
import type { KYCStatus } from '../../services/admin'
import { ApiError } from '../../services/errors'
import { useToast } from '../ui/Toaster'
import { StatusBadge } from '../ui/StatusBadge'
import { Button } from '../ui/Button'

interface KYCReviewPanelProps {
  userId: string
  kycStatus: KYCStatus
  rejectionReason?: string
  onStatusChange: (newStatus: KYCStatus) => void
}

const MAX_REASON_LENGTH = 500

export function KYCReviewPanel({
  userId,
  kycStatus,
  rejectionReason,
  onStatusChange,
}: KYCReviewPanelProps) {
  const toast = useToast()

  const [approving, setApproving] = useState(false)
  const [rejecting, setRejecting] = useState(false)
  const [revoking, setRevoking] = useState(false)
  const [showRevokeForm, setShowRevokeForm] = useState(false)

  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)

  // Revoke section multi-selection
  const [revokeSections, setRevokeSections] = useState<{
    personal: boolean
    business: boolean
    kyc: boolean
  }>({
    personal: true,
    business: true,
    kyc: true,
  })

  const reasonId = useId()
  const charCountId = useId()
  const reasonErrorId = useId()

  const textareaRef = useRef<HTMLTextAreaElement>(null)

  async function handleApprove() {
    setApproving(true)
    try {
      await approveKYC(userId)
      toast.success('KYC approved successfully')
      onStatusChange('approved')
    } catch (err) {
      if (err instanceof ApiError && err.code === 'KYC_NOT_PENDING') {
        toast.error('KYC is no longer pending')
      } else if (err instanceof ApiError) {
        toast.error(err.detail)
      } else {
        toast.error('An unexpected error occurred')
      }
    } finally {
      setApproving(false)
    }
  }

  async function handleReject(e: React.FormEvent) {
    e.preventDefault()

    // Client-side validation
    const trimmed = reason.trim()
    if (trimmed.length === 0) {
      setReasonError('Rejection reason is required.')
      textareaRef.current?.focus()
      return
    }
    if (reason.length > MAX_REASON_LENGTH) {
      setReasonError(`Rejection reason must be ${MAX_REASON_LENGTH} characters or fewer.`)
      textareaRef.current?.focus()
      return
    }
    setReasonError(null)

    setRejecting(true)
    try {
      await rejectKYC(userId, trimmed)
      toast.success('KYC rejected')
      onStatusChange('rejected')
    } catch (err) {
      if (err instanceof ApiError && err.code === 'KYC_NOT_PENDING') {
        toast.error('KYC is no longer pending')
      } else if (err instanceof ApiError) {
        toast.error(err.detail)
      } else {
        toast.error('An unexpected error occurred')
      }
    } finally {
      setRejecting(false)
    }
  }

  async function handleRevoke(e: React.FormEvent) {
    e.preventDefault()

    const trimmed = reason.trim()
    if (trimmed.length === 0) {
      setReasonError('Reason for revoking approval is required.')
      textareaRef.current?.focus()
      return
    }
    if (reason.length > MAX_REASON_LENGTH) {
      setReasonError(`Reason must be ${MAX_REASON_LENGTH} characters or fewer.`)
      textareaRef.current?.focus()
      return
    }

    const selected = Object.entries(revokeSections)
      .filter(([, checked]) => checked)
      .map(([sec]) => sec)

    if (selected.length === 0) {
      setReasonError('Please select at least one section that requires merchant correction.')
      return
    }

    setReasonError(null)
    setRevoking(true)
    try {
      await revokeKYC(userId, trimmed, selected)
      toast.success('KYC approval revoked. Merchant has been notified to update details.')
      setShowRevokeForm(false)
      onStatusChange('rejected')
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(err.detail)
      } else {
        toast.error('An unexpected error occurred while revoking approval')
      }
    } finally {
      setRevoking(false)
    }
  }

  return (
    <div className="space-y-5">
      {/* Current status */}
      <div className="flex items-center gap-3">
        <span className="text-sm font-medium text-slate-600">KYC Status:</span>
        <StatusBadge status={kycStatus} />
      </div>

      {/* Rejection reason display */}
      {kycStatus === 'rejected' && rejectionReason && (
        <div
          className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3"
          role="note"
          aria-label="Rejection reason"
        >
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">
            Rejection / Correction reason
          </p>
          <p className="mt-1 text-sm text-amber-800">{rejectionReason}</p>
        </div>
      )}

      {kycStatus === 'pending' && (
        <div className="space-y-6">
          {/* Approve action */}
          <div>
            <Button
              variant="primary"
              onClick={handleApprove}
              loading={approving}
              disabled={rejecting}
            >
              Approve KYC
            </Button>
          </div>

          {/* Reject form */}
          <form onSubmit={handleReject} noValidate className="space-y-3">
            <div className="flex flex-col gap-1">
              <label
                htmlFor={reasonId}
                className="text-sm font-medium text-slate-700"
              >
                Rejection reason
                <span className="ml-1 text-red-500" aria-hidden="true">
                  *
                </span>
              </label>
              <textarea
                ref={textareaRef}
                id={reasonId}
                rows={4}
                maxLength={MAX_REASON_LENGTH}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value)
                  if (reasonError) setReasonError(null)
                }}
                aria-required="true"
                aria-invalid={reasonError !== null}
                aria-describedby={`${charCountId}${reasonError ? ` ${reasonErrorId}` : ''}`}
                placeholder="Explain why the KYC submission is being rejected…"
                className={[
                  'w-full rounded-md border px-3 py-2 text-sm text-slate-900 placeholder-slate-400',
                  'resize-y transition-colors focus:outline-none focus:ring-2 focus:ring-offset-0',
                  reasonError
                    ? 'border-red-400 focus:border-red-500 focus:ring-red-400'
                    : 'border-slate-300 focus:border-slate-500 focus:ring-slate-400',
                ].join(' ')}
              />
              <div className="flex items-center justify-between">
                {reasonError ? (
                  <p
                    id={reasonErrorId}
                    className="text-xs text-red-600"
                    role="alert"
                  >
                    {reasonError}
                  </p>
                ) : (
                  <span />
                )}
                <span
                  id={charCountId}
                  aria-live="polite"
                  className={[
                    'ml-auto text-xs',
                    reason.length > MAX_REASON_LENGTH
                      ? 'text-red-600'
                      : 'text-slate-400',
                  ].join(' ')}
                >
                  {reason.length} / {MAX_REASON_LENGTH}
                </span>
              </div>
            </div>

            <Button
              type="submit"
              variant="danger"
              loading={rejecting}
              disabled={approving}
            >
              Reject KYC
            </Button>
          </form>
        </div>
      )}

      {kycStatus === 'approved' && (
        <div className="space-y-4">
          {!showRevokeForm ? (
            <div>
              <Button
                variant="danger"
                size="sm"
                onClick={() => setShowRevokeForm(true)}
              >
                Revoke Approval & Request KYC Update
              </Button>
              <p className="mt-1 text-xs text-slate-500">
                Revoke current verified status and prompt merchant via email to update specific information or documents.
              </p>
            </div>
          ) : (
            <form onSubmit={handleRevoke} className="rounded-lg border border-red-200 bg-red-50/40 p-4 space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-semibold text-red-900">
                  Revoke Approval & Request Merchant Update
                </h4>
                <button
                  type="button"
                  onClick={() => {
                    setShowRevokeForm(false)
                    setReasonError(null)
                  }}
                  className="text-xs font-medium text-slate-500 hover:text-slate-800"
                >
                  Cancel
                </button>
              </div>

              <div>
                <label className="text-xs font-semibold uppercase tracking-wider text-slate-700 block mb-2">
                  Select Sections Requiring Update:
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <label className="flex items-center gap-2 rounded bg-white p-2 border border-slate-200 text-xs font-medium text-slate-800 cursor-pointer hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={revokeSections.personal}
                      onChange={(e) =>
                        setRevokeSections((prev) => ({ ...prev, personal: e.target.checked }))
                      }
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>Personal Info</span>
                  </label>
                  <label className="flex items-center gap-2 rounded bg-white p-2 border border-slate-200 text-xs font-medium text-slate-800 cursor-pointer hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={revokeSections.business}
                      onChange={(e) =>
                        setRevokeSections((prev) => ({ ...prev, business: e.target.checked }))
                      }
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>Business Details</span>
                  </label>
                  <label className="flex items-center gap-2 rounded bg-white p-2 border border-slate-200 text-xs font-medium text-slate-800 cursor-pointer hover:bg-slate-50">
                    <input
                      type="checkbox"
                      checked={revokeSections.kyc}
                      onChange={(e) =>
                        setRevokeSections((prev) => ({ ...prev, kyc: e.target.checked }))
                      }
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    />
                    <span>Identity / KYC Proof</span>
                  </label>
                </div>
              </div>

              <div className="space-y-1">
                <label htmlFor={reasonId} className="text-xs font-semibold uppercase tracking-wider text-slate-700 block">
                  Explanation / Correction Instructions <span className="text-red-500">*</span>
                </label>
                <textarea
                  ref={textareaRef}
                  id={reasonId}
                  rows={3}
                  maxLength={MAX_REASON_LENGTH}
                  value={reason}
                  onChange={(e) => {
                    setReason(e.target.value)
                    if (reasonError) setReasonError(null)
                  }}
                  placeholder="Explain what needs to be updated (e.g., 'Please upload a clear government-issued ID and confirm your physical business address')."
                  className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 placeholder-slate-400 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                />
                {reasonError && (
                  <p className="text-xs text-red-600" role="alert">
                    {reasonError}
                  </p>
                )}
              </div>

              <div className="flex items-center gap-3">
                <Button type="submit" variant="danger" size="sm" loading={revoking}>
                  Confirm Revocation & Notify Merchant
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => setShowRevokeForm(false)}
                  disabled={revoking}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </div>
      )}

      {kycStatus === 'not_started' && (
        <p className="text-sm text-slate-500">
          Merchant has not submitted KYC documents yet.
        </p>
      )}
    </div>
  )
}
