/**
 * Price Feed & Currency Conversion Utility
 *
 * Supports converting USD/USDT amounts into live cryptocurrency equivalents
 * for Ethereum, Base, Polygon, BSC, Arbitrum, Optimism, etc.
 */

export interface TokenPriceInfo {
  symbol: string
  priceUsd: number
  lastUpdated: number
}

// Fallback reference prices (USD) in case external APIs are unreachable
const FALLBACK_PRICES: Record<string, number> = {
  USDT: 1.0,
  USDC: 1.0,
  DAI: 1.0,
  BUSD: 1.0,
  ETH: 3100.0,
  WETH: 3100.0,
  BTC: 65000.0,
  WBTC: 65000.0,
  BNB: 580.0,
  MATIC: 0.42,
  POL: 0.42,
  SOL: 150.0,
  ARB: 0.55,
  OP: 1.45,
  AVAX: 28.0,
}

// In-memory cache with 45-second TTL
const priceCache: Record<string, { price: number; timestamp: number }> = {}
const CACHE_TTL_MS = 45 * 1000

const COINGECKO_ID_MAP: Record<string, string> = {
  ETH: 'ethereum',
  WETH: 'ethereum',
  BTC: 'bitcoin',
  WBTC: 'wrapped-bitcoin',
  BNB: 'binancecoin',
  MATIC: 'matic-network',
  POL: 'polygon-ecosystem-token',
  SOL: 'solana',
  ARB: 'arbitrum',
  OP: 'optimism',
  AVAX: 'avalanche-2',
  USDT: 'tether',
  USDC: 'usd-coin',
  DAI: 'dai',
}

/**
 * Fetch live USD price for a token symbol.
 * Falls back gracefully to cache or static reference if network request fails.
 */
export async function getTokenPriceUsd(symbol: string): Promise<number> {
  const sym = symbol.toUpperCase()

  // Stablecoins are always 1:1 USD
  if (['USDT', 'USDC', 'DAI', 'BUSD', 'FDUSD'].includes(sym)) {
    return 1.0
  }

  // Check valid cache
  const cached = priceCache[sym]
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.price
  }

  const cgId = COINGECKO_ID_MAP[sym]
  if (cgId) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 3500)

      const res = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${cgId}&vs_currencies=usd`,
        { signal: controller.signal },
      )
      clearTimeout(timeoutId)

      if (res.ok) {
        const data = await res.json()
        const price = data[cgId]?.usd
        if (typeof price === 'number' && price > 0) {
          priceCache[sym] = { price, timestamp: Date.now() }
          return price
        }
      }
    } catch {
      // Fall through to fallback
    }
  }

  // Fallback to static price
  return FALLBACK_PRICES[sym] ?? 1.0
}

export interface ConvertedAmountResult {
  cryptoAmount: string
  cryptoAmountRaw: number
  rateText: string
  usdEquivalentText: string
  isStablecoin: boolean
}

/**
 * Convert a base USD amount into the target crypto token amount.
 *
 * @param usdAmount - Base USD/USDT amount as a string or number (e.g. "600")
 * @param tokenSymbol - Token symbol (e.g. "ETH", "USDT", "MATIC")
 * @param priceUsd - Current token price in USD (fetched via getTokenPriceUsd)
 */
export function convertUsdToCrypto(
  usdAmount: string | number,
  tokenSymbol: string,
  priceUsd: number,
): ConvertedAmountResult {
  const sym = tokenSymbol.toUpperCase()
  const isStable = ['USDT', 'USDC', 'DAI', 'BUSD', 'FDUSD'].includes(sym)
  const usdVal = typeof usdAmount === 'string' ? parseFloat(usdAmount) : usdAmount

  if (isNaN(usdVal) || usdVal <= 0 || priceUsd <= 0) {
    return {
      cryptoAmount: '0.00',
      cryptoAmountRaw: 0,
      rateText: `1 ${sym} = $${priceUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`,
      usdEquivalentText: '$0.00 USD',
      isStablecoin: isStable,
    }
  }

  let cryptoAmountRaw: number
  let cryptoAmountStr: string

  if (isStable) {
    cryptoAmountRaw = usdVal
    cryptoAmountStr = usdVal.toFixed(2)
  } else {
    cryptoAmountRaw = usdVal / priceUsd
    // Format: up to 6 decimal places without excessive trailing zeros
    if (cryptoAmountRaw < 0.0001) {
      cryptoAmountStr = cryptoAmountRaw.toFixed(6)
    } else if (cryptoAmountRaw < 1) {
      cryptoAmountStr = cryptoAmountRaw.toFixed(5).replace(/\.?0+$/, '')
    } else if (cryptoAmountRaw < 100) {
      cryptoAmountStr = cryptoAmountRaw.toFixed(4).replace(/\.?0+$/, '')
    } else {
      cryptoAmountStr = cryptoAmountRaw.toFixed(2)
    }
  }

  const rateFormatted = priceUsd.toLocaleString('en-US', {
    minimumFractionDigits: priceUsd < 1 ? 4 : 2,
    maximumFractionDigits: priceUsd < 1 ? 4 : 2,
  })

  return {
    cryptoAmount: cryptoAmountStr,
    cryptoAmountRaw,
    rateText: `1 ${sym} ≈ $${rateFormatted} USD`,
    usdEquivalentText: `$${usdVal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`,
    isStablecoin: isStable,
  }
}
