import React, { useState } from 'react'
import { apiClient } from '../../lib/api'
import { Button } from '../ui/Button'
import { Card } from '../ui/Card'
import { Input } from '../ui/Input'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface VerificationResponse {
  id: string
  status: 'pending' | 'approved' | 'rejected'
  full_legal_name: string
  country: string
  business_type: string
  website_url: string
  intended_use: string
  created_at: string
}

interface VerificationRequestFormProps {
  onSuccess: (data: VerificationResponse) => void
}

interface FormValues {
  full_legal_name: string
  country: string
  business_type: string
  website_url: string
  intended_use: string
}

interface FormErrors {
  full_legal_name?: string
  country?: string
  business_type?: string
  website_url?: string
  intended_use?: string
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const COUNTRIES = [
  'United States',
  'United Kingdom',
  'Canada',
  'Germany',
  'France',
  'Australia',
  'India',
  'Nigeria',
  'Brazil',
  'Japan',
  'Singapore',
  'South Africa',
  'Other',
]

const BUSINESS_TYPES = [
  'Individual / Freelancer',
  'Sole Proprietor',
  'LLC / Limited Company',
  'Corporation',
  'Partnership',
  'Non-Profit',
  'Other',
]

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validate(values: FormValues): FormErrors {
  const errors: FormErrors = {}

  if (!values.full_legal_name.trim()) {
    errors.full_legal_name = 'Full legal name is required.'
  } else if (values.full_legal_name.trim().length > 200) {
    errors.full_legal_name = 'Full legal name must be 200 characters or fewer.'
  }

  if (!values.country) {
    errors.country = 'Please select a country.'
  }

  if (!values.business_type) {
    errors.business_type = 'Please select a business type.'
  }

  if (!values.website_url.trim()) {
    errors.website_url = 'Website URL is required.'
  } else if (!/^https?:\/\/.+/.test(values.website_url.trim())) {
    errors.website_url = 'Website URL must start with http:// or https://.'
  }

  if (!values.intended_use.trim()) {
    errors.intended_use = 'Intended use is required.'
  } else if (values.intended_use.trim().length < 50) {
    errors.intended_use = 'Intended use must be at least 50 characters.'
  } else if (values.intended_use.length > 500) {
    errors.intended_use = 'Intended use must be 500 characters or fewer.'
  }

  return errors
}

// ---------------------------------------------------------------------------
// Styled select (matches Input component styling)
// ---------------------------------------------------------------------------

interface StyledSelectProps {
  label: string
  id: string
  value: string
  onChange: (value: string) => void
  onBlur: () => void
  error?: string
  required?: boolean
  placeholder: string
  options: string[]
}

function StyledSelect({
  label,
  id,
  value,
  onChange,
  onBlur,
  error,
  required,
  placeholder,
  options,
}: StyledSelectProps) {
  const errorId = `${id}-error`

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        {label}
        {required && (
          <span className="ml-1 text-red-500" aria-hidden="true">
            *
          </span>
        )}
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        required={required}
        aria-invalid={!!error}
        aria-describedby={error ? errorId : undefined}
        className={[
          'w-full rounded-md border px-3 py-2 text-sm text-slate-900',
          'transition-colors focus:outline-none focus:ring-2 focus:ring-offset-0',
          'bg-white',
          error
            ? 'border-red-400 focus:border-red-500 focus:ring-red-400'
            : 'border-slate-300 focus:border-slate-500 focus:ring-slate-400',
          !value ? 'text-slate-400' : 'text-slate-900',
        ].join(' ')}
      >
        <option value="" disabled>
          {placeholder}
        </option>
        {options.map((opt) => (
          <option key={opt} value={opt}>
            {opt}
          </option>
        ))}
      </select>
      {error && (
        <p id={errorId} className="text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function VerificationRequestForm({ onSuccess }: VerificationRequestFormProps) {
  const [values, setValues] = useState<FormValues>({
    full_legal_name: '',
    country: '',
    business_type: '',
    website_url: '',
    intended_use: '',
  })
  const [errors, setErrors] = useState<FormErrors>({})
  const [touched, setTouched] = useState<Partial<Record<keyof FormValues, boolean>>>({})
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const charCount = values.intended_use.length

  // Validate a single field on blur
  function handleBlur(field: keyof FormValues) {
    setTouched((prev) => ({ ...prev, [field]: true }))
    const fieldErrors = validate(values)
    setErrors((prev) => ({ ...prev, [field]: fieldErrors[field] }))
  }

  function handleChange(field: keyof FormValues, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }))
    // Clear error as user corrects the field
    if (touched[field]) {
      const updated = { ...values, [field]: value }
      const fieldErrors = validate(updated)
      setErrors((prev) => ({ ...prev, [field]: fieldErrors[field] }))
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setFormError(null)

    // Mark all fields touched and run full validation
    setTouched({
      full_legal_name: true,
      country: true,
      business_type: true,
      website_url: true,
      intended_use: true,
    })

    const allErrors = validate(values)
    setErrors(allErrors)

    if (Object.keys(allErrors).length > 0) {
      return
    }

    setSubmitting(true)
    try {
      const { data } = await apiClient.post<VerificationResponse>(
        '/verification/requests',
        {
          full_legal_name: values.full_legal_name.trim(),
          country: values.country,
          business_type: values.business_type,
          website_url: values.website_url.trim(),
          intended_use: values.intended_use.trim(),
        },
      )
      onSuccess(data)
    } catch (err: unknown) {
      const error = err as { response?: { status?: number; data?: { detail?: string } } }
      const status = error?.response?.status

      if (status === 409) {
        setFormError('You already have an active verification request.')
      } else if (status === 400) {
        const detail = error?.response?.data?.detail
        setFormError(
          typeof detail === 'string'
            ? detail
            : 'Invalid submission. Please check your inputs.',
        )
      } else {
        setFormError('Something went wrong. Please try again.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const counterRed = charCount < 50 || charCount >= 500

  return (
    <div className="max-w-2xl">
      {/* Section description */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-slate-900">Developer Verification</h1>
        <p className="mt-1 text-sm text-slate-500">
          Submit your identity and business information to unlock live-mode API access.
          All fields are required and will be reviewed by the Lenis team.
        </p>
      </div>

      <Card title="Developer Verification">
        <form
          onSubmit={handleSubmit}
          noValidate
          className="flex flex-col gap-5"
          aria-label="Developer verification request form"
        >
          {/* Full legal name */}
          <Input
            label="Full legal name"
            id="full_legal_name"
            value={values.full_legal_name}
            onChange={(e) => handleChange('full_legal_name', e.target.value)}
            onBlur={() => handleBlur('full_legal_name')}
            error={touched.full_legal_name ? errors.full_legal_name : undefined}
            maxLength={200}
            required
            placeholder="As it appears on your government-issued ID"
          />

          {/* Country */}
          <StyledSelect
            label="Country"
            id="country"
            value={values.country}
            onChange={(val) => handleChange('country', val)}
            onBlur={() => handleBlur('country')}
            error={touched.country ? errors.country : undefined}
            required
            placeholder="Select a country"
            options={COUNTRIES}
          />

          {/* Business type */}
          <StyledSelect
            label="Business type"
            id="business_type"
            value={values.business_type}
            onChange={(val) => handleChange('business_type', val)}
            onBlur={() => handleBlur('business_type')}
            error={touched.business_type ? errors.business_type : undefined}
            required
            placeholder="Select a business type"
            options={BUSINESS_TYPES}
          />

          {/* Website URL */}
          <Input
            label="Website URL"
            id="website_url"
            type="url"
            value={values.website_url}
            onChange={(e) => handleChange('website_url', e.target.value)}
            onBlur={() => handleBlur('website_url')}
            error={touched.website_url ? errors.website_url : undefined}
            required
            placeholder="https://yourwebsite.com"
            helperText="Must start with http:// or https://"
          />

          {/* Intended use */}
          <div className="flex flex-col gap-1">
            <label htmlFor="intended_use" className="text-sm font-medium text-slate-700">
              Intended use
              <span className="ml-1 text-red-500" aria-hidden="true">
                *
              </span>
            </label>
            <textarea
              id="intended_use"
              value={values.intended_use}
              onChange={(e) => handleChange('intended_use', e.target.value)}
              onBlur={() => handleBlur('intended_use')}
              maxLength={500}
              required
              rows={5}
              aria-invalid={!!(touched.intended_use && errors.intended_use)}
              aria-describedby={
                touched.intended_use && errors.intended_use
                  ? 'intended_use-error'
                  : 'intended_use-counter'
              }
              placeholder="Describe how you plan to use the Lenis API in your application or business..."
              className={[
                'w-full resize-none rounded-md border px-3 py-2 text-sm text-slate-900',
                'placeholder-slate-400 transition-colors',
                'focus:outline-none focus:ring-2 focus:ring-offset-0',
                'bg-white min-h-[120px]',
                touched.intended_use && errors.intended_use
                  ? 'border-red-400 focus:border-red-500 focus:ring-red-400'
                  : 'border-slate-300 focus:border-slate-500 focus:ring-slate-400',
              ].join(' ')}
            />
            <div className="flex items-start justify-between gap-2">
              {touched.intended_use && errors.intended_use ? (
                <p id="intended_use-error" className="text-xs text-red-600" role="alert">
                  {errors.intended_use}
                </p>
              ) : (
                <span />
              )}
              <p
                id="intended_use-counter"
                className={[
                  'shrink-0 text-xs tabular-nums',
                  counterRed ? 'text-red-600' : 'text-slate-400',
                ].join(' ')}
                aria-live="polite"
                aria-atomic="true"
              >
                {charCount}/500
              </p>
            </div>
          </div>

          {/* Form-level error */}
          {formError && (
            <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
              {formError}
            </p>
          )}

          {/* Submit */}
          <Button
            type="submit"
            variant="primary"
            size="lg"
            loading={submitting}
            className="w-full"
          >
            Submit verification request
          </Button>
        </form>
      </Card>
    </div>
  )
}
