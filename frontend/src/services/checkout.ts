import { isAxiosError } from 'axios'
import { apiClient } from '../lib/api'
import type { AcceptedToken } from '../stores/merchantStore'
import { ApiError } from './errors'

export { ApiError }

// ─── Checkout-specific types ──────────────────────────────────────────────────

export interface CheckoutWalletInfo {
  network: string
  address: string
}

export interface CheckoutLinkResponse {
  merchant_name: string
  title: string
  amount_mode: 'fixed' | 'flexible'
  amount: string | null
  currency?: string | null
  accepted_tokens: AcceptedToken[]
  wallets?: CheckoutWalletInfo[]
  /** Legacy fallback for merchant wallet address. */
  wallet_address?: string | null
  slug?: string
  
  // Store branding
  brand_logo_url?: string | null
  brand_color?: string | null
  brand_tagline?: string | null
  support_email?: string | null
  support_phone?: string | null

  // Link customizations
  redirect_url?: string | null
  custom_message?: string | null
  collect_phone?: boolean
  collect_address?: boolean
}

export interface PaymentBroadcastRequest {
  network: string
  token_symbol: string
  contract_address?: string | null
  from_address: string
  to_address: string
  amount: string
  tx_hash: string
  payer_email?: string | null
  payer_phone?: string | null
  payer_address?: string | null
}

export interface PaymentStatusResponse {
  status: 'pending' | 'detected' | 'confirming' | 'confirmed' | 'paid' | 'underpaid' | 'expired' | 'failed'
  tx_hash?: string | null
  confirmations?: number
  required_confirmations?: number
  block_number?: number | null
  amount?: string | null
  token_symbol?: string | null
  network?: string | null
  from_address?: string | null
  to_address?: string | null
  payer_email?: string | null
  payer_phone?: string | null
  payer_address?: string | null
  confirmed_at?: string | null
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

// ─── Checkout service functions ───────────────────────────────────────────────

/**
 * Fetch public checkout data for a payment link slug.
 * GET /pay/{slug}
 *
 * Throws `ApiError` with status 404 if the slug is unknown, or 410 if the link
 * is inactive, expired, or exhausted.
 */
export async function getCheckoutData(
  slug: string,
): Promise<CheckoutLinkResponse> {
  try {
    const { data } = await apiClient.get<CheckoutLinkResponse>(`/pay/${slug}`)
    return data
  } catch (err) {
    handleAxiosError(err)
  }
}

/**
 * Poll the current payment status for a payment link slug.
 * GET /pay/{slug}/status
 *
 * Safe to call repeatedly — no side effects.
 */
export async function getPaymentStatus(
  slug: string,
): Promise<PaymentStatusResponse> {
  try {
    const { data } = await apiClient.get<PaymentStatusResponse>(
      `/pay/${slug}/status`,
    )
    return data
  } catch (err) {
    handleAxiosError(err)
  }
}

/**
 * Broadcast a newly submitted wallet transaction to the backend.
 * POST /pay/{slug}/broadcast
 */
export async function broadcastPayment(
  slug: string,
  payload: PaymentBroadcastRequest,
): Promise<PaymentStatusResponse> {
  try {
    const { data } = await apiClient.post<PaymentStatusResponse>(
      `/pay/${slug}/broadcast`,
      payload,
    )
    return data
  } catch (err) {
    handleAxiosError(err)
  }
}

export interface CheckoutSessionResponse {
  session_id?: string | null
  status: string
  expires_in_seconds: number
  created_at?: string | null
}

/**
 * Initiate or refresh 20-minute checkout session and exchange rate.
 * POST /pay/{slug}/session
 */
export async function createCheckoutSession(
  slug: string,
  payload: {
    payer_email?: string
    payer_phone?: string
    payer_address?: string
    network?: string
    token_symbol?: string
    amount?: string | number
    from_address?: string
  },
): Promise<CheckoutSessionResponse> {
  try {
    const { data } = await apiClient.post<CheckoutSessionResponse>(
      `/pay/${slug}/session`,
      payload,
    )
    return data
  } catch (err) {
    handleAxiosError(err)
  }
}

/**
 * Mark checkout session as expired.
 * POST /pay/{slug}/expire
 */
export async function expireCheckoutSession(
  slug: string,
  payload: {
    payer_email?: string
    session_id?: string
  },
): Promise<{ status: string; detail: string }> {
  try {
    const { data } = await apiClient.post<{ status: string; detail: string }>(
      `/pay/${slug}/expire`,
      payload,
    )
    return data
  } catch (err) {
    handleAxiosError(err)
  }
}

