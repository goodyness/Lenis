import { isAxiosError } from 'axios'
import { apiClient } from '../lib/api'
import { ApiError } from './errors'

export { ApiError }

// ─── Types ────────────────────────────────────────────────────────────────────

export type KYCStatus = 'not_started' | 'pending' | 'approved' | 'rejected'
export type MerchantUserStatus = 'active' | 'suspended'
export type OnboardingStatus = 'incomplete' | 'pending_kyc_review' | 'kyc_approved' | 'kyc_rejected'

export interface KYCApproveResult {
  kyc_status: KYCStatus
}

// ─── Merchant list types ───────────────────────────────────────────────────────

export interface MerchantListItem {
  user_id: string
  email: string
  full_name: string
  onboarding_status: OnboardingStatus
  kyc_status: KYCStatus
  wallet_count: number
  created_at: string
}

export interface PaginatedMerchants {
  items: MerchantListItem[]
  total: number
  page: number
  page_size: number
  pages: number
}

export interface KYCRejectResult {
  kyc_status: KYCStatus
  kyc_rejection_reason: string
}

export interface SuspendResult {
  status: MerchantUserStatus
}

// ─── Error helper ─────────────────────────────────────────────────────────────

function handleAxiosError(err: unknown): never {
  if (isAxiosError(err) && err.response) {
    const { status, data } = err.response
    const detail: string =
      typeof data?.detail === 'string' ? data.detail : 'An error occurred'
    const code: string | undefined =
      typeof data?.code === 'string' ? data.code : undefined
    throw new ApiError(status, detail, code)
  }
  throw err
}

// ─── KYC endpoints ───────────────────────────────────────────────────────────

/**
 * Approve a merchant's KYC submission.
 * POST /admin/merchants/{userId}/kyc/approve
 */
export async function approveKYC(userId: string): Promise<KYCApproveResult> {
  try {
    const { data } = await apiClient.post<KYCApproveResult>(
      `/admin/merchants/${userId}/kyc/approve`,
      {},
    )
    return data
  } catch (err) {
    handleAxiosError(err)
  }
}

/**
 * Reject a merchant's KYC submission with a reason.
 * POST /admin/merchants/{userId}/kyc/reject
 */
export async function rejectKYC(
  userId: string,
  rejectionReason: string,
): Promise<KYCRejectResult> {
  try {
    const { data } = await apiClient.post<KYCRejectResult>(
      `/admin/merchants/${userId}/kyc/reject`,
      { rejection_reason: rejectionReason },
    )
    return data
  } catch (err) {
    handleAxiosError(err)
  }
}

/**
 * Revoke merchant KYC approval and request updates for specified sections.
 * POST /admin/merchants/{userId}/kyc/revoke
 */
export async function revokeKYC(
  userId: string,
  rejectionReason: string,
  sections: string[] = ['personal', 'business', 'kyc'],
): Promise<{ message: string; code: string }> {
  try {
    const { data } = await apiClient.post<{ message: string; code: string }>(
      `/admin/merchants/${userId}/kyc/revoke`,
      { rejection_reason: rejectionReason, sections },
    )
    return data
  } catch (err) {
    handleAxiosError(err)
  }
}

// ─── Suspend / unsuspend endpoints ───────────────────────────────────────────

/**
 * Suspend a merchant account.
 * POST /admin/merchants/{userId}/suspend
 */
export async function suspendMerchant(userId: string): Promise<SuspendResult> {
  try {
    const { data } = await apiClient.post<SuspendResult>(
      `/admin/merchants/${userId}/suspend`,
      {},
    )
    return data
  } catch (err) {
    handleAxiosError(err)
  }
}

/**
 * Unsuspend a previously suspended merchant account.
 * POST /admin/merchants/{userId}/unsuspend
 */
export async function unsuspendMerchant(userId: string): Promise<SuspendResult> {
  try {
    const { data } = await apiClient.post<SuspendResult>(
      `/admin/merchants/${userId}/unsuspend`,
      {},
    )
    return data
  } catch (err) {
    handleAxiosError(err)
  }
}

// ─── Merchant list endpoint ───────────────────────────────────────────────────

/**
 * Fetch a paginated list of merchant accounts.
 * GET /admin/merchants?page=N&page_size=N
 */
export async function listMerchants(
  page: number,
  pageSize: number = 20,
): Promise<PaginatedMerchants> {
  try {
    const { data } = await apiClient.get<PaginatedMerchants>('/admin/merchants', {
      params: { page, page_size: pageSize },
    })
    return data
  } catch (err) {
    handleAxiosError(err)
  }
}


export type SectionStatus = 'pending' | 'approved' | 'rejected'

export interface WalletItem {
  id: string
  network: string
  address: string
  status: string
  created_at: string
}

export interface MerchantDetailResponse {
  user_id: string
  email: string
  user_status: MerchantUserStatus
  full_name: string
  country: string
  phone_number: string
  personal_info_status: SectionStatus
  personal_info_rejection_reason: string | null
  business_name: string | null
  business_address?: string | null
  business_description?: string | null
  business_category?: string | null
  monthly_volume_estimate?: string | null
  website_url: string | null
  social_instagram: string | null
  social_twitter: string | null
  social_facebook: string | null
  social_linkedin: string | null
  social_tiktok: string | null
  is_registered_business: boolean
  registration_doc_path: string | null
  business_info_status: SectionStatus
  business_info_rejection_reason: string | null
  kyc_status: KYCStatus
  kyc_document_path: string | null
  kyc_document_type: string | null
  nin: string | null
  kyc_dojah_session_id: string | null
  kyc_didit_session_id?: string | null
  kyc_reviewed_at: string | null
  kyc_rejection_reason: string | null
  onboarding_complete: boolean
  onboarding_step: number
  wallet_added: boolean
  wallets: WalletItem[]
  payment_link_count: number
  invoice_count: number
  total_confirmed_volume: string
  created_at: string
  updated_at: string
}

export interface KYCDocumentsResponse {
  kyc_document_url: string | null
  registration_doc_url: string | null
}

// ─── Merchant detail endpoints ────────────────────────────────────────────────

/**
 * Fetch full detail for a single merchant.
 * GET /admin/merchants/{userId}
 */
export async function getMerchantDetail(userId: string): Promise<MerchantDetailResponse> {
  try {
    const { data } = await apiClient.get<MerchantDetailResponse>(
      `/admin/merchants/${userId}`,
    )
    return data
  } catch (err) {
    handleAxiosError(err)
  }
}

/**
 * Fetch signed KYC document download URLs for a merchant.
 * GET /admin/merchants/{userId}/kyc-documents
 */
export async function getKYCDocuments(userId: string): Promise<KYCDocumentsResponse> {
  try {
    const { data } = await apiClient.get<KYCDocumentsResponse>(
      `/admin/merchants/${userId}/kyc-documents`,
    )
    return data
  } catch (err) {
    handleAxiosError(err)
  }
}

/**
 * Reject a specific merchant profile section (personal, business, kyc).
 * POST /admin/merchants/{userId}/sections/reject
 */
export async function rejectMerchantSection(
  userId: string,
  section: 'personal' | 'business' | 'kyc',
  rejectionReason: string,
): Promise<{ message: string; code: string }> {
  try {
    const { data } = await apiClient.post<{ message: string; code: string }>(
      `/admin/merchants/${userId}/sections/reject`,
      { section, rejection_reason: rejectionReason },
    )
    return data
  } catch (err) {
    handleAxiosError(err)
  }
}

// ─── Admin Payers & Merchant Transactions ─────────────────────────────────────

export interface AdminGlobalPayerItem {
  email: string
  name?: string | null
  merchant_count: number
  merchants: string[]
  total_payments: number
  successful_payments?: number
  pending_payments?: number
  expired_payments?: number
  status_breakdown?: Record<string, number>
  total_volume_usd: string
  tokens_used: string[]
  networks_used: string[]
  last_payment_at?: string | null
  first_seen_at: string
}

export interface PaginatedAdminPayersResponse {
  items: AdminGlobalPayerItem[]
  total: number
  total_volume_usd: string
  page: number
  page_size: number
  pages: number
}

export interface PayerActivityLogItem {
  id: string
  type: string
  title: string
  status: string
  amount_crypto?: string | null
  token_symbol?: string | null
  network?: string | null
  usd_amount?: string | null
  tx_hash?: string | null
  created_at: string
  confirmed_at?: string | null
  merchant_name?: string | null
  merchant_id?: string | null
  checkout_url?: string | null
}

export interface AdminPayerDetailResponse {
  email: string
  name?: string | null
  merchant_count: number
  merchants: string[]
  total_attempts: number
  successful_payments: number
  pending_payments: number
  expired_payments: number
  total_volume_usd: string
  tokens_used: string[]
  networks_used: string[]
  first_seen_at: string
  last_active_at?: string | null
  status_breakdown: Record<string, number>
  activity_logs: PayerActivityLogItem[]
}

/**
 * Fetch platform-wide global payers directory.
 * GET /admin/payers
 */
export async function getGlobalPayers(
  page: number = 1,
  pageSize: number = 20,
  search?: string,
): Promise<PaginatedAdminPayersResponse> {
  try {
    const params = new URLSearchParams({
      page: String(page),
      page_size: String(pageSize),
    })
    if (search) params.set('search', search)
    const { data } = await apiClient.get<PaginatedAdminPayersResponse>(
      `/admin/payers?${params.toString()}`,
    )
    return data
  } catch (err) {
    handleAxiosError(err)
  }
}

/**
 * Fetch detailed single payer profile and full history across platform.
 * GET /admin/payers/{email}
 */
export async function getGlobalPayerDetail(
  email: string,
): Promise<AdminPayerDetailResponse> {
  try {
    const { data } = await apiClient.get<AdminPayerDetailResponse>(
      `/admin/payers/${encodeURIComponent(email)}`,
    )
    return data
  } catch (err) {
    handleAxiosError(err)
  }
}

/**
 * Fetch payer directory for a specific merchant.
 * GET /admin/merchants/{userId}/payers
 */
export async function getMerchantPayersAdmin(
  userId: string,
  page: number = 1,
  pageSize: number = 20,
  search?: string,
) {
  try {
    const params = new URLSearchParams({
      page: String(page),
      page_size: String(pageSize),
    })
    if (search) params.set('search', search)
    const { data } = await apiClient.get(
      `/admin/merchants/${userId}/payers?${params.toString()}`,
    )
    return data
  } catch (err) {
    handleAxiosError(err)
  }
}

/**
 * Fetch transaction history for a specific merchant.
 * GET /admin/merchants/{userId}/transactions
 */
export async function getMerchantTransactionsAdmin(
  userId: string,
  page: number = 1,
  pageSize: number = 20,
  statusFilter?: string,
) {
  try {
    const params = new URLSearchParams({
      page: String(page),
      page_size: String(pageSize),
    })
    if (statusFilter) params.set('status_filter', statusFilter)
    const { data } = await apiClient.get(
      `/admin/merchants/${userId}/transactions?${params.toString()}`,
    )
    return data
  } catch (err) {
    handleAxiosError(err)
  }
}

/**
 * Check and sync Didit automated KYC decision for a merchant.
 * POST /admin/merchants/{userId}/kyc/didit/check
 */
export async function checkAdminDiditStatus(userId: string) {
  try {
    const { data } = await apiClient.post(`/admin/merchants/${userId}/kyc/didit/check`)
    return data
  } catch (err) {
    handleAxiosError(err)
  }
}

/**
 * Generate a Didit automated KYC verification session link for a merchant.
 * POST /admin/merchants/{userId}/kyc/didit/session
 */
export interface APIKeyHistoryItem {
  id: string
  key_type: string
  prefix: string
  suffix_display: string
  active: boolean
  created_at: string
  revoked_at: string | null
}

export interface APIKeyHistoryResponse {
  keys: APIKeyHistoryItem[]
  total: number
}

/**
 * Fetch API keys credentials and rotation history for a merchant.
 * GET /admin/merchants/{userId}/api-keys
 */
export async function getMerchantAPIKeysAdmin(userId: string): Promise<APIKeyHistoryResponse> {
  try {
    const { data } = await apiClient.get<APIKeyHistoryResponse>(
      `/admin/merchants/${userId}/api-keys`,
    )
    return data
  } catch (err) {
    handleAxiosError(err)
  }
}



