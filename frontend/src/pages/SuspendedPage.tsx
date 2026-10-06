import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../lib/auth-store'
import { apiClient } from '../lib/api'
import { Button } from '../components/ui/Button'

const REASON_LABELS: Record<string, string> = {
  policy_violation: 'Policy Violation',
  fraud: 'Fraudulent Activity',
  spam: 'Spam or Abuse',
  identity_verification_failed: 'Identity Verification Failed',
  other: 'Other',
}

interface SuspensionApiInfo {
  suspension_reason: string | null
  suspension_message: string | null
  has_pending_appeal: boolean
}

export function SuspendedPage() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const suspensionInfo = useAuthStore((s) => s.suspensionInfo)
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const setSuspensionInfo = useAuthStore((s) => s.setSuspensionInfo)

  const [hasPendingAppeal, setHasPendingAppeal] = useState(false)
  const [loadingInfo, setLoadingInfo] = useState(true)

  // Fetch live suspension info (includes has_pending_appeal + latest reason/message)
  useEffect(() => {
    async function fetchInfo() {
      try {
        const { data } = await apiClient.get<SuspensionApiInfo>('/users/me/suspension-info')
        // Update stored suspension info in case it changed
        setSuspensionInfo({
          suspension_reason: data.suspension_reason,
          suspension_message: data.suspension_message,
        })
        setHasPendingAppeal(data.has_pending_appeal)
      } catch {
        // If the fetch fails (network error etc.) use whatever we have in store
      } finally {
        setLoadingInfo(false)
      }
    }
    fetchInfo()
  }, [setSuspensionInfo])

  function handleLogout() {
    clearAuth()
    navigate('/login', { replace: true })
  }

  const reason = suspensionInfo?.suspension_reason
  const message = suspensionInfo?.suspension_message
  const reasonLabel = reason ? (REASON_LABELS[reason] ?? reason) : null

  return (
    <div className="flex min-h-screen flex-col bg-slate-50">
      {/* Minimal header */}
      <header className="border-b border-slate-100 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <span className="text-xl font-semibold tracking-tight text-slate-900">Lenis</span>
          <button
            type="button"
            onClick={handleLogout}
            className="text-sm text-slate-500 underline underline-offset-2 hover:text-slate-700"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 py-16 sm:px-6 lg:px-8">
        <div className="w-full max-w-lg">
          {/* Icon */}
          <div className="mb-6 flex justify-center">
            <span
              className="flex h-16 w-16 items-center justify-center rounded-full bg-red-100"
              aria-hidden="true"
            >
              <svg
                className="h-8 w-8 text-red-600"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth="1.5"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
                />
              </svg>
            </span>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
            <h1 className="text-center text-2xl font-bold text-slate-900">
              Account Suspended
            </h1>
            <p className="mt-2 text-center text-sm text-slate-500">
              Your access to Lenis has been temporarily restricted.
            </p>

            {/* User details */}
            {user && (
              <div className="mt-6 rounded-md border border-slate-100 bg-slate-50 px-4 py-3">
                <p className="text-sm text-slate-600">
                  <span className="font-medium text-slate-800">{user.full_name || user.email}</span>
                </p>
                <p className="text-xs text-slate-400">{user.email}</p>
              </div>
            )}

            {/* Suspension reason */}
            {reasonLabel && (
              <div className="mt-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Reason
                </p>
                <p className="mt-1 inline-flex items-center rounded-full bg-red-50 px-3 py-1 text-sm font-medium text-red-700">
                  {reasonLabel}
                </p>
              </div>
            )}

            {/* Admin message */}
            {message && (
              <div className="mt-5">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Message from admin
                </p>
                <p className="mt-1 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 leading-relaxed">
                  {message}
                </p>
              </div>
            )}

            {/* No reason / message at all — generic note */}
            {!reasonLabel && !message && !loadingInfo && (
              <p className="mt-5 text-sm text-slate-500">
                No additional details were provided. Please contact support for more
                information.
              </p>
            )}

            {/* Appeal status */}
            <div className="mt-8 space-y-3">
              {loadingInfo ? (
                <div className="h-10 animate-pulse rounded-md bg-slate-100" />
              ) : hasPendingAppeal ? (
                <div
                  className="rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800"
                  role="status"
                >
                  <span className="font-medium">Appeal submitted.</span> Our team is
                  reviewing your case. We'll reach out once a decision is made.
                </div>
              ) : (
                <Button
                  variant="primary"
                  size="lg"
                  className="w-full"
                  onClick={() => navigate('/appeal')}
                >
                  Submit an Appeal
                </Button>
              )}

              <Button
                variant="secondary"
                size="lg"
                className="w-full"
                onClick={handleLogout}
              >
                Sign out
              </Button>
            </div>
          </div>

          <p className="mt-6 text-center text-xs text-slate-400">
            If you believe this is a mistake, submit an appeal and our team will
            review your case within 2–3 business days.
          </p>
        </div>
      </main>
    </div>
  )
}
