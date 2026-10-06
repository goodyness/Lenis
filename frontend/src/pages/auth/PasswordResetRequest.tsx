import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { AxiosError } from 'axios'
import { apiClient } from '../../lib/api'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'

interface FormErrors {
  email?: string
  twoFactorCode?: string
  newPassword?: string
  confirmPassword?: string
  form?: string
}

type TabType = 'email' | '2fa'
type FormState = 'idle' | 'loading' | 'done'

function validateEmail(value: string): string | undefined {
  const pattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  if (!pattern.test(value.trim())) return 'Enter a valid email address.'
  return undefined
}

export function PasswordResetRequest() {
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState<TabType>('email')

  // Email Tab State
  const [email, setEmail] = useState('')
  const [emailErrors, setEmailErrors] = useState<FormErrors>({})
  const [emailFormState, setEmailFormState] = useState<FormState>('idle')

  // 2FA Tab State
  const [twoFactorEmail, setTwoFactorEmail] = useState('')
  const [twoFactorCode, setTwoFactorCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [twoFactorErrors, setTwoFactorErrors] = useState<FormErrors>({})
  const [twoFactorFormState, setTwoFactorFormState] = useState<FormState>('idle')
  const [twoFactorSuccess, setTwoFactorSuccess] = useState(false)

  // Handle Email Link Submit
  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault()

    const emailError = validateEmail(email)
    if (emailError) {
      setEmailErrors({ email: emailError })
      return
    }

    setEmailErrors({})
    setEmailFormState('loading')

    try {
      await apiClient.post('/auth/password-reset/request', {
        email: email.trim().toLowerCase(),
      })
    } catch {
      // Intentionally swallow all errors per requirement to avoid enumeration
    } finally {
      setEmailFormState('done')
    }
  }

  // Handle 2FA Reset Submit
  async function handle2FASubmit(e: React.FormEvent) {
    e.preventDefault()
    const errs: FormErrors = {}

    const emailErr = validateEmail(twoFactorEmail)
    if (emailErr) errs.email = emailErr

    if (!twoFactorCode.trim() || twoFactorCode.trim().length !== 6) {
      errs.twoFactorCode = 'Enter the 6-digit code from your authenticator app.'
    }

    if (newPassword.length < 8) {
      errs.newPassword = 'Password must be at least 8 characters long.'
    }

    if (newPassword !== confirmPassword) {
      errs.confirmPassword = 'Passwords do not match.'
    }

    if (Object.keys(errs).length > 0) {
      setTwoFactorErrors(errs)
      return
    }

    setTwoFactorErrors({})
    setTwoFactorFormState('loading')

    try {
      await apiClient.post('/auth/password-reset/2fa', {
        email: twoFactorEmail.trim().toLowerCase(),
        two_factor_code: twoFactorCode.trim(),
        new_password: newPassword,
      })
      setTwoFactorSuccess(true)
      setTwoFactorFormState('done')
      setTimeout(() => {
        navigate('/login')
      }, 3000)
    } catch (err: unknown) {
      setTwoFactorFormState('idle')
      const axErr = err as AxiosError<{ detail?: { detail?: string } | string }>
      const msg = typeof axErr.response?.data?.detail === 'object'
        ? axErr.response?.data?.detail?.detail
        : axErr.response?.data?.detail
      setTwoFactorErrors({
        form: msg || 'Failed to reset password. Please verify your 2FA code and email.',
      })
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

      <main className="flex items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
        <div className="w-full max-w-md">
          <div className="mb-6 text-center">
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">
              Reset your password
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Recover access to your account using an email link or 2FA code.
            </p>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8 shadow-sm">
            {/* Tabs */}
            <div className="mb-6 flex rounded-lg bg-slate-100 p-1 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setActiveTab('email')}
                className={`flex-1 rounded-md py-2 text-center transition-all ${
                  activeTab === 'email'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                ✉️ Email Link
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('2fa')}
                className={`flex-1 rounded-md py-2 text-center transition-all ${
                  activeTab === '2fa'
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                🔐 2FA Authenticator
              </button>
            </div>

            {/* TAB 1: Email Link */}
            {activeTab === 'email' && (
              emailFormState === 'done' ? (
                <div
                  className="rounded-md border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800"
                  role="alert"
                >
                  <p className="font-medium">Check your inbox</p>
                  <p className="mt-0.5 text-green-700 text-xs">
                    If that email address is registered, you'll receive a password reset link
                    shortly. Check your inbox.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleEmailSubmit} noValidate className="flex flex-col gap-4">
                  <Input
                    label="Email address"
                    id="reset-request-email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value)
                      if (emailErrors.email) setEmailErrors({})
                    }}
                    error={emailErrors.email}
                    required
                    disabled={emailFormState === 'loading'}
                  />

                  <Button
                    type="submit"
                    className="mt-2 w-full"
                    size="lg"
                    loading={emailFormState === 'loading'}
                  >
                    Send reset link
                  </Button>
                </form>
              )
            )}

            {/* TAB 2: 2FA Authenticator Reset */}
            {activeTab === '2fa' && (
              twoFactorSuccess ? (
                <div
                  className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"
                  role="alert"
                >
                  <p className="font-semibold">Password Reset Complete!</p>
                  <p className="mt-1 text-emerald-700 text-xs">
                    Your password has been successfully reset. Redirecting to login...
                  </p>
                  <Link
                    to="/login"
                    className="mt-3 inline-block font-semibold text-xs text-emerald-900 underline"
                  >
                    Go to Login now →
                  </Link>
                </div>
              ) : (
                <form onSubmit={handle2FASubmit} noValidate className="flex flex-col gap-4">
                  {twoFactorErrors.form && (
                    <div className="rounded-md bg-red-50 p-3 text-xs font-semibold text-red-700">
                      {twoFactorErrors.form}
                    </div>
                  )}

                  <Input
                    label="Account Email"
                    id="2fa-email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={twoFactorEmail}
                    onChange={(e) => {
                      setTwoFactorEmail(e.target.value)
                      if (twoFactorErrors.email) setTwoFactorErrors((p) => ({ ...p, email: undefined }))
                    }}
                    error={twoFactorErrors.email}
                    required
                    disabled={twoFactorFormState === 'loading'}
                  />

                  <Input
                    label="6-Digit 2FA Authenticator Code"
                    id="2fa-code-reset"
                    type="text"
                    placeholder="000000"
                    maxLength={6}
                    value={twoFactorCode}
                    onChange={(e) => {
                      setTwoFactorCode(e.target.value.replace(/\D/g, ''))
                      if (twoFactorErrors.twoFactorCode) setTwoFactorErrors((p) => ({ ...p, twoFactorCode: undefined }))
                    }}
                    error={twoFactorErrors.twoFactorCode}
                    required
                    className="font-mono text-center text-lg tracking-widest"
                    disabled={twoFactorFormState === 'loading'}
                  />

                  <Input
                    label="New Password"
                    id="2fa-new-pw"
                    type="password"
                    autoComplete="new-password"
                    placeholder="Minimum 8 characters"
                    value={newPassword}
                    onChange={(e) => {
                      setNewPassword(e.target.value)
                      if (twoFactorErrors.newPassword) setTwoFactorErrors((p) => ({ ...p, newPassword: undefined }))
                    }}
                    error={twoFactorErrors.newPassword}
                    required
                    disabled={twoFactorFormState === 'loading'}
                  />

                  <Input
                    label="Confirm New Password"
                    id="2fa-confirm-pw"
                    type="password"
                    autoComplete="new-password"
                    placeholder="Confirm new password"
                    value={confirmPassword}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value)
                      if (twoFactorErrors.confirmPassword) setTwoFactorErrors((p) => ({ ...p, confirmPassword: undefined }))
                    }}
                    error={twoFactorErrors.confirmPassword}
                    required
                    disabled={twoFactorFormState === 'loading'}
                  />

                  <Button
                    type="submit"
                    className="mt-2 w-full"
                    size="lg"
                    loading={twoFactorFormState === 'loading'}
                  >
                    Reset Password with 2FA
                  </Button>
                </form>
              )
            )}

            <p className="mt-6 text-center text-sm text-slate-500">
              <Link
                to="/login"
                className="font-medium text-slate-700 underline underline-offset-2 hover:text-slate-900"
              >
                Back to login
              </Link>
            </p>
          </div>
        </div>
      </main>
    </div>
  )
}
