import { useEffect, useState } from 'react'
import { useOnboardingStore } from '../../stores/onboardingStore'
import { submitOnboardingStep } from '../../services/merchant'
import { ApiError } from '../../services/errors'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { FileUpload } from '../../components/onboarding/FileUpload'
import { apiClient } from '../../lib/api'

// ─── Validation ────────────────────────────────────────────────────────────────

function validateNIN(v: string): string | undefined {
  if (!/^\d{11}$/.test(v))
    return 'NIN must be exactly 11 numeric digits with no letters or special characters.'
  return undefined
}

function validateDocType(v: string): string | undefined {
  if (!v) return 'Please select a document type.'
  return undefined
}

function validateIdentityDoc(file: File | null, hasExistingDoc?: boolean): string | undefined {
  if (!file && !hasExistingDoc) return 'An identity document file is required.'
  return undefined
}

// ─── Types ─────────────────────────────────────────────────────────────────────

interface FormValues {
  nin: string
  doc_type: string
}

interface FormErrors {
  nin?: string
  doc_type?: string
  identity_doc?: string
  form?: string
}

// ─── Automated Didit KYC Verification Component ─────────────────────────────────

function DiditAutoVerification({ onSwitchToManual }: { onSwitchToManual: () => void }) {
  const setStep = useOnboardingStore((state) => state.setStep)
  const fetchStatus = useOnboardingStore((state) => state.fetchStatus)
  const [loadingSession, setLoadingSession] = useState(false)
  const [checkingStatus, setCheckingStatus] = useState(false)
  const [sessionUrl, setSessionUrl] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  async function handleStartDidit() {
    setLoadingSession(true)
    setError(null)
    setStatusMessage(null)
    try {
      const res = await apiClient.post<{ session_id: string; url: string }>('/merchant/kyc/didit/session')
      setSessionId(res.data.session_id)
      setSessionUrl(res.data.url)
      // Open Didit verification in new tab
      window.open(res.data.url, '_blank', 'noopener,noreferrer')
      setStatusMessage('Verification window opened. Complete your document & biometric scan on Didit, then return here.')
    } catch {
      setError('Failed to start Didit automated verification. Please retry or use manual document upload.')
    } finally {
      setLoadingSession(false)
    }
  }

  async function handleCheckStatus() {
    setCheckingStatus(true)
    setError(null)
    try {
      const res = await apiClient.post<{
        status: string
        kyc_status: string
        reason?: string
        onboarding_step: number
      }>('/merchant/kyc/didit/check', {
        session_id: sessionId || undefined,
      })

      if (res.data.status === 'approved' || res.data.kyc_status === 'approved') {
        await fetchStatus()
        setStep(4)
      } else if (res.data.status === 'rejected' || res.data.kyc_status === 'rejected') {
        setError(res.data.reason || 'Verification was declined by Didit. Please try again or upload documents manually.')
      } else {
        setStatusMessage('Verification is still in progress on Didit. Once completed, click the button below to confirm.')
      }
    } catch {
      setError('Could not verify status. Please check your internet connection or complete verification on Didit.')
    } finally {
      setCheckingStatus(false)
    }
  }

  return (
    <div className="flex flex-col gap-5 rounded-2xl border border-slate-200 bg-white p-6 shadow-xs">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-bold text-slate-900">
              Automated Identity Verification
            </h2>
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-blue-100 text-blue-800 uppercase tracking-wider">
              ⚡ Powered by Didit
            </span>
          </div>
          <p className="mt-1 text-xs text-slate-500 leading-relaxed">
            Fast, secure AI biometric verification. Verify your government ID and selfie in under 60 seconds.
          </p>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-semibold text-red-700 flex items-center gap-2">
          <span>⚠️</span>
          <span>{error}</span>
        </div>
      )}

      {statusMessage && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-xs text-blue-800 flex items-center gap-2">
          <span>ℹ️</span>
          <span>{statusMessage}</span>
        </div>
      )}

      {!sessionUrl ? (
        <div className="space-y-4 pt-2">
          <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-2.5">
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">What you'll need:</h4>
            <ul className="text-xs text-slate-600 space-y-1.5 list-disc list-inside">
              <li>A valid government-issued photo ID (Passport, National ID, Driver's License, or NIN slip)</li>
              <li>A device with a camera for a quick 3-second biometric selfie scan</li>
            </ul>
          </div>

          <Button
            type="button"
            variant="primary"
            size="lg"
            className="w-full"
            loading={loadingSession}
            onClick={handleStartDidit}
          >
            Start Instant Verification with Didit →
          </Button>
        </div>
      ) : (
        <div className="space-y-4 pt-2">
          <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-xs text-emerald-900 space-y-2">
            <p className="font-bold flex items-center gap-1.5">
              <span>🚀</span> Session active on Didit verification portal
            </p>
            <p className="text-emerald-800">
              If the verification window did not open automatically, click the link below to resume:
            </p>
            <a
              href={sessionUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-block font-bold text-blue-600 underline text-xs"
            >
              Open Didit Verification Link ↗
            </a>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <Button
              type="button"
              variant="primary"
              size="lg"
              className="flex-1"
              loading={checkingStatus}
              onClick={handleCheckStatus}
            >
              I Have Completed Verification →
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="lg"
              onClick={handleStartDidit}
              disabled={loadingSession || checkingStatus}
            >
              Restart Scan
            </Button>
          </div>
        </div>
      )}

      <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
        <p className="text-xs text-slate-500">Prefer manual document review?</p>
        <button
          type="button"
          onClick={onSwitchToManual}
          className="text-xs font-bold text-slate-900 hover:underline"
        >
          Switch to Manual Document Upload →
        </button>
      </div>
    </div>
  )
}

// ─── Manual KYC Form ───────────────────────────────────────────────────────────

function ManualKYCForm({ isNigerian, onSwitchToAuto }: { isNigerian: boolean; onSwitchToAuto: () => void }) {
  const saveFormData = useOnboardingStore((state) => state.saveFormData)
  const setStep = useOnboardingStore((state) => state.setStep)
  const status = useOnboardingStore((state) => state.status)
  const persistedData = useOnboardingStore((state) => state.formData[3]) as
    | Partial<FormValues>
    | undefined

  const [values, setValues] = useState<FormValues>(() => ({
    nin: persistedData?.nin || status?.nin || '',
    doc_type: persistedData?.doc_type || status?.kyc_document_type || '',
  }))

  const [errors, setErrors] = useState<FormErrors>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [identityDoc, setIdentityDoc] = useState<File | null>(null)

  useEffect(() => {
    if (status) {
      setValues((prev) => ({
        nin: prev.nin || status.nin || '',
        doc_type: prev.doc_type || status.kyc_document_type || '',
      }))
    }
  }, [status])

  const [fileUploadKey] = useState(0)

  function handleNINChange(v: string) {
    setValues((prev) => ({ ...prev, nin: v }))
    if (errors.nin) setErrors((prev) => ({ ...prev, nin: undefined }))
  }

  function handleDocTypeChange(v: string) {
    setValues((prev) => ({ ...prev, doc_type: v }))
    if (errors.doc_type) setErrors((prev) => ({ ...prev, doc_type: undefined }))
  }

  function handleFileSelect(file: File) {
    setIdentityDoc(file)
    if (errors.identity_doc)
      setErrors((prev) => ({ ...prev, identity_doc: undefined }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    const fieldErrors: FormErrors = {}

    if (isNigerian) {
      fieldErrors.nin = validateNIN(values.nin)
    } else {
      fieldErrors.doc_type = validateDocType(values.doc_type)
    }
    fieldErrors.identity_doc = validateIdentityDoc(identityDoc, status?.has_kyc_doc)

    const hasErrors = Object.values(fieldErrors).some(Boolean)
    if (hasErrors) {
      setErrors(fieldErrors)
      return
    }

    setErrors({})
    setIsSubmitting(true)

    try {
      const formData = new FormData()

      if (isNigerian) {
        formData.append('nin', values.nin.trim())
      } else {
        formData.append('kyc_document_type', values.doc_type)
      }

      if (identityDoc) {
        formData.append('kyc_document', identityDoc)
      }

      await submitOnboardingStep(3, formData)

      saveFormData(3, {
        ...(isNigerian ? { nin: values.nin.trim() } : { doc_type: values.doc_type }),
      })
      setStep(4)
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

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-slate-900">
            Manual Identity Document Upload
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Please provide a valid government-issued identity document for manual compliance review.
          </p>
        </div>
        <button
          type="button"
          onClick={onSwitchToAuto}
          className="text-xs font-bold text-blue-600 hover:underline shrink-0"
        >
          ⚡ Use Fast Didit Verification
        </button>
      </div>

      {status?.kyc_status === 'rejected' && status?.kyc_rejection_reason && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3.5 text-xs text-red-800" role="alert">
          <div className="flex items-start gap-2.5">
            <span className="text-base">⚠️</span>
            <div>
              <p className="font-semibold text-red-900">KYC Rejection Feedback</p>
              <p className="mt-0.5 text-xs text-red-700">{status.kyc_rejection_reason}</p>
            </div>
          </div>
        </div>
      )}

      {/* Nigeria: NIN input */}
      {isNigerian && (
        <Input
          label="National Identification Number (NIN)"
          id="step3-nin"
          type="text"
          inputMode="numeric"
          placeholder="e.g. 12345678901"
          maxLength={11}
          value={values.nin}
          onChange={(e) => handleNINChange(e.target.value)}
          error={errors.nin}
          required
          disabled={isSubmitting}
          helperText="Your 11-digit NIN as printed on your NIN slip or national ID card."
        />
      )}

      {/* Non-Nigeria: document type selector */}
      {!isNigerian && (
        <div className="flex flex-col gap-1">
          <label
            htmlFor="step3-doc-type"
            className="text-xs font-bold uppercase tracking-wider text-slate-700"
          >
            Document Type
            <span className="ml-1 text-red-500" aria-hidden="true">
              *
            </span>
          </label>
          <select
            id="step3-doc-type"
            value={values.doc_type}
            onChange={(e) => handleDocTypeChange(e.target.value)}
            disabled={isSubmitting}
            aria-invalid={!!errors.doc_type}
            className={[
              'w-full rounded-xl border px-3.5 py-2.5 text-sm text-slate-900 shadow-xs',
              'transition-colors focus:outline-none focus:ring-1 focus:ring-slate-900',
              errors.doc_type
                ? 'border-red-400 focus:border-red-500'
                : 'border-slate-300 focus:border-slate-900',
              isSubmitting
                ? 'cursor-not-allowed bg-slate-50 text-slate-400'
                : 'bg-white',
            ].join(' ')}
          >
            <option value="">Select document type</option>
            <option value="passport">Passport</option>
            <option value="national_id">National ID Card</option>
            <option value="drivers_license">Driver's License</option>
          </select>
          {errors.doc_type && (
            <p className="text-xs text-red-600" role="alert">
              {errors.doc_type}
            </p>
          )}
        </div>
      )}

      {/* Identity document file upload */}
      <div className="flex flex-col gap-2">
        {status?.has_kyc_doc && (
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-2.5 text-xs text-emerald-800 flex items-center gap-2">
            <span className="font-semibold text-emerald-900">✓ Document on file:</span> Identity document already uploaded. Select a file below only if you want to replace it.
          </div>
        )}
        <FileUpload
          key={fileUploadKey}
          label={isNigerian ? 'NIN Slip or National ID Card' : 'Identity Document'}
          onFileSelect={handleFileSelect}
          error={errors.identity_doc}
          required={!status?.has_kyc_doc}
          disabled={isSubmitting}
        />
      </div>

      {errors.form && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-xs font-semibold text-red-700" role="alert">
          {errors.form}
        </p>
      )}

      <Button
        type="submit"
        className="mt-2 w-full"
        size="lg"
        loading={isSubmitting}
      >
        Submit Documents & Continue →
      </Button>
    </form>
  )
}

// ─── Step3KYC (top-level export) ───────────────────────────────────────────────

export function Step3KYC() {
  const step1Data = useOnboardingStore((state) => state.formData[1]) as
    | { country?: string }
    | undefined
  const status = useOnboardingStore((state) => state.status)

  const country = step1Data?.country || status?.country || ''
  const isNigerian = country.toLowerCase().trim() === 'nigeria'

  // Default to Didit automated verification, with ability to toggle to manual
  const [mode, setMode] = useState<'didit' | 'manual'>('didit')

  if (mode === 'didit') {
    return <DiditAutoVerification onSwitchToManual={() => setMode('manual')} />
  }

  return <ManualKYCForm isNigerian={isNigerian} onSwitchToAuto={() => setMode('didit')} />
}
