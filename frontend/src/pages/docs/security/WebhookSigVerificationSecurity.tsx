import { Link } from 'react-router-dom'
import { SEOMeta } from '../../../components/seo/SEOMeta'
import { CodeSample } from '../../../components/docs/CodeSample'

const INSECURE = `# ❌ DO NOT DO THIS — vulnerable to forged requests
@app.post("/webhooks/lenis")
async def webhook(request: Request):
    event = await request.json()
    # Processing without signature verification!
    if event["type"] == "payment.confirmed":
        fulfill_order(event["data"]["metadata"]["order_id"])`

const TIMING_ATTACK = `# ❌ Vulnerable to timing attacks
if expected == received:  # String comparison leaks timing info
    process()

# ✅ Safe constant-time comparison
import hmac
if hmac.compare_digest(expected, received):
    process()`

export function WebhookSigVerificationSecurity() {
  return (
    <>
      <SEOMeta
        title="Webhook Signature Verification Security — Lenis Developer Docs"
        description="Security guidance for webhook signature verification: why to always verify, timing attack prevention, and timestamp tolerance."
        ogTitle="Webhook Signature Verification Security — Lenis Developer Docs"
        ogDescription="Why you must always verify Lenis webhook signatures, how to prevent timing attacks, and how to handle the timestamp tolerance window."
      />

      <h1 className="mb-4 text-3xl font-bold tracking-tight text-slate-900">
        Webhook Signature Verification
      </h1>
      <p className="mb-6 text-lg text-slate-600 leading-relaxed">
        Signature verification is the only way to confirm that a webhook request genuinely
        came from Lenis. Skipping it exposes your application to serious security risks.
      </p>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">
        Why you must always verify
      </h2>
      <p className="mb-4 text-slate-600 leading-relaxed">
        Your webhook endpoint is publicly accessible over the internet. Anyone can send
        POST requests to it. Without signature verification, an attacker could:
      </p>
      <ul className="mb-4 space-y-2 list-disc pl-6 text-slate-600">
        <li>Send a fake <code className="bg-slate-100 px-1 rounded text-sm">payment.confirmed</code> event to trigger order fulfillment without paying</li>
        <li>Replay old legitimate events to fulfill orders multiple times</li>
        <li>Send malformed payloads to trigger errors or extract information</li>
      </ul>
      <CodeSample code={INSECURE} language="python" title="❌ Insecure — no verification" />
      <p className="mt-3 mb-4 text-slate-600 leading-relaxed">
        Always verify before acting on any event. See the{' '}
        <Link
          to="/docs/webhooks/signature-verification"
          className="font-medium text-slate-900 underline underline-offset-2 hover:no-underline"
        >
          Signature Verification guide
        </Link>{' '}
        for correct implementation.
      </p>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">
        Preventing timing attacks
      </h2>
      <p className="mb-3 text-slate-600 leading-relaxed">
        Standard string comparison returns early as soon as it finds a mismatch. An attacker
        can measure response time differences to brute-force the expected signature byte by
        byte. Always use a constant-time comparison function:
      </p>
      <CodeSample code={TIMING_ATTACK} language="python" title="Constant-time comparison" />

      <div className="mb-6 overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="px-4 py-3 text-left font-semibold text-slate-700">Language</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">Safe comparison function</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {[
              { lang: 'Python', fn: 'hmac.compare_digest(a, b)' },
              { lang: 'Node.js', fn: 'crypto.timingSafeEqual(a, b)' },
              { lang: 'PHP', fn: 'hash_equals($a, $b)' },
              { lang: 'Ruby', fn: 'ActiveSupport::SecurityUtils.secure_compare(a, b)' },
              { lang: 'Go', fn: 'subtle.ConstantTimeCompare(a, b)' },
            ].map((row) => (
              <tr key={row.lang}>
                <td className="px-4 py-3 font-medium text-slate-900">{row.lang}</td>
                <td className="px-4 py-3 font-mono text-slate-600">{row.fn}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">
        Timestamp tolerance window
      </h2>
      <p className="mb-4 text-slate-600 leading-relaxed">
        The <code className="bg-slate-100 px-1 rounded text-sm">X-Lenis-Signature</code> header
        includes a timestamp (<code className="bg-slate-100 px-1 rounded text-sm">t=</code>).
        Always check that this timestamp is within 300 seconds of your current time to
        prevent replay attacks:
      </p>
      <ul className="mb-4 space-y-2 list-disc pl-6 text-slate-600">
        <li>An attacker who intercepts a legitimate event payload cannot replay it after 5 minutes</li>
        <li>300 seconds provides sufficient tolerance for network delays and minor clock drift</li>
        <li>If the tolerance window is too large (e.g. 24 hours), replay attacks become feasible</li>
      </ul>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">
        Storing the webhook secret
      </h2>
      <p className="mb-4 text-slate-600 leading-relaxed">
        The webhook signing secret (<code className="bg-slate-100 px-1 rounded text-sm">whsec_*</code>)
        should be treated with the same care as your API key:
      </p>
      <ul className="space-y-2 list-disc pl-6 text-slate-600">
        <li>Store it as an environment variable, never in source code</li>
        <li>Use a different secret per webhook endpoint (each registration generates a unique secret)</li>
        <li>If compromised, delete the webhook endpoint and create a new one — a new secret is generated automatically</li>
        <li>Never log the secret or include it in error messages</li>
      </ul>
    </>
  )
}
