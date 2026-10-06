import { create } from 'zustand'
import { apiClient } from '../lib/api'

// ─── Domain types ────────────────────────────────────────────────────────────

export interface DailyVolumePoint {
  date: string
  volume_usd: string | number
  count: number
  successful_count: number
}

export interface RecentTransaction {
  type: 'link' | 'invoice'
  payment_type?: string
  amount: string // decimal string
  token_symbol: string
  network: string
  status: 'pending' | 'detected' | 'confirming' | 'confirmed' | 'paid'
  created_at: string // ISO 8601
  timestamp?: string
  tx_hash?: string | null
  source_title?: string | null
  payer_email?: string | null
}

export interface DashboardOverview {
  lifetime_total: string // decimal string, 2 dp
  lifetime_total_token?: string
  pending_count: number
  confirmed_count?: number
  total_transactions?: number
  success_rate?: number
  volume_30d?: string
  active_links_count?: number
  open_invoices_count?: number
  network_breakdown?: Record<string, string | number>
  token_breakdown?: Record<string, string | number>
  daily_volume?: DailyVolumePoint[]
  recent_transactions: RecentTransaction[]
}

export interface PaginatedResult<T> {
  items: T[]
  total: number
  page: number
  page_size: number
  total_pages: number
}

export interface AcceptedToken {
  network: string
  token_symbol: string
  contract_address: string | null
}

export interface PaymentLink {
  id: string
  title: string
  slug: string
  amount_mode: 'fixed' | 'flexible'
  amount: string | null
  currency: string | null
  accepted_tokens: AcceptedToken[]
  status: 'active' | 'inactive' | 'suspended_by_admin'
  expires_at: string | null
  max_uses: number | null
  use_count: number
  redirect_url: string | null
  custom_message: string | null
  collect_phone: boolean
  collect_address: boolean
  total_collected: string
  created_at: string
  updated_at: string
  payment_url: string
}

export interface PaymentLinkCreate {
  title: string
  amount_mode: 'fixed' | 'flexible'
  amount?: string
  accepted_tokens: AcceptedToken[]
  expires_at?: string
  max_uses?: number
  redirect_url?: string
  custom_message?: string
  collect_phone?: boolean
  collect_address?: boolean
}

export interface Branding {
  business_name?: string | null
  brand_logo_url?: string | null
  brand_color: string
  brand_tagline?: string | null
  support_email?: string | null
  support_phone?: string | null
}

export interface BrandingUpdate {
  brand_logo_url?: string | null
  brand_color?: string
  brand_tagline?: string | null
  support_email?: string | null
  support_phone?: string | null
}

export interface DailyVolumePoint {
  date: string
  volume_usd: string | number
  count: number
  successful_count: number
}

export interface TopLinkItem {
  id: string
  title: string
  slug: string
  total_volume_usd: string | number
  total_transactions: number
  successful_transactions: number
}

export interface ReportSummary {
  period: string
  start_date: string
  end_date: string
  gross_revenue_usd: string | number
  total_transactions: number
  successful_payments: number
  pending_payments: number
  expired_payments: number
  failed_payments: number
  average_order_value_usd: string | number
  conversion_rate: number
  daily_volume_series: DailyVolumePoint[]
  token_breakdown: Record<string, string | number>
  network_breakdown: Record<string, string | number>
  top_links: TopLinkItem[]
}

export interface LineItem {
  id: string
  description: string
  amount: string
  sort_order: number
}

export type InvoiceStatus =
  | 'draft'
  | 'sent'
  | 'viewed'
  | 'paid'
  | 'overdue'
  | 'cancelled'

export interface Invoice {
  id: string
  customer_name: string
  customer_email: string
  due_date: string
  status: InvoiceStatus
  notes: string | null
  accepted_tokens: AcceptedToken[]
  line_items: LineItem[]
  created_at: string
  updated_at: string
}

export interface LineItemCreate {
  description: string
  amount: string
  sort_order?: number
}

export interface InvoiceCreate {
  customer_name: string
  customer_email: string
  due_date: string
  notes?: string
  accepted_tokens: AcceptedToken[]
  line_items: LineItemCreate[]
}

export interface MerchantWallet {
  id: string
  network: string
  address: string
  status: 'active' | 'pending' | 'inactive'
  created_at: string
  updated_at: string
}

export interface WalletChallenge {
  challenge: string
  nonce: string
  address: string
  expires_in: number
}

export interface WalletCreate {
  network: string
  address: string
  signature?: string
  nonce?: string
}

export interface TokenInfo {
  symbol: string
  contract_address: string | null
}

export interface Network {
  display_name: string
  chain_id: number
  native_symbol: string
  tokens: TokenInfo[]
}

export interface SubscriptionOverview {
  tier: string
  tier_name: string
  monthly_tx_count: number
  monthly_tx_cap: number
  period?: string | null
  expires_at?: string | null
  features: string[]
  is_active: boolean
}

// Tier limits matching app/core/tier_limits.py
export const TIER_LIMITS: Record<string, number | null> = {
  free: 50,
  growth: 500,
  pro: 5000,
  enterprise: null, // Unlimited
}

// ─── Store interface ─────────────────────────────────────────────────────────

interface MerchantStore {
  // State
  overview: DashboardOverview | null
  paymentLinks: PaginatedResult<PaymentLink> | null
  invoices: PaginatedResult<Invoice> | null
  wallets: MerchantWallet[] | null
  networks: Network[] | null
  branding: Branding | null
  subscription: SubscriptionOverview | null

  // Actions
  fetchOverview: () => Promise<void>
  fetchSubscription: () => Promise<void>
  fetchPaymentLinks: (page?: number) => Promise<void>
  fetchInvoices: (page?: number, status?: InvoiceStatus) => Promise<void>
  fetchWallets: () => Promise<void>
  fetchNetworks: () => Promise<void>
  fetchBranding: () => Promise<Branding>
  updateBranding: (data: BrandingUpdate) => Promise<Branding>
  uploadBrandingLogo: (file: File) => Promise<Branding>
  fetchReportsSummary: (period?: string, startDate?: string, endDate?: string) => Promise<ReportSummary>
  downloadReportsCsv: (period?: string, startDate?: string, endDate?: string) => Promise<void>
  createPaymentLink: (data: PaymentLinkCreate) => Promise<PaymentLink>
  deactivatePaymentLink: (id: string) => Promise<void>
  createInvoice: (data: InvoiceCreate) => Promise<Invoice>
  sendInvoice: (id: string) => Promise<void>
  cancelInvoice: (id: string) => Promise<void>
  addWallet: (data: WalletCreate) => Promise<MerchantWallet>
  deleteWallet: (id: string) => Promise<void>
}

// ─── Store implementation ────────────────────────────────────────────────────

export const useMerchantStore = create<MerchantStore>()((set, get) => ({
  overview: null,
  paymentLinks: null,
  invoices: null,
  wallets: null,
  networks: null,
  branding: null,
  subscription: null,

  fetchOverview: async () => {
    const { data } = await apiClient.get<DashboardOverview>(
      '/merchant/dashboard/overview',
    )
    set({ overview: data })
  },

  fetchSubscription: async () => {
    const { data } = await apiClient.get<SubscriptionOverview>('/users/me/subscription')
    set({ subscription: data })
  },

  fetchPaymentLinks: async (page = 1) => {
    const { data } = await apiClient.get<PaginatedResult<PaymentLink>>(
      `/merchant/payment-links?page=${page}&page_size=20`,
    )
    set({ paymentLinks: data })
  },

  fetchInvoices: async (page = 1, status?: InvoiceStatus) => {
    const params = new URLSearchParams({
      page: String(page),
      page_size: '20',
    })
    if (status !== undefined) {
      params.set('status', status)
    }
    const { data } = await apiClient.get<PaginatedResult<Invoice>>(
      `/merchant/invoices?${params.toString()}`,
    )
    set({ invoices: data })
  },

  fetchWallets: async () => {
    const { data } = await apiClient.get<MerchantWallet[]>('/merchant/wallets')
    set({ wallets: data })
  },

  fetchNetworks: async () => {
    // Return cached networks if already loaded — they don't change during a session
    if (get().networks !== null) return

    const { data } = await apiClient.get<Network[]>('/networks')
    set({ networks: data })
  },

  fetchBranding: async () => {
    const { data } = await apiClient.get<Branding>('/merchant/branding')
    set({ branding: data })
    return data
  },

  updateBranding: async (data: BrandingUpdate) => {
    const { data: updated } = await apiClient.post<Branding>('/merchant/branding', data)
    set({ branding: updated })
    return updated
  },

  uploadBrandingLogo: async (file: File) => {
    const formData = new FormData()
    formData.append('file', file)
    const { data: updated } = await apiClient.post<Branding>('/merchant/branding/logo', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
    set({ branding: updated })
    return updated
  },

  fetchReportsSummary: async (period = '30d', startDate?: string, endDate?: string) => {
    const params = new URLSearchParams({ period })
    if (startDate) params.set('start_date', startDate)
    if (endDate) params.set('end_date', endDate)
    const { data } = await apiClient.get<ReportSummary>(`/merchant/reports/summary?${params.toString()}`)
    return data
  },

  downloadReportsCsv: async (period = '30d', startDate?: string, endDate?: string) => {
    const params = new URLSearchParams({ period })
    if (startDate) params.set('start_date', startDate)
    if (endDate) params.set('end_date', endDate)
    const res = await apiClient.get(`/merchant/reports/export/csv?${params.toString()}`, {
      responseType: 'blob',
    })
    const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8;' })
    const url = window.URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.setAttribute('download', `lenis_report_${period}.csv`)
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    window.URL.revokeObjectURL(url)
  },

  createPaymentLink: async (data: PaymentLinkCreate) => {
    const { data: created } = await apiClient.post<PaymentLink>(
      '/merchant/payment-links',
      data,
    )
    // Refresh list so the new link appears
    await get().fetchPaymentLinks()
    return created
  },

  deactivatePaymentLink: async (id: string) => {
    await apiClient.patch(`/merchant/payment-links/${id}`, {
      status: 'inactive',
    })
    await get().fetchPaymentLinks()
  },

  createInvoice: async (data: InvoiceCreate) => {
    const { data: created } = await apiClient.post<Invoice>(
      '/merchant/invoices',
      data,
    )
    // Refresh list so the new invoice appears
    await get().fetchInvoices()
    return created
  },

  sendInvoice: async (id: string) => {
    await apiClient.post(`/merchant/invoices/${id}/send`)
    await get().fetchInvoices()
  },

  cancelInvoice: async (id: string) => {
    await apiClient.post(`/merchant/invoices/${id}/cancel`)
    await get().fetchInvoices()
  },

  addWallet: async (data: WalletCreate) => {
    const { data: created } = await apiClient.post<MerchantWallet>(
      '/merchant/wallets',
      data,
    )
    await get().fetchWallets()
    return created
  },

  deleteWallet: async (id: string) => {
    await apiClient.delete(`/merchant/wallets/${id}`)
    await get().fetchWallets()
  },
}))

