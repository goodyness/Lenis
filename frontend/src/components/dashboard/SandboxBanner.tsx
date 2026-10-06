import { useEnvironmentStore } from '../../stores/environmentStore'

export function SandboxBanner() {
  const { mode, setMode } = useEnvironmentStore()

  if (mode !== 'sandbox') return null

  return (
    <div className="mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 rounded-xl border border-amber-300 bg-amber-50/90 px-4 py-2.5 text-xs text-amber-900 shadow-2xs">
      <div className="flex items-center gap-2">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-200 text-xs font-bold text-amber-800 shrink-0">
          🧪
        </span>
        <div>
          <strong className="font-bold text-amber-950">Sandbox Mode Active: </strong>
          <span className="text-amber-800">
            You are operating in simulated test mode. Created links, invoices, and transactions do not process real cryptocurrency.
          </span>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setMode('live')}
        className="inline-flex items-center gap-1 font-bold text-amber-900 underline hover:text-amber-950 text-xs shrink-0 self-end sm:self-auto"
      >
        <span>Switch to Live Mode →</span>
      </button>
    </div>
  )
}
