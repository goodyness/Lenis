/**
 * lenis-node signing — pure HMAC-SHA256 webhook signature helpers.
 *
 * Uses only Node.js built-in `crypto`. No external dependencies.
 *
 * Public API:
 *   computeSignature(secret, timestamp, payloadJson) -> string
 *   buildSignatureHeader(secret, payloadJson) -> [header, timestamp]
 *   verifySignature(payloadBytes, sigHeader, secret, toleranceSeconds?) -> Record<string, unknown>
 */

import { createHmac, timingSafeEqual } from 'crypto';
import { LenisWebhookSignatureError } from './errors.js';

const DEFAULT_TOLERANCE_SECONDS = 300;

/**
 * Compute HMAC-SHA256 over `t={timestamp}\n{payloadJson}` using the given secret.
 */
export function computeSignature(
  secret: string,
  timestamp: number,
  payloadJson: string,
): string {
  const message = `t=${timestamp}\n${payloadJson}`;
  return createHmac('sha256', secret).update(message, 'utf8').digest('hex');
}

/**
 * Build an `X-Lenis-Signature` header value for the given payload.
 *
 * @returns A 2-tuple of `[headerValue, timestamp]` where `headerValue` is
 *          `"t={ts},v1={hexSig}"` and `timestamp` is the Unix second used.
 */
export function buildSignatureHeader(
  secret: string,
  payloadJson: string,
): [string, number] {
  const ts = Math.floor(Date.now() / 1000);
  const sig = computeSignature(secret, ts, payloadJson);
  return [`t=${ts},v1=${sig}`, ts];
}

/**
 * Verify an `X-Lenis-Signature` header and return the parsed event object.
 *
 * @throws {LenisWebhookSignatureError} When the header is missing, malformed,
 *   the timestamp is outside the tolerance window, or the HMAC does not match.
 */
export function verifySignature(
  payloadBytes: Buffer,
  sigHeader: string,
  secret: string,
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
): Record<string, unknown> {
  if (!sigHeader) {
    throw new LenisWebhookSignatureError('Missing X-Lenis-Signature header.');
  }

  // Parse key=value pairs from header like "t=1234567890,v1=abcdef..."
  const parts: Record<string, string> = {};
  for (const part of sigHeader.split(',')) {
    const eqIdx = part.indexOf('=');
    if (eqIdx !== -1) {
      parts[part.slice(0, eqIdx).trim()] = part.slice(eqIdx + 1).trim();
    }
  }

  if (!parts['t']) {
    throw new LenisWebhookSignatureError(
      "Malformed X-Lenis-Signature header: missing 't' timestamp component.",
    );
  }
  if (!parts['v1']) {
    throw new LenisWebhookSignatureError(
      "Malformed X-Lenis-Signature header: missing 'v1' signature component.",
    );
  }

  const timestamp = parseInt(parts['t'], 10);
  if (isNaN(timestamp)) {
    throw new LenisWebhookSignatureError(
      "Malformed X-Lenis-Signature header: 't' is not a valid integer.",
    );
  }

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > toleranceSeconds) {
    throw new LenisWebhookSignatureError(
      `Webhook timestamp is outside tolerance window of ${toleranceSeconds} seconds.`,
    );
  }

  const payloadJson = payloadBytes.toString('utf8');
  const expectedSig = computeSignature(secret, timestamp, payloadJson);
  const receivedSig = parts['v1'];

  // Timing-safe comparison — buffers must be the same length
  const expectedBuf = Buffer.from(expectedSig, 'utf8');
  const receivedBuf = Buffer.from(receivedSig, 'utf8');
  if (
    expectedBuf.length !== receivedBuf.length ||
    !timingSafeEqual(expectedBuf, receivedBuf)
  ) {
    throw new LenisWebhookSignatureError(
      'Webhook signature verification failed: HMAC mismatch.',
    );
  }

  return JSON.parse(payloadJson) as Record<string, unknown>;
}
