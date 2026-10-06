import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AxiosError } from 'axios'
import { apiClient } from '../../lib/api'
import { useVerificationPoller } from '../../hooks/useVerificationPoller'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'

interface FormErrors {
  full_name?: string
  email?: string
  password?: string
  form?: string
}

interface RegisterPayload {
  email: string
  password: string
  full_name: string
  account_type: string
}

interface RegisterResponse {
  user_id: string
  email: string
}

function validateFullName(value: string): string | undefined {
  if (value.length < 2) return 'Full name must be at least 2 characters.'
  if (value.length > 100) return 'Full name must be 100 characters or fewer.'
  return undefined
}

function validateEmail(value: string): string | undefined {
  const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!pattern.test(value)) return 'Enter a valid email address.'
  return undefined
}

function validatePassword(value: string): string | undefined {
  if (value.length < 8) return 'Password must be at least 8 characters.'
  if (!/[A-Z]/.test(value)) return 'Password must contain at least one uppercase letter.'
  if (!/[a-z]/.test(value)) return 'Password must contain at least one lowercase letter.'
  if (!/[0-9]/.test(value)) return 'Password must contain at least one digit.'
  return undefined
}

// ---------------------------------------------------------------------------
// Success banner
// ---------------------------------------------------------------------------
interface SuccessBannerProps {
  email: string
}

function SuccessBanner({ email }: SuccessBannerProps) {
  const [resendStatus, setResendStatus] = useState<'idle' | 'loading' | 'sent' | 'error'>('idle')

  // Auto-redirect to /login once verification is detected
  useVerificationPoller(email)

  async function handleResend() {
    setResendStatus('loading')
    try {
      await apiClient.post('/auth/resend-verification', { email })
      setResendStatus('sent')
    } catch {
      setResendStatus('error')
    }
  }

  return (
    <div className="text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-900">
        <svg
          className="h-6 w-6"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
          />
        </svg>
      </div>

      <h2 className="mb-1 text-xl font-semibold text-slate-900">Check your email</h2>
      <p className="mb-6 text-sm text-slate-500">
        We sent a verification link to <strong className="text-slate-700">{email}</strong>. Please click the link to activate your account.
      </p>

      <div className="rounded-md bg-slate-50 border border-slate-200 p-4 text-sm text-slate-600">
        {resendStatus === 'sent' ? (
          <p className="font-medium text-green-700">A new verification link has been sent.</p>
        ) : (
          <>
            <p>
              Didn’t receive the email?{' '}
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
                {resendStatus === 'loading' ? 'Sending...' : 'Resend verification email'}
              </button>
            </p>
            {resendStatus === 'error' && (
              <p className="mt-1 text-xs text-red-600">Failed to resend. Please try again.</p>
            )}
          </>
        )}
      </div>

      <p className="mt-6 text-sm text-slate-500">
        Already verified?{' '}
        <Link to="/login" className="font-medium text-slate-900 underline underline-offset-2 hover:text-slate-700">
          Log in
        </Link>
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Unified Merchant Registration Form
// ---------------------------------------------------------------------------
export function RegisterForm() {
  const navigate = useNavigate()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [errors, setErrors] = useState<FormErrors>({})
  const [loading, setLoading] = useState(false)
  const [isSuccess, setIsSuccess] = useState(false)
  const [successEmail, setSuccessEmail] = useState('')

  function validate(): FormErrors {
    return {
      full_name: validateFullName(fullName),
      email: validateEmail(email),
      password: validatePassword(password),
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    const fieldErrors = validate()
    const hasErrors = Object.values(fieldErrors).some(Boolean)
    if (hasErrors) {
      setErrors(fieldErrors)
      return
    }
    setErrors({})

    setLoading(true)
    try {
      const payload: RegisterPayload = {
        email: email.trim().toLowerCase(),
        password,
        full_name: fullName.trim(),
        account_type: 'merchant',
      }
      await apiClient.post<RegisterResponse>('/auth/register', payload)
      setSuccessEmail(email.trim().toLowerCase())
      setIsSuccess(true)
    } catch (err) {
      const axiosErr = err as AxiosError<{ detail: { detail: string; code?: string } | string }>
      const status = axiosErr.response?.status
      const rawDetail = axiosErr.response?.data?.detail
      const detail = typeof rawDetail === 'object' ? rawDetail?.detail : rawDetail
      const code = typeof rawDetail === 'object' ? rawDetail?.code : undefined

      if (status === 409 || code === 'EMAIL_ALREADY_REGISTERED') {
        navigate(
          `/verify-email?email=${encodeURIComponent(email.trim().toLowerCase())}`,
        )
      } else if (status === 400 && typeof detail === 'string') {
        setErrors({ form: detail })
      } else if (status === 400 && Array.isArray(detail)) {
        const fieldMap: FormErrors = {}
        for (const item of detail as { loc: string[]; msg: string }[]) {
          const field = item.loc[item.loc.length - 1]
          if (field === 'email') fieldMap.email = item.msg
          else if (field === 'password') fieldMap.password = item.msg
          else if (field === 'full_name') fieldMap.full_name = item.msg
          else fieldMap.form = item.msg
        }
        setErrors(fieldMap)
      } else {
        setErrors({ form: 'Something went wrong. Please try again.' })
      }
    } finally {
      setLoading(false)
    }
  }

  if (isSuccess) {
    return <SuccessBanner email={successEmail} />
  }

  return (
    <div>
      <h2 className="mb-1 text-xl font-semibold text-slate-900">
        Create your account
      </h2>
      <p className="mb-6 text-sm text-slate-500">
        Get started with crypto payments, invoices, and developer API access.
      </p>

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <Input
          label="Full name"
          id="full_name"
          type="text"
          autoComplete="name"
          placeholder="Ada Lovelace"
          value={fullName}
          onChange={(e) => {
            setFullName(e.target.value)
            if (errors.full_name) {
              setErrors((prev) => ({ ...prev, full_name: undefined }))
            }
          }}
          error={errors.full_name}
          required
          disabled={loading}
        />
        <Input
          label="Email"
          id="email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value)
            if (errors.email) {
              setErrors((prev) => ({ ...prev, email: undefined }))
            }
          }}
          error={errors.email}
          required
          disabled={loading}
        />
        <Input
          label="Password"
          id="password"
          type="password"
          autoComplete="new-password"
          placeholder="Min 8 chars, uppercase, lowercase, digit"
          value={password}
          onChange={(e) => {
            setPassword(e.target.value)
            if (errors.password) {
              setErrors((prev) => ({ ...prev, password: undefined }))
            }
          }}
          error={errors.password}
          helperText={!errors.password ? 'At least 8 characters, one uppercase, one lowercase, one digit.' : undefined}
          required
          disabled={loading}
        />

        {errors.form && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {errors.form}
          </p>
        )}

        <Button type="submit" className="mt-2 w-full" size="lg" loading={loading}>
          Create account
        </Button>
      </form>
    </div>
  )
}
