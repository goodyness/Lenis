/**
 * lenis-node PaymentsResource — /v1/payments endpoints.
 */

import type { HttpClient } from '../_http.js';
import type {
  CreatePaymentParams,
  ListObject,
  ListPaymentsParams,
  PaymentIntent,
} from '../types.js';

export class PaymentsResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Create a new payment intent.
   *
   * Pass `idempotency_key` in params to set the `Idempotency-Key` header.
   */
  async create(params: CreatePaymentParams): Promise<PaymentIntent> {
    const { idempotency_key, ...body } = params;
    const headers = idempotency_key ? { 'Idempotency-Key': idempotency_key } : undefined;
    return this.http.request<PaymentIntent>('POST', '/v1/payments', {
      json: body,
      headers,
    });
  }

  /** Retrieve a single payment intent by ID. */
  async retrieve(paymentId: string): Promise<PaymentIntent> {
    return this.http.request<PaymentIntent>('GET', `/v1/payments/${paymentId}`);
  }

  /** List payment intents with optional filters. */
  async list(params?: ListPaymentsParams): Promise<ListObject<PaymentIntent>> {
    return this.http.request<ListObject<PaymentIntent>>('GET', '/v1/payments', {
      params: params as Record<string, string | number | boolean | undefined>,
    });
  }
}
