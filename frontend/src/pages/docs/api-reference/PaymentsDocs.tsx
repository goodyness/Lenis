import { SEOMeta } from '../../../components/seo/SEOMeta'
import { CodeSample } from '../../../components/docs/CodeSample'

const methodBadge = (method: 'GET' | 'POST' | 'DELETE') => {
  const styles = {
    GET: 'bg-emerald-100 text-emerald-700',
    POST: 'bg-blue-100 text-blue-700',
    DELETE: 'bg-red-100 text-red-700',
  }
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-bold uppercase ${styles[method]}`}
    >
      {method}
    </span>
  )
}

const CREATE_CURL = `curl -X POST https://api.lenis.io/v1/payments \\
  -H "Authorization: Bearer sk_test_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": "100.00",
    "currency": "USDC",
    "network": "polygon",
    "description": "Order #1234",
    "metadata": {"order_id": "1234"},
    "idempotency_key": "order-1234-attempt-1"
  }'`

const CREATE_PYTHON = `import requests

response = requests.post(
    "https://api.lenis.io/v1/payments",
    headers={
        "Authorization": "Bearer sk_test_YOUR_KEY",
        "Idempotency-Key": "order-1234-attempt-1",
    },
    json={
        "amount": "100.00",
        "currency": "USDC",
        "network": "polygon",
        "description": "Order #1234",
        "metadata": {"order_id": "1234"},
    }
)
payment = response.json()
print(payment["checkout_url"])`

const CREATE_TS = `const response = await fetch("https://api.lenis.io/v1/payments", {
  method: "POST",
  headers: {
    "Authorization": "Bearer sk_test_YOUR_KEY",
    "Content-Type": "application/json",
    "Idempotency-Key": "order-1234-attempt-1",
  },
  body: JSON.stringify({
    amount: "100.00",
    currency: "USDC",
    network: "polygon",
    description: "Order #1234",
    metadata: { order_id: "1234" },
  }),
});
const payment = await response.json();
console.log(payment.checkout_url);`

const LIST_CURL = `curl "https://api.lenis.io/v1/payments?status=confirmed&limit=20" \\
  -H "Authorization: Bearer sk_test_YOUR_KEY"`

const GET_ONE_CURL = `curl "https://api.lenis.io/v1/payments/pay_01HXYZ1234" \\
  -H "Authorization: Bearer sk_test_YOUR_KEY"`

export function PaymentsDocs() {
  return (
    <>
      <SEOMeta
        title="Payments API Reference — Lenis Developer Docs"
        description="API reference for Lenis Payments endpoints: create payment intents, list payments, and retrieve individual payment details."
        ogTitle="Payments API Reference — Lenis Developer Docs"
        ogDescription="Reference for POST /v1/payments, GET /v1/payments, GET /v1/payments/{id}"
      />

      <h1 className="mb-4 text-3xl font-bold tracking-tight text-slate-900">Payments</h1>
      <p className="mb-8 text-lg text-slate-600 leading-relaxed">
        A Payment represents a single payment request from a customer. Creating a payment
        returns a unique on-chain address and a hosted checkout URL.
      </p>

      {/* POST /v1/payments */}
      <section className="mb-12">
        <div className="mb-3 flex items-center gap-3">
          {methodBadge('POST')}
          <code className="font-mono text-base font-medium text-slate-900">/v1/payments</code>
        </div>
        <p className="mb-4 text-slate-600 leading-relaxed">
          Create a new payment intent. Returns a payment object with a{' '}
          <code className="bg-slate-100 px-1 rounded text-sm">checkout_url</code> and a unique{' '}
          <code className="bg-slate-100 px-1 rounded text-sm">payment_address</code> on the specified network.
        </p>

        <h3 className="mb-2 font-semibold text-slate-800">Request parameters</h3>
        <div className="mb-4 overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Name</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Type</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Required</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[
                { name: 'amount', type: 'string', req: 'Yes', desc: 'Payment amount as a decimal string (e.g. "100.00")' },
                { name: 'currency', type: 'string', req: 'Yes', desc: 'Token symbol (e.g. "USDC", "ETH")' },
                { name: 'network', type: 'string', req: 'Yes', desc: 'Target network identifier (e.g. "polygon")' },
                { name: 'description', type: 'string', req: 'No', desc: 'Human-readable description shown on the checkout page' },
                { name: 'metadata', type: 'object', req: 'No', desc: 'Arbitrary key-value pairs passed through to webhook events' },
                { name: 'redirect_url', type: 'string', req: 'No', desc: 'URL to redirect the customer after payment' },
                { name: 'expires_in', type: 'integer', req: 'No', desc: 'Seconds until the payment expires (default: 3600)' },
              ].map((row) => (
                <tr key={row.name}>
                  <td className="px-3 py-2 font-mono text-slate-900">{row.name}</td>
                  <td className="px-3 py-2 text-slate-500">{row.type}</td>
                  <td className="px-3 py-2 text-slate-500">{row.req}</td>
                  <td className="px-3 py-2 text-slate-600">{row.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 className="mb-2 font-semibold text-slate-800">Response fields</h3>
        <div className="mb-4 overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Field</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Type</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[
                { field: 'id', type: 'string', desc: 'Unique payment identifier' },
                { field: 'status', type: 'string', desc: 'Current status: pending | detected | confirming | confirmed | underpaid | expired' },
                { field: 'amount', type: 'string', desc: 'Requested payment amount' },
                { field: 'currency', type: 'string', desc: 'Token symbol' },
                { field: 'network', type: 'string', desc: 'Target network' },
                { field: 'payment_address', type: 'string', desc: 'On-chain address to receive payment' },
                { field: 'checkout_url', type: 'string', desc: 'Hosted checkout page URL' },
                { field: 'expires_at', type: 'string', desc: 'ISO 8601 expiry timestamp' },
                { field: 'created_at', type: 'string', desc: 'ISO 8601 creation timestamp' },
                { field: 'metadata', type: 'object', desc: 'Your provided metadata' },
              ].map((row) => (
                <tr key={row.field}>
                  <td className="px-3 py-2 font-mono text-slate-900">{row.field}</td>
                  <td className="px-3 py-2 text-slate-500">{row.type}</td>
                  <td className="px-3 py-2 text-slate-600">{row.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <CodeSample code={CREATE_CURL} language="bash" title="curl" />
        <CodeSample code={CREATE_PYTHON} language="python" title="Python" />
        <CodeSample code={CREATE_TS} language="typescript" title="TypeScript" />
      </section>

      {/* GET /v1/payments */}
      <section className="mb-12">
        <div className="mb-3 flex items-center gap-3">
          {methodBadge('GET')}
          <code className="font-mono text-base font-medium text-slate-900">/v1/payments</code>
        </div>
        <p className="mb-4 text-slate-600 leading-relaxed">
          List all payments for the authenticated merchant. Supports filtering and pagination.
        </p>

        <h3 className="mb-2 font-semibold text-slate-800">Query parameters</h3>
        <div className="mb-4 overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Name</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Type</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Required</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[
                { name: 'status', type: 'string', req: 'No', desc: 'Filter by status' },
                { name: 'limit', type: 'integer', req: 'No', desc: 'Results per page (default: 20, max: 100)' },
                { name: 'offset', type: 'integer', req: 'No', desc: 'Pagination offset (default: 0)' },
              ].map((row) => (
                <tr key={row.name}>
                  <td className="px-3 py-2 font-mono text-slate-900">{row.name}</td>
                  <td className="px-3 py-2 text-slate-500">{row.type}</td>
                  <td className="px-3 py-2 text-slate-500">{row.req}</td>
                  <td className="px-3 py-2 text-slate-600">{row.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <CodeSample code={LIST_CURL} language="bash" title="curl" />
      </section>

      {/* GET /v1/payments/{id} */}
      <section className="mb-12">
        <div className="mb-3 flex items-center gap-3">
          {methodBadge('GET')}
          <code className="font-mono text-base font-medium text-slate-900">/v1/payments/{'{id}'}</code>
        </div>
        <p className="mb-4 text-slate-600 leading-relaxed">
          Retrieve a single payment by its ID.
        </p>
        <CodeSample code={GET_ONE_CURL} language="bash" title="curl" />
      </section>
    </>
  )
}
