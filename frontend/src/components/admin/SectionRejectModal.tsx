import { useState, useRef } from 'react'
import { rejectMerchantSection } from '../../services/admin'
import { ApiError } from '../../services/errors'
import { useToast } from '../ui/Toaster'
import { Button } from '../ui/Button'

interface SectionRejectModalProps {
  isOpen: boolean
  onClose: () => void
  userId: string
  section: 'personal' | 'business' | 'kyc'
  sectionTitle: string
  onSuccess: (section: 'personal' | 'business' | 'kyc', reason: string) => void
}

const MAX_REASON_LENGTH = 500

export function SectionRejectModal({
  isOpen,
  onClose,
  userId,
  section,
  sectionTitle,
  onSuccess,
}: SectionRejectModalProps) {
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  if (!isOpen) return null

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = reason.trim()
    if (!trimmed) {
      setReasonError('Please provide a specific reason for rejection.')
      textareaRef.current?.focus()
      return
    }
    if (trimmed.length > MAX_REASON_LENGTH) {
      setReasonError(`Rejection reason must be ${MAX_REASON_LENGTH} characters or fewer.`)
      textareaRef.current?.focus()
      return
    }
    setReasonError(null)
    setLoading(true)

    try {
      await rejectMerchantSection(userId, section, trimmed)
      toast.success(`${sectionTitle} marked as rejected`)
      onSuccess(section, trimmed)
      setReason('')
      onClose()
    } catch (err) {
      if (err instanceof ApiError) {
        toast.error(err.detail)
      } else {
        toast.error('Failed to reject section. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm animate-fade-in"
      role="dialog"
      aria-modal="true"
      aria-labelledby="section-reject-modal-title"
    >
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl space-y-5">
        <div>
          <h2 id="section-reject-modal-title" className="text-lg font-semibold text-slate-900">
            Reject {sectionTitle}
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            Specify what needs to be fixed. The merchant will see this reason on their dashboard and will be routed directly to Step {section === 'personal' ? 1 : section === 'business' ? 2 : 3} to update it.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="rejection-reason-input" className="block text-xs font-semibold uppercase tracking-wider text-slate-600 mb-1.5">
              Reason / Instructions for Merchant
            </label>
            <textarea
              id="rejection-reason-input"
              ref={textareaRef}
              rows={4}
              value={reason}
              onChange={(e) => {
                setReason(e.target.value)
                if (reasonError) setReasonError(null)
              }}
              placeholder={`e.g. Please update ${sectionTitle.toLowerCase()} with accurate and verifiable details...`}
              className="w-full rounded-lg border border-slate-300 p-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
              maxLength={MAX_REASON_LENGTH}
            />
            <div className="mt-1.5 flex justify-between items-center text-xs">
              {reasonError ? (
                <span className="text-red-600 font-medium">{reasonError}</span>
              ) : (
                <span className="text-slate-400">Clear feedback helps merchants fix issues quickly</span>
              )}
              <span className={`font-mono ${reason.length > MAX_REASON_LENGTH ? 'text-red-600' : 'text-slate-400'}`}>
                {reason.length}/{MAX_REASON_LENGTH}
              </span>
            </div>
          </div>

          <div className="flex items-center justify-end gap-3 pt-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setReason('')
                setReasonError(null)
                onClose()
              }}
              disabled={loading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="danger"
              size="sm"
              loading={loading}
            >
              Reject Section
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
