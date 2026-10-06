import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../lib/auth-store'

export function LandingNav() {
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
    <nav
      className="fixed top-0 z-50 w-full border-b border-slate-100 bg-white/95 backdrop-blur-sm"
      aria-label="Main navigation"
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
        <Link
          to="/"
          className="text-xl font-semibold tracking-tight text-slate-900"
          aria-label="Lenis home"
        >
          Lenis
        </Link>
        <div className="flex items-center gap-4 sm:gap-6">
          {isAuthenticated ? (
            <>
              <button
                type="button"
                onClick={handleLogout}
                className="text-sm font-medium text-slate-600 transition-colors hover:text-red-600"
              >
                Log out
              </button>
              <Link
                to={dashboardUrl}
                className="inline-flex items-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2"
              >
                Dashboard →
              </Link>
            </>
          ) : (
            <>
              <Link
                to="/sign-up"
                className="text-sm font-medium text-slate-600 transition-colors hover:text-slate-900"
              >
                Sign up
              </Link>
              <Link
                to="/login"
                className="inline-flex items-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2"
              >
                Log in
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  )
}
