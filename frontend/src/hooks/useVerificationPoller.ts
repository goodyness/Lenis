import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { apiClient } from '../lib/api'

const POLL_INTERVAL_MS = 5_000

/**
 * Polls GET /auth/verify-status?email=... every 5 seconds.
 * Navigates to `redirectTo` (default "/login") as soon as the backend
 * reports `verified: true`.
 *
 * Stops automatically on unmount or once the redirect fires.
 */
export function useVerificationPoller(
  email: string,
  redirectTo = '/login',
): void {
  const navigate = useNavigate()
  // Stable ref so the interval closure never goes stale
  const navigateRef = useRef(navigate)
  useEffect(() => {
    navigateRef.current = navigate
  })

  useEffect(() => {
    if (!email) return

    let cancelled = false

    async function check() {
      try {
        const { data } = await apiClient.get<{ verified: boolean }>(
          '/auth/verify-status',
          { params: { email } },
        )
        if (!cancelled && data.verified) {
          cancelled = true
          clearInterval(id)
          navigateRef.current(redirectTo, { replace: true })
        }
      } catch {
        // Network hiccup — keep polling silently
      }
    }

    // Check immediately, then on each tick
    check()
    const id = setInterval(check, POLL_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [email, redirectTo])
}
