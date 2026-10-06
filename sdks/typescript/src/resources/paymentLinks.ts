/**
 * lenis-node PaymentLinksResource — /v1/payment-links endpoints.
 */

import type { HttpClient } from '../_http.js';
import type {
  CreatePaymentLinkParams,
  ListObject,
  ListPaymentLinksParams,
  PaymentLink,
} from '../types.js';

export class PaymentLinksResource {
  constructor(private readonly http: HttpClient) {}

  /**
   * Create a new payment link.
   *
   * Pass `idempotency_key` in params to set the `Idempotency-Key` header.
   */
  async create(params: CreatePaymentLinkParams): Promise<PaymentLink> {
    const { idempotency_key, ...body } = params;
    const headers = idempotency_key ? { 'Idempotency-Key': idempotency_key } : undefined;
    return this.http.request<PaymentLink>('POST', '/v1/payment-links', {
      json: body,
      headers,
    });
  }

  /** Retrieve a single payment link by ID. */
  async retrieve(id: string): Promise<PaymentLink> {
    return this.http.request<PaymentLink>('GET', `/v1/payment-links/${id}`);
  }

  /** List payment links with optional pagination. */
  async list(params?: ListPaymentLinksParams): Promise<ListObject<PaymentLink>> {
    return this.http.request<ListObject<PaymentLink>>('GET', '/v1/payment-links', {
      params: params as Record<string, string | number | boolean | undefined>,
    });
  }
}
