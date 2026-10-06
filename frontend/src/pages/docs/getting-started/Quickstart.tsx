import { SEOMeta } from '../../../components/seo/SEOMeta'
import { CodeSample } from '../../../components/docs/CodeSample'

const CURL_CREATE_PAYMENT = `curl -X POST https://api.lenis.io/v1/payments \\
  -H "Authorization: Bearer sk_test_YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": "100.00",
    "currency": "USDC",
    "network": "polygon",
    "description": "Order #1234",
    "idempotency_key": "order-1234-attempt-1"
  }'`

const CURL_RESPONSE = `{
  "id": "pay_01HXYZ1234ABCDEF",
  "status": "pending",
  "amount": "100.00",
  "currency": "USDC",
  "network": "polygon",
  "checkout_url": "https://pay.lenis.io/c/abc123",
  "payment_address": "0xABC...DEF",
  "expires_at": "2025-01-01T12:00:00Z",
  "created_at": "2025-01-01T11:00:00Z"
}`

const PYTHON_WEBHOOK = `from fastapi import FastAPI, Request, HTTPException
import hmac, hashlib, time

app = FastAPI()
WEBHOOK_SECRET = "whsec_your_webhook_secret"

@app.post("/webhooks/lenis")
async def handle_webhook(request: Request):
    payload = await request.body()
    sig_header = request.headers.get("X-Lenis-Signature", "")

    # Parse the signature header: t=<timestamp>,v1=<hex>
    parts = dict(p.split("=", 1) for p in sig_header.split(","))
    timestamp = parts.get("t", "")
    signature = parts.get("v1", "")

    # Verify timestamp is within 5-minute tolerance
    if abs(time.time() - int(timestamp)) > 300:
        raise HTTPException(status_code=400, detail="Timestamp out of tolerance")

    # Verify HMAC-SHA256 signature
    signed_payload = f"{timestamp}.{payload.decode()}"
    expected = hmac.new(
        WEBHOOK_SECRET.encode(), signed_payload.encode(), hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=400, detail="Invalid signature")

    event = await request.json()

    if event["type"] == "payment.confirmed":
        payment = event["data"]
        # Fulfill the order linked to payment["metadata"]["order_id"]
        fulfill_order(payment["metadata"]["order_id"])

    return {"received": True}

def fulfill_order(order_id: str):
    # Your fulfillment logic here
    pass`

export function Quickstart() {
  return (
    <>
      <SEOMeta
        title="Quickstart — Lenis Developer Docs"
        description="Your first Lenis payment in 5 steps. Create an API key, make a payment intent, and receive a webhook confirmation."
        ogTitle="Quickstart — Lenis Developer Docs"
        ogDescription="Your first Lenis payment in 5 steps."
      />

      <h1 className="mb-4 text-3xl font-bold tracking-tight text-slate-900">Quickstart</h1>
      <p className="mb-8 text-lg text-slate-600 leading-relaxed">
        Accept your first crypto payment in under 10 minutes. Follow these five steps to go
        from zero to a working payment flow.
      </p>

      {/* Step 1 */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white">
            1
          </span>
          <h2 className="text-lg font-semibold text-slate-900">Create a free account</h2>
        </div>
        <div className="ml-11">
          <p className="text-slate-600 leading-relaxed">
            Sign up at{' '}
            <a
              href="/sign-up"
              className="font-medium text-slate-900 underline underline-offset-2 hover:no-underline"
            >
              lenis.io/sign-up
            </a>
            . Once your email is verified, you'll land on the merchant dashboard. Complete the
            onboarding wizard to set your payout wallet address.
          </p>
        </div>
      </div>

      {/* Step 2 */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white">
            2
          </span>
          <h2 className="text-lg font-semibold text-slate-900">
            Generate an API key (<code className="text-sm bg-slate-100 px-1 rounded">sk_test_*</code>)
          </h2>
        </div>
        <div className="ml-11">
          <p className="text-slate-600 leading-relaxed">
            Navigate to <strong>Dashboard → API Keys</strong> and click "Create key". Give it a
            descriptive name (e.g. "local-dev"). Copy the key immediately — it won't be shown
            again. Test keys are prefixed <code className="bg-slate-100 px-1 rounded text-sm">sk_test_</code> and route
            payments on testnets only.
          </p>
        </div>
      </div>

      {/* Step 3 */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white">
            3
          </span>
          <h2 className="text-lg font-semibold text-slate-900">
            Create a payment intent via <code className="text-sm bg-slate-100 px-1 rounded">POST /v1/payments</code>
          </h2>
        </div>
        <div className="ml-11">
          <p className="mb-3 text-slate-600 leading-relaxed">
            Call the Payments endpoint with the amount, currency, and network. Lenis returns a
            unique <code className="bg-slate-100 px-1 rounded text-sm">checkout_url</code> and an on-chain{' '}
            <code className="bg-slate-100 px-1 rounded text-sm">payment_address</code>.
          </p>
          <CodeSample code={CURL_CREATE_PAYMENT} language="bash" title="Create payment intent" />
          <p className="mt-2 mb-3 text-sm text-slate-500">Response:</p>
          <CodeSample code={CURL_RESPONSE} language="json" />
        </div>
      </div>

      {/* Step 4 */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white">
            4
          </span>
          <h2 className="text-lg font-semibold text-slate-900">
            Share the checkout URL with your customer
          </h2>
        </div>
        <div className="ml-11">
          <p className="text-slate-600 leading-relaxed">
            Redirect your customer to the <code className="bg-slate-100 px-1 rounded text-sm">checkout_url</code>{' '}
            returned in the response. Lenis hosts a ready-made checkout page that shows the
            amount, the payment address as a QR code, and a countdown timer. You can also
            build a custom checkout using the <code className="bg-slate-100 px-1 rounded text-sm">payment_address</code>{' '}
            directly.
          </p>
        </div>
      </div>

      {/* Step 5 */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-sm font-bold text-white">
            5
          </span>
          <h2 className="text-lg font-semibold text-slate-900">
            Receive a webhook when payment is confirmed
          </h2>
        </div>
        <div className="ml-11">
          <p className="mb-3 text-slate-600 leading-relaxed">
            Register a webhook endpoint in your dashboard under <strong>Settings → Webhooks</strong>.
            Lenis will POST a signed <code className="bg-slate-100 px-1 rounded text-sm">payment.confirmed</code> event
            to your URL when the on-chain confirmation threshold is reached. Always verify
            the signature before acting on the event.
          </p>
          <CodeSample
            code={PYTHON_WEBHOOK}
            language="python"
            title="Webhook handler (FastAPI)"
          />
        </div>
      </div>

      <div className="mt-8 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-sm font-medium text-emerald-800">
          🎉 That's it! You're now accepting crypto payments non-custodially.
        </p>
        <p className="mt-1 text-sm text-emerald-700">
          When you're ready to go live, swap your test key for a live key
          (<code className="bg-emerald-100 px-1 rounded">sk_live_*</code>) from the dashboard.
        </p>
      </div>
    </>
  )
}
