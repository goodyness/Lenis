import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'react-router-dom'
import {
  getCheckoutData,
  broadcastPayment,
  createCheckoutSession,
  expireCheckoutSession,
  ApiError,
  type CheckoutLinkResponse,
} from '../../services/checkout'
import { NetworkTokenSelector } from '../../components/checkout/NetworkTokenSelector'
import {
  PaymentInstructions,
  type WalletInfo,
} from '../../components/checkout/PaymentInstructions'
import { PaymentStatusPoller } from '../../components/checkout/PaymentStatusPoller'
import { PaymentReceipt } from '../../components/checkout/PaymentReceipt'
import {
  getTokenPriceUsd,
  convertUsdToCrypto,
  type ConvertedAmountResult,
} from '../../lib/priceFeeds'

// ─── Types ────────────────────────────────────────────────────────────────────

type PageState =
  | { kind: 'loading' }
  | { kind: 'not_found' }
  | { kind: 'gone' }
  | { kind: 'error'; message: string }
  | { kind: 'loaded'; data: CheckoutLinkResponse }

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Validate the customer-entered flexible amount.
 * Returns null if valid, or an error string if invalid.
 */
function validateFlexibleAmount(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return 'Please enter an amount.'
  const num = Number(trimmed)
  if (Number.isNaN(num) || !/^\d+(\.\d+)?$/.test(trimmed)) {
    return 'Please enter a valid number.'
  }
  if (num < 0.01) return 'Amount must be at least $0.01.'
  if (num > 999_999_999.99) return 'Amount must be at most $999,999,999.99.'
  return null
}

// ─── Loading skeleton ─────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-4" aria-label="Loading checkout…" role="status">
      <div className="h-6 w-2/3 rounded bg-slate-200" />
      <div className="h-4 w-1/2 rounded bg-slate-200" />
      <div className="h-4 w-1/3 rounded bg-slate-200" />
      <div className="mt-6 h-24 rounded-xl bg-slate-100" />
      <div className="h-24 rounded-xl bg-slate-100" />
      <span className="sr-only">Loading payment link…</span>
    </div>
  )
}

// ─── Error states ─────────────────────────────────────────────────────────────

function NotFoundMessage() {
  return (
    <div
      role="alert"
      className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm"
    >
      <span
        aria-hidden="true"
        className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100"
      >
        <svg
          className="h-7 w-7 text-slate-400"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.5" />
          <path
            d="M9.75 9.75l4.5 4.5M14.25 9.75l-4.5 4.5"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <h2 className="text-lg font-semibold text-slate-800">Payment link not found</h2>
      <p className="mt-1 text-sm text-slate-500">
        This payment link does not exist or the URL may be incorrect. Please check
        the link and try again.
      </p>
    </div>
  )
}

function GoneMessage() {
  return (
    <div
      role="alert"
      className="rounded-xl border border-amber-200 bg-amber-50 p-8 text-center shadow-sm"
    >
      <span
        aria-hidden="true"
        className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-100"
      >
        <svg
          className="h-7 w-7 text-amber-500"
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
      <h2 className="text-lg font-semibold text-amber-800">
        This payment link is no longer available
      </h2>
      <p className="mt-1 text-sm text-amber-700">
        This payment link has expired, reached its usage limit, or been deactivated
        by the merchant. Please contact the merchant for an updated link.
      </p>
    </div>
  )
}

function GenericErrorMessage({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-red-200 bg-red-50 p-8 text-center shadow-sm"
    >
      <h2 className="text-lg font-semibold text-red-800">Something went wrong</h2>
      <p className="mt-1 text-sm text-red-700">{message}</p>
    </div>
  )
}

// ─── Main checkout UI ─────────────────────────────────────────────────────────

interface CheckoutUIProps {
  slug: string
  data: CheckoutLinkResponse
}

function CheckoutUI({ slug, data }: CheckoutUIProps) {
  // Initialize with first accepted token if available
  const defaultToken = data.accepted_tokens[0]
  const [selectedNetwork, setSelectedNetwork] = useState<string | null>(
    defaultToken?.network ?? null,
  )
  const [selectedToken, setSelectedToken] = useState<string | null>(
    defaultToken?.token_symbol ?? null,
  )

  // Flexible amount state
  const [flexAmount, setFlexAmount] = useState('')
  const [flexAmountError, setFlexAmountError] = useState<string | null>(null)
  const [flexAmountConfirmed, setFlexAmountConfirmed] = useState(false)

  // Payer customer info state
  const [payerEmail, setPayerEmail] = useState('')
  const [payerEmailError, setPayerEmailError] = useState<string | null>(null)
  const [payerPhone, setPayerPhone] = useState('')
  const [payerAddress, setPayerAddress] = useState('')
  const [logoError, setLogoError] = useState(false)

  // Live conversion state
  const [conversion, setConversion] = useState<ConvertedAmountResult | null>(null)
  const [isConverting, setIsConverting] = useState(false)
  const [refreshKey, setRefreshKey] = useState(0)

  // 20-minute countdown & rate guarantee state
  const [timeLeft, setTimeLeft] = useState(1200) // 20 minutes in seconds
  const [isExpired, setIsExpired] = useState(false)
  const [sessionId, setSessionId] = useState<string | null>(null)

  // Payment receipt state — shown when polling reaches 'paid'
  const [isPaid, setIsPaid] = useState(false)

  // Base USD amount: fixed from data, or confirmed flexible entry
  const baseUsdAmount =
    data.amount_mode === 'fixed'
      ? data.amount
      : flexAmountConfirmed
        ? flexAmount.trim()
        : null

  // 20-minute Countdown Timer Effect
  useEffect(() => {
    if (isPaid || isExpired) return

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer)
          setIsExpired(true)
          // Mark expired on backend
          expireCheckoutSession(slug, {
            payer_email: payerEmail.trim() || undefined,
            session_id: sessionId || undefined,
          }).catch(() => {})
          return 0
        }
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [isPaid, isExpired, slug, payerEmail, sessionId])

  // Session registration / sync
  const syncSession = useCallback(async () => {
    try {
      const res = await createCheckoutSession(slug, {
        payer_email: payerEmail.trim() || undefined,
        payer_phone: payerPhone.trim() || undefined,
        payer_address: payerAddress.trim() || undefined,
        network: selectedNetwork || undefined,
        token_symbol: selectedToken || undefined,
        amount: conversion?.cryptoAmount || baseUsdAmount || undefined,
      })
      if (res?.session_id) setSessionId(res.session_id)
      if (res?.expires_in_seconds && !isExpired) {
        setTimeLeft(res.expires_in_seconds)
      }
    } catch {
      // Non-blocking
    }
  }, [slug, payerEmail, payerPhone, payerAddress, selectedNetwork, selectedToken, conversion, baseUsdAmount, isExpired])

  // Sync session on mount or token selection
  useEffect(() => {
    syncSession()
  }, [selectedToken, selectedNetwork, refreshKey])

  // Fetch live token price and calculate conversion whenever token or amount changes
  useEffect(() => {
    if (!selectedToken || !baseUsdAmount) {
      setConversion(null)
      return
    }

    let cancelled = false
    setIsConverting(true)

    getTokenPriceUsd(selectedToken)
      .then((priceUsd) => {
        if (!cancelled) {
          const res = convertUsdToCrypto(baseUsdAmount, selectedToken, priceUsd)
          setConversion(res)
        }
      })
      .catch(() => {
        // Fallback calculation with 1:1 if price fetch errors
        if (!cancelled) {
          const res = convertUsdToCrypto(baseUsdAmount, selectedToken, 1.0)
          setConversion(res)
        }
      })
      .finally(() => {
        if (!cancelled) setIsConverting(false)
      })

    return () => {
      cancelled = true
    }
  }, [selectedToken, baseUsdAmount, refreshKey])

  function handleRefreshRate() {
    setIsExpired(false)
    setTimeLeft(1200)
    setRefreshKey((k) => k + 1)
  }

  // Build wallets array for PaymentInstructions
  const wallets: WalletInfo[] =
    data.wallets && data.wallets.length > 0
      ? data.wallets
      : data.wallet_address && selectedNetwork
        ? [{ network: selectedNetwork, address: data.wallet_address }]
        : []

  function handleNetworkTokenSelect(network: string, token: string) {
    setSelectedNetwork(network)
    setSelectedToken(token)
  }

  function handleFlexAmountConfirm() {
    const err = validateFlexibleAmount(flexAmount)
    setFlexAmountError(err)
    if (!err) {
      setFlexAmountConfirmed(true)
    }
  }

  function handleFlexAmountChange(e: React.ChangeEvent<HTMLInputElement>) {
    setFlexAmount(e.target.value)
    if (flexAmountConfirmed) {
      setFlexAmountConfirmed(false)
    }
    setFlexAmountError(null)
  }

  // Show payment instructions only when both a token is selected
  // AND (for flexible mode) the amount has been confirmed
  const showInstructions =
    selectedNetwork !== null &&
    selectedToken !== null &&
    (data.amount_mode === 'fixed' || flexAmountConfirmed)

  const matchedToken = data.accepted_tokens.find(
    (t) =>
      t.network.toLowerCase() === (selectedNetwork || '').toLowerCase() &&
      t.token_symbol.toUpperCase() === (selectedToken || '').toUpperCase(),
  )

  function validatePayerEmail(email: string): boolean {
    const trimmed = email.trim()
    if (!trimmed) {
      setPayerEmailError('Email address is required for payment confirmation and receipt.')
      return false
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setPayerEmailError('Please enter a valid email address.')
      return false
    }
    setPayerEmailError(null)
    return true
  }

  async function handlePaymentBroadcast(txHash: string, fromAddress: string) {
    if (!selectedNetwork || !selectedToken || !conversion?.cryptoAmount) return
    const wallet =
      wallets.find((w) => w.network.toLowerCase() === selectedNetwork.toLowerCase()) ||
      wallets.find((w) => /^0x[0-9a-fA-F]{40}$/.test(w.address))
    if (!wallet) return

    try {
      await broadcastPayment(slug, {
        network: selectedNetwork,
        token_symbol: selectedToken,
        contract_address: matchedToken?.contract_address,
        from_address: fromAddress,
        to_address: wallet.address,
        amount: conversion.cryptoAmount,
        tx_hash: txHash,
        payer_email: payerEmail.trim() || undefined,
        payer_phone: payerPhone.trim() || undefined,
        payer_address: payerAddress.trim() || undefined,
      })
    } catch (err) {
      console.warn('Backend broadcast notification failed (indexer will pick it up on-chain):', err)
    }
  }

  const formattedUsdAmount = baseUsdAmount
    ? `$${parseFloat(baseUsdAmount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`
    : null

  const brandAccent = data.brand_color || '#4F46E5'

  return (
    <div className="space-y-6">
      {/* 20-minute Live Rate Guarantee Countdown Header */}
      <div
        className={`rounded-2xl border p-4 shadow-xs transition-all ${
          isExpired
            ? 'border-amber-300 bg-amber-50/90'
            : timeLeft <= 180
              ? 'border-red-200 bg-red-50/80'
              : 'border-slate-200/90 bg-gradient-to-r from-slate-900 to-indigo-950 text-white'
        }`}
      >
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div
              className={`flex h-10 w-10 items-center justify-center rounded-xl text-lg font-bold shadow-xs ${
                isExpired
                  ? 'bg-amber-100 text-amber-700'
                  : timeLeft <= 180
                    ? 'bg-red-100 text-red-600 animate-pulse'
                    : 'bg-white/10 text-white backdrop-blur-sm'
              }`}
            >
              ⏱
            </div>
            <div>
              <p
                className={`text-xs font-bold uppercase tracking-wider ${
                  isExpired
                    ? 'text-amber-900'
                    : timeLeft <= 180
                      ? 'text-red-900'
                      : 'text-white'
                }`}
              >
                {isExpired ? 'Session & Exchange Rate Expired' : '20-Minute Rate Guarantee'}
              </p>
              <p
                className={`text-xs ${
                  isExpired
                    ? 'text-amber-700'
                    : timeLeft <= 180
                      ? 'text-red-700'
                      : 'text-slate-300'
                }`}
              >
                {isExpired
                  ? 'The 20-minute window has elapsed. Refresh to fetch fresh live rates.'
                  : 'Live on-chain rate is locked for this checkout session.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!isExpired ? (
              <div className="flex items-center gap-2">
                <span
                  className={`font-mono text-base font-extrabold tracking-wider ${
                    timeLeft <= 180 ? 'text-red-600' : 'text-emerald-400'
                  }`}
                >
                  {Math.floor(timeLeft / 60).toString().padStart(2, '0')}:{(timeLeft % 60).toString().padStart(2, '0')}
                </span>
                <button
                  type="button"
                  onClick={handleRefreshRate}
                  title="Refresh live exchange rate"
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold transition-all ${
                    timeLeft <= 180
                      ? 'border border-red-300 bg-white text-red-700 hover:bg-red-50'
                      : 'border border-white/20 bg-white/10 text-white hover:bg-white/20'
                  }`}
                >
                  ⚡ Refresh
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={handleRefreshRate}
                className="inline-flex items-center gap-1.5 rounded-xl bg-amber-600 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-amber-700 transition-all active:scale-95"
              >
                ⚡ Refresh Live Rate & Restart
              </button>
            )}
          </div>
        </div>

        {/* Linear progress bar */}
        {!isExpired && (
          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
            <div
              className={`h-full transition-all duration-1000 ease-linear ${
                timeLeft <= 180 ? 'bg-red-500' : 'bg-emerald-400'
              }`}
              style={{ width: `${Math.max(0, Math.min(100, (timeLeft / 1200) * 100))}%` }}
            />
          </div>
        )}
      </div>

      {/* Merchant + Branding info card */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3.5">
            {data.brand_logo_url && !logoError ? (
              <img
                src={data.brand_logo_url}
                alt={data.merchant_name}
                onError={() => setLogoError(true)}
                className="h-12 w-12 rounded-xl object-cover border border-slate-200 shadow-xs bg-white"
              />
            ) : (
              <div
                className="flex h-12 w-12 items-center justify-center rounded-xl text-lg font-bold text-white shadow-xs"
                style={{ backgroundColor: brandAccent }}
              >
                {data.merchant_name.slice(0, 2).toUpperCase()}
              </div>
            )}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                Pay to Merchant
              </p>
              <h1 className="text-xl font-bold text-slate-900">{data.merchant_name}</h1>
              {data.brand_tagline && (
                <p className="text-xs text-slate-500 mt-0.5">{data.brand_tagline}</p>
              )}
            </div>
          </div>

          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700 border border-emerald-200 shrink-0">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Verified
          </span>
        </div>

        {/* Support contact info */}
        {(data.support_email || data.support_phone) && (
          <div className="mt-3 flex flex-wrap items-center gap-3 pt-3 border-t border-slate-100 text-xs text-slate-500">
            {data.support_email && (
              <a href={`mailto:${data.support_email}`} className="hover:text-slate-900 flex items-center gap-1">
                ✉️ {data.support_email}
              </a>
            )}
            {data.support_phone && (
              <a href={`tel:${data.support_phone}`} className="hover:text-slate-900 flex items-center gap-1">
                📞 {data.support_phone}
              </a>
            )}
          </div>
        )}

        <div className="mt-4 pt-3 border-t border-slate-100">
          <p className="text-sm font-semibold text-slate-800">{data.title}</p>
        </div>

        {/* Fixed amount display */}
        {data.amount_mode === 'fixed' && data.amount !== null && (
          <div className="mt-4 rounded-xl bg-slate-50 p-4 border border-slate-100">
            <div className="flex items-baseline justify-between gap-2">
              <div>
                <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Base Amount</p>
                <p className="text-3xl font-extrabold text-slate-900 tracking-tight">
                  {formattedUsdAmount}
                </p>
              </div>

              {selectedToken && (
                <div className="text-right">
                  <p className="text-xs font-medium text-slate-400 uppercase tracking-wide">Live Crypto Equivalent</p>
                  <p className="text-lg font-bold text-emerald-600">
                    {isConverting ? (
                      <span className="animate-pulse text-sm text-slate-400">Calculating…</span>
                    ) : conversion ? (
                      `${conversion.cryptoAmount} ${selectedToken}`
                    ) : (
                      `— ${selectedToken}`
                    )}
                  </p>
                </div>
              )}
            </div>

            {/* Conversion information notice */}
            <div className="mt-3 flex items-start gap-2 border-t border-slate-200/60 pt-3 text-xs text-slate-500">
              <svg className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0118 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
              </svg>
              <span>
                Priced in USD / USDT. At payment time, your wallet will send the exact cryptocurrency equivalent (e.g. {conversion?.cryptoAmount || '0.00'} {selectedToken || 'crypto'}), which Lenis will verify on-chain.
              </span>
            </div>
          </div>
        )}

        {/* Flexible amount input */}
        {data.amount_mode === 'flexible' && (
          <div className="mt-4 space-y-3 rounded-xl bg-slate-50 p-4 border border-slate-100">
            <label
              htmlFor="flex-amount"
              className="block text-xs font-semibold uppercase tracking-wider text-slate-600"
            >
              Enter Payment Amount ($ USD)
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <span className="absolute left-3 top-2.5 text-sm font-semibold text-slate-400">$</span>
                <input
                  id="flex-amount"
                  type="number"
                  inputMode="decimal"
                  min="0.01"
                  max="999999999.99"
                  step="any"
                  placeholder="0.00"
                  value={flexAmount}
                  onChange={handleFlexAmountChange}
                  aria-describedby={flexAmountError ? 'flex-amount-error' : undefined}
                  aria-invalid={flexAmountError !== null}
                  className={[
                    'block w-full rounded-lg border pl-7 pr-3 py-2 text-sm shadow-xs font-semibold',
                    'focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1',
                    flexAmountError
                      ? 'border-red-400 bg-red-50 text-red-900'
                      : 'border-slate-300 bg-white text-slate-900',
                  ].join(' ')}
                />
              </div>
              <button
                type="button"
                onClick={handleFlexAmountConfirm}
                className={[
                  'shrink-0 rounded-lg border px-4 py-2 text-sm font-semibold transition-all select-none',
                  'focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1',
                  flexAmountConfirmed
                    ? 'border-emerald-600 bg-emerald-600 text-white shadow-xs'
                    : 'border-slate-900 bg-slate-900 text-white hover:bg-slate-800',
                ].join(' ')}
              >
                {flexAmountConfirmed ? 'Confirmed ✓' : 'Set Amount'}
              </button>
            </div>
            {flexAmountError && (
              <p
                id="flex-amount-error"
                role="alert"
                className="text-xs text-red-600"
              >
                {flexAmountError}
              </p>
            )}
            {flexAmountConfirmed && conversion && selectedToken && (
              <p className="text-xs font-medium text-emerald-700">
                ⚡ Paying <strong>{conversion.cryptoAmount} {selectedToken}</strong> ({conversion.rateText})
              </p>
            )}
          </div>
        )}
      </div>

      {/* Customer Information Card */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm space-y-4">
        <div>
          <label
            htmlFor="payer-email"
            className="block text-sm font-bold text-slate-800"
          >
            Your Email Address <span className="text-red-500">*</span>
          </label>
          <p className="mt-0.5 text-xs text-slate-500">
            We will send your payment receipt, transaction confirmation, and proof to this address.
          </p>
          <div className="mt-2">
            <input
              id="payer-email"
              type="email"
              required
              placeholder="you@example.com"
              value={payerEmail}
              onChange={(e) => {
                setPayerEmail(e.target.value)
                if (payerEmailError) setPayerEmailError(null)
              }}
              onBlur={() => {
                if (payerEmail.trim()) {
                  validatePayerEmail(payerEmail)
                  syncSession()
                }
              }}
              className={[
                'block w-full rounded-lg border px-3.5 py-2.5 text-sm shadow-xs transition-colors',
                'focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1',
                payerEmailError
                  ? 'border-red-400 bg-red-50 text-red-900'
                  : 'border-slate-300 bg-white text-slate-900',
              ].join(' ')}
            />
            {payerEmailError && (
              <p className="mt-1.5 text-xs text-red-600" role="alert">
                {payerEmailError}
              </p>
            )}
          </div>
        </div>

        {/* Optional phone collection */}
        {data.collect_phone && (
          <div>
            <label
              htmlFor="payer-phone"
              className="block text-sm font-bold text-slate-800"
            >
              Phone / WhatsApp Number
            </label>
            <input
              id="payer-phone"
              type="tel"
              placeholder="+123 456 7890"
              value={payerPhone}
              onChange={(e) => setPayerPhone(e.target.value)}
              onBlur={syncSession}
              className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm shadow-xs focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1 text-slate-900"
            />
          </div>
        )}

        {/* Optional address collection */}
        {data.collect_address && (
          <div>
            <label
              htmlFor="payer-address"
              className="block text-sm font-bold text-slate-800"
            >
              Delivery / Shipping Address
            </label>
            <textarea
              id="payer-address"
              rows={2}
              placeholder="Street Address, City, State, Postal Code, Country"
              value={payerAddress}
              onChange={(e) => setPayerAddress(e.target.value)}
              onBlur={syncSession}
              className="mt-1.5 block w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm shadow-xs focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1 text-slate-900"
            />
          </div>
        )}
      </div>

      {/* Network + token selector */}
      <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
        <h2 className="mb-4 text-sm font-bold text-slate-800">
          Choose Payment Asset & Network
        </h2>
        <NetworkTokenSelector
          acceptedTokens={data.accepted_tokens}
          selectedNetwork={selectedNetwork}
          selectedToken={selectedToken}
          onSelect={handleNetworkTokenSelect}
        />
      </div>

      {/* Payment instructions — wallet address + QR code or Expired Message */}
      {showInstructions && (
        <div className="relative rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
          {isExpired && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-2xl bg-white/95 backdrop-blur-xs p-6 text-center shadow-lg">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-600 mb-3 text-xl font-bold">
                ⚠️
              </div>
              <h3 className="text-base font-bold text-slate-900">Exchange Rate Expired</h3>
              <p className="mt-1 max-w-sm text-xs text-slate-600">
                To protect against crypto market price volatility and ensure accurate settlement, payment sessions are locked for 20 minutes. Please refresh to get the latest live conversion rate.
              </p>
              <button
                type="button"
                onClick={handleRefreshRate}
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-xs font-bold text-white shadow-sm hover:bg-slate-800 transition-all active:scale-95"
              >
                ⚡ Refresh Live Rate & Continue Payment
              </button>
            </div>
          )}

          <h2 className="mb-4 text-sm font-bold text-slate-800">
            Complete Payment
          </h2>
          <PaymentInstructions
            network={selectedNetwork}
            tokenSymbol={selectedToken}
            contractAddress={matchedToken?.contract_address}
            amount={conversion?.cryptoAmount ?? baseUsdAmount}
            usdAmount={baseUsdAmount}
            rateText={conversion?.rateText}
            amountMode={data.amount_mode}
            wallets={wallets}
            onPaymentBroadcast={handlePaymentBroadcast}
          />
        </div>
      )}

      {/* Payment status poller — shown once checkout data loads */}
      {isPaid ? (
        <PaymentReceipt
          merchantName={data.merchant_name}
          amount={conversion?.cryptoAmount ?? baseUsdAmount ?? '—'}
          tokenSymbol={selectedToken ?? '—'}
          networkName={selectedNetwork ?? '—'}
          transactionHash="—"
          confirmedAt={new Date().toISOString()}
          customMessage={data.custom_message}
          redirectUrl={data.redirect_url}
          brandLogoUrl={data.brand_logo_url}
          brandColor={data.brand_color}
        />
      ) : (
        <div className="rounded-2xl border border-slate-200/80 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-sm font-bold text-slate-800">
            Payment Status Monitor
          </h2>
          <PaymentStatusPoller
            slug={slug}
            onStatusChange={(status) => {
              if (status === 'paid' || status === 'confirmed') {
                setIsPaid(true)
              }
            }}
          />
        </div>
      )}

      {/* Security notice */}
      <p className="text-center text-xs text-slate-400">
        Lenis uses non-custodial direct peer-to-peer settlement. No private keys or seed phrases are ever requested.
      </p>
    </div>
  )
}

// ─── Page component ────────────────────────────────────────────────────────────

/**
 * Public checkout page served at /pay/:slug.
 *
 * Fetches payment link data on mount, then renders the appropriate state:
 * - Loading skeleton while fetching
 * - 404 message if the slug is unknown
 * - 410 message if the link is expired, exhausted, or deactivated
 * - Full checkout UI on success
 *
 * Requirements 11.1–11.11
 */
export function CheckoutPage() {
  const { slug } = useParams<{ slug: string }>()
  const [pageState, setPageState] = useState<PageState>({ kind: 'loading' })

  useEffect(() => {
    if (!slug) {
      setPageState({ kind: 'not_found' })
      return
    }

    let cancelled = false

    async function load() {
      setPageState({ kind: 'loading' })
      try {
        const data = await getCheckoutData(slug!)
        if (!cancelled) {
          setPageState({ kind: 'loaded', data })
        }
      } catch (err) {
        if (cancelled) return
        if (err instanceof ApiError) {
          if (err.status === 404) {
            setPageState({ kind: 'not_found' })
          } else if (err.status === 410) {
            setPageState({ kind: 'gone' })
          } else {
            setPageState({
              kind: 'error',
              message: err.message ?? 'Failed to load payment link.',
            })
          }
        } else {
          setPageState({
            kind: 'error',
            message: 'An unexpected error occurred. Please try again.',
          })
        }
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [slug])

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-10">
      <div className="mx-auto max-w-lg">
        {/* Lenis branding */}
        <div className="mb-8 text-center">
          <span className="text-2xl font-bold tracking-tight text-slate-900">
            Lenis
          </span>
          <p className="mt-0.5 text-xs text-slate-400">
            Secure crypto payment
          </p>
        </div>

        {pageState.kind === 'loading' && <LoadingSkeleton />}
        {pageState.kind === 'not_found' && <NotFoundMessage />}
        {pageState.kind === 'gone' && <GoneMessage />}
        {pageState.kind === 'error' && (
          <GenericErrorMessage message={pageState.message} />
        )}
        {pageState.kind === 'loaded' && (
          <CheckoutUI slug={slug!} data={pageState.data} />
        )}
      </div>
    </div>
  )
}
