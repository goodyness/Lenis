import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../lib/auth-store'

export function HeroSection() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const accessToken = useAuthStore((s) => s.accessToken)
  const clearAuth = useAuthStore((s) => s.clearAuth)

  const isAuthenticated = Boolean(accessToken || user)
  const dashboardUrl = user?.role === 'admin' || user?.account_type === 'admin' ? '/admin' : '/dashboard'

  function handleLogout() {
    clearAuth()
    navigate('/login')
  }

  return (
    <section className="flex min-h-screen items-center justify-center bg-white px-4 pt-16 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl text-center">
        <div className="mb-6 inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-4 py-1.5 text-sm text-slate-600">
          Non-custodial Web3 financial infrastructure
        </div>
        <h1 className="mb-6 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
          Build on crypto payments{' '}
          <span className="text-slate-500">without giving up control</span>
        </h1>
        <p className="mx-auto mb-10 max-w-2xl text-lg leading-relaxed text-slate-600 sm:text-xl">
          Lenis provides a non-custodial crypto payment infrastructure for
          merchants and developers. Accept payments, issue API keys, and
          integrate blockchain finance — with keys that stay in your hands.
        </p>
        <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
          {isAuthenticated ? (
            <>
              <Link
                to={dashboardUrl}
                className="inline-flex w-full items-center justify-center rounded-md bg-slate-900 px-8 py-3.5 text-base font-medium text-white transition-colors hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2 sm:w-auto"
              >
                Go to Dashboard →
              </Link>
              <button
                type="button"
                onClick={handleLogout}
                className="inline-flex w-full items-center justify-center rounded-md border border-slate-300 bg-white px-8 py-3.5 text-base font-medium text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 sm:w-auto"
              >
                Log out
              </button>
            </>
          ) : (
            <>
              <Link
                to="/sign-up"
                className="inline-flex w-full items-center justify-center rounded-md bg-slate-900 px-8 py-3.5 text-base font-medium text-white transition-colors hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2 sm:w-auto"
              >
                Get started free
              </Link>
              <Link
                to="/login"
                className="inline-flex w-full items-center justify-center rounded-md border border-slate-300 bg-white px-8 py-3.5 text-base font-medium text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 sm:w-auto"
              >
                Log in
              </Link>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
