import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { apiClient } from '../../lib/api'
import { useOnboardingStore, type OnboardingStatus } from '../../stores/onboardingStore'

interface Props {
  status: OnboardingStatus
}

/**
 * Persistent top-of-page banner that informs the merchant of their
 * verification state and provides 1-click Didit verification.
 *
 * - kyc_status === 'pending'  → "Verification in review" with Didit Instant Scan option
 * - kyc_status === 'rejected' → "Verification rejected" with Didit Instant Scan option
 * - kyc_status === 'not_started' → "Verification required" with Didit Instant Scan option
 *
 * Returns null for approved merchants.
 */
export function VerificationBanner({ status }: Props) {
  const navigate = useNavigate()
  const fetchStatus = useOnboardingStore((s) => s.fetchStatus)

  // ─── Didit Modal State ───────────────────────────────────────────────────────
  const [isDiditModalOpen, setIsDiditModalOpen] = useState(false)
  const [diditSessionUrl, setDiditSessionUrl] = useState<string | null>(null)
  const [diditSessionId, setDiditSessionId] = useState<string | null>(null)
  const [diditLoading, setDiditLoading] = useState(false)
  const [diditCheckLoading, setDiditCheckLoading] = useState(false)
  const [diditStatusMsg, setDiditStatusMsg] = useState<string | null>(null)
  const [diditError, setDiditError] = useState<string | null>(null)

  async function handleStartDiditKYC() {
    setDiditLoading(true)
    setDiditError(null)
    setDiditStatusMsg(null)
    setIsDiditModalOpen(true)
    try {
      const res = await apiClient.post<{ session_id: string; url: string }>('/merchant/kyc/didit/session')
      setDiditSessionId(res.data.session_id)
      setDiditSessionUrl(res.data.url)
      window.open(res.data.url, '_blank', 'noopener,noreferrer')
      setDiditStatusMsg('Verification window opened on Didit. Complete your ID and biometric scan, then click Confirm below.')
    } catch {
      setDiditError('Failed to initialize Didit auto-verification. Please retry or upload documents manually.')
    } finally {
      setDiditLoading(false)
    }
  }

  async function handleCheckDiditKYC() {
    setDiditCheckLoading(true)
    setDiditError(null)
    try {
      const res = await apiClient.post<{
        status: string
        kyc_status: string
        reason?: string
      }>('/merchant/kyc/didit/check', {
        session_id: diditSessionId || undefined,
      })

      if (res.data.status === 'approved' || res.data.kyc_status === 'approved') {
        await fetchStatus()
        setIsDiditModalOpen(false)
      } else if (res.data.status === 'rejected' || res.data.kyc_status === 'rejected') {
        setDiditError(res.data.reason || 'Verification was declined by Didit.')
        await fetchStatus()
      } else {
        setDiditStatusMsg('Verification is still in progress on Didit. Once you complete the scan on Didit, click Confirm below.')
      }
    } catch {
      setDiditError('Failed to check Didit verification status. Please verify your connection.')
    } finally {
      setDiditCheckLoading(false)
    }
  }

  const rejectedSections = status.rejected_sections || []
  const hasRejections =
    rejectedSections.length > 0 ||
    status.kyc_status === 'rejected' ||
    status.personal_info_status === 'rejected' ||
    status.business_info_status === 'rejected'

  if (status.kyc_status === 'approved' && !hasRejections) return null

  return (
    <>
      {hasRejections ? (
        <div className="space-y-3">
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900 shadow-sm">
            <div className="flex items-start gap-3">
              <svg
                className="mt-0.5 h-5 w-5 shrink-0 text-red-600"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z"
                  clipRule="evenodd"
                />
              </svg>
              <div className="flex-1 space-y-2.5">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <strong className="text-base font-semibold text-red-900 block">
                      Action Required on Your Account
                    </strong>
                    <p className="mt-0.5 text-xs text-red-700">
                      Some parts of your profile require correction before your account is fully verified.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    loading={diditLoading}
                    onClick={handleStartDiditKYC}
                    className="shrink-0 text-xs"
                  >
                    ⚡ Fast Verify with Didit
                  </Button>
                </div>

                <div className="space-y-2 pt-1">
                  {(rejectedSections.length > 0
                    ? rejectedSections
                    : [
                        ...(status.personal_info_status === 'rejected'
                          ? [
                              {
                                section: 'personal',
                                step: 1,
                                title: 'Personal Information',
                                reason:
                                  status.personal_info_rejection_reason ||
                                  'Personal details were marked for correction.',
                              },
                            ]
                          : []),
                        ...(status.business_info_status === 'rejected'
                          ? [
                              {
                                section: 'business',
                                step: 2,
                                title: 'Business Information',
                                reason:
                                  status.business_info_rejection_reason ||
                                  'Business details or documents were marked for correction.',
                              },
                            ]
                          : []),
                        ...(status.kyc_status === 'rejected'
                          ? [
                              {
                                section: 'kyc',
                                step: 3,
                                title: 'KYC & Identity Verification',
                                reason:
                                  status.kyc_rejection_reason ||
                                  'Your identity documents were rejected. Please review and re-upload valid identification.',
                              },
                            ]
                          : []),
                      ]
                  ).map((item) => (
                    <div
                      key={item.section}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 rounded-lg border border-red-200 bg-white/90 p-3"
                    >
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-red-100 text-red-800">
                            Step {item.step}: {item.title}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-700">
                          <strong className="text-red-900 font-medium">Feedback: </strong>
                          {item.reason}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => navigate(`/onboarding?step=${item.step}`)}
                        className="inline-flex items-center justify-center px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md shadow-sm shrink-0 transition-colors"
                      >
                        Fix {item.title.split(' ')[0]} →
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : status.kyc_status === 'pending' ? (
        <div
          className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900 shadow-xs"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-start gap-3">
            <svg
              className="mt-0.5 h-4 w-4 shrink-0 text-blue-600"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z"
                clipRule="evenodd"
              />
            </svg>
            <div>
              <strong className="font-semibold block sm:inline">Verification in progress. </strong>
              <span className="text-xs sm:text-sm text-blue-800">
                Your account is currently undergoing verification review. Fast-track approval instantly using Didit AI verification.
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
            <Button
              type="button"
              variant="primary"
              size="sm"
              loading={diditLoading}
              onClick={handleStartDiditKYC}
              className="text-xs font-bold"
            >
              ⚡ Instant Verify with Didit
            </Button>
          </div>
        </div>
      ) : (
        /* not_started or other non-approved */
        <div
          className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 shadow-xs"
          role="alert"
        >
          <div className="flex items-start gap-3">
            <svg
              className="mt-0.5 h-4 w-4 shrink-0 text-amber-600"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
                clipRule="evenodd"
              />
            </svg>
            <div>
              <strong className="font-semibold block sm:inline">Verification required. </strong>
              <span className="text-xs sm:text-sm text-amber-800">
                Complete identity verification to unlock crypto checkout, invoices, and API keys.
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
            <Button
              type="button"
              variant="primary"
              size="sm"
              loading={diditLoading}
              onClick={handleStartDiditKYC}
              className="text-xs font-bold"
            >
              ⚡ Verify with Didit
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => navigate('/onboarding?step=3')}
              className="text-xs"
            >
              Manual Upload
            </Button>
          </div>
        </div>
      )}

      {/* ─── Didit Verification Modal ─────────────────────────────────────── */}
      {isDiditModalOpen && (
        <Modal
          isOpen={isDiditModalOpen}
          onClose={() => setIsDiditModalOpen(false)}
          title="⚡ Instant Identity Verification (Didit)"
        >
          <div className="space-y-4">
            <p className="text-xs text-slate-600 leading-relaxed">
              Complete your identity verification in under 60 seconds with Didit. Have your government ID ready and follow the camera prompts.
            </p>

            {diditError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                {diditError}
              </div>
            )}

            {diditStatusMsg && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
                {diditStatusMsg}
              </div>
            )}

            {diditSessionUrl && (
              <div className="rounded-xl bg-slate-50 border border-slate-200 p-4 space-y-2.5">
                <p className="text-xs font-semibold text-slate-800">
                  Verification session active:
                </p>
                <a
                  href={diditSessionUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-block text-xs font-bold text-blue-600 underline hover:text-blue-800"
                >
                  Click here if Didit window did not open automatically ↗
                </a>
              </div>
            )}

            <div className="flex flex-col sm:flex-row items-center justify-end gap-3 pt-3 border-t border-slate-100">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setIsDiditModalOpen(false)}
                disabled={diditCheckLoading}
              >
                Close
              </Button>
              {diditSessionUrl ? (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  loading={diditCheckLoading}
                  onClick={handleCheckDiditKYC}
                >
                  I Have Completed Verification →
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  loading={diditLoading}
                  onClick={handleStartDiditKYC}
                >
                  Start Didit Scan →
                </Button>
              )}
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
