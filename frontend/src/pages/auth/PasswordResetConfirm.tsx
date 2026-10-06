import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AxiosError } from 'axios'
import { apiClient } from '../../lib/api'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'

interface ApiErrorResponse {
  detail: string
  code?: string
}

interface FormErrors {
  new_password?: string
  confirm_password?: string
  form?: string
}

type FormState = 'idle' | 'loading' | 'success' | 'token_expired' | 'token_invalid' | 'token_already_used'

function validatePassword(value: string): string | undefined {
  if (value.length < 8) return 'Password must be at least 8 characters.'
  if (value.length > 128) return 'Password must be 128 characters or fewer.'
  if (!/[A-Z]/.test(value)) return 'Password must contain at least one uppercase letter.'
  if (!/[a-z]/.test(value)) return 'Password must contain at least one lowercase letter.'
  if (!/[0-9]/.test(value)) return 'Password must contain at least one digit.'
  if (!/[^A-Za-z0-9]/.test(value)) return 'Password must contain at least one special character.'
  return undefined
}

export function PasswordResetConfirm() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [errors, setErrors] = useState<FormErrors>({})
  const [formState, setFormState] = useState<FormState>('idle')

  const isLoading = formState === 'loading'

  // If no token in URL, show missing-token state immediately
  if (!token) {
    return <PageShell><MissingTokenState /></PageShell>
  }

  if (formState === 'success') {
    return <PageShell><SuccessState /></PageShell>
  }

  if (formState === 'token_expired') {
    return <PageShell><TokenErrorState reason="expired" /></PageShell>
  }

  if (formState === 'token_invalid' || formState === 'token_already_used') {
    return <PageShell><TokenErrorState reason="invalid" /></PageShell>
  }

  function validate(): FormErrors {
    const fieldErrors: FormErrors = {}
    const pwdError = validatePassword(newPassword)
    if (pwdError) fieldErrors.new_password = pwdError
    if (!confirmPassword) {
      fieldErrors.confirm_password = 'Please confirm your password.'
    } else if (newPassword !== confirmPassword) {
      fieldErrors.confirm_password = 'Passwords do not match.'
    }
    return fieldErrors
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    const fieldErrors = validate()
    if (Object.values(fieldErrors).some(Boolean)) {
      setErrors(fieldErrors)
      return
    }
    setErrors({})
    setFormState('loading')

    try {
      await apiClient.post('/auth/password-reset/confirm', {
        token,
        new_password: newPassword,
      })
      setFormState('success')
    } catch (err) {
      const axiosErr = err as AxiosError<ApiErrorResponse>
      const status = axiosErr.response?.status
      const code = axiosErr.response?.data?.code
      const detail = axiosErr.response?.data?.detail

      if (code === 'TOKEN_EXPIRED') {
        setFormState('token_expired')
      } else if (code === 'TOKEN_INVALID') {
        setFormState('token_invalid')
      } else if (code === 'TOKEN_ALREADY_USED') {
        setFormState('token_already_used')
      } else if (status === 400 && typeof detail === 'string') {
        setFormState('idle')
        setErrors({ form: detail })
      } else {
        setFormState('idle')
        setErrors({ form: 'Something went wrong. Please try again.' })
      }
    }
  }

  return (
    <PageShell>
      <div className="rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Set a new password
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Choose a strong password for your account.
          </p>
        </div>

        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          <Input
            label="New password"
            id="reset-new-password"
            type="password"
            autoComplete="new-password"
            placeholder="Min 8 chars, uppercase, lowercase, digit, special"
            value={newPassword}
            onChange={(e) => {
              setNewPassword(e.target.value)
              if (errors.new_password) setErrors((prev) => ({ ...prev, new_password: undefined }))
            }}
            error={errors.new_password}
            helperText={
              !errors.new_password
                ? 'At least 8 characters, uppercase, lowercase, digit, and special character.'
                : undefined
            }
            required
            disabled={isLoading}
          />

          <Input
            label="Confirm password"
            id="reset-confirm-password"
            type="password"
            autoComplete="new-password"
            placeholder="Re-enter your new password"
            value={confirmPassword}
            onChange={(e) => {
              setConfirmPassword(e.target.value)
              if (errors.confirm_password) setErrors((prev) => ({ ...prev, confirm_password: undefined }))
            }}
            error={errors.confirm_password}
            required
            disabled={isLoading}
          />

          {errors.form && (
            <p
              className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
              role="alert"
            >
              {errors.form}
            </p>
          )}

          <Button
            type="submit"
            className="mt-2 w-full"
            size="lg"
            loading={isLoading}
          >
            Reset password
          </Button>
        </form>
      </div>
    </PageShell>
  )
}

// ---------------------------------------------------------------------------
// Shared page shell
// ---------------------------------------------------------------------------
function PageShell({ children }: { children: React.ReactNode }) {
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
      <main className="flex items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
        <div className="w-full max-w-md">{children}</div>
      </main>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Terminal states
// ---------------------------------------------------------------------------
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
      <h1 className="text-xl font-semibold text-slate-900">Password reset</h1>
      <p className="mt-2 text-sm text-slate-500">
        Your password has been updated. You can now log in with your new password.
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
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </div>
      <h1 className="text-xl font-semibold text-slate-900">Invalid reset link</h1>
      <p className="mt-2 text-sm text-slate-500">
        This link is missing a reset token. Please use the link from your email, or
        request a new one.
      </p>
      <Link
        to="/forgot-password"
        className="mt-6 inline-flex w-full items-center justify-center rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2"
      >
        Request a new reset link
      </Link>
    </div>
  )
}

interface TokenErrorStateProps {
  reason: 'expired' | 'invalid'
}

function TokenErrorState({ reason }: TokenErrorStateProps) {
  const isExpired = reason === 'expired'

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-8 shadow-sm text-center">
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
        {isExpired ? 'Reset link expired' : 'Reset link invalid'}
      </h1>
      <p className="mt-2 text-sm text-slate-500">
        {isExpired
          ? 'This reset link has expired. Please request a new one.'
          : 'This reset link is invalid or has already been used.'}
      </p>
      <Link
        to="/forgot-password"
        className="mt-6 inline-flex w-full items-center justify-center rounded-md bg-slate-900 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2"
      >
        Request a new reset link
      </Link>
    </div>
  )
}
