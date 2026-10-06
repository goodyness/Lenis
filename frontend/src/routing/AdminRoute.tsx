import { ReactNode, useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../lib/auth-store'

export interface AdminRouteProps {
  requiredRole: 'admin' | 'superadmin'
  children: ReactNode
}

/**
 * Mirrors the hydration guard in ProtectedRoute — waits for Zustand persist
 * middleware to rehydrate from localStorage before making role decisions.
 */
function useAuthHydrated(): boolean {
  const [hydrated, setHydrated] = useState(
    () => useAuthStore.persist.hasHydrated(),
  )

  useEffect(() => {
    if (useAuthStore.persist.hasHydrated()) {
      setHydrated(true)
      return
    }
    const unsub = useAuthStore.persist.onFinishHydration(() => setHydrated(true))
    return unsub
  }, [])

  return hydrated
}

/**
 * Route guard for admin-only pages.
 *
 * - While auth state is loading (hydrating from localStorage): renders a
 *   centred spinner — prevents premature redirect (Req 7.4).
 * - Unauthenticated users: redirected to /login?next=<current path> (Req 7.2).
 * - Authenticated users without the required role: redirected to /dashboard (Req 7.1).
 * - Role check reads from the in-memory Zustand store — no extra API call (Req 7.5).
 */
export function AdminRoute({ requiredRole, children }: AdminRouteProps) {
  const hydrated = useAuthHydrated()
  const user = useAuthStore((state) => state.user)
  const accessToken = useAuthStore((state) => state.accessToken)
  const location = useLocation()

  // Prevent premature redirect while auth state is being rehydrated (Req 7.4).
  if (!hydrated) {
    return (
      <div
        className="flex min-h-screen items-center justify-center bg-slate-50"
        role="status"
        aria-label="Loading"
      >
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-indigo-600 border-t-transparent" />
      </div>
    )
  }

  // Unauthenticated: redirect to login with return path (Req 7.2).
  if (!accessToken || !user) {
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />
  }

  // Role check — reads from Zustand store only, no API call (Req 7.5).
  const role = user.role ?? ''
  const hasRole =
    requiredRole === 'admin'
      ? role === 'admin' || role === 'superadmin'
      : role === 'superadmin'

  if (!hasRole) {
    return <Navigate to="/dashboard" replace />
  }

  return <>{children}</>
}
