import { SEOMeta } from '../../../components/seo/SEOMeta'
import { CodeSample } from '../../../components/docs/CodeSample'

const INSTALL_NPM = `npm install lenis-node`

const QUICKSTART_ESM = `// ESM (TypeScript / ES modules)
import { Lenis } from "lenis-node";

const client = new Lenis({ apiKey: process.env.LENIS_API_KEY! });

// Create a payment intent
const payment = await client.payments.create({
  amount: "100.00",
  token_symbol: "USDC",
  network: "base",
  accepted_tokens: [{ token_symbol: "USDC", network: "base" }],
  customer_email: "buyer@example.com",
  metadata: { order_id: "1234" },
  idempotency_key: "order-1234-attempt-1",
});

console.log(payment.checkout_url);   // https://lenis.io/pay/<slug>
console.log(payment.status);         // "pending"

// Retrieve a payment
const fetched = await client.payments.retrieve("pay_abc123");

// List payments — returns { data, has_more, next_cursor, total }
const { data, has_more } = await client.payments.list({ status: "confirmed", limit: 20 });
data.forEach((p) => console.log(p.id, p.amount, p.status));`

const QUICKSTART_CJS = `// CommonJS
const { Lenis } = require("lenis-node");

const client = new Lenis({ apiKey: process.env.LENIS_API_KEY });

async function run() {
  const payment = await client.payments.create({
    amount: "50.00",
    token_symbol: "USDC",
    network: "base",
    accepted_tokens: [{ token_symbol: "USDC", network: "base" }],
  });
  console.log(payment.checkout_url);
}

run().catch(console.error);`

const PAYMENT_LINKS = `// Create a fixed-price payment link
const link = await client.paymentLinks.create({
  title: "Pro Plan — Monthly",
  amount_mode: "fixed",
  amount: "29.00",
  accepted_tokens: [{ token_symbol: "USDC", network: "base" }],
  redirect_url: "https://yourapp.com/thank-you",
  max_uses: 100,
});

console.log(link.checkout_url);

// Retrieve and list
const single = await client.paymentLinks.retrieve("lnk_abc123");
const { data } = await client.paymentLinks.list({ limit: 10 });
data.forEach((l) => console.log(l.id, l.title));`

const WEBHOOK_TS = `import express from "express";
import { Lenis, LenisWebhookSignatureError } from "lenis-node";
import type { WebhookEvent } from "lenis-node";

const app = express();
const client = new Lenis({ apiKey: process.env.LENIS_API_KEY! });
const WEBHOOK_SECRET = process.env.LENIS_WEBHOOK_SECRET!;

// Use raw body parser — do NOT pre-parse as JSON
app.post(
  "/webhooks/lenis",
  express.raw({ type: "application/json" }),
  (req, res) => {
    let event: Record<string, unknown>;

    try {
      event = client.webhooks.constructEvent(
        req.body as Buffer,
        req.headers["x-lenis-signature"] as string,
        WEBHOOK_SECRET,
      );
    } catch (err) {
      if (err instanceof LenisWebhookSignatureError) {
        return res.status(400).json({ error: err.message });
      }
      throw err;
    }

    if (event["type"] === "payment.confirmed") {
      const data = event["data"] as Record<string, unknown>;
      const metadata = data["metadata"] as Record<string, string> | undefined;
      fulfillOrder(metadata?.order_id ?? "");
    }

    res.json({ received: true });
  }
);

function fulfillOrder(orderId: string): void {
  // Your fulfillment logic
}`

const EXCEPTION_TS = `import { Lenis, LenisAuthError, LenisAPIError, LenisWebhookSignatureError } from "lenis-node";

const client = new Lenis({ apiKey: process.env.LENIS_API_KEY! });

try {
  const payment = await client.payments.create({
    amount: "100.00",
    token_symbol: "USDC",
    network: "base",
    accepted_tokens: [{ token_symbol: "USDC", network: "base" }],
  });
} catch (err) {
  if (err instanceof LenisAuthError) {
    // err.statusCode: 0 (empty key) or 401 (invalid/revoked/expired)
    // err.error: string
    console.error("Auth error:", err.error);
  } else if (err instanceof LenisAPIError) {
    // err.statusCode: number (422, 429, 503, ...)
    // err.error: string
    // err.param: string | undefined  (field that caused the error)
    console.error(\`API error [\${err.statusCode}]: \${err.error}, param=\${err.param}\`);
  } else {
    throw err;
  }
}

// LenisAuthError is also thrown at construction with an empty key:
try {
  new Lenis({ apiKey: "" });
} catch (err) {
  if (err instanceof LenisAuthError) {
    console.error(err.error); // "apiKey is required and cannot be empty."
  }
}`

export function TypeScriptSDKDocs() {
  return (
    <>
      <SEOMeta
        title="TypeScript SDK — Lenis Developer Docs"
        description="Install and use the Lenis Node.js/TypeScript SDK for creating payments, managing payment links, verifying webhooks, and handling errors."
        ogTitle="TypeScript SDK — Lenis Developer Docs"
        ogDescription="lenis-node SDK: ESM and CJS usage, full TypeScript types, webhook verification, and exception handling."
      />

      <h1 className="mb-4 text-3xl font-bold tracking-tight text-slate-900">TypeScript SDK</h1>
      <p className="mb-6 text-lg text-slate-600 leading-relaxed">
        The official Node.js SDK for Lenis — fully typed, works with both ESM and CommonJS,
        no external HTTP dependencies, and built-in webhook signature verification.
        Requires Node.js 18+.
      </p>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">Installation</h2>
      <CodeSample code={INSTALL_NPM} language="bash" />
      <p className="mt-2 mb-4 text-sm text-slate-500">
        TypeScript types are bundled — no separate{' '}
        <code className="bg-slate-100 px-1 rounded text-xs">@types</code> package needed.
        No external runtime dependencies.
      </p>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">Quick start (ESM / TypeScript)</h2>
      <p className="mb-3 text-slate-600 leading-relaxed">
        The client is <code className="bg-slate-100 px-1 rounded text-sm">new Lenis{'({ apiKey })'}</code>.
        All resource methods are async and return typed objects. List responses always
        include <code className="bg-slate-100 px-1 rounded text-sm">data</code>,{' '}
        <code className="bg-slate-100 px-1 rounded text-sm">has_more</code>,{' '}
        <code className="bg-slate-100 px-1 rounded text-sm">next_cursor</code>, and{' '}
        <code className="bg-slate-100 px-1 rounded text-sm">total</code>.
      </p>
      <CodeSample code={QUICKSTART_ESM} language="typescript" />

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">CommonJS usage</h2>
      <CodeSample code={QUICKSTART_CJS} language="javascript" />

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">Payment links</h2>
      <CodeSample code={PAYMENT_LINKS} language="typescript" />

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">TypeScript types</h2>
      <p className="mb-3 text-slate-600 leading-relaxed">
        All parameters and responses are fully typed. Key interfaces:
      </p>
      <div className="mb-4 overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="px-4 py-3 text-left font-semibold text-slate-700">Type</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">Description</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {[
              { type: 'CreatePaymentParams', desc: 'Input for client.payments.create()' },
              { type: 'PaymentIntent', desc: 'Response: id, status, checkout_url, amount, token_symbol, network, …' },
              { type: 'ListObject<T>', desc: 'Paginated list: data, has_more, next_cursor, total' },
              { type: 'CreatePaymentLinkParams', desc: 'Input for client.paymentLinks.create()' },
              { type: 'PaymentLink', desc: 'Response: id, title, checkout_url, status, amount, …' },
              { type: 'WebhookEvent', desc: 'Parsed event: id, type, created, livemode, data' },
              { type: 'AcceptedToken', desc: 'token_symbol, network, contract_address?' },
              { type: 'LenisConfig', desc: 'Constructor options: apiKey, baseUrl?' },
            ].map((row) => (
              <tr key={row.type}>
                <td className="px-4 py-3 font-mono text-slate-900 whitespace-nowrap">{row.type}</td>
                <td className="px-4 py-3 text-slate-600">{row.desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">Webhook handling</h2>
      <p className="mb-3 text-slate-600 leading-relaxed">
        Use{' '}
        <code className="bg-slate-100 px-1 rounded text-sm">client.webhooks.constructEvent()</code>{' '}
        to verify the{' '}
        <code className="bg-slate-100 px-1 rounded text-sm">X-Lenis-Signature</code> header and
        parse the event. Pass the raw{' '}
        <code className="bg-slate-100 px-1 rounded text-sm">Buffer</code> body — never pre-parse
        it as JSON.
      </p>
      <CodeSample code={WEBHOOK_TS} language="typescript" title="Express webhook handler" />

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">Exception handling</h2>
      <div className="mb-4 overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="px-4 py-3 text-left font-semibold text-slate-700">Exception</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">Properties</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">When thrown</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {[
              {
                ex: 'LenisAuthError',
                props: 'statusCode: number, error: string',
                when: 'HTTP 401, or apiKey is empty (statusCode=0)',
              },
              {
                ex: 'LenisAPIError',
                props: 'statusCode: number, error: string, param?: string',
                when: 'Any other non-2xx (422, 429, 5xx after retries)',
              },
              {
                ex: 'LenisWebhookSignatureError',
                props: 'message: string',
                when: 'constructEvent() — HMAC mismatch, expired timestamp, or malformed header',
              },
            ].map((row) => (
              <tr key={row.ex}>
                <td className="px-4 py-3 font-mono text-slate-900 whitespace-nowrap">{row.ex}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-500">{row.props}</td>
                <td className="px-4 py-3 text-slate-600">{row.when}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <CodeSample code={EXCEPTION_TS} language="typescript" title="Exception handling" />
    </>
  )
}
