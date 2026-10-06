import { useEffect, useId, useState } from 'react'
import { getNetworks } from '../../services/networks'
import type { AcceptedToken } from '../../stores/merchantStore'
import { QuickAddWalletModal } from './QuickAddWalletModal'

// ─── Types ────────────────────────────────────────────────────────────────────

/** Flat option representing a single token on a specific network. */
interface TokenOption {
  /** Unique key: "{network}:{symbol}" */
  key: string
  network: string
  networkDisplay: string
  symbol: string
  contractAddress: string | null
}

interface TokenMultiSelectProps {
  /** Currently selected tokens. */
  value: AcceptedToken[]
  /** Called whenever the selection changes. */
  onChange: (tokens: AcceptedToken[]) => void
  /** Field-level error message. */
  error?: string
  /** Disable the whole control. */
  disabled?: boolean
  /**
   * When provided, only show tokens belonging to these network display names.
   * Pass the merchant's wallet networks so the selector is pre-filtered to
   * networks the merchant can actually receive on.
   * If omitted or empty, all networks are shown (backward-compatible).
   */
  allowedNetworks?: string[]
}

// ─── TokenMultiSelect ─────────────────────────────────────────────────────────

/**
 * Multi-select control that lists all supported tokens grouped by network.
 * Tokens are loaded from `GET /networks` (cached in memory for the session).
 * Each option shows "{SYMBOL} on {Network Display Name}".
 *
 * When `allowedNetworks` is supplied, only tokens from those networks are
 * displayed. This ensures merchants only accept payments on chains where
 * they have an active payout wallet.
 */
export function TokenMultiSelect({
  value,
  onChange,
  error,
  disabled = false,
  allowedNetworks,
}: TokenMultiSelectProps) {
  const id = useId()
  const errorId = `${id}-error`

  const [options, setOptions] = useState<TokenOption[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [quickAddNetwork, setQuickAddNetwork] = useState<string | null>(null)

  // ─── Load networks on mount ────────────────────────────────────────────────

  useEffect(() => {
    let cancelled = false

    async function load() {
      setLoading(true)
      setFetchError(null)
      try {
        const networks = await getNetworks()
        if (cancelled) return

        const flat: TokenOption[] = []
        for (const net of networks) {
          for (const token of net.tokens) {
            flat.push({
              key: `${net.display_name}:${token.symbol}`,
              network: net.display_name,
              networkDisplay: net.display_name,
              symbol: token.symbol,
              contractAddress: token.contract_address,
            })
          }
        }
        setOptions(flat)
      } catch {
        if (!cancelled) {
          setFetchError('Failed to load supported tokens.')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])



  // ─── Selection helpers ─────────────────────────────────────────────────────

  const selectedKeys = new Set(
    value.map((t) => `${t.network}:${t.token_symbol}`),
  )

  function toggle(opt: TokenOption) {
    if (disabled) return
    const key = opt.key

    if (selectedKeys.has(key)) {
      onChange(
        value.filter(
          (t) => !(t.network === opt.network && t.token_symbol === opt.symbol),
        ),
      )
    } else {
      onChange([
        ...value,
        {
          network: opt.network,
          token_symbol: opt.symbol,
          contract_address: opt.contractAddress,
        },
      ])
    }
  }

  function clearAll() {
    onChange([])
  }

  // ─── Group all options by network ─────────────────────────────────────────

  const grouped = options.reduce<Record<string, TokenOption[]>>((acc, opt) => {
    const g = acc[opt.networkDisplay] ?? []
    g.push(opt)
    acc[opt.networkDisplay] = g
    return acc
  }, {})

  // Helper to test if a network is allowed / configured
  const isNetworkAllowed = (networkName: string) => {
    if (!allowedNetworks || allowedNetworks.length === 0) return true
    return allowedNetworks.some(
      (n) => n.toLowerCase() === networkName.toLowerCase(),
    )
  }

  function selectAllConfigured() {
    const available = options.filter((opt) => isNetworkAllowed(opt.network))
    onChange(
      available.map((opt) => ({
        network: opt.network,
        token_symbol: opt.symbol,
        contract_address: opt.contractAddress,
      })),
    )
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div
        className="space-y-2"
        aria-busy="true"
        aria-label="Loading supported tokens"
      >
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-8 animate-pulse rounded bg-slate-100" />
        ))}
      </div>
    )
  }

  if (fetchError) {
    return (
      <p className="text-sm text-red-600" role="alert">
        {fetchError}
      </p>
    )
  }

  return (
    <div
      role="group"
      aria-labelledby={`${id}-label`}
      aria-describedby={error ? errorId : undefined}
    >
      {/* Header row: label + bulk actions */}
      <div className="mb-2 flex items-center justify-between">
        <span
          id={`${id}-label`}
          className="text-sm font-medium text-slate-700"
        >
          Accepted tokens{' '}
          <span className="text-red-500" aria-hidden="true">
            *
          </span>
        </span>
        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            disabled={disabled}
            onClick={selectAllConfigured}
            className="text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline disabled:pointer-events-none disabled:opacity-40"
          >
            Select all available
          </button>
          <span className="text-slate-300" aria-hidden="true">
            /
          </span>
          <button
            type="button"
            disabled={disabled}
            onClick={clearAll}
            className="text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline disabled:pointer-events-none disabled:opacity-40"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Network filter notice */}
      {allowedNetworks && allowedNetworks.length > 0 && (
        <p className="mb-2 text-xs text-slate-500">
          Only tokens for your active payout wallet networks are selectable.
        </p>
      )}

      {/* Token grid grouped by network */}
      <div
        className={[
          'rounded-lg border p-4 space-y-4',
          error ? 'border-red-400' : 'border-slate-200',
          disabled ? 'bg-slate-50 opacity-70' : 'bg-white',
        ].join(' ')}
      >
        {Object.entries(grouped).map(([networkName, tokens]) => {
          const networkActive = isNetworkAllowed(networkName)

          return (
            <div
              key={networkName}
              className={[
                'rounded-lg p-3 transition-colors',
                networkActive
                  ? 'bg-slate-50/70 border border-slate-200/80'
                  : 'bg-slate-50/30 border border-dashed border-slate-200 opacity-60',
              ].join(' ')}
            >
              <div className="mb-2.5 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  {networkName}
                </span>
                {!networkActive ? (
                  <div className="flex items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded bg-amber-100/80 px-2 py-0.5 text-[11px] font-medium text-amber-800">
                      <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
                      </svg>
                      Wallet not configured
                    </span>
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setQuickAddNetwork(networkName)
                      }}
                      className="inline-flex items-center gap-1 rounded bg-slate-900 px-2 py-0.5 text-[11px] font-medium text-white shadow-xs hover:bg-slate-800 disabled:opacity-50 transition-colors"
                    >
                      + Add Wallet
                    </button>
                  </div>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Wallet active
                  </span>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                {tokens.map((opt) => {
                  const checked = selectedKeys.has(opt.key)
                  const checkId = `${id}-${opt.key}`
                  const itemDisabled = disabled || !networkActive

                  return (
                    <label
                      key={opt.key}
                      htmlFor={checkId}
                      title={!networkActive ? 'Add a wallet for this network in Wallet Settings to accept this token' : undefined}
                      className={[
                        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all select-none',
                        itemDisabled
                          ? 'cursor-not-allowed border-slate-200 bg-slate-100/70 text-slate-400'
                          : 'cursor-pointer hover:scale-[1.02] active:scale-[0.98]',
                        checked && networkActive
                          ? 'border-slate-900 bg-slate-900 text-white shadow-xs'
                          : !itemDisabled
                            ? 'border-slate-300 bg-white text-slate-700 hover:border-slate-500 hover:bg-slate-50'
                            : '',
                      ].join(' ')}
                    >
                      <input
                        type="checkbox"
                        id={checkId}
                        checked={checked}
                        disabled={itemDisabled}
                        onChange={() => toggle(opt)}
                        className="sr-only"
                        aria-label={`${opt.symbol} on ${opt.networkDisplay}`}
                      />
                      <span>{opt.symbol}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          )
        })}

        {options.length === 0 && (
          <p className="text-sm text-slate-400">
            No supported tokens configured.
          </p>
        )}
      </div>

      {/* Selected summary */}
      {value.length > 0 && (
        <p className="mt-1 text-xs text-slate-500">
          {value.length} token{value.length !== 1 ? 's' : ''} selected
        </p>
      )}

      {/* Error */}
      {error && (
        <p id={errorId} className="mt-1 text-xs text-red-600" role="alert">
          {error}
        </p>
      )}

      {/* Quick Add Wallet Modal */}
      <QuickAddWalletModal
        isOpen={quickAddNetwork !== null}
        onClose={() => setQuickAddNetwork(null)}
        defaultNetwork={quickAddNetwork ?? undefined}
      />
    </div>
  )
}
