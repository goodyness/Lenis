import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type EnvironmentMode = 'sandbox' | 'live'

interface EnvironmentState {
  mode: EnvironmentMode
  setMode: (mode: EnvironmentMode) => void
  toggleMode: () => void
}

export const useEnvironmentStore = create<EnvironmentState>()(
  persist(
    (set) => ({
      mode: 'sandbox', // default to sandbox for safe onboarding & testing
      setMode: (mode: EnvironmentMode) => set({ mode }),
      toggleMode: () =>
        set((state) => ({
          mode: state.mode === 'sandbox' ? 'live' : 'sandbox',
        })),
    }),
    {
      name: 'lenis-environment-mode',
    },
  ),
)
