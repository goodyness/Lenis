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

const CREATE_CURL = `curl -X POST https://api.lenis.io/v1/webhooks \\
  -H "Authorization: Bearer sk_test_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://yourapp.com/webhooks/lenis",
    "events": ["payment.confirmed", "payment.expired", "payment.underpaid"]
  }'`

const LIST_CURL = `curl "https://api.lenis.io/v1/webhooks" \\
  -H "Authorization: Bearer sk_test_YOUR_KEY"`

const DELETE_CURL = `curl -X DELETE "https://api.lenis.io/v1/webhooks/wh_01HABC1234" \\
  -H "Authorization: Bearer sk_test_YOUR_KEY"`

const DELIVERIES_CURL = `curl "https://api.lenis.io/v1/webhooks/wh_01HABC1234/deliveries" \\
  -H "Authorization: Bearer sk_test_YOUR_KEY"`

const TEST_CURL = `curl -X POST "https://api.lenis.io/v1/webhooks/wh_01HABC1234/test" \\
  -H "Authorization: Bearer sk_test_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"event_type": "payment.confirmed"}'`

export function WebhooksDocs() {
  return (
    <>
      <SEOMeta
        title="Webhooks API Reference — Lenis Developer Docs"
        description="API reference for Lenis Webhooks: register endpoints, list webhooks, view delivery logs, and test webhook delivery."
        ogTitle="Webhooks API Reference — Lenis Developer Docs"
        ogDescription="Reference for POST/GET/DELETE /v1/webhooks and delivery log endpoints."
      />

      <h1 className="mb-4 text-3xl font-bold tracking-tight text-slate-900">Webhooks</h1>
      <p className="mb-8 text-lg text-slate-600 leading-relaxed">
        Webhooks allow Lenis to push payment events to your application in real time. Register
        an HTTPS endpoint and subscribe to the events you care about.
      </p>

      {/* POST /v1/webhooks */}
      <section className="mb-12">
        <div className="mb-3 flex items-center gap-3">
          {methodBadge('POST')}
          <code className="font-mono text-base font-medium text-slate-900">/v1/webhooks</code>
        </div>
        <p className="mb-4 text-slate-600 leading-relaxed">
          Register a new webhook endpoint. Lenis generates a signing secret that you use to
          verify all incoming events from this endpoint.
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
                { name: 'url', type: 'string', req: 'Yes', desc: 'HTTPS URL of your webhook endpoint' },
                { name: 'events', type: 'string[]', req: 'Yes', desc: 'Array of event types to subscribe to (or ["*"] for all)' },
                { name: 'description', type: 'string', req: 'No', desc: 'Optional label for this webhook endpoint' },
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
                { field: 'id', type: 'string', desc: 'Unique webhook endpoint identifier' },
                { field: 'url', type: 'string', desc: 'Registered HTTPS URL' },
                { field: 'events', type: 'string[]', desc: 'Subscribed event types' },
                { field: 'secret', type: 'string', desc: 'Signing secret — shown only once at creation' },
                { field: 'is_active', type: 'boolean', desc: 'Whether the endpoint is enabled' },
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
      </section>

      {/* GET /v1/webhooks */}
      <section className="mb-12">
        <div className="mb-3 flex items-center gap-3">
          {methodBadge('GET')}
          <code className="font-mono text-base font-medium text-slate-900">/v1/webhooks</code>
        </div>
        <p className="mb-4 text-slate-600 leading-relaxed">
          List all registered webhook endpoints for the authenticated merchant.
        </p>
        <CodeSample code={LIST_CURL} language="bash" title="curl" />
      </section>

      {/* DELETE /v1/webhooks/{id} */}
      <section className="mb-12">
        <div className="mb-3 flex items-center gap-3">
          {methodBadge('DELETE')}
          <code className="font-mono text-base font-medium text-slate-900">/v1/webhooks/{'{id}'}</code>
        </div>
        <p className="mb-4 text-slate-600 leading-relaxed">
          Permanently delete a webhook endpoint. Events will no longer be delivered to this URL.
        </p>
        <CodeSample code={DELETE_CURL} language="bash" title="curl" />
      </section>

      {/* GET /v1/webhooks/{id}/deliveries */}
      <section className="mb-12">
        <div className="mb-3 flex items-center gap-3">
          {methodBadge('GET')}
          <code className="font-mono text-base font-medium text-slate-900">/v1/webhooks/{'{id}'}/deliveries</code>
        </div>
        <p className="mb-4 text-slate-600 leading-relaxed">
          List all delivery attempts for a webhook endpoint. Each record includes the event
          payload, HTTP response code, and whether delivery succeeded.
        </p>
        <CodeSample code={DELIVERIES_CURL} language="bash" title="curl" />
      </section>

      {/* POST /v1/webhooks/{id}/test */}
      <section className="mb-12">
        <div className="mb-3 flex items-center gap-3">
          {methodBadge('POST')}
          <code className="font-mono text-base font-medium text-slate-900">/v1/webhooks/{'{id}'}/test</code>
        </div>
        <p className="mb-4 text-slate-600 leading-relaxed">
          Send a test event to the webhook endpoint with a synthetic payload. Useful for
          verifying your handler is working before going live.
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
            <tbody>
              <tr>
                <td className="px-3 py-2 font-mono text-slate-900">event_type</td>
                <td className="px-3 py-2 text-slate-500">string</td>
                <td className="px-3 py-2 text-slate-500">Yes</td>
                <td className="px-3 py-2 text-slate-600">The event type to simulate (e.g. "payment.confirmed")</td>
              </tr>
            </tbody>
          </table>
        </div>
        <CodeSample code={TEST_CURL} language="bash" title="curl" />
      </section>
    </>
  )
}
