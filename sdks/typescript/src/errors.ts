/**
 * lenis-node error classes.
 *
 * Hierarchy:
 *   LenisAuthError           — HTTP 401 or empty/null apiKey (statusCode=0)
 *   LenisAPIError            — any other non-2xx HTTP error
 *   LenisWebhookSignatureError — HMAC verification failure
 */

export class LenisAuthError extends Error {
  readonly statusCode: number;
  readonly error: string;

  constructor(statusCode: number, error: string) {
    super(`[${statusCode}] ${error}`);
    this.name = 'LenisAuthError';
    this.statusCode = statusCode;
    this.error = error;
    Object.setPrototypeOf(this, LenisAuthError.prototype);
  }
}

export class LenisAPIError extends Error {
  readonly statusCode: number;
  readonly error: string;
  readonly param?: string;

  constructor(statusCode: number, error: string, param?: string) {
    const msg = param
      ? `[${statusCode}] ${error} (param: ${param})`
      : `[${statusCode}] ${error}`;
    super(msg);
    this.name = 'LenisAPIError';
    this.statusCode = statusCode;
    this.error = error;
    this.param = param;
    Object.setPrototypeOf(this, LenisAPIError.prototype);
  }
}

export class LenisWebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LenisWebhookSignatureError';
    Object.setPrototypeOf(this, LenisWebhookSignatureError.prototype);
  }
}
