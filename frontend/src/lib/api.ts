import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios'
import { useAuthStore } from './auth-store'

const API_BASE_URL = import.meta.env.VITE_API_URL || ''

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
  // Do NOT set a default Content-Type here.
  // Axios sets it per-request: 'application/json' for plain objects,
  // 'multipart/form-data; boundary=...' for FormData (e.g. onboarding steps 2 & 3).
  // A hardcoded default would override the multipart boundary and break file uploads.
})

// ─── Token refresh state ──────────────────────────────────────────────────────

// Prevent concurrent refresh attempts when multiple 401s fire simultaneously.
let isRefreshing = false

// Queued callbacks: resolve with new token on success, reject with error on failure.
type PendingCallback = {
  resolve: (token: string) => void
  reject: (err: unknown) => void
}
let pendingRequests: PendingCallback[] = []

function resolvePendingRequests(token: string) {
  pendingRequests.forEach(({ resolve }) => resolve(token))
  pendingRequests = []
}

function rejectPendingRequests(err: unknown) {
  pendingRequests.forEach(({ reject }) => reject(err))
  pendingRequests = []
}

// ─── Request interceptor ──────────────────────────────────────────────────────
// Attach Bearer token from store to every outgoing request.

apiClient.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    const { accessToken } = useAuthStore.getState()
    if (accessToken && config.headers) {
      config.headers['Authorization'] = `Bearer ${accessToken}`
    }
    return config
  },
  (error) => Promise.reject(error),
)

// ─── Response interceptor ─────────────────────────────────────────────────────
// On HTTP 401 responses, attempt a single token refresh then retry.
//
// Network errors (no response — backend down, CORS, DNS failure) are passed
// through without triggering logout. Only genuine HTTP 401 responses from the
// backend trigger the refresh flow.

apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retried?: boolean
    }

    // Only act on real HTTP 401 responses (error.response is defined).
    // Network errors have error.response === undefined — don't logout for those.
    const is401 = error.response?.status === 401
    const is403 = error.response?.status === 403
    const isRefreshEndpoint = originalRequest?.url?.includes('/auth/refresh')
    const errorCode = (error.response?.data as { detail?: { code?: string } } | undefined)
      ?.detail?.code

    // Redirect suspended users to the dedicated suspension page.
    // Skip the refresh-endpoint to avoid an infinite loop.
    if (is403 && errorCode === 'ACCOUNT_SUSPENDED' && !isRefreshEndpoint) {
      const detail = (error.response?.data as {
        detail?: { suspension_reason?: string; suspension_message?: string }
      } | undefined)?.detail
      // Store suspension info in the auth store so the /suspended page can display it
      const { setSuspensionInfo } = (await import('./auth-store')).useAuthStore.getState()
      setSuspensionInfo({
        suspension_reason: detail?.suspension_reason ?? null,
        suspension_message: detail?.suspension_message ?? null,
      })
      // Only redirect if we're not already on the suspended page
      if (!window.location.pathname.startsWith('/suspended')) {
        window.location.href = '/suspended'
      }
      return Promise.reject(error)
    }

    if (!is401 || originalRequest._retried || isRefreshEndpoint) {
      return Promise.reject(error)
    }

    const { refreshToken } = useAuthStore.getState()
    if (!refreshToken) {
      useAuthStore.getState().clearAuth()
      window.location.href = '/login'
      return Promise.reject(error)
    }

    // If a refresh is already in flight, queue this request and wait.
    if (isRefreshing) {
      return new Promise<string>((resolve, reject) => {
        pendingRequests.push({ resolve, reject })
      }).then((newToken) => {
        if (originalRequest.headers) {
          originalRequest.headers['Authorization'] = `Bearer ${newToken}`
        }
        originalRequest._retried = true
        return apiClient(originalRequest)
      })
    }

    isRefreshing = true
    originalRequest._retried = true

    try {
      const { data } = await apiClient.post<{
        access_token: string
        refresh_token: string
        token_type: string
        expires_in: number
      }>('/auth/refresh', { refresh_token: refreshToken })

      const newAccessToken = data.access_token
      useAuthStore.getState().setAccessToken(newAccessToken)
      useAuthStore.getState().setRefreshToken(data.refresh_token)

      if (originalRequest.headers) {
        originalRequest.headers['Authorization'] = `Bearer ${newAccessToken}`
      }

      resolvePendingRequests(newAccessToken)
      return apiClient(originalRequest)
    } catch (refreshError: unknown) {
      // Only clear auth when the backend explicitly returns 401 on the refresh
      // endpoint (meaning the refresh token is genuinely expired or revoked).
      // If the refresh call itself failed with a network error, keep the user
      // logged in — the backend may be temporarily unavailable.
      const refreshIs401 =
        refreshError instanceof AxiosError && refreshError.response?.status === 401

      rejectPendingRequests(refreshError)

      if (refreshIs401) {
        useAuthStore.getState().clearAuth()
        window.location.href = '/login'
      }

      return Promise.reject(refreshError)
    } finally {
      isRefreshing = false
    }
  },
)
