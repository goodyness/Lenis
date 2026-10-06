import { useState, FormEvent, ChangeEvent } from 'react'
import { SEOMeta } from '../../components/seo/SEOMeta'
import { apiClient } from '../../lib/api'
import { AxiosError } from 'axios'

// ── Types ─────────────────────────────────────────────────────────────────────

interface FormFields {
  name: string
  email: string
  message: string
}

interface FieldErrors {
  name?: string
  email?: string
  message?: string
  general?: string
}

// FastAPI 422 validation error shape
interface FastAPIValidationError {
  detail: Array<{
    loc: string[]
    msg: string
    type: string
  }>
}

// Custom validation error shape
interface APIValidationError {
  error: string
  message: string
}

// ── Constants ─────────────────────────────────────────────────────────────────

const INITIAL_FIELDS: FormFields = { name: '', email: '', message: '' }
const INITIAL_ERRORS: FieldErrors = {}

// ── Helpers ───────────────────────────────────────────────────────────────────

function validateEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

function clientValidate(fields: FormFields): FieldErrors {
  const errors: FieldErrors = {}
  if (!fields.name.trim()) {
    errors.name = 'Name is required.'
  } else if (fields.name.trim().length > 100) {
    errors.name = 'Name must be 100 characters or fewer.'
  }
  if (!fields.email.trim()) {
    errors.email = 'Email address is required.'
  } else if (!validateEmail(fields.email.trim())) {
    errors.email = 'Enter a valid email address.'
  }
  if (!fields.message.trim()) {
    errors.message = 'Message is required.'
  } else if (fields.message.trim().length > 2000) {
    errors.message = 'Message must be 2,000 characters or fewer.'
  }
  return errors
}

function parseServerErrors(data: unknown): FieldErrors {
  const errors: FieldErrors = {}

  // FastAPI 422 shape: { detail: [{ loc: [...], msg: "..." }] }
  const fapiData = data as Partial<FastAPIValidationError>
  if (Array.isArray(fapiData?.detail)) {
    for (const item of fapiData.detail) {
      const field = item.loc?.[item.loc.length - 1] as string | undefined
      if (field === 'name') errors.name = item.msg
      else if (field === 'email') errors.email = item.msg
      else if (field === 'message') errors.message = item.msg
      else errors.general = item.msg
    }
    if (Object.keys(errors).length > 0) return errors
  }

  // Custom shape: { error: "...", message: "..." }
  const customData = data as Partial<APIValidationError>
  if (customData?.message) {
    errors.general = customData.message
  }

  errors.general = errors.general ?? 'Please check the highlighted fields and try again.'
  return errors
}

// ── Input field component ─────────────────────────────────────────────────────

interface InputFieldProps {
  id: string
  label: string
  type?: string
  value: string
  error?: string
  maxLength?: number
  onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void
  multiline?: boolean
  rows?: number
  autoComplete?: string
}

function InputField({
  id,
  label,
  type = 'text',
  value,
  error,
  maxLength,
  onChange,
  multiline = false,
  rows = 5,
  autoComplete,
}: InputFieldProps) {
  const hasError = Boolean(error)
  const baseInputClass =
    'block w-full rounded-md border px-3.5 py-2.5 text-sm text-slate-900 placeholder-slate-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-0'
  const stateClass = hasError
    ? 'border-red-400 bg-red-50 focus:border-red-500 focus:ring-red-400'
    : 'border-slate-300 bg-white focus:border-slate-500 focus:ring-slate-400'

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-sm font-medium text-slate-900">
        {label}
      </label>
      {multiline ? (
        <textarea
          id={id}
          name={id}
          value={value}
          onChange={onChange}
          rows={rows}
          maxLength={maxLength}
          aria-invalid={hasError}
          aria-describedby={hasError ? `${id}-error` : undefined}
          className={`${baseInputClass} ${stateClass} resize-y`}
        />
      ) : (
        <input
          id={id}
          name={id}
          type={type}
          value={value}
          onChange={onChange}
          maxLength={maxLength}
          autoComplete={autoComplete}
          aria-invalid={hasError}
          aria-describedby={hasError ? `${id}-error` : undefined}
          className={`${baseInputClass} ${stateClass}`}
        />
      )}
      {hasError && (
        <p id={`${id}-error`} className="mt-1.5 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ContactPage() {
  const [fields, setFields] = useState<FormFields>(INITIAL_FIELDS)
  const [errors, setErrors] = useState<FieldErrors>(INITIAL_ERRORS)
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  function handleChange(e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) {
    const { name, value } = e.target
    setFields((prev) => ({ ...prev, [name]: value }))
    // Clear the field-level error as the user types
    if (errors[name as keyof FieldErrors]) {
      setErrors((prev) => ({ ...prev, [name]: undefined }))
    }
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault()

    const clientErrors = clientValidate(fields)
    if (Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors)
      return
    }

    setErrors(INITIAL_ERRORS)
    setSubmitting(true)

    try {
      await apiClient.post('/v1/contact', {
        name: fields.name.trim(),
        email: fields.email.trim(),
        message: fields.message.trim(),
      })
      setSubmitted(true)
      setFields(INITIAL_FIELDS)
    } catch (err) {
      const axiosError = err as AxiosError
      if (axiosError.response?.status === 422) {
        const serverErrors = parseServerErrors(axiosError.response.data)
        setErrors({
          ...serverErrors,
          general: serverErrors.general ?? 'Please check the highlighted fields and try again.',
        })
      } else {
        setErrors({
          general: 'Something went wrong. Please try again in a moment.',
        })
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <>
      <SEOMeta
        title="Contact Us — Lenis"
        description="Get in touch with the Lenis team. We respond to all inquiries within 48 hours."
        ogTitle="Contact Us — Lenis"
        ogDescription="Get in touch with the Lenis team. We respond to all inquiries within 48 hours."
      />

      {/* ── Hero ── */}
      <section className="bg-slate-50 py-16 text-center">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Get in touch
          </h1>
          <p className="mt-3 text-lg text-slate-600">
            We'd love to hear from you. Send us a message and we'll respond as soon as possible.
          </p>
        </div>
      </section>

      {/* ── Form / Success ── */}
      <section
        className="bg-white px-4 py-16 sm:px-6 lg:px-8"
        aria-labelledby="contact-form-heading"
      >
        <div className="mx-auto max-w-xl">
          <h2 id="contact-form-heading" className="sr-only">
            Contact form
          </h2>

          {submitted ? (
            <div
              className="rounded-xl border border-green-200 bg-green-50 p-8 text-center"
              role="alert"
              aria-live="polite"
            >
              <div
                className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100"
                aria-hidden="true"
              >
                <svg
                  className="h-6 w-6 text-green-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                  aria-hidden="true"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="mb-2 text-lg font-semibold text-green-900">Message sent!</h3>
              <p className="text-sm text-green-700">
                Thanks for reaching out. We'll get back to you within 48 hours.
              </p>
              <button
                type="button"
                onClick={() => setSubmitted(false)}
                className="mt-6 text-sm font-medium text-green-800 underline underline-offset-4 hover:text-green-900"
              >
                Send another message
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} noValidate aria-label="Contact form">
              {errors.general && (
                <div
                  className="mb-6 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                  role="alert"
                  aria-live="polite"
                >
                  {errors.general}
                </div>
              )}

              <div className="space-y-5">
                <InputField
                  id="name"
                  label="Full name"
                  value={fields.name}
                  error={errors.name}
                  maxLength={100}
                  onChange={handleChange}
                  autoComplete="name"
                />

                <InputField
                  id="email"
                  label="Email address"
                  type="email"
                  value={fields.email}
                  error={errors.email}
                  onChange={handleChange}
                  autoComplete="email"
                />

                <div>
                  <InputField
                    id="message"
                    label="Message"
                    value={fields.message}
                    error={errors.message}
                    maxLength={2000}
                    onChange={handleChange}
                    multiline
                    rows={6}
                  />
                  <p className="mt-1.5 text-right text-xs text-slate-400" aria-live="polite">
                    {fields.message.length} / 2,000
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex w-full items-center justify-center rounded-md bg-slate-900 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? 'Sending…' : 'Send message'}
                </button>
              </div>
            </form>
          )}
        </div>
      </section>

      {/* ── Alternative contact info ── */}
      <section
        className="bg-slate-50 px-4 py-16 sm:px-6 lg:px-8"
        aria-labelledby="contact-info-heading"
      >
        <div className="mx-auto max-w-xl">
          <h2
            id="contact-info-heading"
            className="mb-6 text-xl font-semibold text-slate-900"
          >
            Other ways to reach us
          </h2>
          <dl className="space-y-4">
            <div>
              <dt className="text-sm font-medium text-slate-900">General inquiries</dt>
              <dd className="mt-0.5 text-sm text-slate-600">hello@lenis.io</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-slate-900">Developer support</dt>
              <dd className="mt-0.5 text-sm text-slate-600">developers@lenis.io</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-slate-900">Security disclosures</dt>
              <dd className="mt-0.5 text-sm text-slate-600">security@lenis.io</dd>
            </div>
          </dl>
        </div>
      </section>
    </>
  )
}
