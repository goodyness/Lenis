import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { AppShell } from '../../components/layout/AppShell'
import { ProtectedRoute } from '../../components/routing/ProtectedRoute'
import { KYCReviewPanel } from '../../components/admin/KYCReviewPanel'
import { SuspendMerchantModal } from '../../components/admin/SuspendMerchantModal'
import { SectionRejectModal } from '../../components/admin/SectionRejectModal'
import { DocumentPreviewModal } from '../../components/admin/DocumentPreviewModal'
import { StatusBadge } from '../../components/ui/StatusBadge'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Badge } from '../../components/ui/Badge'
import { Input } from '../../components/ui/Input'
import {
  getMerchantDetail,
  getKYCDocuments,
  getMerchantPayersAdmin,
  getMerchantTransactionsAdmin,
  getMerchantAPIKeysAdmin,
  checkAdminDiditStatus,
  type MerchantDetailResponse,
  type KYCStatus,
  type MerchantUserStatus,
  type KYCDocumentsResponse,
  type APIKeyHistoryItem,
} from '../../services/admin'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function truncateAddress(address: string, maxLen = 20): string {
  if (address.length <= maxLen) return address
  return `${address.slice(0, 10)}…${address.slice(-8)}`
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function LabeledField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</dt>
      <dd className="mt-0.5 text-sm text-slate-800">{value ?? <span className="text-slate-400">—</span>}</dd>
    </div>
  )
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SkeletonCard({ rows = 4 }: { rows?: number }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm space-y-3">
      <div className="h-5 w-32 animate-pulse rounded bg-slate-200" />
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-4 w-full animate-pulse rounded bg-slate-100" />
      ))}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function MerchantDetail() {
  const { userId } = useParams<{ userId: string }>()
  const navigate = useNavigate()

  const [merchant, setMerchant] = useState<MerchantDetailResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)

  const [kycDocs, setKycDocs] = useState<KYCDocumentsResponse | null>(null)
  const [kycDocsLoading, setKycDocsLoading] = useState(false)
  const [kycDocsLoaded, setKycDocsLoaded] = useState(false)

  const [previewModal, setPreviewModal] = useState<{
    isOpen: boolean
    title: string
    documentUrl: string | null
  }>({
    isOpen: false,
    title: '',
    documentUrl: null,
  })

  const [suspendModalOpen, setSuspendModalOpen] = useState(false)
  const [rejectSectionModal, setRejectSectionModal] = useState<{
    isOpen: boolean
    section: 'personal' | 'business' | 'kyc'
    sectionTitle: string
  }>({
    isOpen: false,
    section: 'personal',
    sectionTitle: 'Personal Information',
  })

  const fetchMerchant = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    setFetchError(false)
    try {
      const data = await getMerchantDetail(userId)
      setMerchant(data)
    } catch {
      setFetchError(true)
    } finally {
      setLoading(false)
    }
  }, [userId])

  const loadKycDocs = useCallback(async () => {
    if (!userId) return
    setKycDocsLoading(true)
    try {
      const docs = await getKYCDocuments(userId)
      setKycDocs(docs)
      setKycDocsLoaded(true)
    } catch {
      // Non-critical, fallback endpoints will be used
    } finally {
      setKycDocsLoading(false)
    }
  }, [userId])

  const [activeTab, setActiveTab] = useState<'profile' | 'payers' | 'transactions' | 'api_keys'>('profile')

  // API Keys tab state
  const [apiKeysData, setApiKeysData] = useState<APIKeyHistoryItem[]>([])
  const [apiKeysLoading, setApiKeysLoading] = useState(false)

  const fetchApiKeys = useCallback(async () => {
    if (!userId) return
    setApiKeysLoading(true)
    try {
      const res = await getMerchantAPIKeysAdmin(userId)
      setApiKeysData(res?.keys || [])
    } catch {
      // ignore
    } finally {
      setApiKeysLoading(false)
    }
  }, [userId])

  // Didit Automated KYC sync state
  const [syncingDidit, setSyncingDidit] = useState(false)
  const [diditSyncMsg, setDiditSyncMsg] = useState<string | null>(null)

  async function handleSyncDidit() {
    if (!userId) return
    setSyncingDidit(true)
    setDiditSyncMsg(null)
    try {
      const res = await checkAdminDiditStatus(userId)
      if (res?.status === 'approved' || res?.kyc_status === 'approved') {
        setDiditSyncMsg('Didit verified! Merchant status updated to Approved.')
      } else if (res?.status === 'not_started') {
        setDiditSyncMsg('No Didit session has been initiated yet by this merchant.')
      } else {
        setDiditSyncMsg(`Didit decision: ${res?.status || 'Pending'}${res?.reason ? ` (${res.reason})` : ''}`)
      }
      await fetchMerchant()
    } catch {
      setDiditSyncMsg('Failed to sync with Didit API.')
    } finally {
      setSyncingDidit(false)
    }
  }

  // Payers tab state
  const [payersData, setPayersData] = useState<any>(null)
  const [payersLoading, setPayersLoading] = useState(false)
  const [payersPage, setPayersPage] = useState(1)
  const [payersSearch, setPayersSearch] = useState('')

  // Transactions tab state
  const [txData, setTxData] = useState<any>(null)
  const [txLoading, setTxLoading] = useState(false)
  const [txPage, setTxPage] = useState(1)
  const [txStatusFilter, setTxStatusFilter] = useState('')

  const fetchPayers = useCallback(async (p = 1, search?: string) => {
    if (!userId) return
    setPayersLoading(true)
    try {
      const res = await getMerchantPayersAdmin(userId, p, 20, search || undefined)
      setPayersData(res)
    } catch {
      // ignore
    } finally {
      setPayersLoading(false)
    }
  }, [userId])

  const fetchTransactions = useCallback(async (p = 1, status?: string) => {
    if (!userId) return
    setTxLoading(true)
    try {
      const res = await getMerchantTransactionsAdmin(userId, p, 20, status || undefined)
      setTxData(res)
    } catch {
      // ignore
    } finally {
      setTxLoading(false)
    }
  }, [userId])

  useEffect(() => {
    fetchMerchant()
    loadKycDocs()
  }, [fetchMerchant, loadKycDocs])

  useEffect(() => {
    if (activeTab === 'payers') {
      fetchPayers(payersPage, payersSearch)
    } else if (activeTab === 'transactions') {
      fetchTransactions(txPage, txStatusFilter)
    } else if (activeTab === 'api_keys') {
      fetchApiKeys()
    }
  }, [activeTab, payersPage, payersSearch, txPage, txStatusFilter, fetchPayers, fetchTransactions, fetchApiKeys])

  function handleKycStatusChange(newStatus: KYCStatus) {
    setMerchant((prev) => prev ? { ...prev, kyc_status: newStatus } : prev)
  }

  function handleSuspendSuccess(newStatus: MerchantUserStatus) {
    setMerchant((prev) => prev ? { ...prev, user_status: newStatus } : prev)
  }

  function handleSectionRejectSuccess(section: 'personal' | 'business' | 'kyc', reason: string) {
    setMerchant((prev) => {
      if (!prev) return prev
      if (section === 'personal') {
        return { ...prev, personal_info_status: 'rejected', personal_info_rejection_reason: reason }
      } else if (section === 'business') {
        return { ...prev, business_info_status: 'rejected', business_info_rejection_reason: reason }
      } else {
        return { ...prev, kyc_status: 'rejected', kyc_rejection_reason: reason }
      }
    })
  }

  // ── Error state ──────────────────────────────────────────────────────────────
  if (fetchError) {
    return (
      <ProtectedRoute requiredRole="admin">
        <AppShell>
          <div
            className="rounded-lg border border-red-200 bg-red-50 p-6 text-center"
            role="alert"
            aria-live="assertive"
          >
            <p className="text-sm text-red-600">Failed to load merchant details. Please try again.</p>
            <Button variant="secondary" size="sm" className="mt-3" onClick={fetchMerchant}>
              Retry
            </Button>
          </div>
        </AppShell>
      </ProtectedRoute>
    )
  }

  // ── Loading state ────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <ProtectedRoute requiredRole="admin">
        <AppShell>
          <div className="space-y-6">
            {/* Back + header skeleton */}
            <div className="space-y-2">
              <div className="h-4 w-24 animate-pulse rounded bg-slate-200" />
              <div className="h-7 w-64 animate-pulse rounded bg-slate-200" />
            </div>
            <SkeletonCard rows={5} />
            <SkeletonCard rows={4} />
            <SkeletonCard rows={3} />
          </div>
        </AppShell>
      </ProtectedRoute>
    )
  }

  if (!merchant) return null

  const displayName = merchant.full_name || merchant.email

  return (
    <ProtectedRoute requiredRole="admin">
      <AppShell>
        <div className="space-y-6">
          {/* Back navigation */}
          <div>
            <button
              type="button"
              onClick={() => navigate('/admin/merchants')}
              className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1 rounded"
            >
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path
                  fillRule="evenodd"
                  d="M9.707 14.707a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 1.414L7.414 9H15a1 1 0 110 2H7.414l2.293 2.293a1 1 0 010 1.414z"
                  clipRule="evenodd"
                />
              </svg>
              Back to Merchants
            </button>
          </div>

          {/* Page header */}
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-semibold text-slate-900">{displayName}</h1>
              <p className="mt-0.5 text-sm text-slate-500">{merchant.email}</p>
            </div>
            <div className="flex items-center gap-3">
              <StatusBadge status={merchant.user_status} />
              <Button
                variant={merchant.user_status === 'active' ? 'danger' : 'secondary'}
                size="sm"
                onClick={() => setSuspendModalOpen(true)}
              >
                {merchant.user_status === 'active' ? 'Suspend' : 'Unsuspend'}
              </Button>
            </div>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Payment Links</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900">{merchant.payment_link_count}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Invoices</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900">{merchant.invoice_count}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-white px-5 py-4 shadow-sm">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Total Confirmed Volume</p>
              <p className="mt-1 text-2xl font-semibold text-slate-900">{merchant.total_confirmed_volume}</p>
            </div>
          </div>

          {/* Tab Navigation */}
          <div className="border-b border-slate-200">
            <nav className="flex space-x-8" aria-label="Tabs">
              <button
                type="button"
                onClick={() => setActiveTab('profile')}
                className={[
                  'border-b-2 py-4 px-1 text-sm font-medium transition-colors',
                  activeTab === 'profile'
                    ? 'border-slate-900 text-slate-900 font-semibold'
                    : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700',
                ].join(' ')}
              >
                Profile & KYC
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('payers')}
                className={[
                  'border-b-2 py-4 px-1 text-sm font-medium transition-colors',
                  activeTab === 'payers'
                    ? 'border-slate-900 text-slate-900 font-semibold'
                    : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700',
                ].join(' ')}
              >
                Payers & Customers
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('transactions')}
                className={[
                  'border-b-2 py-4 px-1 text-sm font-medium transition-colors',
                  activeTab === 'transactions'
                    ? 'border-slate-900 text-slate-900 font-semibold'
                    : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700',
                ].join(' ')}
              >
                Transactions
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('api_keys')}
                className={[
                  'border-b-2 py-4 px-1 text-sm font-medium transition-colors',
                  activeTab === 'api_keys'
                    ? 'border-slate-900 text-slate-900 font-semibold'
                    : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700',
                ].join(' ')}
              >
                API Keys & Rotations
              </button>
            </nav>
          </div>

          {activeTab === 'profile' && (
            <div className="space-y-6">
              {/* Personal info */}
              <Card
            title={
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-2.5">
                  <span>Personal Information</span>
                  <StatusBadge status={merchant.personal_info_status || 'pending'} />
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setRejectSectionModal({
                      isOpen: true,
                      section: 'personal',
                      sectionTitle: 'Personal Information',
                    })
                  }
                >
                  Reject Section
                </Button>
              </div>
            }
          >
            <div className="space-y-4">
              {merchant.personal_info_status === 'rejected' && merchant.personal_info_rejection_reason && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  <span className="font-semibold">Rejection Feedback: </span>
                  {merchant.personal_info_rejection_reason}
                </div>
              )}
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <LabeledField label="Full Name" value={merchant.full_name} />
                <LabeledField label="Email" value={merchant.email} />
                <LabeledField label="Country" value={merchant.country} />
                <LabeledField label="Phone Number" value={merchant.phone_number} />
                <LabeledField label="Account Status" value={<StatusBadge status={merchant.user_status} />} />
                <LabeledField label="Member Since" value={formatDate(merchant.created_at)} />
                <LabeledField label="Last Updated" value={formatDateTime(merchant.updated_at)} />
                <LabeledField label="Onboarding Step" value={`Step ${merchant.onboarding_step}`} />
                <LabeledField
                  label="Onboarding Complete"
                  value={merchant.onboarding_complete ? 'Yes' : 'No'}
                />
              </dl>
            </div>
          </Card>

          {/* Business info */}
          <Card
            title={
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-2.5">
                  <span>Business Information</span>
                  <StatusBadge status={merchant.business_info_status || 'pending'} />
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() =>
                    setRejectSectionModal({
                      isOpen: true,
                      section: 'business',
                      sectionTitle: 'Business Information',
                    })
                  }
                >
                  Reject Section
                </Button>
              </div>
            }
          >
            <div className="space-y-4">
              {merchant.business_info_status === 'rejected' && merchant.business_info_rejection_reason && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                  <span className="font-semibold">Rejection Feedback: </span>
                  {merchant.business_info_rejection_reason}
                </div>
              )}
              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <LabeledField label="Business Name" value={merchant.business_name} />
                <LabeledField label="Business Category" value={merchant.business_category} />
                <LabeledField label="Monthly Est. Volume" value={merchant.monthly_volume_estimate} />
                <LabeledField label="Physical Business Address" value={merchant.business_address} />
                <div className="sm:col-span-2 lg:col-span-3">
                  <LabeledField label="Business Description" value={merchant.business_description} />
                </div>
                <LabeledField label="Website" value={
                  merchant.website_url
                    ? <a href={merchant.website_url} target="_blank" rel="noopener noreferrer" className="text-slate-700 underline underline-offset-2 hover:text-slate-900">{merchant.website_url}</a>
                    : null
                } />
                <LabeledField
                  label="Registered Business"
                  value={merchant.is_registered_business ? 'Yes' : 'No'}
                />
                <LabeledField
                  label="Registration Document"
                  value={
                    merchant.registration_doc_path ? (
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200">
                          Uploaded
                        </span>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            setPreviewModal({
                              isOpen: true,
                              title: `${merchant.business_name || 'Business'} Registration Document`,
                              documentUrl:
                                kycDocs?.registration_doc_url ||
                                `/admin/merchants/${userId}/documents/registration`,
                            })
                          }
                        >
                          View Document ↗
                        </Button>
                      </div>
                    ) : (
                      <span className="text-slate-400">None</span>
                    )
                  }
                />
                <LabeledField label="Instagram" value={merchant.social_instagram} />
                <LabeledField label="Twitter / X" value={merchant.social_twitter} />
                <LabeledField label="Facebook" value={merchant.social_facebook} />
                <LabeledField label="LinkedIn" value={merchant.social_linkedin} />
                <LabeledField label="TikTok" value={merchant.social_tiktok} />
              </dl>
            </div>
          </Card>

          {/* KYC section */}
          <Card title="KYC & Verification">
            <div className="space-y-6">
              {diditSyncMsg && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs font-semibold text-blue-900 flex items-center justify-between">
                  <span>ℹ️ {diditSyncMsg}</span>
                  <button type="button" onClick={() => setDiditSyncMsg(null)} className="text-xs text-blue-600 underline">Dismiss</button>
                </div>
              )}

              <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <LabeledField label="KYC Status" value={<StatusBadge status={merchant.kyc_status} />} />
                <LabeledField label="Document Type" value={merchant.kyc_document_type || 'Didit Automated Scan'} />
                <LabeledField label="NIN" value={merchant.nin} />
                <LabeledField
                  label="Didit Session ID"
                  value={
                    merchant.kyc_didit_session_id || merchant.kyc_dojah_session_id ? (
                      <span className="font-mono text-xs text-slate-800 font-semibold">
                        {merchant.kyc_didit_session_id || merchant.kyc_dojah_session_id}
                      </span>
                    ) : (
                      <span className="text-slate-400">None</span>
                    )
                  }
                />
                <LabeledField
                  label="Reviewed At"
                  value={merchant.kyc_reviewed_at ? formatDateTime(merchant.kyc_reviewed_at) : null}
                />
                <div className="flex items-center pt-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    loading={syncingDidit}
                    onClick={handleSyncDidit}
                    className="text-xs"
                  >
                    ⚡ Sync Didit Decision
                  </Button>
                </div>
                {merchant.kyc_rejection_reason && (
                  <div className="sm:col-span-2 lg:col-span-3">
                    <LabeledField label="Rejection Reason" value={merchant.kyc_rejection_reason} />
                  </div>
                )}
              </dl>

              {/* KYC Documents */}
              <div>
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400 mb-3">
                  KYC & Registration Documents
                </p>
                {kycDocsLoading && !kycDocsLoaded ? (
                  <div className="flex items-center gap-2 text-xs text-slate-500 py-2">
                    <svg className="h-4 w-4 animate-spin text-slate-400" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4l3-3-3-3v4a8 8 0 00-8 8h4z" />
                    </svg>
                    Loading documents…
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Identity Document Card */}
                    <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 shadow-xs">
                      <div>
                        <span className="text-xs font-semibold text-slate-800 block">Identity Document</span>
                        <span className="text-xs text-slate-500 mt-0.5 block">
                          {merchant.kyc_document_type ? `Type: ${merchant.kyc_document_type}` : 'Official Government ID / NIN'}
                        </span>
                      </div>
                      {merchant.kyc_document_path || kycDocs?.kyc_document_url ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            setPreviewModal({
                              isOpen: true,
                              title: `${merchant.full_name || 'Merchant'} Identity Document`,
                              documentUrl:
                                kycDocs?.kyc_document_url ||
                                `/admin/merchants/${userId}/documents/kyc`,
                            })
                          }
                        >
                          View Document ↗
                        </Button>
                      ) : (
                        <span className="text-xs text-slate-400 font-medium px-2 py-1 bg-slate-100 rounded">Not provided</span>
                      )}
                    </div>

                    {/* Registration Document Card */}
                    <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 shadow-xs">
                      <div>
                        <span className="text-xs font-semibold text-slate-800 block">Registration Certificate</span>
                        <span className="text-xs text-slate-500 mt-0.5 block">CAC / Business Certificate</span>
                      </div>
                      {merchant.registration_doc_path || kycDocs?.registration_doc_url ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() =>
                            setPreviewModal({
                              isOpen: true,
                              title: `${merchant.business_name || 'Business'} Registration Document`,
                              documentUrl:
                                kycDocs?.registration_doc_url ||
                                `/admin/merchants/${userId}/documents/registration`,
                            })
                          }
                        >
                          View Document ↗
                        </Button>
                      ) : (
                        <span className="text-xs text-slate-400 font-medium px-2 py-1 bg-slate-100 rounded">Not provided</span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* KYC Review Panel */}
              <div className="border-t border-slate-100 pt-5">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-400 mb-3">
                  Review Actions
                </p>
                <KYCReviewPanel
                  userId={merchant.user_id}
                  kycStatus={merchant.kyc_status}
                  rejectionReason={merchant.kyc_rejection_reason ?? undefined}
                  onStatusChange={handleKycStatusChange}
                />
              </div>
            </div>
          </Card>

          {/* Wallets */}
          <Card title="Wallets">
            {merchant.wallets.length === 0 ? (
              <p className="text-sm text-slate-400">No wallets added yet.</p>
            ) : (
              <div className="overflow-x-auto -mx-6 -mb-6">
                <table className="min-w-full text-sm">
                  <thead className="border-b border-slate-100 bg-slate-50">
                    <tr>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                        Network
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                        Address
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                        Status
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                        Added
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {merchant.wallets.map((wallet) => (
                      <tr key={wallet.id}>
                        <td className="px-6 py-3 text-slate-700">{wallet.network}</td>
                        <td className="px-6 py-3">
                          <span
                            className="font-mono text-slate-700"
                            title={wallet.address}
                          >
                            {truncateAddress(wallet.address)}
                          </span>
                        </td>
                        <td className="px-6 py-3">
                          <StatusBadge status={wallet.status} />
                        </td>
                        <td className="px-6 py-3">
                          <time dateTime={wallet.created_at} className="whitespace-nowrap text-xs text-slate-500">
                            {formatDate(wallet.created_at)}
                          </time>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Payers Tab */}
      {activeTab === 'payers' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">Merchant's Payers & Customers</h2>
            <div className="flex items-center gap-2">
              <Input
                placeholder="Search payers…"
                value={payersSearch}
                onChange={(e) => setPayersSearch(e.target.value)}
                className="w-56"
              />
              <Button
                variant="secondary"
                size="sm"
                onClick={() => fetchPayers(1, payersSearch)}
                disabled={payersLoading}
              >
                Search
              </Button>
            </div>
          </div>

          <Card>
            {payersLoading && !payersData ? (
              <div className="space-y-3 py-6" aria-busy="true">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-12 animate-pulse rounded bg-slate-100" />
                ))}
              </div>
            ) : !payersData || payersData.items.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-500">
                No payers found for this merchant.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                  <thead className="bg-slate-50 font-semibold uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="py-3 pl-4 pr-3">Customer Email</th>
                      <th className="px-3 py-3 text-center">Payments</th>
                      <th className="px-3 py-3 text-right">Total Spent</th>
                      <th className="px-3 py-3">Tokens Used</th>
                      <th className="px-3 py-3">Sources</th>
                      <th className="py-3 pl-3 pr-4">Last Payment</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {payersData.items.map((p: any) => (
                      <tr key={p.email} className="hover:bg-slate-50">
                        <td className="whitespace-nowrap py-3.5 pl-4 pr-3 font-semibold text-slate-900">
                          {p.email}
                          {p.name && <span className="block text-[11px] font-normal text-slate-500">{p.name}</span>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3.5 text-center font-bold text-slate-800">
                          {p.total_payments}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3.5 text-right font-mono font-bold text-emerald-600">
                          ${parseFloat(p.total_volume || '0').toLocaleString('en-US', { minimumFractionDigits: 2 })}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3.5">
                          <div className="flex flex-wrap gap-1">
                            {p.tokens_used.map((t: string) => (
                              <span key={t} className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                                {t}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3.5">
                          <div className="flex flex-wrap gap-1">
                            {p.sources.map((s: string) => (
                              <Badge key={s} variant={s === 'invoice' ? 'purple' : 'blue'}>
                                {s === 'invoice' ? 'Invoice' : 'Link'}
                              </Badge>
                            ))}
                          </div>
                        </td>
                        <td className="whitespace-nowrap py-3.5 pl-3 pr-4 text-slate-500">
                          {formatDateTime(p.last_payment_at || p.first_seen_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {payersData && payersData.total_pages > 1 && (
              <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 sm:px-6">
                <p className="text-xs text-slate-500">
                  Page {payersData.page} of {payersData.total_pages}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={payersData.page <= 1 || payersLoading}
                    onClick={() => setPayersPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={payersData.page >= payersData.total_pages || payersLoading}
                    onClick={() => setPayersPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      {/* Transactions Tab */}
      {activeTab === 'transactions' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-slate-900">Merchant Payment Transactions</h2>
            <div className="flex items-center gap-2">
              <select
                value={txStatusFilter}
                onChange={(e) => {
                  setTxStatusFilter(e.target.value)
                  setTxPage(1)
                }}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-xs focus:outline-none focus:ring-2 focus:ring-slate-400"
              >
                <option value="">All Statuses</option>
                <option value="confirmed">Confirmed</option>
                <option value="confirming">Confirming</option>
                <option value="detected">Detected</option>
                <option value="pending">Pending</option>
              </select>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => fetchTransactions(1, txStatusFilter)}
                disabled={txLoading}
              >
                Refresh
              </Button>
            </div>
          </div>

          <Card>
            {txLoading && !txData ? (
              <div className="space-y-3 py-6" aria-busy="true">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-12 animate-pulse rounded bg-slate-100" />
                ))}
              </div>
            ) : !txData || txData.items.length === 0 ? (
              <div className="py-10 text-center text-sm text-slate-500">
                No transactions found for this merchant.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-200 text-left text-xs">
                  <thead className="bg-slate-50 font-semibold uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="py-3 pl-4 pr-3">Date</th>
                      <th className="px-3 py-3">Source</th>
                      <th className="px-3 py-3">Payer Email</th>
                      <th className="px-3 py-3 text-right">Amount Paid</th>
                      <th className="px-3 py-3">Network & Wallet</th>
                      <th className="px-3 py-3">Status</th>
                      <th className="py-3 pl-3 pr-4">Tx Hash</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 bg-white">
                    {txData.items.map((tx: any) => (
                      <tr key={tx.id} className="hover:bg-slate-50">
                        <td className="whitespace-nowrap py-3.5 pl-4 pr-3 text-slate-600">
                          {formatDateTime(tx.created_at)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3.5">
                          <Badge variant={tx.source_type === 'payment_link' ? 'blue' : 'purple'}>
                            {tx.source_type === 'payment_link' ? 'Link' : 'Invoice'}
                          </Badge>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3.5 font-medium text-slate-900">
                          {tx.payer_email || <span className="italic text-slate-400">—</span>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3.5 text-right font-mono font-bold text-emerald-600">
                          {tx.amount} {tx.token_symbol}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3.5">
                          <span className="font-semibold capitalize text-slate-800">{tx.network}</span>
                          <span className="block font-mono text-[10px] text-slate-400">{truncateAddress(tx.to_address, 6)}</span>
                        </td>
                        <td className="whitespace-nowrap px-3 py-3.5">
                          <StatusBadge status={tx.status} />
                        </td>
                        <td className="whitespace-nowrap py-3.5 pl-3 pr-4 font-mono text-slate-500">
                          {tx.tx_hash ? truncateAddress(tx.tx_hash, 6) : <span className="text-slate-300">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {txData && txData.total_pages > 1 && (
              <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3 sm:px-6">
                <p className="text-xs text-slate-500">
                  Page {txData.page} of {txData.total_pages}
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={txData.page <= 1 || txLoading}
                    onClick={() => setTxPage((p) => Math.max(1, p - 1))}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={txData.page >= txData.total_pages || txLoading}
                    onClick={() => setTxPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </Card>
        </div>
      )}

      {activeTab === 'api_keys' && (
        <div className="space-y-6">
          {/* Active Keys Overview */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card title="Sandbox (Test) Active Credentials">
              <div className="space-y-3 pt-2">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-slate-400">Publishable Key (pk_test)</dt>
                  <dd className="mt-1 font-mono text-xs bg-slate-50 p-2.5 rounded-lg border border-slate-200 break-all text-slate-800">
                    {apiKeysData.find((k) => k.key_type === 'pk_test' && k.active)
                      ? `${apiKeysData.find((k) => k.key_type === 'pk_test' && k.active)?.prefix}...${apiKeysData.find((k) => k.key_type === 'pk_test' && k.active)?.suffix_display}`
                      : 'Not generated'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-slate-400">Secret Key (sk_test)</dt>
                  <dd className="mt-1 font-mono text-xs bg-slate-50 p-2.5 rounded-lg border border-slate-200 text-slate-600">
                    {apiKeysData.find((k) => k.key_type === 'sk_test' && k.active)
                      ? `${apiKeysData.find((k) => k.key_type === 'sk_test' && k.active)?.prefix}****************************${apiKeysData.find((k) => k.key_type === 'sk_test' && k.active)?.suffix_display}`
                      : 'Not generated'}
                  </dd>
                </div>
              </div>
            </Card>

            <Card title="Production (Live) Active Credentials">
              <div className="space-y-3 pt-2">
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-slate-400">Publishable Key (pk_live)</dt>
                  <dd className="mt-1 font-mono text-xs bg-slate-50 p-2.5 rounded-lg border border-slate-200 break-all text-slate-800">
                    {apiKeysData.find((k) => k.key_type === 'pk_live' && k.active)
                      ? `${apiKeysData.find((k) => k.key_type === 'pk_live' && k.active)?.prefix}...${apiKeysData.find((k) => k.key_type === 'pk_live' && k.active)?.suffix_display}`
                      : <span className="text-slate-400 italic">No live publishable key generated</span>}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-semibold uppercase tracking-wider text-slate-400">Secret Key (sk_live)</dt>
                  <dd className="mt-1 font-mono text-xs bg-slate-50 p-2.5 rounded-lg border border-slate-200 text-slate-600">
                    {apiKeysData.find((k) => k.key_type === 'sk_live' && k.active)
                      ? `${apiKeysData.find((k) => k.key_type === 'sk_live' && k.active)?.prefix}****************************${apiKeysData.find((k) => k.key_type === 'sk_live' && k.active)?.suffix_display}`
                      : <span className="text-slate-400 italic">No live secret key generated</span>}
                  </dd>
                </div>
              </div>
            </Card>
          </div>

          {/* Key Rotation Audit History */}
          <Card
            title={
              <div className="flex items-center justify-between">
                <span>API Key Rotation Audit Trail</span>
                <Badge variant="blue">{apiKeysData.length} {apiKeysData.length === 1 ? 'Key' : 'Keys'} Recorded</Badge>
              </div>
            }
          >
            {apiKeysLoading ? (
              <div className="py-8 text-center text-xs text-slate-400">Loading API keys rotation history...</div>
            ) : apiKeysData.length === 0 ? (
              <div className="rounded-xl border border-dashed border-slate-200 p-8 text-center text-xs text-slate-400">
                No API key records found for this merchant.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200 mt-2">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-4 py-2.5">Key Type</th>
                      <th className="px-4 py-2.5">Key Identifier</th>
                      <th className="px-4 py-2.5">Status</th>
                      <th className="px-4 py-2.5">Created Date</th>
                      <th className="px-4 py-2.5">Revoked Date</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {apiKeysData.map((key) => {
                      const isKeyLive = key.key_type.includes('live')
                      return (
                        <tr key={key.id} className="hover:bg-slate-50/60 transition-colors">
                          <td className="px-4 py-3 font-mono font-bold">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] ${
                                isKeyLive
                                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                  : 'bg-amber-50 text-amber-800 border border-amber-200'
                              }`}
                            >
                              {key.key_type}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-mono text-slate-700">
                            {key.prefix}...{key.suffix_display}
                          </td>
                          <td className="px-4 py-3">
                            {key.active ? (
                              <span className="inline-flex items-center gap-1 text-emerald-700 font-semibold">
                                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                                Active
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-slate-400 font-medium">
                                <span className="h-1.5 w-1.5 rounded-full bg-slate-300" />
                                Revoked
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {formatDateTime(key.created_at)}
                          </td>
                          <td className="px-4 py-3 text-slate-400">
                            {key.revoked_at ? formatDateTime(key.revoked_at) : '—'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

        </div>

        {/* Suspend/Unsuspend modal */}
        <SuspendMerchantModal
          isOpen={suspendModalOpen}
          onClose={() => setSuspendModalOpen(false)}
          userId={merchant.user_id}
          merchantName={displayName}
          currentStatus={merchant.user_status}
          onSuccess={handleSuspendSuccess}
        />

        {/* Section Rejection modal */}
        <SectionRejectModal
          isOpen={rejectSectionModal.isOpen}
          onClose={() =>
            setRejectSectionModal((prev) => ({ ...prev, isOpen: false }))
          }
          userId={merchant.user_id}
          section={rejectSectionModal.section}
          sectionTitle={rejectSectionModal.sectionTitle}
          onSuccess={handleSectionRejectSuccess}
        />

        {/* Document Preview Modal */}
        <DocumentPreviewModal
          isOpen={previewModal.isOpen}
          onClose={() => setPreviewModal((prev) => ({ ...prev, isOpen: false }))}
          title={previewModal.title}
          documentUrl={previewModal.documentUrl}
        />
      </AppShell>
    </ProtectedRoute>
  )
}
