/**
 * lenis-node HTTP client.
 *
 * Uses only Node.js built-in `https` — no external HTTP library.
 *
 * Features:
 *   - 30-second timeout
 *   - Authorization: Bearer {apiKey} on all requests
 *   - Retry on 5xx: delays [1000, 2000, 4000] ms, up to 3 retries
 *   - Raises LenisAuthError on HTTP 401
 *   - Raises LenisAPIError on other non-2xx
 */

import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import { LenisAPIError, LenisAuthError } from './errors.js';

const RETRY_DELAYS = [1000, 2000, 4000] as const;
const DEFAULT_TIMEOUT = 30_000;
const USER_AGENT = 'lenis-node/0.1.0';

export interface RequestOptions {
  json?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
  headers?: Record<string, string>;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildUrl(
  baseUrl: string,
  path: string,
  params?: Record<string, string | number | boolean | undefined>,
): string {
  // Ensure the base URL doesn't double-slash with the path
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
  const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
  const url = new URL(normalizedPath, normalizedBase);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined) {
        url.searchParams.set(key, String(value));
      }
    }
  }
  return url.toString();
}

function doRequest(
  method: string,
  fullUrl: string,
  apiKey: string,
  body?: string,
  extraHeaders?: Record<string, string>,
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(fullUrl);
    const options: https.RequestOptions = {
      hostname: url.hostname,
      port: url.port || '443',
      path: url.pathname + url.search,
      method,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'User-Agent': USER_AGENT,
        ...(body ? { 'Content-Length': Buffer.byteLength(body).toString() } : {}),
        ...extraHeaders,
      },
    };

    const req = https.request(options, (res: http.IncomingMessage) => {
      let data = '';
      res.on('data', (chunk: Buffer) => {
        data += chunk.toString();
      });
      res.on('end', () => {
        resolve({ statusCode: res.statusCode ?? 0, body: data });
      });
    });

    req.setTimeout(DEFAULT_TIMEOUT, () => {
      req.destroy(new Error('Request timed out after 30 seconds'));
    });

    req.on('error', reject);

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

export class HttpClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(apiKey: string, baseUrl = 'https://api.lenis.io') {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  }

  async request<T>(method: string, path: string, options: RequestOptions = {}): Promise<T> {
    const { json, params, headers: extraHeaders } = options;
    const fullUrl = buildUrl(this.baseUrl, path, params);
    const body = json !== undefined ? JSON.stringify(json) : undefined;

    let lastError: LenisAPIError | null = null;

    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
      const { statusCode, body: responseBody } = await doRequest(
        method,
        fullUrl,
        this.apiKey,
        body,
        extraHeaders,
      );

      // 5xx — retry with delay
      if (statusCode >= 500) {
        let parsedError: { error?: string; param?: string } = {};
        try {
          parsedError = JSON.parse(responseBody) as { error?: string; param?: string };
        } catch {
          // ignore parse errors
        }
        lastError = new LenisAPIError(
          statusCode,
          parsedError.error ?? 'server_error',
          parsedError.param,
        );
        if (attempt < RETRY_DELAYS.length) {
          await sleep(RETRY_DELAYS[attempt]);
          continue;
        }
        throw lastError;
      }

      // 401 — auth error
      if (statusCode === 401) {
        let parsedError: { error?: string } = {};
        try {
          parsedError = JSON.parse(responseBody) as { error?: string };
        } catch {
          // ignore
        }
        throw new LenisAuthError(statusCode, parsedError.error ?? 'invalid_api_key');
      }

      // Other non-2xx
      if (statusCode < 200 || statusCode >= 300) {
        let parsedError: { error?: string; param?: string } = {};
        try {
          parsedError = JSON.parse(responseBody) as { error?: string; param?: string };
        } catch {
          // ignore
        }
        throw new LenisAPIError(
          statusCode,
          parsedError.error ?? 'unknown_error',
          parsedError.param,
        );
      }

      // 2xx success
      try {
        return JSON.parse(responseBody) as T;
      } catch {
        return {} as T;
      }
    }

    // Should never reach here, but TypeScript needs this
    throw lastError ?? new LenisAPIError(500, 'unexpected_error');
  }
}
