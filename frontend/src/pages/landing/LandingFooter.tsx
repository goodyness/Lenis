import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../lib/auth-store'

export function LandingFooter() {
  const currentYear = new Date().getFullYear()
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const accessToken = useAuthStore((s) => s.accessToken)
  const clearAuth = useAuthStore((s) => s.clearAuth)

  const isAuthenticated = Boolean(user && accessToken)
  const dashboardUrl = user?.role === 'admin' || user?.account_type === 'admin' ? '/admin' : '/dashboard'

  function handleLogout() {
    clearAuth()
    navigate('/login')
  }

  return (
    <footer className="border-t border-slate-200 bg-white px-4 py-12 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="flex flex-col items-start justify-between gap-8 sm:flex-row sm:items-center">
          <div>
            <Link
              to="/"
              className="text-lg font-semibold text-slate-900"
              aria-label="Lenis home"
            >
              Lenis
            </Link>
            <p className="mt-1 text-sm text-slate-500">
              Non-custodial Web3 financial infrastructure
            </p>
          </div>

          <nav aria-label="Footer navigation">
            <ul className="flex flex-wrap gap-6 items-center">
              {isAuthenticated ? (
                <>
                  <li>
                    <Link
                      to={dashboardUrl}
                      className="text-sm font-medium text-slate-700 transition-colors hover:text-slate-900"
                    >
                      Dashboard
                    </Link>
                  </li>
                  <li>
                    <button
                      type="button"
                      onClick={handleLogout}
                      className="text-sm text-slate-500 transition-colors hover:text-red-600"
                    >
                      Log out
                    </button>
                  </li>
                </>
              ) : (
                <>
                  <li>
                    <Link
                      to="/sign-up"
                      className="text-sm text-slate-500 transition-colors hover:text-slate-900"
                    >
                      Sign up
                    </Link>
                  </li>
                  <li>
                    <Link
                      to="/login"
                      className="text-sm text-slate-500 transition-colors hover:text-slate-900"
                    >
                      Log in
                    </Link>
                  </li>
                </>
              )}
            </ul>
          </nav>
        </div>

        <div className="mt-8 border-t border-slate-100 pt-8">
          <p className="text-sm text-slate-400">
            &copy; {currentYear} Lenis. All rights reserved.
          </p>
        </div>
      </div>
    </footer>
  )
}
