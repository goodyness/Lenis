/**
 * Vitest unit tests for the lenis-node TypeScript SDK.
 *
 * HTTP responses are mocked via vi.spyOn on HttpClient.prototype.request.
 * Webhook signature tests are pure crypto — no mocking needed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Lenis } from '../src/client.js';
import { LenisAuthError, LenisAPIError, LenisWebhookSignatureError } from '../src/errors.js';
import { HttpClient } from '../src/_http.js';
import { buildSignatureHeader, computeSignature } from '../src/signing.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_API_KEY = 'sk_test_abc123defg456hijklmnopqrstuvwxyz';

function makeClient(apiKey = TEST_API_KEY): Lenis {
  return new Lenis({ apiKey });
}

// ---------------------------------------------------------------------------
// 1. Client construction
// ---------------------------------------------------------------------------

describe('Lenis construction', () => {
  it('throws LenisAuthError for empty string apiKey', () => {
    expect(() => new Lenis({ apiKey: '' })).toThrow(LenisAuthError);
  });

  it('LenisAuthError for empty key has statusCode 0', () => {
    try {
      new Lenis({ apiKey: '' });
    } catch (err) {
      expect(err).toBeInstanceOf(LenisAuthError);
      expect((err as LenisAuthError).statusCode).toBe(0);
    }
  });

  it('constructs successfully with a valid api key', () => {
    expect(() => makeClient()).not.toThrow();
  });

  it('exposes payments, paymentLinks, and webhooks resources', () => {
    const client = makeClient();
    expect(client.payments).toBeDefined();
    expect(client.paymentLinks).toBeDefined();
    expect(client.webhooks).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 2. payments.create
// ---------------------------------------------------------------------------

describe('payments.create', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns payment intent on success', async () => {
    const mockResponse = {
      id: 'pay_123',
      status: 'pending',
      amount: '100.00',
      token_symbol: 'USDC',
      network: 'base',
      checkout_url: 'https://checkout.lenis.io/pay/abc',
      created: 1700000000,
      expires_at: 1700003600,
      is_test: true,
      livemode: false,
    };
    vi.spyOn(HttpClient.prototype, 'request').mockResolvedValueOnce(mockResponse);

    const client = makeClient();
    const result = await client.payments.create({
      amount: '100.00',
      token_symbol: 'USDC',
      network: 'base',
      accepted_tokens: [{ token_symbol: 'USDC', network: 'base' }],
    });

    expect(result.id).toBe('pay_123');
    expect(result.status).toBe('pending');
    expect(result.checkout_url).toBe('https://checkout.lenis.io/pay/abc');
    expect(result.is_test).toBe(true);
  });

  it('passes Idempotency-Key header when idempotency_key provided', async () => {
    const mockResponse = { id: 'pay_456', status: 'pending' };
    const requestSpy = vi
      .spyOn(HttpClient.prototype, 'request')
      .mockResolvedValueOnce(mockResponse);

    const client = makeClient();
    await client.payments.create({
      amount: '50.00',
      token_symbol: 'USDC',
      network: 'base',
      accepted_tokens: [{ token_symbol: 'USDC', network: 'base' }],
      idempotency_key: 'my-unique-key-123',
    });

    expect(requestSpy).toHaveBeenCalledWith('POST', '/v1/payments', {
      json: expect.not.objectContaining({ idempotency_key: expect.anything() }),
      headers: { 'Idempotency-Key': 'my-unique-key-123' },
    });
  });

  it('throws LenisAuthError on HTTP 401', async () => {
    vi.spyOn(HttpClient.prototype, 'request').mockRejectedValueOnce(
      new LenisAuthError(401, 'invalid_api_key'),
    );

    const client = makeClient();
    await expect(
      client.payments.create({
        amount: '100.00',
        token_symbol: 'USDC',
        network: 'base',
        accepted_tokens: [{ token_symbol: 'USDC', network: 'base' }],
      }),
    ).rejects.toThrow(LenisAuthError);
  });

  it('throws LenisAPIError on HTTP 422 with param', async () => {
    vi.spyOn(HttpClient.prototype, 'request').mockRejectedValueOnce(
      new LenisAPIError(422, 'invalid_amount', 'amount'),
    );

    const client = makeClient();
    try {
      await client.payments.create({
        amount: '-1',
        token_symbol: 'USDC',
        network: 'base',
        accepted_tokens: [{ token_symbol: 'USDC', network: 'base' }],
      });
      expect.fail('Should have thrown LenisAPIError');
    } catch (err) {
      expect(err).toBeInstanceOf(LenisAPIError);
      expect((err as LenisAPIError).statusCode).toBe(422);
      expect((err as LenisAPIError).error).toBe('invalid_amount');
      expect((err as LenisAPIError).param).toBe('amount');
    }
  });
});

// ---------------------------------------------------------------------------
// 3. payments.retrieve
// ---------------------------------------------------------------------------

describe('payments.retrieve', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns payment by id', async () => {
    const mockResponse = { id: 'pay_789', status: 'confirmed' };
    vi.spyOn(HttpClient.prototype, 'request').mockResolvedValueOnce(mockResponse);

    const client = makeClient();
    const result = await client.payments.retrieve('pay_789');
    expect(result.id).toBe('pay_789');
    expect(result.status).toBe('confirmed');
  });

  it('throws LenisAPIError on 404', async () => {
    vi.spyOn(HttpClient.prototype, 'request').mockRejectedValueOnce(
      new LenisAPIError(404, 'payment_not_found'),
    );

    const client = makeClient();
    await expect(client.payments.retrieve('pay_nonexistent')).rejects.toThrow(LenisAPIError);
  });
});

// ---------------------------------------------------------------------------
// 4. payments.list
// ---------------------------------------------------------------------------

describe('payments.list', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns list object', async () => {
    const mockResponse = {
      data: [{ id: 'pay_1', status: 'pending' }],
      has_more: false,
      next_cursor: null,
      total: 1,
    };
    vi.spyOn(HttpClient.prototype, 'request').mockResolvedValueOnce(mockResponse);

    const client = makeClient();
    const result = await client.payments.list({ limit: 10 });
    expect(result.data).toHaveLength(1);
    expect(result.has_more).toBe(false);
    expect(result.total).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 5. webhooks.constructEvent — pure crypto, no mocking
// ---------------------------------------------------------------------------

describe('webhooks.constructEvent', () => {
  const secret = 'test_secret_32chars_long_enough!';
  const payload = JSON.stringify({ id: 'evt_abc', type: 'payment.confirmed', data: {} });
  const payloadBytes = Buffer.from(payload);

  it('verifies a valid signature and returns parsed event', () => {
    const [sigHeader] = buildSignatureHeader(secret, payload);
    const client = makeClient();
    const event = client.webhooks.constructEvent(payloadBytes, sigHeader, secret);

    expect(event['type']).toBe('payment.confirmed');
    expect(event['id']).toBe('evt_abc');
  });

  it('throws LenisWebhookSignatureError with wrong secret', () => {
    const wrongSecret = 'wrong_secret_32chars_long!!!!!!!';
    const [sigHeader] = buildSignatureHeader(secret, payload);
    const client = makeClient();

    expect(() =>
      client.webhooks.constructEvent(payloadBytes, sigHeader, wrongSecret),
    ).toThrow(LenisWebhookSignatureError);
  });

  it('throws LenisWebhookSignatureError with missing header', () => {
    const client = makeClient();
    expect(() =>
      client.webhooks.constructEvent(payloadBytes, '', secret),
    ).toThrow(LenisWebhookSignatureError);
  });

  it('throws LenisWebhookSignatureError with malformed header (no t=)', () => {
    const client = makeClient();
    expect(() =>
      client.webhooks.constructEvent(payloadBytes, 'v1=somesig', secret),
    ).toThrow(LenisWebhookSignatureError);
  });

  it('throws LenisWebhookSignatureError with malformed header (no v1=)', () => {
    const client = makeClient();
    expect(() =>
      client.webhooks.constructEvent(payloadBytes, 't=1700000000', secret),
    ).toThrow(LenisWebhookSignatureError);
  });

  it('throws LenisWebhookSignatureError with expired timestamp', () => {
    // timestamp 10 minutes in the past — outside the 300-second tolerance
    const oldTs = Math.floor(Date.now() / 1000) - 600;
    const oldSig = computeSignature(secret, oldTs, payload);
    const oldHeader = `t=${oldTs},v1=${oldSig}`;
    const client = makeClient();

    expect(() =>
      client.webhooks.constructEvent(payloadBytes, oldHeader, secret),
    ).toThrow(LenisWebhookSignatureError);
  });
});

// ---------------------------------------------------------------------------
// 6. paymentLinks
// ---------------------------------------------------------------------------

describe('paymentLinks.create', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns payment link on success', async () => {
    const mockResponse = {
      id: 'link_abc',
      title: 'My Product',
      amount_mode: 'fixed',
      amount: '49.99',
      checkout_url: 'https://checkout.lenis.io/pay/link_abc',
      status: 'active',
      is_test: true,
      created_at: '2024-01-01T00:00:00Z',
      external_id: null,
    };
    vi.spyOn(HttpClient.prototype, 'request').mockResolvedValueOnce(mockResponse);

    const client = makeClient();
    const result = await client.paymentLinks.create({
      title: 'My Product',
      amount_mode: 'fixed',
      amount: '49.99',
      accepted_tokens: [{ token_symbol: 'USDC', network: 'base' }],
    });

    expect(result.id).toBe('link_abc');
    expect(result.checkout_url).toBe('https://checkout.lenis.io/pay/link_abc');
  });
});

// ---------------------------------------------------------------------------
// 7. Error class identity checks
// ---------------------------------------------------------------------------

describe('Error class identity', () => {
  it('LenisAuthError instanceof check works correctly', () => {
    const err = new LenisAuthError(401, 'invalid_api_key');
    expect(err).toBeInstanceOf(LenisAuthError);
    expect(err).toBeInstanceOf(Error);
    expect(err.statusCode).toBe(401);
    expect(err.error).toBe('invalid_api_key');
  });

  it('LenisAPIError instanceof check works correctly', () => {
    const err = new LenisAPIError(422, 'invalid_amount', 'amount');
    expect(err).toBeInstanceOf(LenisAPIError);
    expect(err).toBeInstanceOf(Error);
    expect(err.statusCode).toBe(422);
    expect(err.param).toBe('amount');
  });

  it('LenisWebhookSignatureError instanceof check works correctly', () => {
    const err = new LenisWebhookSignatureError('HMAC mismatch');
    expect(err).toBeInstanceOf(LenisWebhookSignatureError);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe('HMAC mismatch');
  });
});
