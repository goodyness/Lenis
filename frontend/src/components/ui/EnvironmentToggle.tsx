import { useEnvironmentStore } from '../../stores/environmentStore'
import { useOnboardingStore } from '../../stores/onboardingStore'

interface Props {
  className?: string
  compact?: boolean
}

export function EnvironmentToggle({ className = '', compact = false }: Props) {
  const { mode, setMode } = useEnvironmentStore()
  const onboardingStatus = useOnboardingStore((s) => s.status)

  const isLiveApproved = onboardingStatus?.kyc_status === 'approved'

  function handleSelectMode(newMode: 'sandbox' | 'live') {
    setMode(newMode)
  }

  return (
    <div
      className={`inline-flex items-center rounded-xl bg-slate-100 p-1 border border-slate-200/80 shadow-2xs ${className}`}
      role="group"
      aria-label="Environment Mode Selector"
    >
      {/* Sandbox / Test Button */}
      <button
        type="button"
        onClick={() => handleSelectMode('sandbox')}
        className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
          mode === 'sandbox'
            ? 'bg-amber-500 text-white shadow-xs'
            : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
        }`}
      >
        <span className="text-xs">🧪</span>
        <span>{compact ? 'Test' : 'Sandbox'}</span>
      </button>

      {/* Live Mode Button */}
      <button
        type="button"
        onClick={() => handleSelectMode('live')}
        title={
          !isLiveApproved
            ? 'Live mode uses real mainnet crypto. Identity verification is required for full payout settlement.'
            : 'Live mode — Real crypto payments and settlements.'
        }
        className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-xs font-bold transition-all ${
          mode === 'live'
            ? 'bg-emerald-600 text-white shadow-xs'
            : 'text-slate-600 hover:text-slate-900 hover:bg-slate-200/50'
        }`}
      >
        <span className="text-xs">⚡</span>
        <span>Live</span>
        {!isLiveApproved && (
          <span
            className={`h-1.5 w-1.5 rounded-full ${
              mode === 'live' ? 'bg-amber-300' : 'bg-amber-500'
            }`}
            title="Verification pending"
          />
        )}
      </button>
    </div>
  )
}
