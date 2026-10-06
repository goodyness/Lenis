import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AxiosError } from 'axios'
import { useAuthStore } from '../lib/auth-store'
import { apiClient } from '../lib/api'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'

const REASON_LABELS: Record<string, string> = {
  policy_violation: 'Policy Violation',
  fraud: 'Fraudulent Activity',
  spam: 'Spam or Abuse',
  identity_verification_failed: 'Identity Verification Failed',
  other: 'Other',
}

interface AppealErrorDetail {
  detail?: string
  code?: string
}

export function AppealPage() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const suspensionInfo = useAuthStore((s) => s.suspensionInfo)

  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [messageError, setMessageError] = useState<string | undefined>()

  const reasonLabel = suspensionInfo?.suspension_reason
    ? (REASON_LABELS[suspensionInfo.suspension_reason] ?? suspensionInfo.suspension_reason)
    : null

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (message.trim().length < 10) {
      setMessageError('Please write at least 10 characters explaining your case.')
      return
    }
    setMessageError(undefined)
    setLoading(true)

    try {
      await apiClient.post('/users/me/appeal', { message: message.trim() })
      setSubmitted(true)
    } catch (err) {
      const axiosErr = err as AxiosError<AppealErrorDetail>
      const code = axiosErr.response?.data?.code
      if (code === 'APPEAL_ALREADY_PENDING') {
        setError('You already have a pending appeal. Please wait for it to be reviewed.')
      } else if (code === 'ACCOUNT_NOT_SUSPENDED') {
        setError('Your account is not currently suspended.')
      } else {
        setError('Something went wrong. Please try again.')
      }
    } finally {
      setLoading(false)
    }
  }

  if (submitted) {
    return (
      <div className="flex min-h-screen flex-col bg-slate-50">
        <header className="border-b border-slate-100 bg-white">
          <div className="mx-auto flex max-w-7xl items-center px-4 py-4 sm:px-6 lg:px-8">
            <span className="text-xl font-semibold tracking-tight text-slate-900">Lenis</span>
          </div>
        </header>

        <main className="flex flex-1 items-center justify-center px-4 py-16 sm:px-6 lg:px-8">
          <div className="w-full max-w-md text-center">
            <div className="mb-6 flex justify-center">
              <span className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
                <svg
                  className="h-8 w-8 text-green-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth="1.5"
                  stroke="currentColor"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
              </span>
            </div>
            <h1 className="text-2xl font-bold text-slate-900">Appeal Submitted</h1>
            <p className="mt-2 text-sm text-slate-500">
              Your appeal has been received. Our team will review it within 2–3 business days.
            </p>
            <Button
              variant="secondary"
              size="md"
              className="mt-8"
              onClick={() => navigate('/suspended')}
            >
              Back to suspension page
            </Button>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      {/* Header */}
      <header className="border-b border-slate-100 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <span className="text-xl font-semibold tracking-tight text-slate-900">Lenis</span>
          <button
            type="button"
            onClick={() => navigate('/suspended')}
            className="text-sm text-slate-500 underline underline-offset-2 hover:text-slate-700"
          >
            ← Back
          </button>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-16 sm:px-6 lg:px-8">
        <div className="w-full max-w-lg">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-bold text-slate-900">Submit an Appeal</h1>
            <p className="mt-1 text-sm text-slate-500">
              Explain your situation and we'll review your account.
            </p>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
            {/* Pre-filled user details */}
            <section aria-label="Your account details" className="space-y-4">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                Your Details
              </h2>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Input
                  label="Full Name"
                  value={user?.full_name ?? ''}
                  disabled
                  readOnly
                />
                <Input
                  label="Email"
                  value={user?.email ?? ''}
                  disabled
                  readOnly
                />
              </div>

              <Input
                label="Account Type"
                value={
                  user?.account_type
                    ? user.account_type.charAt(0).toUpperCase() + user.account_type.slice(1)
                    : ''
                }
                disabled
                readOnly
              />
            </section>

            {/* Suspension context */}
            {(reasonLabel || suspensionInfo?.suspension_message) && (
              <section
                aria-label="Suspension details"
                className="mt-6 rounded-md border border-slate-100 bg-slate-50 px-4 py-3 space-y-2"
              >
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Suspension Details
                </h2>
                {reasonLabel && (
                  <p className="text-sm text-slate-700">
                    <span className="font-medium">Reason:</span> {reasonLabel}
                  </p>
                )}
                {suspensionInfo?.suspension_message && (
                  <p className="text-sm text-slate-700">
                    <span className="font-medium">Message from admin:</span>{' '}
                    {suspensionInfo.suspension_message}
                  </p>
                )}
              </section>
            )}

            {/* Appeal message */}
            <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-4">
              <div className="flex flex-col gap-1">
                <label
                  htmlFor="appeal-message"
                  className="text-sm font-medium text-slate-700"
                >
                  Your Appeal Message
                  <span className="ml-1 text-red-500" aria-hidden="true">
                    *
                  </span>
                </label>
                <textarea
                  id="appeal-message"
                  rows={6}
                  required
                  disabled={loading}
                  placeholder="Explain why you believe your account should be reinstated. Be specific and include any relevant context."
                  value={message}
                  onChange={(e) => {
                    setMessage(e.target.value)
                    if (messageError && e.target.value.trim().length >= 10) {
                      setMessageError(undefined)
                    }
                  }}
                  className={[
                    'w-full rounded-md border px-3 py-2 text-sm text-slate-900 placeholder-slate-400',
                    'resize-y transition-colors focus:outline-none focus:ring-2 focus:ring-offset-0',
                    messageError
                      ? 'border-red-400 focus:border-red-500 focus:ring-red-400'
                      : 'border-slate-300 focus:border-slate-500 focus:ring-slate-400',
                    loading ? 'cursor-not-allowed bg-slate-50 text-slate-400' : 'bg-white',
                  ].join(' ')}
                  aria-invalid={!!messageError}
                  aria-describedby={messageError ? 'appeal-message-error' : undefined}
                />
                {messageError && (
                  <p id="appeal-message-error" className="text-xs text-red-600" role="alert">
                    {messageError}
                  </p>
                )}
                <p className="text-xs text-slate-400">
                  {message.length} / 2000 characters
                </p>
              </div>

              {error && (
                <div
                  className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
                  role="alert"
                >
                  {error}
                </div>
              )}

              <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  size="md"
                  onClick={() => navigate('/suspended')}
                  disabled={loading}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="md"
                  loading={loading}
                >
                  Submit Appeal
                </Button>
              </div>
            </form>
          </div>
        </div>
      </main>
    </div>
  )
}
