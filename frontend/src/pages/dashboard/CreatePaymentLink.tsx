import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { TokenMultiSelect } from '../../components/dashboard/TokenMultiSelect'
import { useMerchantStore } from '../../stores/merchantStore'
import { useOnboardingStore } from '../../stores/onboardingStore'
import type { AcceptedToken } from '../../stores/merchantStore'

const DRAFT_STORAGE_KEY = 'lenis_payment_link_draft'

// ─── Validation ───────────────────────────────────────────────────────────────

interface FormErrors {
  title?: string
  amount?: string
  expires_at?: string
  max_uses?: string
  redirect_url?: string
  custom_message?: string
  accepted_tokens?: string
}

interface FormValues {
  title: string
  amount_mode: 'fixed' | 'flexible'
  amount: string
  expires_at: string
  max_uses: string
  redirect_url: string
  custom_message: string
  collect_phone: boolean
  collect_address: boolean
  accepted_tokens: AcceptedToken[]
}

const defaultValues: FormValues = {
  title: '',
  amount_mode: 'fixed',
  amount: '',
  expires_at: '',
  max_uses: '',
  redirect_url: '',
  custom_message: '',
  collect_phone: false,
  collect_address: false,
  accepted_tokens: [],
}

function validateStep(step: number, values: FormValues): FormErrors {
  const errors: FormErrors = {}

  if (step === 1) {
    if (values.title.trim().length === 0) {
      errors.title = 'Title is required.'
    } else if (values.title.trim().length > 200) {
      errors.title = 'Title must be 200 characters or fewer.'
    }

    if (values.amount_mode === 'fixed') {
      if (values.amount.trim() === '') {
        errors.amount = 'Amount is required for fixed-price links.'
      } else {
        const num = parseFloat(values.amount)
        if (isNaN(num) || num <= 0) {
          errors.amount = 'Amount must be a positive number.'
        } else if (num > 999_999_999.99) {
          errors.amount = 'Amount must not exceed 999,999,999.99.'
        } else {
          const decimalPart = values.amount.split('.')[1]
          if (decimalPart && decimalPart.length > 18) {
            errors.amount = 'Amount must have at most 18 decimal places.'
          }
        }
      }
    }
  }

  if (step === 2) {
    if (values.accepted_tokens.length === 0) {
      errors.accepted_tokens = 'Select at least one token to accept.'
    }
  }

  if (step === 3) {
    if (values.expires_at.trim() !== '') {
      const expiresDate = new Date(values.expires_at)
      if (isNaN(expiresDate.getTime())) {
        errors.expires_at = 'Invalid date/time.'
      } else if (expiresDate <= new Date()) {
        errors.expires_at = 'Expiry date must be in the future.'
      }
    }

    if (values.max_uses.trim() !== '') {
      const n = Number(values.max_uses)
      if (!Number.isInteger(n) || n <= 0) {
        errors.max_uses = 'Max uses must be a positive whole number.'
      } else if (n > 1_000_000) {
        errors.max_uses = 'Max uses cannot exceed 1,000,000.'
      }
    }

    if (values.redirect_url.trim() !== '') {
      try {
        const url = new URL(values.redirect_url.trim())
        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          errors.redirect_url = 'URL must start with http:// or https://.'
        } else if (!url.hostname) {
          errors.redirect_url = 'URL must contain a valid host.'
        }
      } catch {
        errors.redirect_url = 'Must be a valid URL starting with http:// or https://.'
      }
    }
  }

  return errors
}

// ─── Gate component ───────────────────────────────────────────────────────────

function GateBlock({
  icon,
  title,
  description,
  actionLabel,
  onAction,
}: {
  icon: React.ReactNode
  title: string
  description: string
  actionLabel: string
  onAction: () => void
}) {
  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <div className="flex flex-col items-center gap-4 py-8 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-yellow-50 text-yellow-500">
            {icon}
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-900">{title}</h2>
            <p className="mt-1 text-sm text-slate-500">{description}</p>
          </div>
          <Button variant="primary" size="sm" onClick={onAction}>
            {actionLabel}
          </Button>
        </div>
      </Card>
    </div>
  )
}

const WarningIcon = () => (
  <svg className="h-7 w-7" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
    <path
      fillRule="evenodd"
      d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
      clipRule="evenodd"
    />
  </svg>
)

// ─── Main Component ───────────────────────────────────────────────────────────

export function CreatePaymentLink() {
  const navigate = useNavigate()
  const createPaymentLink = useMerchantStore((s) => s.createPaymentLink)
  const wallets = useMerchantStore((s) => s.wallets)
  const fetchWallets = useMerchantStore((s) => s.fetchWallets)
  const onboardingStatus = useOnboardingStore((s) => s.status)
  const fetchOnboardingStatus = useOnboardingStore((s) => s.fetchStatus)

  const [prereqLoading, setPrereqLoading] = useState(wallets === null || onboardingStatus === null)
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1)
  const [hasDraft, setHasDraft] = useState(false)

  const [values, setValues] = useState<FormValues>(() => {
    try {
      const saved = localStorage.getItem(DRAFT_STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        return { ...defaultValues, ...parsed }
      }
    } catch {
      // ignore
    }
    return defaultValues
  })

  const [errors, setErrors] = useState<FormErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  // Check initial draft existence
  useEffect(() => {
    const saved = localStorage.getItem(DRAFT_STORAGE_KEY)
    if (saved) {
      setHasDraft(true)
    }
  }, [])

  // Auto-save draft on changes
  useEffect(() => {
    if (values.title || values.amount || values.accepted_tokens.length > 0) {
      localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(values))
      setHasDraft(true)
    }
  }, [values])

  // Load wallets and onboarding status if not yet cached.
  useEffect(() => {
    if (wallets !== null && onboardingStatus !== null) {
      setPrereqLoading(false)
      return
    }
    const loads: Promise<unknown>[] = []
    if (wallets === null) loads.push(fetchWallets())
    if (onboardingStatus === null) loads.push(fetchOnboardingStatus())
    Promise.all(loads).finally(() => setPrereqLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function set<K extends keyof FormValues>(field: K, val: FormValues[K]) {
    setValues((prev) => ({ ...prev, [field]: val }))
    setErrors((prev) => ({ ...prev, [field]: undefined }))
  }

  function discardDraft() {
    localStorage.removeItem(DRAFT_STORAGE_KEY)
    setValues(defaultValues)
    setHasDraft(false)
    setCurrentStep(1)
    setErrors({})
  }

  function handleNextStep() {
    setServerError(null)
    const stepErrors = validateStep(currentStep, values)
    if (Object.keys(stepErrors).length > 0) {
      setErrors(stepErrors)
      return
    }
    setErrors({})
    if (currentStep === 1) setCurrentStep(2)
    else if (currentStep === 2) setCurrentStep(3)
  }

  function handlePrevStep() {
    setServerError(null)
    setErrors({})
    if (currentStep === 3) setCurrentStep(2)
    else if (currentStep === 2) setCurrentStep(1)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setServerError(null)

    // Validate step 3 and overall
    const errs = {
      ...validateStep(1, values),
      ...validateStep(2, values),
      ...validateStep(3, values),
    }

    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      if (errs.title || errs.amount) setCurrentStep(1)
      else if (errs.accepted_tokens) setCurrentStep(2)
      return
    }

    setSubmitting(true)
    try {
      await createPaymentLink({
        title: values.title.trim(),
        amount_mode: values.amount_mode,
        ...(values.amount_mode === 'fixed' && values.amount.trim() !== ''
          ? { amount: values.amount.trim() }
          : {}),
        accepted_tokens: values.accepted_tokens,
        ...(values.expires_at.trim() !== ''
          ? { expires_at: new Date(values.expires_at).toISOString() }
          : {}),
        ...(values.max_uses.trim() !== ''
          ? { max_uses: parseInt(values.max_uses, 10) }
          : {}),
        ...(values.redirect_url.trim() !== ''
          ? { redirect_url: values.redirect_url.trim() }
          : {}),
        ...(values.custom_message.trim() !== ''
          ? { custom_message: values.custom_message.trim() }
          : {}),
        collect_phone: values.collect_phone,
        collect_address: values.collect_address,
      })
      localStorage.removeItem(DRAFT_STORAGE_KEY)
      navigate('/dashboard/payment-links')
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : 'An unexpected error occurred. Please try again.'
      setServerError(msg)
    } finally {
      setSubmitting(false)
    }
  }

  // ─── Pre-requisite checks ──────────────────────────────────────────────────

  if (prereqLoading) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="h-8 w-48 animate-pulse rounded bg-slate-200" />
        <div className="h-64 animate-pulse rounded-lg bg-slate-100" />
      </div>
    )
  }

  // Gate 1: must have at least one active wallet
  const activeWallets = (wallets ?? []).filter((w) => w.status === 'active')
  if (activeWallets.length === 0) {
    return (
      <GateBlock
        icon={<WarningIcon />}
        title="Wallet required"
        description="You need to add and activate at least one payout wallet before creating a payment link."
        actionLabel="Set up a wallet"
        onAction={() => navigate('/dashboard/wallets')}
      />
    )
  }

  // Gate 2: KYC must be approved
  if (onboardingStatus && onboardingStatus.kyc_status !== 'approved') {
    const isInProgress = onboardingStatus.kyc_status === 'pending'
    return (
      <GateBlock
        icon={<WarningIcon />}
        title={isInProgress ? 'Verification in progress' : 'Verification required'}
        description={
          isInProgress
            ? 'Your identity is being reviewed. Payment links will be available once verification is complete.'
            : 'You must complete identity verification before creating payment links. This protects your customers and your account.'
        }
        actionLabel="Complete Verification (Didit)"
        onAction={() => navigate('/onboarding?step=3')}
      />
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Page heading */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/dashboard/payment-links')}
            aria-label="Go back to payment links"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1"
          >
            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path
                fillRule="evenodd"
                d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
                clipRule="evenodd"
              />
            </svg>
          </button>
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">
              Create Payment Link
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Step {currentStep} of 3 • {currentStep === 1 ? 'Title & Pricing' : currentStep === 2 ? 'Accepted Tokens' : 'Settings & Review'}
            </p>
          </div>
        </div>

        {hasDraft && (
          <button
            type="button"
            onClick={discardDraft}
            className="text-xs font-medium text-slate-400 hover:text-red-600 transition-colors"
          >
            Discard Draft
          </button>
        )}
      </div>

      {/* Wizard Progress Bar */}
      <div className="grid grid-cols-3 gap-2">
        <div
          className={`h-1.5 rounded-full transition-colors ${
            currentStep >= 1 ? 'bg-slate-900' : 'bg-slate-200'
          }`}
        />
        <div
          className={`h-1.5 rounded-full transition-colors ${
            currentStep >= 2 ? 'bg-slate-900' : 'bg-slate-200'
          }`}
        />
        <div
          className={`h-1.5 rounded-full transition-colors ${
            currentStep === 3 ? 'bg-slate-900' : 'bg-slate-200'
          }`}
        />
      </div>

      <Card>
        <form onSubmit={handleSubmit} noValidate className="space-y-6">
          {/* Server error */}
          {serverError && (
            <div
              className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
              role="alert"
            >
              {serverError}
            </div>
          )}

          {/* STEP 1: Title & Pricing */}
          {currentStep === 1 && (
            <div className="space-y-6 animate-fadeIn">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Title & Pricing</h2>
                <p className="text-xs text-slate-500">Configure what you are selling and its USD value.</p>
              </div>

              {/* Title */}
              <Input
                label="Payment Link Title"
                required
                placeholder="e.g. Photography Session Deposit, Subscription, Consulting"
                value={values.title}
                onChange={(e) => set('title', e.target.value)}
                error={errors.title}
                disabled={submitting}
                maxLength={200}
              />

              {/* Amount mode */}
              <fieldset>
                <legend className="mb-2 text-sm font-medium text-slate-700">
                  Price type <span className="text-red-500">*</span>
                </legend>
                <div className="flex items-center gap-6">
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      name="amount_mode"
                      value="fixed"
                      checked={values.amount_mode === 'fixed'}
                      onChange={() => {
                        set('amount_mode', 'fixed')
                        setErrors((prev) => ({ ...prev, amount: undefined }))
                      }}
                      disabled={submitting}
                      className="h-4 w-4 border-slate-300 text-slate-900 focus:ring-slate-400"
                    />
                    Fixed price (USD / USDT)
                  </label>
                  <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                    <input
                      type="radio"
                      name="amount_mode"
                      value="flexible"
                      checked={values.amount_mode === 'flexible'}
                      onChange={() => {
                        set('amount_mode', 'flexible')
                        set('amount', '')
                        setErrors((prev) => ({ ...prev, amount: undefined }))
                      }}
                      disabled={submitting}
                      className="h-4 w-4 border-slate-300 text-slate-900 focus:ring-slate-400"
                    />
                    Customer chooses amount
                  </label>
                </div>
              </fieldset>

              {/* Amount (fixed mode only) */}
              {values.amount_mode === 'fixed' && (
                <div className="space-y-1.5">
                  <Input
                    label="Amount (USD / USDT)"
                    required
                    type="number"
                    inputMode="decimal"
                    min="0.01"
                    step="any"
                    placeholder="e.g. 600.00"
                    value={values.amount}
                    onChange={(e) => set('amount', e.target.value)}
                    error={errors.amount}
                    disabled={submitting}
                    helperText="Enter the price in USD / USDT equivalent."
                  />
                  <div className="flex items-start gap-2 rounded-lg bg-blue-50/80 p-3 text-xs text-blue-800">
                    <svg className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div>
                      <span className="font-semibold">Dynamic Crypto Pricing:</span> When customers checkout, they can pay this amount using any accepted token at real-time rates (e.g. $600 = ~0.20 ETH, 600 USDT, etc.).
                    </div>
                  </div>
                </div>
              )}

              <div className="flex justify-end pt-4 border-t border-slate-100">
                <Button type="button" variant="primary" onClick={handleNextStep}>
                  Next: Accepted Tokens →
                </Button>
              </div>
            </div>
          )}

          {/* STEP 2: Accepted Tokens */}
          {currentStep === 2 && (
            <div className="space-y-6 animate-fadeIn">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Accepted Cryptocurrencies</h2>
                <p className="text-xs text-slate-500">
                  Select which tokens and networks you want to accept. If a network is unconfigured, click <strong>+ Add Wallet</strong>.
                </p>
              </div>

              {/* Accepted tokens */}
              <TokenMultiSelect
                value={values.accepted_tokens}
                onChange={(tokens) => set('accepted_tokens', tokens)}
                error={errors.accepted_tokens}
                disabled={submitting}
                allowedNetworks={activeWallets.map((w) => w.network)}
              />

              <div className="flex items-center justify-between pt-4 border-t border-slate-100">
                <Button type="button" variant="secondary" onClick={handlePrevStep}>
                  ← Back
                </Button>
                <Button type="button" variant="primary" onClick={handleNextStep}>
                  Next: Settings & Review →
                </Button>
              </div>
            </div>
          )}

          {/* STEP 3: Optional Settings & Review */}
          {currentStep === 3 && (
            <div className="space-y-6 animate-fadeIn">
              <div>
                <h2 className="text-base font-semibold text-slate-900">Optional Settings & Confirmation</h2>
                <p className="text-xs text-slate-500">Set limits and review your payment link before publishing.</p>
              </div>

              {/* Expiry */}
              <Input
                label="Expires at"
                type="datetime-local"
                value={values.expires_at}
                onChange={(e) => set('expires_at', e.target.value)}
                error={errors.expires_at}
                disabled={submitting}
                helperText="Leave blank for no expiration."
                min={new Date().toISOString().slice(0, 16)}
              />

              {/* Max uses */}
              <Input
                label="Maximum uses"
                type="number"
                inputMode="numeric"
                min="1"
                max="1000000"
                step="1"
                placeholder="e.g. 100"
                value={values.max_uses}
                onChange={(e) => set('max_uses', e.target.value)}
                error={errors.max_uses}
                disabled={submitting}
                helperText="Leave blank for unlimited uses."
              />

              {/* Redirect URL */}
              <Input
                label="Post-Payment Redirect URL"
                type="url"
                placeholder="https://wa.me/234... or https://yoursite.com/thank-you"
                value={values.redirect_url}
                onChange={(e) => set('redirect_url', e.target.value)}
                error={errors.redirect_url}
                disabled={submitting}
                helperText="Optional. Payer will be automatically redirected (or shown a direct button) after payment."
              />

              {/* Custom Thank-You Note */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">
                  Custom Thank-You Message
                </label>
                <textarea
                  rows={2}
                  placeholder="e.g. Thanks for your purchase! We have received your order and will contact you shortly."
                  value={values.custom_message}
                  onChange={(e) => set('custom_message', e.target.value)}
                  disabled={submitting}
                  maxLength={500}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 disabled:bg-slate-50"
                />
                <p className="mt-1 text-xs text-slate-500">
                  Optional. Displayed prominently on the customer receipt after a successful payment.
                </p>
              </div>

              {/* Customer Information Collection */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-600">Customer Data Collection</h3>
                <p className="text-xs text-slate-500">
                  Customer email is always required. Optionally ask for additional contact details before checkout:
                </p>
                <div className="space-y-2 pt-1">
                  <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={values.collect_phone}
                      onChange={(e) => set('collect_phone', e.target.checked)}
                      disabled={submitting}
                      className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                    />
                    <span>Collect customer phone number / WhatsApp</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={values.collect_address}
                      onChange={(e) => set('collect_address', e.target.checked)}
                      disabled={submitting}
                      className="h-4 w-4 rounded border-slate-300 text-slate-900 focus:ring-slate-400"
                    />
                    <span>Collect customer physical shipping / delivery address</span>
                  </label>
                </div>
              </div>

              {/* Summary card */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 space-y-3">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Review Summary</h3>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-slate-400">Title:</span>
                    <p className="font-semibold text-slate-900">{values.title || '—'}</p>
                  </div>
                  <div>
                    <span className="text-slate-400">Price:</span>
                    <p className="font-semibold text-slate-900">
                      {values.amount_mode === 'fixed'
                        ? `$${values.amount || '0.00'} USD`
                        : 'Customer chooses amount'}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-400">Accepted Tokens:</span>
                    <p className="font-semibold text-slate-900">
                      {values.accepted_tokens.length} token{values.accepted_tokens.length !== 1 ? 's' : ''} ({values.accepted_tokens.map(t => t.token_symbol).join(', ') || 'None'})
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-400">Max Uses:</span>
                    <p className="font-semibold text-slate-900">{values.max_uses || 'Unlimited'}</p>
                  </div>
                  {values.redirect_url && (
                    <div className="col-span-2">
                      <span className="text-slate-400">Redirect URL:</span>
                      <p className="font-mono text-slate-900 break-all">{values.redirect_url}</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center justify-between pt-4 border-t border-slate-100">
                <Button type="button" variant="secondary" onClick={handlePrevStep} disabled={submitting}>
                  ← Back
                </Button>
                <Button type="submit" variant="primary" loading={submitting}>
                  Publish Payment Link
                </Button>
              </div>
            </div>
          )}
        </form>
      </Card>
    </div>
  )
}

