import type { AcceptedToken } from '../../stores/merchantStore'

// ─── Types ────────────────────────────────────────────────────────────────────

interface NetworkTokenSelectorProps {
  acceptedTokens: AcceptedToken[]
  selectedNetwork: string | null
  selectedToken: string | null
  onSelect: (network: string, token: string) => void
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Group tokens by network, preserving insertion order.
 */
function groupByNetwork(tokens: AcceptedToken[]): Map<string, AcceptedToken[]> {
  const map = new Map<string, AcceptedToken[]>()
  for (const t of tokens) {
    const group = map.get(t.network)
    if (group) {
      group.push(t)
    } else {
      map.set(t.network, [t])
    }
  }
  return map
}

function formatNetworkName(network: string): string {
  const upper = new Set(['bsc', 'eth'])
  if (upper.has(network.toLowerCase())) {
    return network.toUpperCase()
  }
  return network
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

function getTokenColor(symbol: string): { bg: string; text: string; dot: string } {
  const s = symbol.toUpperCase()
  if (s.includes('USDT')) return { bg: 'bg-emerald-50 text-emerald-700 border-emerald-200', text: 'text-emerald-700', dot: 'bg-emerald-500' }
  if (s.includes('USDC')) return { bg: 'bg-blue-50 text-blue-700 border-blue-200', text: 'text-blue-700', dot: 'bg-blue-500' }
  if (s.includes('ETH')) return { bg: 'bg-indigo-50 text-indigo-700 border-indigo-200', text: 'text-indigo-700', dot: 'bg-indigo-500' }
  if (s.includes('BNB')) return { bg: 'bg-amber-50 text-amber-700 border-amber-200', text: 'text-amber-700', dot: 'bg-amber-500' }
  if (s.includes('MATIC') || s.includes('POL')) return { bg: 'bg-purple-50 text-purple-700 border-purple-200', text: 'text-purple-700', dot: 'bg-purple-500' }
  return { bg: 'bg-slate-50 text-slate-700 border-slate-200', text: 'text-slate-700', dot: 'bg-slate-500' }
}

// ─── Component ────────────────────────────────────────────────────────────────

export function NetworkTokenSelector({
  acceptedTokens,
  selectedNetwork,
  selectedToken,
  onSelect,
}: NetworkTokenSelectorProps) {
  const groups = groupByNetwork(acceptedTokens)

  if (groups.size === 0) {
    return (
      <p className="text-sm text-slate-500">
        No payment networks are configured for this link.
      </p>
    )
  }

  return (
    <div className="space-y-4" role="radiogroup" aria-label="Select payment network and token">
      {Array.from(groups.entries()).map(([network, tokens]) => {
        const isNetworkActive = selectedNetwork?.toLowerCase() === network.toLowerCase()

        return (
          <div
            key={network}
            className={[
              'rounded-xl border p-3.5 transition-all',
              isNetworkActive
                ? 'border-slate-800 bg-slate-50/70 shadow-xs'
                : 'border-slate-200 bg-white hover:border-slate-300',
            ].join(' ')}
          >
            {/* Network header */}
            <div className="mb-2.5 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-slate-400" />
                <span className="text-xs font-bold uppercase tracking-wider text-slate-700">
                  {formatNetworkName(network)} Network
                </span>
              </div>
              <span className="text-[11px] text-slate-400 font-medium">
                {tokens.length} {tokens.length === 1 ? 'asset' : 'assets'}
              </span>
            </div>

            {/* Token buttons */}
            <div className="flex flex-wrap gap-2">
              {tokens.map((token) => {
                const isSelected =
                  selectedNetwork === token.network &&
                  selectedToken === token.token_symbol

                const colors = getTokenColor(token.token_symbol)

                return (
                  <button
                    key={`${token.network}-${token.token_symbol}`}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => onSelect(token.network, token.token_symbol)}
                    className={[
                      'inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-semibold transition-all select-none',
                      'focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1',
                      isSelected
                        ? 'border-slate-900 bg-slate-900 text-white shadow-sm ring-1 ring-slate-900'
                        : 'border-slate-200 bg-white text-slate-800 hover:border-slate-400 hover:bg-slate-50',
                    ].join(' ')}
                  >
                    <span
                      className={[
                        'h-2 w-2 rounded-full',
                        isSelected ? 'bg-emerald-400' : colors.dot,
                      ].join(' ')}
                    />
                    <span>{token.token_symbol}</span>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

