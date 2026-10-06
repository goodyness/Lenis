import { SEOMeta } from '../../../components/seo/SEOMeta'
import { CodeSample } from '../../../components/docs/CodeSample'

const methodBadge = (method: 'GET' | 'POST' | 'DELETE') => {
  const styles = {
    GET: 'bg-emerald-100 text-emerald-700',
    POST: 'bg-blue-100 text-blue-700',
    DELETE: 'bg-red-100 text-red-700',
  }
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-bold uppercase ${styles[method]}`}>
      {method}
    </span>
  )
}

const CREATE_CURL = `curl -X POST https://api.lenis.io/v1/payment-links \\
  -H "Authorization: Bearer sk_test_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "Consulting Session",
    "amount": "200.00",
    "currency": "USDC",
    "network": "ethereum",
    "description": "1-hour consulting call"
  }'`

const CREATE_PYTHON = `import requests

response = requests.post(
    "https://api.lenis.io/v1/payment-links",
    headers={"Authorization": "Bearer sk_test_YOUR_KEY"},
    json={
        "title": "Consulting Session",
        "amount": "200.00",
        "currency": "USDC",
        "network": "ethereum",
        "description": "1-hour consulting call",
    }
)
link = response.json()
print(link["url"])  # Share this with your customer`

const CREATE_TS = `const response = await fetch("https://api.lenis.io/v1/payment-links", {
  method: "POST",
  headers: {
    "Authorization": "Bearer sk_test_YOUR_KEY",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    title: "Consulting Session",
    amount: "200.00",
    currency: "USDC",
    network: "ethereum",
    description: "1-hour consulting call",
  }),
});
const link = await response.json();
console.log(link.url);`

const LIST_CURL = `curl "https://api.lenis.io/v1/payment-links?is_active=true" \\
  -H "Authorization: Bearer sk_test_YOUR_KEY"`

const GET_ONE_CURL = `curl "https://api.lenis.io/v1/payment-links/lnk_01HABC5678" \\
  -H "Authorization: Bearer sk_test_YOUR_KEY"`

export function PaymentLinksDocs() {
  return (
    <>
      <SEOMeta
        title="Payment Links API Reference — Lenis Developer Docs"
        description="API reference for Lenis Payment Links: create reusable payment links, list them, and retrieve individual links."
        ogTitle="Payment Links API Reference — Lenis Developer Docs"
        ogDescription="Reference for POST /v1/payment-links, GET /v1/payment-links, GET /v1/payment-links/{id}"
      />

      <h1 className="mb-4 text-3xl font-bold tracking-tight text-slate-900">Payment Links</h1>
      <p className="mb-8 text-lg text-slate-600 leading-relaxed">
        A Payment Link is a reusable URL that allows any customer to initiate a payment.
        Unlike a payment intent (which is single-use and expires), a payment link stays
        active until you deactivate it.
      </p>

      {/* POST /v1/payment-links */}
      <section className="mb-12">
        <div className="mb-3 flex items-center gap-3">
          {methodBadge('POST')}
          <code className="font-mono text-base font-medium text-slate-900">/v1/payment-links</code>
        </div>
        <p className="mb-4 text-slate-600 leading-relaxed">
          Create a new payment link. Returns a link object with a shareable{' '}
          <code className="bg-slate-100 px-1 rounded text-sm">url</code>.
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
                { name: 'title', type: 'string', req: 'Yes', desc: 'Display name for the payment link' },
                { name: 'amount', type: 'string', req: 'Yes', desc: 'Fixed amount as a decimal string' },
                { name: 'currency', type: 'string', req: 'Yes', desc: 'Token symbol (e.g. "USDC")' },
                { name: 'network', type: 'string', req: 'Yes', desc: 'Target network identifier' },
                { name: 'description', type: 'string', req: 'No', desc: 'Optional description shown on the checkout page' },
                { name: 'redirect_url', type: 'string', req: 'No', desc: 'Post-payment redirect URL' },
                { name: 'metadata', type: 'object', req: 'No', desc: 'Arbitrary key-value data passed through to webhook events' },
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
                { field: 'id', type: 'string', desc: 'Unique payment link identifier' },
                { field: 'title', type: 'string', desc: 'Display name' },
                { field: 'url', type: 'string', desc: 'Shareable checkout URL' },
                { field: 'slug', type: 'string', desc: 'URL-safe identifier used in the checkout path' },
                { field: 'amount', type: 'string', desc: 'Fixed payment amount' },
                { field: 'currency', type: 'string', desc: 'Token symbol' },
                { field: 'network', type: 'string', desc: 'Target network' },
                { field: 'is_active', type: 'boolean', desc: 'Whether the link is accepting payments' },
                { field: 'created_at', type: 'string', desc: 'ISO 8601 creation timestamp' },
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

      {/* GET /v1/payment-links */}
      <section className="mb-12">
        <div className="mb-3 flex items-center gap-3">
          {methodBadge('GET')}
          <code className="font-mono text-base font-medium text-slate-900">/v1/payment-links</code>
        </div>
        <p className="mb-4 text-slate-600 leading-relaxed">
          List all payment links. Filter by active status or paginate through results.
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
                { name: 'is_active', type: 'boolean', req: 'No', desc: 'Filter by active/inactive status' },
                { name: 'limit', type: 'integer', req: 'No', desc: 'Results per page (default: 20, max: 100)' },
                { name: 'offset', type: 'integer', req: 'No', desc: 'Pagination offset' },
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

      {/* GET /v1/payment-links/{id} */}
      <section className="mb-12">
        <div className="mb-3 flex items-center gap-3">
          {methodBadge('GET')}
          <code className="font-mono text-base font-medium text-slate-900">/v1/payment-links/{'{id}'}</code>
        </div>
        <p className="mb-4 text-slate-600 leading-relaxed">
          Retrieve a single payment link by its ID.
        </p>
        <CodeSample code={GET_ONE_CURL} language="bash" title="curl" />
      </section>
    </>
  )
}
