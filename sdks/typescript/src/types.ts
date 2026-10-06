/**
 * lenis-node type definitions.
 *
 * Request and response types for all Lenis API resources.
 */

export interface AcceptedToken {
  token_symbol: string;
  network: string;
  contract_address?: string;
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

export interface CreatePaymentParams {
  /** Decimal string, e.g. "100.00" */
  amount: string;
  token_symbol: string;
  network: string;
  accepted_tokens: AcceptedToken[];
  customer_email?: string;
  /** Must be HTTPS */
  redirect_url?: string;
  /** 300–86400 seconds, default 3600 */
  expires_in?: number;
  /** Max 16 keys */
  metadata?: Record<string, string>;
  /** Becomes the Idempotency-Key request header */
  idempotency_key?: string;
}

export interface PaymentIntent {
  id: string;
  status: string;
  amount: string;
  token_symbol: string;
  network: string;
  checkout_url: string;
  /** Unix timestamp */
  created: number;
  /** Unix timestamp */
  expires_at: number;
  is_test: boolean;
  livemode: boolean;
}

export interface ListPaymentsParams {
  status?: string;
  network?: string;
  token_symbol?: string;
  /** Unix timestamp lower bound */
  created_after?: number;
  /** Unix timestamp upper bound */
  created_before?: number;
  /** 1–100 */
  limit?: number;
  cursor?: string;
}

// ---------------------------------------------------------------------------
// Generic pagination wrapper
// ---------------------------------------------------------------------------

export interface ListObject<T> {
  data: T[];
  has_more: boolean;
  next_cursor: string | null;
  total: number | null;
}

// ---------------------------------------------------------------------------
// Payment Links
// ---------------------------------------------------------------------------

export interface CreatePaymentLinkParams {
  /** 1–200 chars */
  title: string;
  amount_mode: 'fixed' | 'flexible';
  accepted_tokens: AcceptedToken[];
  /** Required when amount_mode is "fixed" */
  amount?: string;
  /** Max 128 chars */
  external_id?: string;
  /** Must be HTTPS, max 2048 chars */
  redirect_url?: string;
  /** 300–86400 seconds */
  expires_in?: number;
  max_uses?: number;
  custom_message?: string;
  /** Becomes the Idempotency-Key request header */
  idempotency_key?: string;
}

export interface PaymentLink {
  id: string;
  title: string;
  amount_mode: string;
  amount: string | null;
  checkout_url: string;
  status: string;
  is_test: boolean;
  created_at: string;
  external_id: string | null;
}

export interface ListPaymentLinksParams {
  limit?: number;
  cursor?: string;
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export interface WebhookEvent {
  id: string;
  type: string;
  /** Unix timestamp */
  created: number;
  livemode: boolean;
  data: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export interface ListTransactionsParams {
  network?: string;
  token_symbol?: string;
  min_amount?: string;
  max_amount?: string;
  confirmed_after?: number;
  confirmed_before?: number;
  limit?: number;
  cursor?: string;
}
