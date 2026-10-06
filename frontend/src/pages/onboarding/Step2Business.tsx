import { useState, useEffect } from 'react'
import { useOnboardingStore } from '../../stores/onboardingStore'
import { submitOnboardingStep } from '../../services/merchant'
import { ApiError } from '../../services/errors'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { FileUpload } from '../../components/onboarding/FileUpload'

// ─── Validation ───────────────────────────────────────────────────────────────

function validateBusinessName(v: string): string | undefined {
  const trimmed = v.trim()
  if (trimmed.length < 2)
    return 'Business name must be at least 2 characters after trimming.'
  if (trimmed.length > 200)
    return 'Business name must not exceed 200 characters.'
  return undefined
}

function validateBusinessAddress(v: string): string | undefined {
  const trimmed = v.trim()
  if (trimmed.length < 3)
    return 'Physical business address is required (at least 3 characters).'
  if (trimmed.length > 300)
    return 'Physical business address must not exceed 300 characters.'
  return undefined
}

function validateBusinessDescription(v: string): string | undefined {
  const trimmed = v.trim()
  if (trimmed.length < 5)
    return 'Business description is required (at least 5 characters).'
  if (trimmed.length > 1000)
    return 'Business description must not exceed 1000 characters.'
  return undefined
}

function validateWebsiteUrl(v: string): string | undefined {
  if (!v) return undefined // optional field
  if (!/^https?:\/\/.+/.test(v) || v.replace(/^https?:\/\//, '').length === 0)
    return 'Website URL must start with http:// or https:// and include a valid host.'
  return undefined
}

function validateSocialHandles(handles: SocialHandles): string | undefined {
  const hasAtLeastOne = Object.values(handles).some(
    (h) => h.trim().length > 0,
  )
  if (!hasAtLeastOne)
    return 'At least one social media handle is required.'
  return undefined
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface SocialHandles {
  instagram: string
  twitter: string
  facebook: string
  linkedin: string
  tiktok: string
}

interface FormValues {
  business_name: string
  business_category: string
  monthly_volume_estimate: string
  business_address: string
  business_description: string
  website_url: string
  social_handles: SocialHandles
  is_registered_business: boolean
}

interface FormErrors {
  business_name?: string
  business_category?: string
  monthly_volume_estimate?: string
  business_address?: string
  business_description?: string
  website_url?: string
  social_handles?: string
  registration_doc?: string
  form?: string
}

const CATEGORY_OPTIONS = [
  'E-Commerce & Retail',
  'Digital Goods & Software (SaaS)',
  'Gaming & Virtual Goods',
  'Professional Services & Consulting',
  'Creator & Content Monetization',
  'Crypto / Web3 Native',
  'Other / General Merchandise',
]

const VOLUME_OPTIONS = [
  'Under $5,000 / month',
  '$5,000 – $25,000 / month',
  '$25,000 – $100,000 / month',
  '$100,000+ / month',
]

const SOCIAL_FIELDS: { key: keyof SocialHandles; label: string; placeholder: string }[] =
  [
    { key: 'instagram', label: 'Instagram', placeholder: '@yourbusiness' },
    { key: 'twitter', label: 'Twitter / X', placeholder: '@yourbusiness' },
    { key: 'facebook', label: 'Facebook', placeholder: 'yourbusiness' },
    { key: 'linkedin', label: 'LinkedIn', placeholder: 'yourbusiness' },
    { key: 'tiktok', label: 'TikTok', placeholder: '@yourbusiness' },
  ]

// ─── Component ────────────────────────────────────────────────────────────────

export function Step2Business() {
  const saveFormData = useOnboardingStore((state) => state.saveFormData)
  const setStep = useOnboardingStore((state) => state.setStep)
  const status = useOnboardingStore((state) => state.status)
  const persistedData = useOnboardingStore((state) => state.formData[2]) as
    | Partial<FormValues>
    | undefined

  // Initialise from persisted store data or server status
  const [values, setValues] = useState<FormValues>(() => ({
    business_name: persistedData?.business_name || status?.business_name || '',
    business_category: persistedData?.business_category || status?.business_category || CATEGORY_OPTIONS[0],
    monthly_volume_estimate: persistedData?.monthly_volume_estimate || status?.monthly_volume_estimate || VOLUME_OPTIONS[0],
    business_address: persistedData?.business_address || status?.business_address || '',
    business_description: persistedData?.business_description || status?.business_description || '',
    website_url: persistedData?.website_url || status?.website_url || '',
    social_handles: persistedData?.social_handles ?? {
      instagram: status?.social_instagram || '',
      twitter: status?.social_twitter || '',
      facebook: status?.social_facebook || '',
      linkedin: status?.social_linkedin || '',
      tiktok: status?.social_tiktok || '',
    },
    is_registered_business:
      persistedData?.is_registered_business ??
      status?.is_registered_business ??
      false,
  }))

  const [errors, setErrors] = useState<FormErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Sync with status if loaded asynchronously
  useEffect(() => {
    if (status) {
      setValues((prev) => ({
        business_name: prev.business_name || status.business_name || '',
        business_category: prev.business_category || status.business_category || CATEGORY_OPTIONS[0],
        monthly_volume_estimate: prev.monthly_volume_estimate || status.monthly_volume_estimate || VOLUME_OPTIONS[0],
        business_address: prev.business_address || status.business_address || '',
        business_description: prev.business_description || status.business_description || '',
        website_url: prev.website_url || status.website_url || '',
        social_handles: {
          instagram: prev.social_handles.instagram || status.social_instagram || '',
          twitter: prev.social_handles.twitter || status.social_twitter || '',
          facebook: prev.social_handles.facebook || status.social_facebook || '',
          linkedin: prev.social_handles.linkedin || status.social_linkedin || '',
          tiktok: prev.social_handles.tiktok || status.social_tiktok || '',
        },
        is_registered_business:
          prev.is_registered_business || status.is_registered_business || false,
      }))
    }
  }, [status])

  // File state — stored separately from form values since File objects
  // cannot be serialised to the Zustand store
  const [registrationDoc, setRegistrationDoc] = useState<File | null>(null)

  // Key used to force-remount FileUpload, clearing its internal state
  // when the toggle is flipped back to false (Req 3.8)
  const [fileUploadKey, setFileUploadKey] = useState(0)

  // ─── Handlers ───────────────────────────────────────────────────────────────

  function handleTextChange(field: keyof Omit<FormValues, 'social_handles' | 'is_registered_business'>, value: string) {
    setValues((prev) => ({ ...prev, [field]: value }))
    if (errors[field as keyof FormErrors]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }))
    }
  }

  function handleSocialChange(key: keyof SocialHandles, value: string) {
    setValues((prev) => ({
      ...prev,
      social_handles: { ...prev.social_handles, [key]: value },
    }))
    if (errors.social_handles) {
      setErrors((prev) => ({ ...prev, social_handles: undefined }))
    }
  }

  function handleToggleChange(checked: boolean) {
    setValues((prev) => ({ ...prev, is_registered_business: checked }))

    if (!checked) {
      // Clear file selection when toggled back to false (Req 3.8)
      setRegistrationDoc(null)
      setFileUploadKey((k) => k + 1)
      setErrors((prev) => ({ ...prev, registration_doc: undefined }))
    }
  }

  function handleFileSelect(file: File) {
    setRegistrationDoc(file)
    setErrors((prev) => ({ ...prev, registration_doc: undefined }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    // Run all validations
    const fieldErrors: FormErrors = {
      business_name: validateBusinessName(values.business_name),
      business_address: validateBusinessAddress(values.business_address),
      business_description: validateBusinessDescription(values.business_description),
      website_url: validateWebsiteUrl(values.website_url),
      social_handles: validateSocialHandles(values.social_handles),
      registration_doc:
        values.is_registered_business && !registrationDoc && !status?.has_registration_doc
          ? 'Business registration document is required.'
          : undefined,
    }

    const hasErrors = Object.values(fieldErrors).some(Boolean)
    if (hasErrors) {
      setErrors(fieldErrors)
      return
    }

    setErrors({})
    setIsSubmitting(true)

    try {
      // Build multipart/form-data (required for file upload — Req 3.13)
      const formData = new FormData()
      formData.append('business_name', values.business_name.trim())
      if (values.business_category) formData.append('business_category', values.business_category)
      if (values.monthly_volume_estimate) formData.append('monthly_volume_estimate', values.monthly_volume_estimate)
      if (values.business_address) formData.append('business_address', values.business_address.trim())
      if (values.business_description) formData.append('business_description', values.business_description.trim())
      if (values.website_url) {
        formData.append('website_url', values.website_url)
      }
      formData.append('is_registered_business', String(values.is_registered_business))

      // Append social handles
      const { instagram, twitter, facebook, linkedin, tiktok } = values.social_handles
      if (instagram) formData.append('social_instagram', instagram)
      if (twitter) formData.append('social_twitter', twitter)
      if (facebook) formData.append('social_facebook', facebook)
      if (linkedin) formData.append('social_linkedin', linkedin)
      if (tiktok) formData.append('social_tiktok', tiktok)

      // Append registration document if provided
      if (registrationDoc) {
        formData.append('registration_doc', registrationDoc)
      }

      await submitOnboardingStep(2, formData)

      // Persist non-file data to store and advance
      saveFormData(2, {
        business_name: values.business_name.trim(),
        business_category: values.business_category,
        monthly_volume_estimate: values.monthly_volume_estimate,
        business_address: values.business_address,
        business_description: values.business_description,
        website_url: values.website_url,
        social_handles: values.social_handles,
        is_registered_business: values.is_registered_business,
      })
      setStep(3)
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
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-900">
          Business Information
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Tell us about your business so customers and admins can identify your
          organisation.
        </p>
      </div>

      {status?.business_info_status === 'rejected' && status?.business_info_rejection_reason && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3.5 text-sm text-red-800" role="alert">
          <div className="flex items-start gap-2.5">
            <svg className="h-5 w-5 shrink-0 text-red-600 mt-0.5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
            </svg>
            <div>
              <p className="font-semibold text-red-900">Correction Required by Admin</p>
              <p className="mt-0.5 text-xs text-red-700">{status.business_info_rejection_reason}</p>
            </div>
          </div>
        </div>
      )}

      {/* Business Name */}
      <Input
        label="Business Name"
        id="step2-business-name"
        type="text"
        autoComplete="organization"
        placeholder="Your business or trade name"
        value={values.business_name}
        onChange={(e) => handleTextChange('business_name', e.target.value)}
        error={errors.business_name}
        required
        disabled={isSubmitting}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Business Category */}
        <div className="flex flex-col gap-1">
          <label htmlFor="step2-category" className="text-sm font-medium text-slate-700">
            Business Category
          </label>
          <select
            id="step2-category"
            value={values.business_category}
            onChange={(e) => handleTextChange('business_category', e.target.value)}
            disabled={isSubmitting}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-400"
          >
            {CATEGORY_OPTIONS.map((cat) => (
              <option key={cat} value={cat}>
                {cat}
              </option>
            ))}
          </select>
        </div>

        {/* Monthly Volume Estimate */}
        <div className="flex flex-col gap-1">
          <label htmlFor="step2-volume" className="text-sm font-medium text-slate-700">
            Estimated Monthly Volume
          </label>
          <select
            id="step2-volume"
            value={values.monthly_volume_estimate}
            onChange={(e) => handleTextChange('monthly_volume_estimate', e.target.value)}
            disabled={isSubmitting}
            className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-400"
          >
            {VOLUME_OPTIONS.map((vol) => (
              <option key={vol} value={vol}>
                {vol}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Business Address */}
      <Input
        label="Physical Business / Operating Address"
        id="step2-address"
        type="text"
        placeholder="123 Commerce Way, Suite 400, City, Country"
        value={values.business_address}
        onChange={(e) => handleTextChange('business_address', e.target.value)}
        error={errors.business_address}
        required
        disabled={isSubmitting}
        helperText="Physical headquarters or primary operating address."
      />

      {/* Business Description */}
      <div className="flex flex-col gap-1">
        <label htmlFor="step2-description" className="text-sm font-medium text-slate-700">
          Business / Product Description
          <span className="ml-1 text-red-500" aria-hidden="true">
            *
          </span>
        </label>
        <textarea
          id="step2-description"
          rows={3}
          maxLength={1000}
          required
          placeholder="Briefly describe what products, services, or digital goods your business provides to customers…"
          value={values.business_description}
          onChange={(e) => handleTextChange('business_description', e.target.value)}
          disabled={isSubmitting}
          className={[
            'w-full rounded-md border px-3 py-2 text-sm text-slate-900 placeholder-slate-400',
            'transition-colors focus:outline-none focus:ring-2 focus:ring-offset-0',
            errors.business_description
              ? 'border-red-400 focus:border-red-500 focus:ring-red-400'
              : 'border-slate-300 focus:border-slate-500 focus:ring-slate-400',
          ].join(' ')}
        />
        {errors.business_description && (
          <p className="text-xs text-red-600" role="alert">
            {errors.business_description}
          </p>
        )}
      </div>

      {/* Website URL */}
      <Input
        label="Website URL"
        id="step2-website-url"
        type="url"
        autoComplete="url"
        placeholder="https://yourbusiness.com"
        value={values.website_url}
        onChange={(e) => handleTextChange('website_url', e.target.value)}
        error={errors.website_url}
        disabled={isSubmitting}
        helperText="Optional. Must start with http:// or https://"
      />

      {/* Social Media Handles */}
      <fieldset className="flex flex-col gap-3">
        <legend className="text-sm font-medium text-slate-700">
          Social Media Handles
          <span className="ml-1 text-red-500" aria-hidden="true">
            *
          </span>
          <span className="ml-1 text-xs font-normal text-slate-500">
            (at least one required)
          </span>
        </legend>

        {SOCIAL_FIELDS.map(({ key, label, placeholder }) => (
          <Input
            key={key}
            label={label}
            id={`step2-social-${key}`}
            type="text"
            placeholder={placeholder}
            value={values.social_handles[key]}
            onChange={(e) => handleSocialChange(key, e.target.value)}
            maxLength={100}
            disabled={isSubmitting}
          />
        ))}

        {errors.social_handles && (
          <p className="text-xs text-red-600" role="alert">
            {errors.social_handles}
          </p>
        )}
      </fieldset>

      {/* Registered Business Toggle */}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-slate-700">
          Registered Business
        </label>
        <div className="flex items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={values.is_registered_business}
            aria-label="Is this a registered business?"
            disabled={isSubmitting}
            onClick={() => handleToggleChange(!values.is_registered_business)}
            className={[
              'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors',
              'focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2',
              'disabled:cursor-not-allowed disabled:opacity-50',
              values.is_registered_business ? 'bg-slate-900' : 'bg-slate-300',
            ].join(' ')}
          >
            <span
              aria-hidden="true"
              className={[
                'inline-block h-4 w-4 rounded-full bg-white shadow transition-transform',
                values.is_registered_business
                  ? 'translate-x-6'
                  : 'translate-x-1',
              ].join(' ')}
            />
          </button>
          <span className="text-sm text-slate-600">
            {values.is_registered_business ? 'Yes' : 'No'}
          </span>
        </div>
        <p className="text-xs text-slate-500">
          Toggle on if your business is formally registered with a government
          body.
        </p>
      </div>

      {/* Registration Document Upload — conditional on toggle (Req 3.7) */}
      {values.is_registered_business && (
        <div className="flex flex-col gap-2">
          {status?.has_registration_doc && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-xs text-emerald-800 flex items-center gap-2">
              <span className="font-semibold text-emerald-900">✓ Document on file:</span> Registration certificate already uploaded. Select a file below only if you want to replace it.
            </div>
          )}
          <FileUpload
            key={fileUploadKey}
            label="Business Registration Document"
            onFileSelect={handleFileSelect}
            error={errors.registration_doc}
            required={!status?.has_registration_doc}
            disabled={isSubmitting}
          />
        </div>
      )}

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
