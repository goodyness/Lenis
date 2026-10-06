import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { apiClient } from '../lib/api'

export interface RejectedSectionItem {
  section: string
  step: number
  title: string
  reason: string
}

export interface OnboardingStatus {
  current_step: number
  onboarding_complete: boolean
  kyc_status: 'not_started' | 'pending' | 'approved' | 'rejected'
  wallet_added: boolean
  personal_info_status?: 'pending' | 'approved' | 'rejected'
  personal_info_rejection_reason?: string | null
  business_info_status?: 'pending' | 'approved' | 'rejected'
  business_info_rejection_reason?: string | null
  kyc_rejection_reason?: string | null
  rejected_sections?: RejectedSectionItem[]

  // Prefill fields
  full_name?: string | null
  country?: string | null
  phone_number?: string | null
  business_name?: string | null
  business_address?: string | null
  business_description?: string | null
  business_category?: string | null
  monthly_volume_estimate?: string | null
  website_url?: string | null
  social_instagram?: string | null
  social_twitter?: string | null
  social_facebook?: string | null
  social_linkedin?: string | null
  social_tiktok?: string | null
  is_registered_business?: boolean
  has_registration_doc?: boolean
  kyc_document_type?: string | null
  nin?: string | null
  has_kyc_doc?: boolean
  kyc_didit_session_id?: string | null
}

interface OnboardingState {
  // Current step the user is on (the next incomplete step)
  currentStep: number
  // All steps that have been completed (steps before currentStep)
  completedSteps: number[]
  // Form data keyed by step number, persisted across refreshes
  formData: Record<number, object>
  // Latest onboarding status from the server, persisted across refreshes
  status: OnboardingStatus | null

  // Actions
  setStep: (step: number) => void
  saveFormData: (step: number, data: object) => void
  fetchStatus: () => Promise<void>
}

export const useOnboardingStore = create<OnboardingState>()(
  persist(
    (set) => ({
      currentStep: 1,
      completedSteps: [],
      formData: {},
      status: null,

      setStep: (step: number) => set({ currentStep: step }),

      saveFormData: (step: number, data: object) =>
        set((state) => ({
          formData: {
            ...state.formData,
            [step]: { ...(state.formData[step] ?? {}), ...data },
          },
        })),

      fetchStatus: async () => {
        const { data } = await apiClient.get<OnboardingStatus>(
          '/merchant/onboarding-status',
        )

        // Build completedSteps as every step before the current one
        const completedSteps = Array.from(
          { length: data.current_step - 1 },
          (_, i) => i + 1,
        )

        set({
          status: data,
          currentStep: data.current_step,
          completedSteps,
          // formData is intentionally not overwritten — persisted local data is preserved
        })
      },
    }),
    {
      name: 'lenis-onboarding',
      // Only persist formData and status; currentStep and completedSteps are
      // derived on fetchStatus so they don't need to survive a refresh
      partialize: (state) => ({
        formData: state.formData,
        status: state.status,
      }),
    },
  ),
)
