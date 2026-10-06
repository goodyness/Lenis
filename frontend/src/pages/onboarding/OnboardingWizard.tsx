import { useEffect, useState } from 'react'
import { useNavigate, useBlocker, useSearchParams } from 'react-router-dom'
import { useOnboardingStore } from '../../stores/onboardingStore'
import { WizardProgress } from '../../components/onboarding/WizardProgress'
import { Step1Personal } from './Step1Personal'
import { Step2Business } from './Step2Business'
import { Step3KYC } from './Step3KYC'
import { Step4Wallet } from './Step4Wallet'

// ─── Constants ────────────────────────────────────────────────────────────────

const TOTAL_STEPS = 4

// ─── Step map ─────────────────────────────────────────────────────────────────

function ActiveStep({ step }: { step: number }) {
  switch (step) {
    case 1:
      return <Step1Personal />
    case 2:
      return <Step2Business />
    case 3:
      return <Step3KYC />
    case 4:
      return <Step4Wallet />
    default:
      return null
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function OnboardingWizard() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const stepParam = searchParams.get('step')
  const requestedStep = stepParam ? parseInt(stepParam, 10) : null

  const fetchStatus = useOnboardingStore((state) => state.fetchStatus)
  const currentStep = useOnboardingStore((state) => state.currentStep)
  const setStep = useOnboardingStore((state) => state.setStep)

  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [freshlyComplete, setFreshlyComplete] = useState(false)

  // Block navigation away from /onboarding only if incomplete and NOT in remediation mode
  const isRemediation = requestedStep !== null
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      !freshlyComplete &&
      !isLoading &&
      !isRemediation &&
      nextLocation.pathname !== currentLocation.pathname,
  )

  useEffect(() => {
    if (blocker.state === 'blocked') {
      blocker.reset()
      navigate('/onboarding', { replace: true })
    }
  }, [blocker, navigate])

  // ─── Fetch status on mount ─────────────────────────────────────────────────

  async function loadStatus() {
    setIsLoading(true)
    setLoadError(null)
    try {
      await fetchStatus()
      const freshStatus = useOnboardingStore.getState().status

      const hasRejection =
        (freshStatus?.rejected_sections && freshStatus.rejected_sections.length > 0) ||
        freshStatus?.kyc_status === 'rejected' ||
        freshStatus?.personal_info_status === 'rejected' ||
        freshStatus?.business_info_status === 'rejected'

      if (requestedStep && requestedStep >= 1 && requestedStep <= 4) {
        setStep(requestedStep)
      } else if (freshStatus?.onboarding_complete && !hasRejection && freshStatus?.kyc_status === 'approved') {
        setFreshlyComplete(true)
      } else if (freshStatus?.kyc_status !== 'approved' && (freshStatus?.current_step || 1) >= 3) {
        setStep(3)
      }
    } catch {
      setLoadError('Failed to load your onboarding progress. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    loadStatus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (requestedStep && requestedStep >= 1 && requestedStep <= 4) {
      setStep(requestedStep)
    }
  }, [requestedStep, setStep])

  // ─── Redirect when freshly confirmed complete ──────────────────────────────

  useEffect(() => {
    if (freshlyComplete && !requestedStep) {
      navigate('/dashboard', { replace: true })
    }
  }, [freshlyComplete, requestedStep, navigate])

  // ─── Loading ───────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <svg
            className="h-6 w-6 animate-spin text-slate-400"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z"
            />
          </svg>
          <p className="text-sm text-slate-500">Loading your progress…</p>
        </div>
      </div>
    )
  }

  // ─── Error ─────────────────────────────────────────────────────────────────

  if (loadError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
          <p
            className="mb-4 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700"
            role="alert"
          >
            {loadError}
          </p>
          <button
            type="button"
            onClick={loadStatus}
            className={[
              'w-full rounded-md border border-slate-300 bg-white px-4 py-2 text-sm',
              'font-medium text-slate-700 transition-colors',
              'hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2',
            ].join(' ')}
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  // Clamp step to 1–4 for display; step 5+ means complete (redirect handled above)
  const displayStep = Math.min(Math.max(currentStep, 1), TOTAL_STEPS)

  return (
    <div className="flex min-h-screen items-start justify-center bg-slate-50 px-4 py-12 sm:py-16">
      <div className="w-full max-w-lg">
        {/* Navigation link back to dashboard if completed or remediating */}
        <div className="mb-4 flex items-center justify-between">
          <button
            type="button"
            onClick={() => navigate('/dashboard')}
            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 transition-colors"
          >
            ← Back to Dashboard
          </button>
        </div>

        {/* Progress indicator */}
        <div className="mb-8">
          <WizardProgress currentStep={displayStep} totalSteps={TOTAL_STEPS} />
        </div>

        {/* Step card */}
        <div className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
          <ActiveStep step={displayStep} />
        </div>
      </div>
    </div>
  )
}
