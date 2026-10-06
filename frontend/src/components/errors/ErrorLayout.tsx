import { ReactNode, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../lib/auth-store'
import { Button } from '../ui/Button'

export interface ErrorLayoutProps {
  statusCode?: string | number
  title: string
  message: string
  suggestion?: string
  badgeText?: string
  badgeVariant?: 'neutral' | 'warning' | 'danger' | 'info'
  icon?: ReactNode
  showHomeButton?: boolean
  showDashboardButton?: boolean
  showBackButton?: boolean
  showSupportButton?: boolean
  showReloadButton?: boolean
  onReload?: () => void
  errorDetails?: string | Error | null
  children?: ReactNode
}

export function ErrorLayout({
  statusCode = 'Error',
  title,
  message,
  suggestion,
  badgeText,
  badgeVariant = 'neutral',
  icon,
  showHomeButton = true,
  showDashboardButton = true,
  showBackButton = true,
  showSupportButton = true,
  showReloadButton = false,
  onReload,
  errorDetails,
  children,
}: ErrorLayoutProps) {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const accessToken = useAuthStore((s) => s.accessToken)
  const isAuthenticated = Boolean(accessToken || user)
  const dashboardUrl =
    user?.role === 'admin' || user?.account_type === 'admin'
      ? '/admin'
      : '/dashboard'

  const [copied, setCopied] = useState(false)
  const [showDetails, setShowDetails] = useState(false)

  const detailString =
    errorDetails instanceof Error
      ? `${errorDetails.name}: ${errorDetails.message}\n\nStack:\n${errorDetails.stack || 'No stack trace available'}`
      : typeof errorDetails === 'string'
        ? errorDetails
        : null

  const handleCopyDetails = () => {
    if (!detailString) return
    const payload = `Error: ${statusCode} - ${title}
Message: ${message}
URL: ${typeof window !== 'undefined' ? window.location.href : 'N/A'}
Timestamp: ${new Date().toISOString()}
Details:
${detailString}`

    navigator.clipboard.writeText(payload).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2500)
    })
  }

  const badgeColorMap = {
    neutral: 'bg-slate-100 text-slate-700 border-slate-200',
    warning: 'bg-amber-50 text-amber-800 border-amber-200',
    danger: 'bg-red-50 text-red-700 border-red-200',
    info: 'bg-indigo-50 text-indigo-700 border-indigo-200',
  }

  return (
    <div className="flex min-h-screen flex-col bg-slate-50/50 text-slate-900">
      {/* ── Top Bar ── */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          <Link
            to="/"
            className="flex items-center gap-2 text-xl font-bold tracking-tight text-slate-900 transition-opacity hover:opacity-80"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-sm font-black text-white">
              L
            </span>
            <span>Lenis</span>
          </Link>

          <div className="flex items-center gap-3">
            {isAuthenticated ? (
              <Link
                to={dashboardUrl}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                Dashboard
                <svg
                  className="h-3.5 w-3.5 text-slate-400"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path
                    fillRule="evenodd"
                    d="M3 10a.75.75 0 01.75-.75h10.638L10.23 5.29a.75.75 0 111.04-1.08l5.5 5.25a.75.75 0 010 1.08l-5.5 5.25a.75.75 0 11-1.04-1.08l4.158-3.96H3.75A.75.75 0 013 10z"
                    clipRule="evenodd"
                  />
                </svg>
              </Link>
            ) : (
              <Link
                to="/login"
                className="rounded-lg border border-slate-200 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50"
              >
                Sign In
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* ── Main Error Container ── */}
      <main className="flex flex-1 items-center justify-center px-4 py-12 sm:px-6 lg:px-8">
        <div className="w-full max-w-xl text-center">
          {/* Visual Icon Badge */}
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-2xl border border-slate-200 bg-white shadow-sm ring-8 ring-slate-100/60">
            {icon || (
              <svg
                className="h-10 w-10 text-slate-600"
                fill="none"
                viewBox="0 0 24 24"
                strokeWidth={1.5}
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z"
                />
              </svg>
            )}
          </div>

          {/* Status code pill */}
          <div className="mb-3">
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-3 py-0.5 text-xs font-semibold tracking-wide uppercase ${badgeColorMap[badgeVariant]}`}
            >
              {badgeText || `Error ${statusCode}`}
            </span>
          </div>

          {/* Title */}
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
            {title}
          </h1>

          {/* Message */}
          <p className="mt-3 text-base text-slate-600 sm:text-lg">{message}</p>

          {suggestion && (
            <p className="mt-2 text-sm text-slate-500">{suggestion}</p>
          )}

          {/* Action buttons */}
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            {showReloadButton && (
              <Button
                onClick={onReload || (() => window.location.reload())}
                variant="primary"
                size="md"
              >
                <svg
                  className="mr-1.5 h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                  />
                </svg>
                Try Again
              </Button>
            )}

            {isAuthenticated && showDashboardButton && (
              <Link to={dashboardUrl}>
                <Button variant={showReloadButton ? 'secondary' : 'primary'} size="md">
                  Go to Dashboard
                </Button>
              </Link>
            )}

            {showHomeButton && (!isAuthenticated || !showDashboardButton) && (
              <Link to="/">
                <Button variant={showReloadButton ? 'secondary' : 'primary'} size="md">
                  Return Home
                </Button>
              </Link>
            )}

            {showBackButton && (
              <Button
                variant="secondary"
                size="md"
                onClick={() => {
                  if (typeof window !== 'undefined' && window.history.length > 1) {
                    navigate(-1)
                  } else {
                    navigate('/')
                  }
                }}
              >
                Go Back
              </Button>
            )}

            {showSupportButton && (
              <Link to="/contact">
                <Button variant="secondary" size="md">
                  Contact Support
                </Button>
              </Link>
            )}
          </div>

          {/* Optional children slots */}
          {children && <div className="mt-8">{children}</div>}

          {/* Technical Diagnostics Drawer */}
          {detailString && (
            <div className="mt-8 text-left">
              <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setShowDetails(!showDetails)}
                    className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 hover:text-slate-900"
                  >
                    <svg
                      className={`h-4 w-4 transform transition-transform ${showDetails ? 'rotate-90' : ''}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 5l7 7-7 7"
                      />
                    </svg>
                    <span>{showDetails ? 'Hide technical details' : 'Show technical details'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleCopyDetails}
                    className="inline-flex items-center gap-1 rounded bg-slate-100 px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-200 transition"
                  >
                    {copied ? (
                      <>
                        <svg
                          className="h-3.5 w-3.5 text-green-600"
                          viewBox="0 0 20 20"
                          fill="currentColor"
                        >
                          <path
                            fillRule="evenodd"
                            d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                            clipRule="evenodd"
                          />
                        </svg>
                        <span>Copied!</span>
                      </>
                    ) : (
                      <>
                        <svg
                          className="h-3.5 w-3.5 text-slate-500"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                          />
                        </svg>
                        <span>Copy Diagnostics</span>
                      </>
                    )}
                  </button>
                </div>

                {showDetails && (
                  <div className="mt-3 overflow-hidden rounded-lg bg-slate-900 p-3">
                    <pre className="max-h-56 overflow-auto font-mono text-xs text-slate-200 whitespace-pre-wrap select-all">
                      {detailString}
                    </pre>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      {/* ── Footer ── */}
      <footer className="border-t border-slate-200 bg-white py-6 text-center text-xs text-slate-500">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 px-4 sm:flex-row sm:px-6 lg:px-8">
          <p>&copy; {new Date().getFullYear()} Lenis Non-Custodial Financial Infrastructure.</p>
          <div className="flex gap-4">
            <Link to="/docs" className="hover:text-slate-900 transition-colors">
              Documentation
            </Link>
            <Link to="/pricing" className="hover:text-slate-900 transition-colors">
              Pricing
            </Link>
            <Link to="/contact" className="hover:text-slate-900 transition-colors">
              Contact
            </Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
