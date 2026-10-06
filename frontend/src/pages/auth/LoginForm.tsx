import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { AxiosError } from 'axios'
import { apiClient } from '../../lib/api'
import { useAuthStore } from '../../lib/auth-store'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'

interface LoginPayload {
  email: string
  password: string
  two_factor_code?: string
}

interface LoginResponse {
  access_token: string | null
  refresh_token: string | null
  token_type: string
  expires_in: number
  requires_2fa?: boolean
}

interface UserProfileResponse {
  user_id: string
  email: string
  full_name: string
  account_type: string
  status: string
  email_verified: boolean
  two_factor_enabled?: boolean
}

interface ApiErrorDetail {
  detail: string
  code?: string
  suspension_reason?: string
  suspension_message?: string
}

interface ApiErrorResponse {
  detail: ApiErrorDetail | string
}

type FormState = 'idle' | 'loading'

interface FormErrors {
  email?: string
  password?: string
  twoFactorCode?: string
  form?: string
}

function validateEmail(value: string): string | undefined {
  const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!pattern.test(value)) return 'Enter a valid email address.'
  return undefined
}

function validatePassword(value: string): string | undefined {
  if (value.length === 0) return 'Password is required.'
  return undefined
}

const ADMIN_ROLES = new Set(['admin', 'superadmin'])

export function LoginForm() {
  const navigate = useNavigate()
  const setAccessToken = useAuthStore((state) => state.setAccessToken)
  const setRefreshToken = useAuthStore((state) => state.setRefreshToken)
  const setUser = useAuthStore((state) => state.setUser)
  const setSuspensionInfo = useAuthStore((state) => state.setSuspensionInfo)

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [twoFactorCode, setTwoFactorCode] = useState('')
  const [requires2FA, setRequires2FA] = useState(false)
  const [errors, setErrors] = useState<FormErrors>({})
  const [formState, setFormState] = useState<FormState>('idle')

  const isLoading = formState === 'loading'

  function validate(): FormErrors {
    return {
      email: validateEmail(email),
      password: validatePassword(password),
    }
  }

  async function handleLogin(twoFactorSubmission?: string) {
    setErrors({})
    setFormState('loading')

    try {
      const payload: LoginPayload = {
        email: email.trim().toLowerCase(),
        password,
        two_factor_code: twoFactorSubmission || (requires2FA ? twoFactorCode.trim() : undefined),
      }
      const { data } = await apiClient.post<LoginResponse>('/auth/login', payload)

      // If 2FA is required and not yet supplied
      if (data.requires_2fa) {
        setRequires2FA(true)
        setFormState('idle')
        return
      }

      if (!data.access_token || !data.refresh_token) {
        setRequires2FA(true)
        setFormState('idle')
        return
      }

      setAccessToken(data.access_token)
      setRefreshToken(data.refresh_token)

      // Fetch profile to determine role and redirect destination
      const { data: profile } = await apiClient.get<UserProfileResponse & { subscription_tier?: string }>('/users/me')
      setUser({
        id: profile.user_id,
        email: profile.email,
        full_name: profile.full_name,
        role: profile.account_type,
        account_type: profile.account_type,
        status: profile.status,
        subscription_tier: profile.subscription_tier || 'free',
      })

      if (ADMIN_ROLES.has(profile.account_type)) {
        navigate('/admin', { replace: true })
      } else {
        navigate('/dashboard', { replace: true })
      }
    } catch (err) {
      const axiosErr = err as AxiosError<ApiErrorResponse>
      const status = axiosErr.response?.status
      const detail = axiosErr.response?.data?.detail
      const code = typeof detail === 'object' ? detail?.code : undefined
      const message = typeof detail === 'object' ? detail?.detail : detail

      if (status === 403 && code === 'ACCOUNT_SUSPENDED') {
        const suspDetail = typeof detail === 'object' ? detail : null
        setSuspensionInfo({
          suspension_reason: suspDetail?.suspension_reason ?? null,
          suspension_message: suspDetail?.suspension_message ?? null,
        })
        navigate('/suspended', { replace: true })
      } else if (status === 403 && code === 'EMAIL_VERIFICATION_REQUIRED') {
        navigate(`/verify-email?email=${encodeURIComponent(email.trim().toLowerCase())}`)
      } else if (status === 401 && code === 'INVALID_2FA_CODE') {
        setFormState('idle')
        setErrors({
          twoFactorCode: 'Invalid 2FA code. Please check your authenticator app and try again.',
        })
      } else if (status === 429) {
        setFormState('idle')
        setErrors({
          form: 'Too many login attempts. Please wait a few minutes and try again.',
        })
      } else if (status === 401) {
        setFormState('idle')
        setErrors({ form: message || 'Invalid email or password.' })
      } else {
        setFormState('idle')
        setErrors({ form: message || 'Something went wrong. Please try again.' })
      }
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (requires2FA) {
      if (!twoFactorCode.trim() || twoFactorCode.trim().length !== 6) {
        setErrors({ twoFactorCode: 'Please enter the 6-digit code.' })
        return
      }
      handleLogin(twoFactorCode.trim())
      return
    }

    const fieldErrors = validate()
    const hasErrors = Object.values(fieldErrors).some(Boolean)
    if (hasErrors) {
      setErrors(fieldErrors)
      return
    }

    handleLogin()
  }

  // ─── 2FA Verification View ──────────────────────────────────────────────────
  if (requires2FA) {
    return (
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-4 text-center">
          <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-indigo-600 text-white shadow-sm">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
            </svg>
          </div>
          <h2 className="text-base font-bold text-slate-900">Two-Factor Authentication</h2>
          <p className="mt-1 text-xs text-slate-600">
            Enter the 6-digit code from your authenticator app for <span className="font-semibold text-slate-800">{email}</span>.
          </p>
        </div>

        <Input
          label="6-Digit Authenticator Code"
          id="2fa-code"
          type="text"
          placeholder="000000"
          maxLength={6}
          value={twoFactorCode}
          onChange={(e) => {
            setTwoFactorCode(e.target.value.replace(/\D/g, ''))
            if (errors.twoFactorCode) setErrors((prev) => ({ ...prev, twoFactorCode: undefined }))
          }}
          error={errors.twoFactorCode}
          required
          autoFocus
          className="font-mono text-center text-xl tracking-widest"
          disabled={isLoading}
        />

        {errors.form && (
          <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            {errors.form}
          </p>
        )}

        <Button
          type="submit"
          className="mt-2 w-full"
          size="lg"
          loading={isLoading}
          disabled={twoFactorCode.length !== 6}
        >
          Verify & Sign In
        </Button>

        <div className="flex flex-col items-center gap-2 pt-2 text-xs text-slate-500">
          <button
            type="button"
            onClick={() => {
              setRequires2FA(false)
              setTwoFactorCode('')
              setErrors({})
            }}
            className="font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900"
          >
            ← Back to password login
          </button>
          <Link
            to="/forgot-password"
            className="font-medium text-indigo-600 underline underline-offset-2 hover:text-indigo-800"
          >
            Lost access to authenticator? Reset via email
          </Link>
        </div>
      </form>
    )
  }

  // ─── Standard Email & Password Login View ────────────────────────────────────
  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <Input
        label="Email"
        id="login-email"
        type="email"
        autoComplete="email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => {
          setEmail(e.target.value)
          if (errors.email) setErrors((prev) => ({ ...prev, email: undefined }))
        }}
        error={errors.email}
        required
        disabled={isLoading}
      />

      <Input
        label="Password"
        id="login-password"
        type="password"
        autoComplete="current-password"
        placeholder="Your password"
        value={password}
        onChange={(e) => {
          setPassword(e.target.value)
          if (errors.password) setErrors((prev) => ({ ...prev, password: undefined }))
        }}
        error={errors.password}
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
        Log in
      </Button>

      <p className="text-center text-sm text-slate-500">
        <Link
          to="/forgot-password"
          className="font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900"
        >
          Forgot your password?
        </Link>
      </p>
    </form>
  )
}