import { ReactNode, useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '../../lib/auth-store'
import { ForbiddenPage } from '../../pages/errors/ForbiddenPage'

interface ProtectedRouteProps {
  children: ReactNode
  /**
   * When provided, the signed-in user's role must match this value or
   * be "superadmin" (which always satisfies any role requirement).
   * Accepted values: "admin" | "superadmin" | "merchant"
   */
  requiredRole?: 'admin' | 'superadmin' | 'merchant'
}

const ADMIN_ROLES = new Set(['admin', 'superadmin'])

/**
 * Returns true once Zustand's persist middleware has finished loading auth
 * state from localStorage. Guards against false redirects on page refresh
 * where the token hasn't been rehydrated yet on the first render tick.
 */
function useAuthHydrated(): boolean {
  const [hydrated, setHydrated] = useState(
    () => useAuthStore.persist.hasHydrated(),
  )

  useEffect(() => {
    // Already hydrated by the time the effect runs (sync localStorage).
    if (useAuthStore.persist.hasHydrated()) {
      setHydrated(true)
      return
    }
    // Subscribe to finish-hydration event for async storage engines.
    const unsub = useAuthStore.persist.onFinishHydration(() => setHydrated(true))
    return unsub
  }, [])

  return hydrated
}

export function ProtectedRoute({ children, requiredRole }: ProtectedRouteProps) {
  const hydrated = useAuthHydrated()
  const accessToken = useAuthStore((state) => state.accessToken)
  const user = useAuthStore((state) => state.user)
  const location = useLocation()

  // Wait for persisted auth to load from localStorage before making any
  // routing decisions. Returning null renders nothing for one tick — no flash.
  if (!hydrated) {
    return null
  }

  if (!accessToken) {
    return <Navigate to="/login" replace state={{ from: location }} />
  }

  // Redirect suspended users to the suspension page, regardless of their
  // destination — except when they're already heading there or to /appeal.
  if (
    user?.status === 'suspended' &&
    !location.pathname.startsWith('/suspended') &&
    !location.pathname.startsWith('/appeal')
  ) {
    return <Navigate to="/suspended" replace />
  }

  if (requiredRole === 'merchant') {
    const isMerchant = user?.account_type === 'merchant' || user?.role === 'merchant'

    if (!isMerchant) {
      return <ForbiddenPage requiredRole="merchant" />
    }

    return <>{children}</>
  }

  if (requiredRole) {
    const role = user?.role ?? ''
    const hasRole =
      role === 'superadmin' || (requiredRole === 'admin' && ADMIN_ROLES.has(role))

    if (!hasRole) {
      return <ForbiddenPage requiredRole={requiredRole} />
    }
  }

  return <>{children}</>
}
