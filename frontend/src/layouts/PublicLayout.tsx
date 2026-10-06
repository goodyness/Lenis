import { useEffect } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { apiClient } from '../lib/api'
import { useAuthStore } from '../lib/auth-store'

export function PublicLayout() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const accessToken = useAuthStore((s) => s.accessToken)
  const clearAuth = useAuthStore((s) => s.clearAuth)
  const setUser = useAuthStore((s) => s.setUser)

  const isAuthenticated = Boolean(accessToken || user)
  const dashboardUrl = user?.role === 'admin' || user?.account_type === 'admin' ? '/admin' : '/dashboard'

  useEffect(() => {
    if (accessToken && !user) {
      apiClient
        .get('/users/me')
        .then((res) => {
          if (res.data) {
            setUser({
              id: res.data.user_id,
              email: res.data.email,
              full_name: res.data.full_name,
              role: res.data.account_type,
              account_type: res.data.account_type,
              status: res.data.status,
              subscription_tier: res.data.subscription_tier,
            })
          }
        })
        .catch(() => {
          // If token is invalid, interceptor handles refresh or clears auth
        })
    }
  }, [accessToken, user, setUser])

  function handleLogout() {
    clearAuth()
    navigate('/login')
  }

  return (
    <div className="flex min-h-screen flex-col bg-white">
      {/* ── Top navigation ── */}
      <nav
        className="fixed top-0 z-50 w-full border-b border-slate-100 bg-white/95 backdrop-blur-sm"
        aria-label="Main navigation"
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-4 sm:px-6 lg:px-8">
          {/* Brand */}
          <Link
            to="/"
            className="text-xl font-semibold tracking-tight text-slate-900"
            aria-label="Lenis home"
          >
            Lenis
          </Link>

          {/* Centre nav links */}
          <div className="hidden items-center gap-6 sm:flex">
            <NavLink
              to="/"
              end
              className={({ isActive }) =>
                isActive
                  ? 'text-sm font-medium text-slate-900'
                  : 'text-sm font-medium text-slate-600 transition-colors hover:text-slate-900'
              }
            >
              Home
            </NavLink>
            <NavLink
              to="/pricing"
              className={({ isActive }) =>
                isActive
                  ? 'text-sm font-medium text-slate-900'
                  : 'text-sm font-medium text-slate-600 transition-colors hover:text-slate-900'
              }
            >
              Pricing
            </NavLink>
            <NavLink
              to="/docs"
              className={({ isActive }) =>
                isActive
                  ? 'text-sm font-medium text-slate-900'
                  : 'text-sm font-medium text-slate-600 transition-colors hover:text-slate-900'
              }
            >
              Docs
            </NavLink>
          </div>

          {/* Auth buttons */}
          <div className="flex items-center gap-3">
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
                  to="/login"
                  className="text-sm font-medium text-slate-600 transition-colors hover:text-slate-900"
                >
                  Sign In
                </Link>
                <Link
                  to="/sign-up"
                  className="inline-flex items-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2"
                >
                  Get Started
                </Link>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* ── Page content ── */}
      <main className="flex-1 pt-16">
        <Outlet />
      </main>

      {/* ── Footer ── */}
      <footer
        className="border-t border-slate-200 bg-white px-4 py-12 sm:px-6 lg:px-8"
        aria-label="Site footer"
      >
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col gap-8 sm:flex-row sm:justify-between">
            {/* Brand blurb */}
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

            {/* Link groups */}
            <div className="flex flex-wrap gap-12">
              <div>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Product
                </h3>
                <nav aria-label="Product links">
                  <ul className="space-y-2">
                    <li>
                      <Link
                        to="/"
                        className="text-sm text-slate-500 transition-colors hover:text-slate-900"
                      >
                        Home
                      </Link>
                    </li>
                    <li>
                      <Link
                        to="/pricing"
                        className="text-sm text-slate-500 transition-colors hover:text-slate-900"
                      >
                        Pricing
                      </Link>
                    </li>
                    <li>
                      <Link
                        to="/docs"
                        className="text-sm text-slate-500 transition-colors hover:text-slate-900"
                      >
                        Docs
                      </Link>
                    </li>
                  </ul>
                </nav>
              </div>

              <div>
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Legal
                </h3>
                <nav aria-label="Legal links">
                  <ul className="space-y-2">
                    <li>
                      <Link
                        to="/terms"
                        className="text-sm text-slate-500 transition-colors hover:text-slate-900"
                      >
                        Terms
                      </Link>
                    </li>
                    <li>
                      <Link
                        to="/privacy"
                        className="text-sm text-slate-500 transition-colors hover:text-slate-900"
                      >
                        Privacy
                      </Link>
                    </li>
                    <li>
                      <Link
                        to="/contact"
                        className="text-sm text-slate-500 transition-colors hover:text-slate-900"
                      >
                        Contact
                      </Link>
                    </li>
                  </ul>
                </nav>
              </div>
            </div>
          </div>

          <div className="mt-8 border-t border-slate-100 pt-8">
            <p className="text-sm text-slate-400">
              &copy; {new Date().getFullYear()} Lenis. All rights reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
