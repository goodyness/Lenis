/**
 * lenis-node WebhooksResource — webhook signature verification helper.
 *
 * This resource does NOT make HTTP requests. It is a stateless helper that
 * verifies the X-Lenis-Signature header on incoming webhook deliveries.
 */

import type { HttpClient } from '../_http.js';
import { verifySignature } from '../signing.js';

export class WebhooksResource {
  // _http is kept for API consistency with other resources; not used here.
  constructor(private readonly _http: HttpClient) {}

  /**
   * Verify a webhook delivery and return the parsed event object.
   *
   * Call this inside your webhook handler to confirm the request came from
   * Lenis and to parse the event payload.
   *
   * @param payload     Raw request body as a Buffer.
   * @param sigHeader   Value of the `X-Lenis-Signature` HTTP header.
   * @param secret      The webhook endpoint's signing secret.
   * @returns Parsed event object, e.g. `{ id, type, data, ... }`.
   * @throws {LenisWebhookSignatureError} On missing, malformed, or invalid signature.
   */
  constructEvent(
    payload: Buffer,
    sigHeader: string,
    secret: string,
  ): Record<string, unknown> {
    return verifySignature(payload, sigHeader, secret);
  }
}
