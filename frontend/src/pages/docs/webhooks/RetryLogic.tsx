import { Link } from 'react-router-dom'
import { SEOMeta } from '../../../components/seo/SEOMeta'
import { CodeSample } from '../../../components/docs/CodeSample'

const TEST_CURL = `curl -X POST "https://api.lenis.io/v1/webhooks/wh_01HABC1234/test" \\
  -H "Authorization: Bearer sk_test_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"event_type": "payment.confirmed"}'`

const RETRY_SCHEDULE = [
  { attempt: '1st retry', delay: '5 seconds', cumulative: '~5s after failure' },
  { attempt: '2nd retry', delay: '30 seconds', cumulative: '~35s after failure' },
  { attempt: '3rd retry', delay: '5 minutes', cumulative: '~6m after failure' },
  { attempt: '4th retry', delay: '30 minutes', cumulative: '~36m after failure' },
  { attempt: '5th retry', delay: '2 hours', cumulative: '~2h 36m after failure' },
]

export function RetryLogic() {
  return (
    <>
      <SEOMeta
        title="Webhook Retry Logic — Lenis Developer Docs"
        description="Learn how Lenis retries failed webhook deliveries: the retry schedule, auto-disable behavior, and how to test your endpoint."
        ogTitle="Webhook Retry Logic — Lenis Developer Docs"
        ogDescription="Lenis retries failed webhooks on a schedule of 5s, 30s, 5m, 30m, 2h. After 3 consecutive failing days, endpoints are auto-disabled."
      />

      <h1 className="mb-4 text-3xl font-bold tracking-tight text-slate-900">Retry Logic</h1>
      <p className="mb-6 text-lg text-slate-600 leading-relaxed">
        When your webhook endpoint returns a non-2xx HTTP status or times out, Lenis
        automatically retries delivery using an exponential backoff schedule.
      </p>

      <h2 className="mb-4 mt-8 text-xl font-semibold text-slate-900">Retry schedule</h2>
      <p className="mb-3 text-slate-600 leading-relaxed">
        Lenis attempts delivery up to 5 times after the initial failure:
      </p>
      <div className="mb-6 overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="px-4 py-3 text-left font-semibold text-slate-700">Attempt</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">Delay</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">Cumulative</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {RETRY_SCHEDULE.map((row) => (
              <tr key={row.attempt}>
                <td className="px-4 py-3 font-medium text-slate-900">{row.attempt}</td>
                <td className="px-4 py-3 text-slate-600">{row.delay}</td>
                <td className="px-4 py-3 text-slate-600">{row.cumulative}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mb-6 text-slate-600 leading-relaxed">
        If all 5 retries fail, the delivery is marked as permanently failed. The event will
        appear in the delivery log with a failed status. You can view failed deliveries via{' '}
        <code className="bg-slate-100 px-1 rounded text-sm">GET /v1/webhooks/{'{id}'}/deliveries</code>.
      </p>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">
        Auto-disable behavior
      </h2>
      <p className="mb-4 text-slate-600 leading-relaxed">
        If a webhook endpoint fails to accept any deliveries for 3 consecutive calendar days,
        Lenis automatically disables the endpoint to avoid wasting resources. You'll receive
        a dashboard notification when this happens.
      </p>
      <p className="mb-4 text-slate-600 leading-relaxed">
        To re-enable: fix the issue with your endpoint, then re-enable it from the Dashboard
        under <strong>Settings → Webhooks</strong> or via the API.
      </p>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">
        What triggers a retry
      </h2>
      <ul className="mb-6 space-y-2 list-disc pl-6 text-slate-600">
        <li>HTTP response status outside 2xx range (e.g. 4xx, 5xx)</li>
        <li>Connection timeout (Lenis waits up to 30 seconds for a response)</li>
        <li>SSL/TLS handshake failure</li>
        <li>DNS resolution failure</li>
      </ul>

      <div className="mb-8 rounded-lg border border-blue-200 bg-blue-50 p-4">
        <p className="text-sm font-medium text-blue-800">Respond quickly</p>
        <p className="mt-1 text-sm text-blue-700">
          Your handler must respond within <strong>30 seconds</strong>. If your fulfillment
          logic takes longer, respond immediately with{' '}
          <code className="bg-blue-100 px-1 rounded">{"{ \"received\": true }"}</code> and do
          the heavy work in a background task.
        </p>
      </div>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">Testing retry behavior</h2>
      <p className="mb-3 text-slate-600 leading-relaxed">
        Use the test endpoint to send a synthetic event and verify your handler processes it
        correctly without waiting for a real payment:
      </p>
      <CodeSample code={TEST_CURL} language="bash" title="Send test event" />

      <p className="mt-4 text-slate-600 leading-relaxed">
        See the full{' '}
        <Link
          to="/docs/api-reference/webhooks"
          className="font-medium text-slate-900 underline underline-offset-2 hover:no-underline"
        >
          Webhooks API reference
        </Link>{' '}
        for all available endpoints.
      </p>
    </>
  )
}
