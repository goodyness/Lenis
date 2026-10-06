import { SEOMeta } from '../../../components/seo/SEOMeta'
import { CodeSample } from '../../../components/docs/CodeSample'

const REGISTER_CURL = `curl -X POST https://api.lenis.io/v1/webhooks \\
  -H "Authorization: Bearer sk_live_YOUR_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "https://yourapp.com/webhooks/lenis",
    "events": ["payment.confirmed", "payment.expired", "payment.underpaid"]
  }'`

const PYTHON_HANDLER = `from fastapi import FastAPI, Request, HTTPException
import hmac, hashlib, time, json

app = FastAPI()
WEBHOOK_SECRET = "whsec_your_webhook_secret_here"

@app.post("/webhooks/lenis")
async def lenis_webhook(request: Request):
    payload_bytes = await request.body()
    sig_header = request.headers.get("X-Lenis-Signature", "")

    # 1. Parse the header
    try:
        parts = dict(p.split("=", 1) for p in sig_header.split(","))
        timestamp = parts["t"]
        v1_sig = parts["v1"]
    except (ValueError, KeyError):
        raise HTTPException(status_code=400, detail="Missing signature header")

    # 2. Check timestamp tolerance (5 minutes)
    if abs(time.time() - int(timestamp)) > 300:
        raise HTTPException(status_code=400, detail="Timestamp out of tolerance")

    # 3. Verify HMAC-SHA256
    signed_payload = f"{timestamp}.{payload_bytes.decode()}"
    expected = hmac.new(
        WEBHOOK_SECRET.encode(), signed_payload.encode(), hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(expected, v1_sig):
        raise HTTPException(status_code=400, detail="Invalid signature")

    # 4. Process the event
    event = json.loads(payload_bytes)
    if event["type"] == "payment.confirmed":
        fulfill_order(event["data"])

    # 5. Respond quickly — do heavy work asynchronously
    return {"received": True}

def fulfill_order(payment: dict):
    # Queue background task here
    pass`

export function SetupGuide() {
  return (
    <>
      <SEOMeta
        title="Webhook Setup Guide — Lenis Developer Docs"
        description="Step-by-step guide to setting up Lenis webhooks: register your endpoint, verify signatures, and go live."
        ogTitle="Webhook Setup Guide — Lenis Developer Docs"
        ogDescription="Register your webhook endpoint, store the secret, verify HMAC signatures, and go live with Lenis webhooks."
      />

      <h1 className="mb-4 text-3xl font-bold tracking-tight text-slate-900">
        Webhook Setup Guide
      </h1>
      <p className="mb-6 text-lg text-slate-600 leading-relaxed">
        Webhooks are the recommended way to get notified of payment events. This guide walks
        you through registering an endpoint and handling events securely.
      </p>

      {/* Step 1 */}
      <div className="mb-8">
        <div className="mb-3 flex items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white">1</span>
          <h2 className="text-lg font-semibold text-slate-900">Register your endpoint</h2>
        </div>
        <div className="ml-11">
          <p className="mb-3 text-slate-600 leading-relaxed">
            Call <code className="bg-slate-100 px-1 rounded text-sm">POST /v1/webhooks</code> with
            your HTTPS endpoint URL and the event types you want to receive. Only subscribe
            to events your application actually handles.
          </p>
          <CodeSample code={REGISTER_CURL} language="bash" />
        </div>
      </div>

      {/* Step 2 */}
      <div className="mb-8">
        <div className="mb-3 flex items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white">2</span>
          <h2 className="text-lg font-semibold text-slate-900">Store the signing secret</h2>
        </div>
        <div className="ml-11">
          <p className="text-slate-600 leading-relaxed">
            The registration response includes a{' '}
            <code className="bg-slate-100 px-1 rounded text-sm">secret</code> field prefixed with{' '}
            <code className="bg-slate-100 px-1 rounded text-sm">whsec_</code>. This is shown only once.
            Store it in an environment variable (e.g.{' '}
            <code className="bg-slate-100 px-1 rounded text-sm">LENIS_WEBHOOK_SECRET</code>) and never
            commit it to version control.
          </p>
        </div>
      </div>

      {/* Step 3 */}
      <div className="mb-8">
        <div className="mb-3 flex items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white">3</span>
          <h2 className="text-lg font-semibold text-slate-900">Implement signature verification</h2>
        </div>
        <div className="ml-11">
          <p className="mb-3 text-slate-600 leading-relaxed">
            Every incoming request from Lenis includes an{' '}
            <code className="bg-slate-100 px-1 rounded text-sm">X-Lenis-Signature</code> header.
            Always verify this signature before processing the event.
          </p>
          <CodeSample
            code={PYTHON_HANDLER}
            language="python"
            title="Complete webhook handler (FastAPI)"
          />
        </div>
      </div>

      {/* Step 4 */}
      <div className="mb-8">
        <div className="mb-3 flex items-center gap-3">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white">4</span>
          <h2 className="text-lg font-semibold text-slate-900">Test and go live</h2>
        </div>
        <div className="ml-11">
          <p className="text-slate-600 leading-relaxed">
            Use the{' '}
            <code className="bg-slate-100 px-1 rounded text-sm">POST /v1/webhooks/{'{id}'}/test</code>{' '}
            endpoint to send a synthetic event to your handler. Verify your logs show the
            event was received and processed correctly. Then swap your test API key for a
            live key and update your webhook endpoint URL if needed.
          </p>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
        <p className="text-sm font-medium text-slate-800">Best practices</p>
        <ul className="mt-2 space-y-1 text-sm text-slate-600">
          <li>— Always verify signatures before trusting event data</li>
          <li>— Respond with HTTP 200 quickly (under 30 seconds) to avoid retry triggering</li>
          <li>— Do heavy processing in a background queue, not in the handler itself</li>
          <li>— Handle duplicate events with idempotency (same event ID may be delivered more than once)</li>
        </ul>
      </div>
    </>
  )
}
