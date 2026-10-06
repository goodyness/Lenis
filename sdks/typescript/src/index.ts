/**
 * lenis-node public API surface.
 *
 * Import everything from 'lenis-node':
 *   import { Lenis, LenisAuthError, LenisAPIError, LenisWebhookSignatureError } from 'lenis-node';
 */

export { Lenis } from './client.js';
export type { LenisConfig } from './client.js';

export {
  LenisAuthError,
  LenisAPIError,
  LenisWebhookSignatureError,
} from './errors.js';

export { PaymentsResource } from './resources/payments.js';
export { PaymentLinksResource } from './resources/paymentLinks.js';
export { WebhooksResource } from './resources/webhooks.js';

export type {
  AcceptedToken,
  CreatePaymentParams,
  PaymentIntent,
  ListPaymentsParams,
  ListObject,
  CreatePaymentLinkParams,
  PaymentLink,
  WebhookEvent,
  ListPaymentLinksParams,
  ListTransactionsParams,
} from './types.js';
