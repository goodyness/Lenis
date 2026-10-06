import React, { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Input } from '../../components/ui/Input'
import { TokenMultiSelect } from '../../components/dashboard/TokenMultiSelect'
import { useMerchantStore } from '../../stores/merchantStore'
import { useOnboardingStore } from '../../stores/onboardingStore'
import type { AcceptedToken } from '../../stores/merchantStore'

// â”€â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface LineItemRow {
  description: string
  amount: string
}

interface FormValues {
  customer_name: string
  customer_email: string
  due_date: string
  line_items: LineItemRow[]
  accepted_tokens: AcceptedToken[]
  notes: string
}

interface FormErrors {
  customer_name?: string
  customer_email?: string
  due_date?: string
  line_items?: (Partial<Record<'description' | 'amount', string>> | undefined)[]
  accepted_tokens?: string
  notes?: string
}

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function todayISO(): string {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function computeRunningTotal(items: LineItemRow[]): string {
  const sum = items.reduce((acc, item) => {
    const n = parseFloat(item.amount)
    return acc + (isNaN(n) ? 0 : n)
  }, 0)
  return sum.toFixed(2)
}

// â”€â”€â”€ Validation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function validate(values: FormValues): FormErrors {
  const errors: FormErrors = {}

  // customer_name
  if (values.customer_name.trim().length === 0) {
    errors.customer_name = 'Customer name is required.'
  } else if (values.customer_name.trim().length > 200) {
    errors.customer_name = 'Customer name must be 200 characters or fewer.'
  }

  // customer_email
  const emailTrimmed = values.customer_email.trim()
  if (emailTrimmed.length === 0) {
    errors.customer_email = 'Customer email is required.'
  } else {
    const atIdx = emailTrimmed.indexOf('@')
    if (atIdx < 1) {
      errors.customer_email = 'Must be a valid email address.'
    } else {
      const afterAt = emailTrimmed.slice(atIdx + 1)
      if (!afterAt.includes('.') || afterAt.startsWith('.') || afterAt.endsWith('.')) {
        errors.customer_email = 'Must be a valid email address.'
      }
    }
  }

  // due_date: must be today or future (compare YYYY-MM-DD strings)
  if (values.due_date.trim() === '') {
    errors.due_date = 'Due date is required.'
  } else if (values.due_date < todayISO()) {
    errors.due_date = 'Due date must be today or a future date.'
  }

  // line_items
  if (values.line_items.length === 0) {
    errors.line_items = []
  } else {
    const lineErrors: FormErrors['line_items'] = values.line_items.map((item) => {
      const rowErr: Partial<Record<'description' | 'amount', string>> = {}

      if (item.description.trim().length === 0) {
        rowErr.description = 'Description is required.'
      } else if (item.description.trim().length > 500) {
        rowErr.description = 'Description must be 500 characters or fewer.'
      }

      if (item.amount.trim() === '') {
        rowErr.amount = 'Amount is required.'
      } else {
        const n = parseFloat(item.amount)
        if (isNaN(n) || n <= 0) {
          rowErr.amount = 'Amount must be a positive number.'
        } else if (n > 999_999.99) {
          rowErr.amount = 'Amount must not exceed 999,999.99.'
        } else {
          const decimalPart = item.amount.split('.')[1]
          if (decimalPart && decimalPart.length > 2) {
            rowErr.amount = 'Amount can have at most 2 decimal places.'
          }
        }
      }

      return Object.keys(rowErr).length > 0 ? rowErr : undefined
    })

    if (lineErrors.some(Boolean)) {
      errors.line_items = lineErrors
    }
  }

  // accepted_tokens
  if (values.accepted_tokens.length === 0) {
    errors.accepted_tokens = 'Select at least one token to accept.'
  }

  // notes
  if (values.notes.length > 2000) {
    errors.notes = 'Notes must be 2000 characters or fewer.'
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
// â”€â”€â”€ Component â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function CreateInvoice() {
  const navigate = useNavigate()
  const createInvoice = useMerchantStore((s) => s.createInvoice)
  const wallets = useMerchantStore((s) => s.wallets)
  const fetchWallets = useMerchantStore((s) => s.fetchWallets)
  const onboardingStatus = useOnboardingStore((s) => s.status)
  const fetchOnboardingStatus = useOnboardingStore((s) => s.fetchStatus)

  const [prereqLoading, setPrereqLoading] = React.useState(wallets === null || onboardingStatus === null)

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

  const [values, setValues] = useState<FormValues>({
    customer_name: '',
    customer_email: '',
    due_date: '',
    line_items: [{ description: '', amount: '' }],
    accepted_tokens: [],
    notes: '',
  })
  const [errors, setErrors] = useState<FormErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  // â”€â”€â”€ Field setters â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  function setField<K extends keyof FormValues>(field: K, val: FormValues[K]) {
    setValues((prev) => ({ ...prev, [field]: val }))
    setErrors((prev) => ({ ...prev, [field]: undefined }))
  }

  // â”€â”€â”€ Line item helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  function updateLineItem(index: number, field: keyof LineItemRow, val: string) {
    setValues((prev) => {
      const updated = prev.line_items.map((item, i) =>
        i === index ? { ...item, [field]: val } : item,
      )
      return { ...prev, line_items: updated }
    })
    // Clear the specific line item field error
    setErrors((prev) => {
      if (!prev.line_items) return prev
      const updatedLineErrors = [...(prev.line_items ?? [])]
      if (updatedLineErrors[index]) {
        updatedLineErrors[index] = {
          ...updatedLineErrors[index],
          [field]: undefined,
        }
      }
      return { ...prev, line_items: updatedLineErrors }
    })
  }

  function addLineItem() {
    if (values.line_items.length >= 50) return
    setValues((prev) => ({
      ...prev,
      line_items: [...prev.line_items, { description: '', amount: '' }],
    }))
  }

  function removeLineItem(index: number) {
    if (values.line_items.length <= 1) return
    setValues((prev) => ({
      ...prev,
      line_items: prev.line_items.filter((_, i) => i !== index),
    }))
    setErrors((prev) => {
      if (!prev.line_items) return prev
      return {
        ...prev,
        line_items: prev.line_items.filter((_, i) => i !== index),
      }
    })
  }

  // â”€â”€â”€ Submit â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setServerError(null)

    const errs = validate(values)
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      return
    }

    setSubmitting(true)
    try {
      await createInvoice({
        customer_name: values.customer_name.trim(),
        customer_email: values.customer_email.trim(),
        due_date: values.due_date,
        accepted_tokens: values.accepted_tokens,
        line_items: values.line_items.map((item, idx) => ({
          description: item.description.trim(),
          amount: item.amount.trim(),
          sort_order: idx,
        })),
        ...(values.notes.trim() !== '' ? { notes: values.notes.trim() } : {}),
      })
      navigate('/dashboard/invoices')
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

  // ─── Pre-requisite checks ────────────────────────────────────────────────────

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
        description="You need to add and activate at least one payout wallet before creating an invoice."
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
            ? 'Your identity is being reviewed. Invoices will be available once verification is complete.'
            : 'You must complete identity verification before creating invoices.'
        }
        actionLabel="Complete Verification (Didit)"
        onAction={() => navigate('/onboarding?step=3')}
      />
    )
  }

  const runningTotal = computeRunningTotal(values.line_items)
  const notesRemaining = 2000 - values.notes.length

  // â”€â”€â”€ Render â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      {/* Page heading */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => navigate('/dashboard/invoices')}
          aria-label="Go back to invoices"
          className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1"
        >
          <svg
            className="h-5 w-5"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
        </button>
        <h1 className="text-2xl font-semibold text-slate-900">Create invoice</h1>
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

          {/* Customer name */}
          <Input
            label="Customer name"
            required
            placeholder="e.g. Jane Smith"
            value={values.customer_name}
            onChange={(e) => setField('customer_name', e.target.value)}
            error={errors.customer_name}
            disabled={submitting}
            maxLength={200}
          />

          {/* Customer email */}
          <Input
            label="Customer email"
            required
            type="email"
            placeholder="e.g. jane@example.com"
            value={values.customer_email}
            onChange={(e) => setField('customer_email', e.target.value)}
            error={errors.customer_email}
            disabled={submitting}
          />

          {/* Due date */}
          <Input
            label="Due date"
            required
            type="date"
            value={values.due_date}
            onChange={(e) => setField('due_date', e.target.value)}
            error={errors.due_date}
            disabled={submitting}
            min={todayISO()}
          />

          {/* Line items */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">
                Line items{' '}
                <span className="text-red-500" aria-hidden="true">
                  *
                </span>
              </span>
              <span className="text-xs text-slate-400">
                {values.line_items.length} / 50
              </span>
            </div>

            <div className="space-y-3">
              {values.line_items.map((item, idx) => {
                const lineErr = errors.line_items?.[idx]
                return (
                  <div key={idx} className="rounded-md border border-slate-200 p-3">
                    <div className="flex gap-3">
                      {/* Description */}
                      <div className="flex-1">
                        <Input
                          label={idx === 0 ? 'Description' : undefined}
                          placeholder="e.g. Design work"
                          value={item.description}
                          onChange={(e) =>
                            updateLineItem(idx, 'description', e.target.value)
                          }
                          error={lineErr?.description}
                          disabled={submitting}
                          maxLength={500}
                          aria-label={`Line item ${idx + 1} description`}
                        />
                      </div>

                      {/* Amount */}
                      <div className="w-40">
                        <Input
                          label={idx === 0 ? 'Amount ($ USD)' : undefined}
                          type="number"
                          inputMode="decimal"
                          min="0.01"
                          max="999999.99"
                          step="0.01"
                          placeholder="0.00"
                          value={item.amount}
                          onChange={(e) =>
                            updateLineItem(idx, 'amount', e.target.value)
                          }
                          error={lineErr?.amount}
                          disabled={submitting}
                          aria-label={`Line item ${idx + 1} amount in USD`}
                        />
                      </div>

                      {/* Remove button */}
                      <div className={idx === 0 ? 'mt-6' : 'mt-0 flex items-center'}>
                        <button
                          type="button"
                          onClick={() => removeLineItem(idx)}
                          disabled={submitting || values.line_items.length <= 1}
                          aria-label={`Remove line item ${idx + 1}`}
                          className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 focus:outline-none focus:ring-2 focus:ring-red-400 focus:ring-offset-1 disabled:pointer-events-none disabled:opacity-30"
                        >
                          <svg
                            className="h-4 w-4"
                            viewBox="0 0 20 20"
                            fill="currentColor"
                            aria-hidden="true"
                          >
                            <path
                              fillRule="evenodd"
                              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Add line item */}
            {values.line_items.length < 50 && (
              <button
                type="button"
                onClick={addLineItem}
                disabled={submitting}
                className="mt-2 text-sm text-slate-500 underline-offset-2 hover:text-slate-800 hover:underline disabled:pointer-events-none disabled:opacity-40"
              >
                + Add line item
              </button>
            )}

            {/* Running total */}
            <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
              <span className="text-xs text-slate-500">
                Invoices settle at the live crypto equivalent of the total USD amount upon checkout.
              </span>
              <p className="text-right text-sm font-medium text-slate-700">
                Total:{' '}
                <span className="text-base font-bold text-slate-900">${runningTotal} USD</span>
              </p>
            </div>
          </div>

          {/* Accepted tokens */}
          <TokenMultiSelect
            value={values.accepted_tokens}
            onChange={(tokens) => setField('accepted_tokens', tokens)}
            error={errors.accepted_tokens}
            disabled={submitting}
          allowedNetworks={activeWallets.map((w) => w.network)}
          />

          {/* Notes */}
          <div className="flex flex-col gap-1">
            <label
              htmlFor="invoice-notes"
              className="text-sm font-medium text-slate-700"
            >
              Notes
            </label>
            <textarea
              id="invoice-notes"
              value={values.notes}
              onChange={(e) => setField('notes', e.target.value)}
              disabled={submitting}
              maxLength={2000}
              rows={4}
              placeholder="Optional notes for the customerâ€¦"
              aria-describedby={errors.notes ? 'invoice-notes-error' : undefined}
              className={[
                'w-full rounded-md border px-3 py-2 text-sm text-slate-900 placeholder-slate-400',
                'transition-colors focus:outline-none focus:ring-2 focus:ring-offset-0',
                errors.notes
                  ? 'border-red-400 focus:border-red-500 focus:ring-red-400'
                  : 'border-slate-300 focus:border-slate-500 focus:ring-slate-400',
                submitting ? 'cursor-not-allowed bg-slate-50 text-slate-400' : 'bg-white',
              ].join(' ')}
            />
            <div className="flex items-center justify-between">
              {errors.notes ? (
                <p
                  id="invoice-notes-error"
                  className="text-xs text-red-600"
                  role="alert"
                >
                  {errors.notes}
                </p>
              ) : (
                <span />
              )}
              <p
                className={[
                  'text-xs',
                  notesRemaining < 100 ? 'text-yellow-600' : 'text-slate-400',
                ].join(' ')}
              >
                {notesRemaining} characters remaining
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center justify-end gap-3 border-t border-slate-100 pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => navigate('/dashboard/invoices')}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={submitting}>
              Create invoice
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}

