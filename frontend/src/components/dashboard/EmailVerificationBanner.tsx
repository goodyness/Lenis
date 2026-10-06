import { useState } from 'react'
import { apiClient } from '../../lib/api'

interface EmailVerificationBannerProps {
  email: string
}

export function EmailVerificationBanner({ email }: EmailVerificationBannerProps) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle')

  async function handleResend() {
    setStatus('loading')
    try {
      await apiClient.post('/auth/resend-verification', { email })
      setStatus('sent')
    } catch {
      setStatus('error')
    }
  }

  return (
    <div
      role="alert"
      className="flex items-start gap-4 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3"
    >
      {/* Icon */}
      <svg
        className="mt-0.5 h-5 w-5 shrink-0 text-yellow-600"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
          clipRule="evenodd"
        />
      </svg>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-yellow-800">
          Please verify your email address
        </p>
        <p className="mt-0.5 text-sm text-yellow-700">
          We sent a confirmation link to <span className="font-medium">{email}</span>.
          Check your inbox and click the link to activate your account.
        </p>

        {status === 'sent' && (
          <p className="mt-2 text-sm font-medium text-yellow-800">
            A new verification email has been sent.
          </p>
        )}

        {status === 'error' && (
          <p className="mt-2 text-sm text-red-700">
            Something went wrong. Please try again.
          </p>
        )}

        {status !== 'sent' && (
          <button
            type="button"
            onClick={handleResend}
            disabled={status === 'loading'}
            className="mt-2 text-sm font-medium text-yellow-800 underline underline-offset-2 hover:text-yellow-900 disabled:cursor-not-allowed disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:ring-offset-1 rounded"
          >
            {status === 'loading' ? 'Sending...' : 'Resend verification email'}
          </button>
        )}
      </div>
    </div>
  )
}
