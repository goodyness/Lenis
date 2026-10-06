/**
 * lenis-node LenisClient — main entry point for the Lenis Node.js SDK.
 *
 * Usage:
 *   import { Lenis } from 'lenis-node';
 *   const client = new Lenis({ apiKey: 'sk_live_...' });
 *   const payment = await client.payments.create({ ... });
 *
 * Raises LenisAuthError immediately if apiKey is undefined, null, or empty.
 */

import { LenisAuthError } from './errors.js';
import { HttpClient } from './_http.js';
import { PaymentsResource } from './resources/payments.js';
import { PaymentLinksResource } from './resources/paymentLinks.js';
import { WebhooksResource } from './resources/webhooks.js';

export interface LenisConfig {
  apiKey: string;
  baseUrl?: string;
}

export class Lenis {
  readonly payments: PaymentsResource;
  readonly paymentLinks: PaymentLinksResource;
  readonly webhooks: WebhooksResource;

  constructor({ apiKey, baseUrl = 'https://api.lenis.io' }: LenisConfig) {
    if (!apiKey) {
      throw new LenisAuthError(0, 'apiKey is required and cannot be empty.');
    }

    const http = new HttpClient(apiKey, baseUrl);
    this.payments = new PaymentsResource(http);
    this.paymentLinks = new PaymentLinksResource(http);
    this.webhooks = new WebhooksResource(http);
  }
}
