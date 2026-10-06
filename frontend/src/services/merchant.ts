import { isAxiosError } from 'axios'
import { apiClient } from '../lib/api'
import type {
  DashboardOverview,
  Invoice,
  InvoiceCreate,
  InvoiceStatus,
  MerchantWallet,
  Network,
  PaginatedResult,
  PaymentLink,
  PaymentLinkCreate,
  WalletChallenge,
  WalletCreate,
} from '../stores/merchantStore'
import type { OnboardingStatus } from '../stores/onboardingStore'
import { ApiError } from './errors'

export { ApiError }

// ─── Error helper ─────────────────────────────────────────────────────────────

function handleAxiosError(err: unknown): never {
  if (isAxiosError(err) && err.response) {
    const { status, data } = err.response

    // FastAPI can return detail in three shapes:
    //   1. Plain string - our custom HTTPException with detail=str
    //   2. Object {detail, code} - legacy nested shape (being phased out)
    //   3. Array [{loc, msg, type}] - FastAPI's native request validation errors
    let detail: string
    let code: string | undefined

    if (typeof data?.detail === 'string') {
      detail = data.detail
      code = typeof data?.code === 'string' ? data.code : undefined
    } else if (Array.isArray(data?.detail) && data.detail.length > 0) {
      // FastAPI validation error list - turn into a human-readable sentence
      const first = data.detail[0]
      const rawLoc: string[] = Array.isArray(first?.loc) ? first.loc.slice(1).map(String) : []
      const fieldName = rawLoc.length > 0
        ? rawLoc[rawLoc.length - 1]
            .replace(/_/g, ' ')
            .replace(/\b\w/g, (c: string) => c.toUpperCase())
        : ''
      const rawMsg: string = typeof first?.msg === 'string' ? first.msg : ''
      // Strip Pydantic prefixes like "Value error, " or "String should have at least..."
      const cleanMsg = rawMsg
        .replace(/^value error,\s*/i, '')
        .replace(/^string should have at least \d+ character.*$/i, 'is too short')
        .replace(/^string should have at most \d+ character.*$/i, 'is too long')
        .replace(/^field required$/i, 'is required')
      detail = fieldName ? `${fieldName} ${cleanMsg}` : (cleanMsg || 'Please check your input and try again.')
    } else if (data?.detail && typeof data.detail === 'object' && typeof data.detail.detail === 'string') {
      // Legacy nested {detail: string, code: string} shape
      detail = data.detail.detail
      code = typeof data.detail.code === 'string' ? data.detail.code : undefined
    } else {
      detail = 'An error occurred'
    }

    throw new ApiError(status, detail, code)
  }
  throw err
}

// ─── Onboarding ───────────────────────────────────────────────────────────────

/**
 * Fetch the authenticated merchant's current onboarding status.
 * GET /merchant/onboarding-status
 */
export async function getOnboardingStatus(): Promise<OnboardingStatus> {
  try {
    const { data } = await apiClient.get<OnboardingStatus>(
      '/merchant/onboarding-status',
    )
    return data
  } catch (err) {
    handleAxiosError(err)
  }
}

/**
 * Submit data for a specific onboarding wizard step.
 * PATCH /merchant/onboarding/{step}
 *
 * Steps 2 and 3 should pass a `FormData` instance (Axios sets multipart/form-data automatically).
 * Steps 1 and 4 can pass a plain object (sent as JSON).
 */
export async function submitOnboardingStep(
  step: 1 | 2 | 3 | 4,
  data: FormData | object,
): Promise<OnboardingStatus> {
  try {
    const { data: response } = await apiClient.patch<OnboardingStatus>(
      `/merchant/onboarding/${step}`,
      data,
    )
    return response
  } catch (err) {
    handleAxiosError(err)
  }
}

// ─── Wallets ──────────────────────────────────────────────────────────────────

/**
 * Request an EIP-191 verification challenge nonce for a wallet address.
 * POST /merchant/wallets/challenge
 */
export async function getWalletChallenge(address: string): Promise<WalletChallenge> {
  try {
    const { data } = await apiClient.post<WalletChallenge>(
      '/merchant/wallets/challenge',
      { address },
    )
    return data
  } catch (err) {
    handleAxiosError(err)
  }
}

/**
 * List all wallets for the authenticated merchant.
 * GET /merchant/wallets
 */
export async function listWallets(): Promise<MerchantWallet[]> {
  try {
    const { data } = await apiClient.get<MerchantWallet[]>('/merchant/wallets')
    return data
  } catch (err) {
    handleAxiosError(err)
  }
}

/**
 * Add a new wallet for the authenticated merchant.
 * POST /merchant/wallets
 */
export async function addWallet(data: WalletCreate): Promise<MerchantWallet> {
  try {
    const { data: created } = await apiClient.post<MerchantWallet>(
      '/merchant/wallets',
      data,
    )
    return created
  } catch (err) {
    handleAxiosError(err)
  }
}

/**
 * Delete (soft-delete) a wallet by ID.
 * DELETE /merchant/wallets/{walletId}
 */
export async function deleteWallet(walletId: string): Promise<void> {
  try {
    await apiClient.delete(`/merchant/wallets/${walletId}`)
  } catch (err) {
    handleAxiosError(err)
  }
}

// ─── Payment links ────────────────────────────────────────────────────────────

/**
 * List the authenticated merchant's payment links (paginated).
 * GET /merchant/payment-links
 */
export async function listPaymentLinks(
  page = 1,
  pageSize = 20,
): Promise<PaginatedResult<PaymentLink>> {
  try {
    const params = new URLSearchParams({
      page: String(page),
      page_size: String(pageSize),
    })
    const { data } = await apiClient.get<PaginatedResult<PaymentLink>>(
      `/merchant/payment-links?${params.toString()}`,
    )
    return data
  } catch (err) {
    handleAxiosError(err)
  }
}

/**
 * Create a new payment link.
 * POST /merchant/payment-links
 */
export async function createPaymentLink(
  data: PaymentLinkCreate,
): Promise<PaymentLink> {
  try {
    const { data: created } = await apiClient.post<PaymentLink>(
      '/merchant/payment-links',
      data,
    )
    return created
  } catch (err) {
    handleAxiosError(err)
  }
}

/**
 * Deactivate a payment link.
 * PATCH /merchant/payment-links/{linkId}
 */
export async function deactivatePaymentLink(
  linkId: string,
): Promise<PaymentLink> {
  try {
    const { data } = await apiClient.patch<PaymentLink>(
      `/merchant/payment-links/${linkId}`,
      { status: 'inactive' },
    )
    return data
  } catch (err) {
    handleAxiosError(err)
  }
}

/**
 * Download a QR code PNG for a payment link.
 * GET /merchant/payment-links/{linkId}/qr
 */
export async function getPaymentLinkQR(linkId: string): Promise<Blob> {
  try {
    const { data } = await apiClient.get<Blob>(
      `/merchant/payment-links/${linkId}/qr`,
      { responseType: 'blob' },
    )
    return data
  } catch (err) {
    handleAxiosError(err)
  }
}

// ─── Invoices ─────────────────────────────────────────────────────────────────

/**
 * List the authenticated merchant's invoices (paginated, with optional status filter).
 * GET /merchant/invoices
 */
export async function listInvoices(
  page = 1,
  pageSize = 20,
  status?: InvoiceStatus,
): Promise<PaginatedResult<Invoice>> {
  try {
    const params = new URLSearchParams({
      page: String(page),
      page_size: String(pageSize),
    })
    if (status !== undefined) {
      params.set('status', status)
    }
    const { data } = await apiClient.get<PaginatedResult<Invoice>>(
      `/merchant/invoices?${params.toString()}`,
    )
    return data
  } catch (err) {
    handleAxiosError(err)
  }
}

/**
 * Create a new invoice (initially in draft status).
 * POST /merchant/invoices
 */
export async function createInvoice(data: InvoiceCreate): Promise<Invoice> {
  try {
    const { data: created } = await apiClient.post<Invoice>(
      '/merchant/invoices',
      data,
    )
    return created
  } catch (err) {
    handleAxiosError(err)
  }
}

/**
 * Send a draft invoice to the customer (triggers email).
 * POST /merchant/invoices/{invoiceId}/send
 */
export async function sendInvoice(invoiceId: string): Promise<Invoice> {
  try {
    const { data } = await apiClient.post<Invoice>(
      `/merchant/invoices/${invoiceId}/send`,
    )
    return data
  } catch (err) {
    handleAxiosError(err)
  }
}

/**
 * Cancel an invoice.
 * POST /merchant/invoices/{invoiceId}/cancel
 */
export async function cancelInvoice(invoiceId: string): Promise<Invoice> {
  try {
    const { data } = await apiClient.post<Invoice>(
      `/merchant/invoices/${invoiceId}/cancel`,
    )
    return data
  } catch (err) {
    handleAxiosError(err)
  }
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

/**
 * Fetch the merchant dashboard overview (lifetime total, pending count, recent transactions).
 * GET /merchant/dashboard/overview
 */
export async function getDashboardOverview(): Promise<DashboardOverview> {
  try {
    const { data } = await apiClient.get<DashboardOverview>(
      '/merchant/dashboard/overview',
    )
    return data
  } catch (err) {
    handleAxiosError(err)
  }
}

// ─── Transactions & Payer Directory ──────────────────────────────────────────

export interface TransactionDetailItem {
  id: string
  tx_hash?: string | null
  network: string
  token_symbol: string
  amount: string
  from_address?: string | null
  to_address: string
  payer_email?: string | null
  status: string
  confirmations: number
  source_type: 'payment_link' | 'invoice'
  source_title?: string | null
  source_id?: string | null
  source_slug?: string | null
  confirmed_at?: string | null
  created_at: string
}

export interface TransactionListResult {
  items: TransactionDetailItem[]
  total: number
  total_volume_usd: string
  tokens_breakdown: Record<string, string>
  page: number
  page_size: number
  total_pages: number
}

export interface PayerDirectoryItem {
  email: string
  name?: string | null
  total_payments: number
  successful_payments?: number
  pending_payments?: number
  expired_payments?: number
  status_breakdown?: Record<string, number>
  total_volume: string
  tokens_used: string[]
  networks_used: string[]
  last_payment_at?: string | null
  first_seen_at: string
  sources: string[]
}

export interface PayerDirectoryResult {
  items: PayerDirectoryItem[]
  total: number
  total_payers: number
  total_volume: string
  page: number
  page_size: number
  total_pages: number
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

export interface PayerDetailResponse {
  email: string
  name?: string | null
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
 * Fetch full merchant transaction history.
 * GET /merchant/transactions
 */
export async function getMerchantTransactions(
  page: number = 1,
  pageSize: number = 20,
  statusFilter?: string,
): Promise<TransactionListResult> {
  try {
    const params = new URLSearchParams({
      page: String(page),
      page_size: String(pageSize),
    })
    if (statusFilter) params.set('status_filter', statusFilter)
    const { data } = await apiClient.get<TransactionListResult>(
      `/merchant/transactions?${params.toString()}`,
    )
    return data
  } catch (err) {
    handleAxiosError(err)
  }
}

/**
 * Fetch merchant payer / customer directory.
 * GET /merchant/payers
 */
export async function getMerchantPayers(
  page: number = 1,
  pageSize: number = 20,
  search?: string,
): Promise<PayerDirectoryResult> {
  try {
    const params = new URLSearchParams({
      page: String(page),
      page_size: String(pageSize),
    })
    if (search) params.set('search', search)
    const { data } = await apiClient.get<PayerDirectoryResult>(
      `/merchant/payers?${params.toString()}`,
    )
    return data
  } catch (err) {
    handleAxiosError(err)
  }
}

/**
 * Fetch single customer profile and activity history for merchant.
 * GET /merchant/payers/{email}
 */
export async function getMerchantPayerDetail(
  email: string,
): Promise<PayerDetailResponse> {
  try {
    const { data } = await apiClient.get<PayerDetailResponse>(
      `/merchant/payers/${encodeURIComponent(email)}`,
    )
    return data
  } catch (err) {
    handleAxiosError(err)
  }
}

// ─── Networks (re-export for convenience) ────────────────────────────────────

export type { Network }

