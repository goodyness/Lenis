import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AxiosError } from 'axios'
import { apiClient } from '../../lib/api'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { useVerificationPoller } from '../../hooks/useVerificationPoller'

interface ApiErrorResponse {
  detail: string
  code?: string
}

type VerifyState =
  | 'loading'
  | 'success'
  | 'already_verified'
  | 'token_expired'
  | 'token_invalid'
  | 'missing_token'
  | 'pending'

type ResendState = 'idle' | 'loading' | 'sent' | 'error'

export function VerifyEmail() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const emailParam = searchParams.get('email') ?? ''

  const [verifyState, setVerifyState] = useState<VerifyState>(() => {
    if (token) return 'loading'
    if (emailParam) return 'pending'
    return 'missing_token'
  })
  const [resendEmail, setResendEmail] = useState(emailParam)
  const [resendEmailError, setResendEmailError] = useState<string | undefined>()
  const [resendState, setResendState] = useState<ResendState>('idle')
  const [resendErrorMessage, setResendErrorMessage] = useState<string | undefined>()

  // Guard against double-invocation in React strict mode
  const didVerify = useRef(false)

  useEffect(() => {
    if (!token || didVerify.current) return
    didVerify.current = true

    apiClient
      .post('/auth/verify-email', { token })
      .then(() => {
        setVerifyState('success')
      })
      .catch((err: AxiosError<ApiErrorResponse>) => {
        const code = err.response?.data?.code
        if (code === 'EMAIL_ALREADY_VERIFIED') {
          setVerifyState('already_verified')
        } else if (code === 'TOKEN_EXPIRED') {
          setVerifyState('token_expired')
        } else {
          setVerifyState('token_invalid')
        }
      })
  }, [token])

  async function handleResend(e: React.FormEvent) {
    e.preventDefault()

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailPattern.test(resendEmail.trim())) {
      setResendEmailError('Enter a valid email address.')
      return
    }
    setResendEmailError(undefined)
    setResendState('loading')
    setResendErrorMessage(undefined)

    try {
      await apiClient.post('/auth/resend-verification', {
        email: resendEmail.trim().toLowerCase(),
      })
      setResendState('sent')
    } catch (err) {
      const axiosErr = err as AxiosError<ApiErrorResponse>
      const code = axiosErr.response?.data?.code
      if (code === 'EMAIL_ALREADY_VERIFIED') {
        setResendErrorMessage(
          'That email address is already verified. You can log in directly.',
        )
      } else {
        setResendErrorMessage('Something went wrong. Please try again.')
      }
      setResendState('error')
    }
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-100 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <Link
            to="/"
            className="text-xl font-semibold tracking-tight text-slate-900"
            aria-label="Lenis home"
          >
            Lenis
          </Link>
        </div>
      </header>

      <main className="flex items-center justify-center px-4 py-16 sm:px-6 lg:px-8">
        <div className="w-full max-w-md">
          {verifyState === 'loading' && <LoadingState />}
          {verifyState === 'success' && <SuccessState />}
          {verifyState === 'already_verified' && <AlreadyVerifiedState />}
          {verifyState === 'pending' && (
            <PendingState
              email={resendEmail}
            />
          )}
          {verifyState === 'token_expired' && (
            <ResendState
              resendEmail={resendEmail}
              setResendEmail={setResendEmail}
              resendEmailError={resendEmailError}
              setResendEmailError={setResendEmailError}
              resendState={resendState}
              resendErrorMessage={resendErrorMessage}
              onSubmit={handleResend}
              reason="expired"
            />
          )}
          {verifyState === 'token_invalid' && (
            <ResendState
              resendEmail={resendEmail}
              setResendEmail={setResendEmail}
              resendEmailError={resendEmailError}
              setResendEmailError={setResendEmailError}
              resendState={resendState}
              resendErrorMessage={resendErrorMessage}
              onSubmit={handleResend}
              reason="invalid"
            />
          )}
          {verifyState === 'missing_token' && <MissingTokenState />}
        </div>
      </main>
    </div>
  )
}

function PendingState({ email }: { email: string }) {
  const [resendStatus, setResendStatus] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle')
  const [errorMessage, setErrorMessage] = useState<string | undefined>()

  // Auto-redirect to /login once the user clicks the email link and verifies
  useVerificationPoller(email)

  async function handleResend() {
    setResendStatus('loading')
    setErrorMessage(undefined)
    try {
      await apiClient.post('/auth/resend-verification', {
        email: email.trim().toLowerCase(),
      })
      setResendStatus('sent')
    } catch (err) {
      const axiosErr = err as AxiosError<ApiErrorResponse>
      const code = axiosErr.response?.data?.code
      if (code === 'EMAIL_ALREADY_VERIFIED') {
        setErrorMessage('This email is already verified. You can log in directly.')
      } else {
        setErrorMessage('Something went wrong. Please try again.')
      }
      setResendStatus('error')
    }
  }

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-8 shadow-sm text-center">
      <div
        className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100"
        aria-hidden="true"
      >
        <svg className="h-6 w-6 text-slate-700" viewBox="0 0 24 24" fill="none">
          <path
            d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>

      <h1 className="text-xl font-semibold text-slate-900">Check your email</h1>
      <p className="mt-2 text-sm text-slate-600">We sent a verification link to</p>
      <p className="mt-0.5 mb-4 text-sm font-medium text-slate-900 break-all">{email}</p>
      <p className="text-sm text-slate-500">
        Click the link in the email to activate your account. The link expires in 24 hours.
      </p>

      {/* Subtle animated indicator that we are watching for verification */}
      <p className="mt-3 flex items-center justify-center gap-1.5 text-xs text-slate-400">
        <span
          className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400"
          aria-hidden="true"
        />
        Waiting for verification…
      </p>

      <div className="mt-5">
        {resendStatus === 'sent' ? (
          <p className="text-sm font-medium text-green-700">
            Verification email resent. Check your inbox.
          </p>
        ) : (
          <>
            <p className="text-sm text-slate-500">
              {"Didn't receive it? "}
              <button
                type="button"
                onClick={handleResend}
                disabled={resendStatus === 'loading'}
                className={[
                  'font-medium underline underline-offset-2 transition-colors',
                  'focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1 rounded',
                  resendStatus === 'loading'
                    ? 'cursor-not-allowed text-slate-400'
                    : 'text-slate-900 hover:text-slate-700',
                ].join(' ')}
              >
                {resendStatus === 'loading' ? 'Sending…' : 'Resend verification email'}
              </button>
            </p>
            {resendStatus === 'error' && errorMessage && (
              <p className="mt-1 text-xs text-red-600">{errorMessage}</p>
            )}
          </>
        )}
      </div>

      <p className="mt-6 text-sm text-slate-500">
        Already verified?{' '}
        <Link
          to="/login"
          className="font-medium text-slate-900 underline underline-offset-2 hover:text-slate-700"
        >
          Log in
        </Link>
      </p>
    </div>
  )
}

function LoadingState() {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-8 shadow-sm text-center">
      <div
        className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-4 border-slate-200 border-t-slate-900"
        aria-hidden="true"
      />
      <h1 className="text-xl font-semibold text-slate-900">Verifying your email</h1>
      <p className="mt-1 text-sm text-slate-500">Please wait a moment...</p>
    </div>
  )
}

function SuccessState() {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-8 shadow-sm text-center">
      <div
        className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100"
        aria-hidden="true"
      >
        <svg
          className="h-6 w-6 text-green-600"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h1 className="text-xl font-semibold text-slate-900">Email verified</h1>
      <p className="mt-2 text-sm text-slate-500">
        Your email address has been confirmed. You can now log in to your account.
      </p>
      <Link
        to="/login"
        className="mt-6 inline-flex w-full items-center justify-center rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2"
      >
        Go to login
      </Link>
    </div>
  )
}

function AlreadyVerifiedState() {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-8 shadow-sm text-center">
      <div
        className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-blue-100"
        aria-hidden="true"
      >
        <svg
          className="h-6 w-6 text-blue-600"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20A10 10 0 0012 2z"
          />
        </svg>
      </div>
      <h1 className="text-xl font-semibold text-slate-900">Already verified</h1>
      <p className="mt-2 text-sm text-slate-500">
        This email address has already been verified. You can log in directly.
      </p>
      <Link
        to="/login"
        className="mt-6 inline-flex w-full items-center justify-center rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2"
      >
        Go to login
      </Link>
    </div>
  )
}

function MissingTokenState() {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-8 shadow-sm text-center">
      <div
        className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-100"
        aria-hidden="true"
      >
        <svg
          className="h-6 w-6 text-red-600"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </div>
      <h1 className="text-xl font-semibold text-slate-900">Invalid verification link</h1>
      <p className="mt-2 text-sm text-slate-500">
        This link is missing a verification token. Please use the link from your email, or
        request a new one below.
      </p>
      <Link
        to="/login"
        className="mt-6 inline-flex w-full items-center justify-center rounded-md border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2"
      >
        Back to login
      </Link>
    </div>
  )
}

interface ResendStateProps {
  resendEmail: string
  setResendEmail: (v: string) => void
  resendEmailError: string | undefined
  setResendEmailError: (v: string | undefined) => void
  resendState: ResendState
  resendErrorMessage: string | undefined
  onSubmit: (e: React.FormEvent) => void
  reason: 'expired' | 'invalid'
}

function ResendState({
  resendEmail,
  setResendEmail,
  resendEmailError,
  setResendEmailError,
  resendState,
  resendErrorMessage,
  onSubmit,
  reason,
}: ResendStateProps) {
  const isExpired = reason === 'expired'

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
      <div className="mb-6 text-center">
        <div
          className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100"
          aria-hidden="true"
        >
          <svg
            className="h-6 w-6 text-amber-600"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
            />
          </svg>
        </div>
        <h1 className="text-xl font-semibold text-slate-900">
          {isExpired ? 'Verification link expired' : 'Verification link invalid'}
        </h1>
        <p className="mt-2 text-sm text-slate-500">
          {isExpired
            ? 'This verification link has expired. Verification links are valid for 24 hours.'
            : 'This verification link is no longer valid. It may have already been used.'}
        </p>
      </div>

      {resendState === 'sent' ? (
        <div
          className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800"
          role="alert"
        >
          <p className="font-medium">Verification email sent</p>
          <p className="mt-0.5 text-green-700">
            Check your inbox for a new verification link.
          </p>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          <p className="text-sm font-medium text-slate-700">
            Enter your email address to receive a new verification link.
          </p>
          <Input
            label="Email address"
            id="resend-email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            value={resendEmail}
            onChange={(e) => {
              setResendEmail(e.target.value)
              if (resendEmailError) setResendEmailError(undefined)
            }}
            error={resendEmailError}
            required
            disabled={resendState === 'loading'}
          />

          {resendState === 'error' && resendErrorMessage && (
            <p
              className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
              role="alert"
            >
              {resendErrorMessage}
            </p>
          )}

          <Button
            type="submit"
            className="w-full"
            size="lg"
            loading={resendState === 'loading'}
          >
            Resend verification email
          </Button>
        </form>
      )}

      <p className="mt-4 text-center text-sm text-slate-500">
        <Link
          to="/login"
          className="font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900"
        >
          Back to login
        </Link>
      </p>
    </div>
  )
}
