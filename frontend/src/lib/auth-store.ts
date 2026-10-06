import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AuthUser {
  id: string
  email: string
  full_name: string
  role: string
  account_type: string
  status: string
  subscription_tier?: string
}

interface SuspensionInfo {
  suspension_reason: string | null
  suspension_message: string | null
}

interface AuthState {
  accessToken: string | null
  refreshToken: string | null
  user: AuthUser | null
  suspensionInfo: SuspensionInfo | null
  setAccessToken: (token: string) => void
  setRefreshToken: (token: string) => void
  setUser: (user: AuthUser) => void
  setSuspensionInfo: (info: SuspensionInfo) => void
  clearAuth: () => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      accessToken: null,
      refreshToken: null,
      user: null,
      suspensionInfo: null,

      setAccessToken: (token: string) => set({ accessToken: token }),

      setRefreshToken: (token: string) => set({ refreshToken: token }),

      setUser: (user: AuthUser) => set({ user }),

      setSuspensionInfo: (info: SuspensionInfo) => set({ suspensionInfo: info }),

      clearAuth: () => {
        set({ accessToken: null, refreshToken: null, user: null, suspensionInfo: null })
        // Clear the onboarding store from localStorage so a new login starts fresh.
        localStorage.removeItem('lenis-onboarding')
      },
    }),
    {
      name: 'lenis-auth',
      partialize: (state) => ({
        accessToken: state.accessToken,
        refreshToken: state.refreshToken,
        user: state.user,
        suspensionInfo: state.suspensionInfo,
      }),
    },
  ),
)
