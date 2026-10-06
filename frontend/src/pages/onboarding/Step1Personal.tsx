import { useState, useEffect } from 'react'
import { useAuthStore } from '../../lib/auth-store'
import { useOnboardingStore } from '../../stores/onboardingStore'
import { submitOnboardingStep } from '../../services/merchant'
import { ApiError } from '../../services/errors'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { CountrySelect } from '../../components/onboarding/CountrySelect'

// ─── Validation ───────────────────────────────────────────────────────────────

function validateFullName(v: string): string | undefined {
  const trimmed = v.trim()
  if (trimmed.replace(/\s/g, '').length < 2)
    return 'Full name must contain at least 2 non-whitespace characters.'
  if (trimmed.length > 100) return 'Full name must not exceed 100 characters.'
  return undefined
}

function validateCountry(v: string): string | undefined {
  if (!v) return 'Please select a country.'
  return undefined
}

function validatePhone(v: string): string | undefined {
  if (!v) return 'Phone number is required.'
  if (!/^[0-9 +()\-]{4,15}$/.test(v))
    return 'Phone number must be 4–15 characters and contain only digits, spaces, hyphens, or parentheses.'
  return undefined
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface FormValues {
  full_name: string
  country: string
  dialCode: string
  phone_number: string
}

interface FormErrors {
  full_name?: string
  country?: string
  phone_number?: string
  form?: string
}

// ─── Component ────────────────────────────────────────────────────────────────

export function Step1Personal() {
  const user = useAuthStore((state) => state.user)
  const saveFormData = useOnboardingStore((state) => state.saveFormData)
  const setStep = useOnboardingStore((state) => state.setStep)
  const status = useOnboardingStore((state) => state.status)
  const persistedData = useOnboardingStore((state) => state.formData[1]) as
    | Partial<FormValues>
    | undefined

  // Initialise from persisted store data or server status
  const [values, setValues] = useState<FormValues>(() => ({
    full_name: persistedData?.full_name || status?.full_name || '',
    country: persistedData?.country || status?.country || '',
    dialCode: persistedData?.dialCode || '',
    phone_number: persistedData?.phone_number || status?.phone_number || '',
  }))

  const [errors, setErrors] = useState<FormErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Sync with status if status was loaded after component mount
  useEffect(() => {
    if (status) {
      setValues((prev) => ({
        full_name: prev.full_name || status.full_name || '',
        country: prev.country || status.country || '',
        dialCode: prev.dialCode || '',
        phone_number: prev.phone_number || status.phone_number || '',
      }))
    }
  }, [status])

  // ─── Handlers ───────────────────────────────────────────────────────────────

  function handleFieldChange<K extends keyof FormValues>(
    field: K,
    value: FormValues[K],
  ) {
    setValues((prev) => ({ ...prev, [field]: value }))
    // Clear field error on change
    if (errors[field as keyof FormErrors]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }))
    }
  }

  function handleCountryChange(country: string, dialCode: string) {
    setValues((prev) => ({ ...prev, country, dialCode }))
    if (errors.country) {
      setErrors((prev) => ({ ...prev, country: undefined }))
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    // Run all validations
    const fieldErrors: FormErrors = {
      full_name: validateFullName(values.full_name),
      country: validateCountry(values.country),
      phone_number: validatePhone(values.phone_number),
    }

    const hasErrors = Object.values(fieldErrors).some(Boolean)
    if (hasErrors) {
      setErrors(fieldErrors)
      return
    }

    setErrors({})
    setIsSubmitting(true)

    try {
      await submitOnboardingStep(1, {
        full_name: values.full_name.trim(),
        country: values.country,
        phone_number: values.phone_number,
      })

      // Persist to store and advance
      saveFormData(1, {
        full_name: values.full_name.trim(),
        country: values.country,
        dialCode: values.dialCode,
        phone_number: values.phone_number,
      })
      setStep(2)
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors({ form: err.detail })
      } else {
        setErrors({ form: 'Something went wrong. Please try again.' })
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">
          Personal Information
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Tell us a bit about yourself to get started.
        </p>
      </div>

      {status?.personal_info_status === 'rejected' && status?.personal_info_rejection_reason && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3.5 text-sm text-red-800" role="alert">
          <div className="flex items-start gap-2.5">
            <svg className="h-5 w-5 shrink-0 text-red-600 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
            </svg>
            <div>
              <p className="font-semibold text-red-900">Correction Required by Admin</p>
              <p className="mt-0.5 text-xs text-red-700">{status.personal_info_rejection_reason}</p>
            </div>
          </div>
        </div>
      )}

      {/* Full Name */}
      <Input
        label="Full Name"
        id="step1-full-name"
        type="text"
        autoComplete="name"
        placeholder="Your full name"
        value={values.full_name}
        onChange={(e) => handleFieldChange('full_name', e.target.value)}
        error={errors.full_name}
        required
        disabled={isSubmitting}
      />

      {/* Email — read-only */}
      <Input
        label="Email"
        id="step1-email"
        type="email"
        autoComplete="email"
        value={user?.email ?? ''}
        readOnly
        disabled
        helperText="Your email address cannot be changed."
      />

      {/* Country */}
      <CountrySelect
        label="Country"
        value={values.country}
        onChange={handleCountryChange}
        error={errors.country}
        required
        disabled={isSubmitting}
      />

      {/* Phone number with dial code prefix */}
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium text-slate-700">
          Phone Number
          <span className="ml-1 text-red-500" aria-hidden="true">
            *
          </span>
        </label>
        <div className="flex">
          {/* Dial code prefix */}
          <span
            aria-hidden="true"
            className={[
              'inline-flex items-center rounded-l-md border border-r-0 px-3 py-2 text-sm',
              'border-slate-300 bg-slate-50 text-slate-500 select-none',
              errors.phone_number ? 'border-red-400' : '',
            ].join(' ')}
          >
            {values.dialCode || '–'}
          </span>

          {/* Phone input */}
          <input
            id="step1-phone"
            type="tel"
            autoComplete="tel-national"
            placeholder="e.g. 812 345 6789"
            value={values.phone_number}
            disabled={isSubmitting}
            aria-required
            aria-invalid={!!errors.phone_number}
            aria-describedby={
              errors.phone_number ? 'step1-phone-error' : undefined
            }
            onChange={(e) => {
              handleFieldChange('phone_number', e.target.value)
            }}
            className={[
              'flex-1 min-w-0 rounded-r-md border px-3 py-2 text-sm text-slate-900 placeholder-slate-400',
              'transition-colors focus:outline-none focus:ring-2 focus:ring-offset-0',
              errors.phone_number
                ? 'border-red-400 focus:border-red-500 focus:ring-red-400'
                : 'border-slate-300 focus:border-slate-500 focus:ring-slate-400',
              isSubmitting
                ? 'cursor-not-allowed bg-slate-50 text-slate-400'
                : 'bg-white',
            ].join(' ')}
          />
        </div>
        {errors.phone_number && (
          <p
            id="step1-phone-error"
            className="text-xs text-red-600"
            role="alert"
          >
            {errors.phone_number}
          </p>
        )}
      </div>

      {/* Form-level server error */}
      {errors.form && (
        <p
          className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700"
          role="alert"
        >
          {errors.form}
        </p>
      )}

      <Button
        type="submit"
        className="mt-2 w-full"
        size="lg"
        loading={isSubmitting}
      >
        Continue
      </Button>
    </form>
  )
}
