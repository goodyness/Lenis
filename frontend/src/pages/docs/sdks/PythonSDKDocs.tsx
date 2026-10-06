import { SEOMeta } from '../../../components/seo/SEOMeta'
import { CodeSample } from '../../../components/docs/CodeSample'

const INSTALL = `pip install lenis-python`

const QUICKSTART = `from lenis import LenisClient

# Initialize the client
client = LenisClient(api_key="sk_test_YOUR_API_KEY")

# Create a payment intent
payment = client.payments.create(
    amount="100.00",
    token_symbol="USDC",
    network="base",
    accepted_tokens=[{"token_symbol": "USDC", "network": "base"}],
    customer_email="buyer@example.com",
    metadata={"order_id": "1234"},
    idempotency_key="order-1234-attempt-1",
)

print(payment["checkout_url"])   # https://lenis.io/pay/<slug>
print(payment["status"])         # pending

# Retrieve a payment by ID
payment = client.payments.retrieve("pay_abc123")

# List payments (returns dict with data, has_more, next_cursor, total)
result = client.payments.list(status="confirmed", limit=20)
for p in result["data"]:
    print(p["id"], p["amount"], p["status"])`

const PAYMENT_LINKS = `# Create a fixed-price payment link
link = client.payment_links.create(
    title="Pro Plan — Monthly",
    amount_mode="fixed",
    amount="29.00",
    accepted_tokens=[{"token_symbol": "USDC", "network": "base"}],
    redirect_url="https://yourapp.com/thank-you",
    max_uses=100,
)

print(link["checkout_url"])

# Retrieve and list
link = client.payment_links.retrieve("lnk_abc123")
result = client.payment_links.list(limit=10)
for l in result["data"]:
    print(l["id"], l["title"])`

const WEBHOOK_HANDLER = `from lenis import LenisClient
from lenis.exceptions import LenisWebhookSignatureError
from fastapi import FastAPI, Request, Response

app = FastAPI()
client = LenisClient(api_key="sk_live_YOUR_API_KEY")

WEBHOOK_SECRET = "whsec_your_endpoint_secret"

@app.post("/webhooks/lenis")
async def handle_webhook(request: Request):
    payload = await request.body()
    sig_header = request.headers.get("X-Lenis-Signature", "")

    try:
        event = client.webhooks.construct_event(payload, sig_header, WEBHOOK_SECRET)
    except LenisWebhookSignatureError as e:
        return Response(content=str(e), status_code=400)

    if event["type"] == "payment.confirmed":
        order_id = event["data"].get("metadata", {}).get("order_id")
        fulfill_order(order_id)

    return {"received": True}

def fulfill_order(order_id: str):
    pass  # Your fulfillment logic`

const EXCEPTION_EXAMPLE = `from lenis import LenisClient
from lenis.exceptions import (
    LenisAuthError,
    LenisAPIError,
    LenisWebhookSignatureError,
)

client = LenisClient(api_key="sk_test_...")

try:
    payment = client.payments.create(
        amount="100.00",
        token_symbol="USDC",
        network="base",
        accepted_tokens=[{"token_symbol": "USDC", "network": "base"}],
    )
except LenisAuthError as e:
    # e.status_code == 0  -> empty/missing api_key
    # e.status_code == 401 -> invalid, revoked, or expired key
    print(f"Auth error: {e.error}")
except LenisAPIError as e:
    # e.status_code: int (e.g. 422, 429, 503)
    # e.error: str  (machine-readable error code)
    # e.param: str | None  (field that caused the error, if any)
    print(f"API error [{e.status_code}]: {e.error}, param={e.param}")
except LenisWebhookSignatureError as e:
    # e.message: str
    print(f"Bad webhook signature: {e.message}")

# LenisAuthError is also raised immediately at construction time:
try:
    bad_client = LenisClient(api_key="")
except LenisAuthError as e:
    print(e.error)  # "api_key is required and cannot be empty."`

export function PythonSDKDocs() {
  return (
    <>
      <SEOMeta
        title="Python SDK — Lenis Developer Docs"
        description="Install and use the Lenis Python SDK to create payments, manage payment links, verify webhooks, and handle errors in your Python application."
        ogTitle="Python SDK — Lenis Developer Docs"
        ogDescription="lenis-python SDK: install, quickstart, webhook handler, and exception types."
      />

      <h1 className="mb-4 text-3xl font-bold tracking-tight text-slate-900">Python SDK</h1>
      <p className="mb-6 text-lg text-slate-600 leading-relaxed">
        The official Python SDK for Lenis. Wraps the REST API with a clean sync/async interface,
        built-in 5xx retries, and webhook signature verification. Requires Python 3.10+.
      </p>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">Installation</h2>
      <CodeSample code={INSTALL} language="bash" />
      <p className="mt-2 mb-4 text-sm text-slate-500">
        Available on{' '}
        <a
          href="https://pypi.org/project/lenis-python/"
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-slate-700 underline underline-offset-2 hover:no-underline"
        >
          PyPI
        </a>
        . Runtime dependency:{' '}
        <code className="bg-slate-100 px-1 rounded text-xs">httpx&gt;=0.27</code>.
      </p>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">Quick start — payments</h2>
      <p className="mb-3 text-slate-600 leading-relaxed">
        All resource methods return plain{' '}
        <code className="bg-slate-100 px-1 rounded text-sm">dict</code>s matching the API JSON
        response. List responses always include{' '}
        <code className="bg-slate-100 px-1 rounded text-sm">data</code>,{' '}
        <code className="bg-slate-100 px-1 rounded text-sm">has_more</code>,{' '}
        <code className="bg-slate-100 px-1 rounded text-sm">next_cursor</code>, and{' '}
        <code className="bg-slate-100 px-1 rounded text-sm">total</code>.
      </p>
      <CodeSample code={QUICKSTART} language="python" />

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">Payment links</h2>
      <CodeSample code={PAYMENT_LINKS} language="python" />

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">Webhook handling</h2>
      <p className="mb-3 text-slate-600 leading-relaxed">
        Use{' '}
        <code className="bg-slate-100 px-1 rounded text-sm">client.webhooks.construct_event()</code>{' '}
        to verify the{' '}
        <code className="bg-slate-100 px-1 rounded text-sm">X-Lenis-Signature</code> header and
        parse the event. Pass raw bytes — do not pre-parse the body.
      </p>
      <CodeSample code={WEBHOOK_HANDLER} language="python" title="FastAPI webhook handler" />

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">Exception handling</h2>
      <p className="mb-3 text-slate-600 leading-relaxed">
        The SDK raises typed exceptions for every failure mode:
      </p>

      <div className="mb-4 overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="px-4 py-3 text-left font-semibold text-slate-700">Exception</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">Attributes</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">When raised</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {[
              {
                ex: 'LenisAuthError',
                attrs: 'status_code: int, error: str',
                when: 'HTTP 401, or api_key is None / empty (status_code=0)',
              },
              {
                ex: 'LenisAPIError',
                attrs: 'status_code: int, error: str, param: str | None',
                when: 'Any other non-2xx response (422, 429, 5xx after retries)',
              },
              {
                ex: 'LenisWebhookSignatureError',
                attrs: 'message: str',
                when: 'construct_event() — HMAC mismatch, expired timestamp, or malformed header',
              },
            ].map((row) => (
              <tr key={row.ex}>
                <td className="px-4 py-3 font-mono text-slate-900 whitespace-nowrap">{row.ex}</td>
                <td className="px-4 py-3 font-mono text-xs text-slate-500">{row.attrs}</td>
                <td className="px-4 py-3 text-slate-600">{row.when}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <CodeSample code={EXCEPTION_EXAMPLE} language="python" title="Exception handling" />

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">Async support</h2>
      <p className="text-slate-600 leading-relaxed">
        Every resource method has a synchronous variant (used above) backed by{' '}
        <code className="bg-slate-100 px-1 rounded text-sm">httpx.Client</code>. An async{' '}
        <code className="bg-slate-100 px-1 rounded text-sm">httpx.AsyncClient</code> is also
        available via{' '}
        <code className="bg-slate-100 px-1 rounded text-sm">client._http.async_request()</code>{' '}
        for advanced use cases. Use the client as a context manager to ensure connections are
        properly closed:
      </p>
      <CodeSample
        code={`with LenisClient(api_key="sk_test_...") as client:\n    payment = client.payments.create(...)`}
        language="python"
      />
    </>
  )
}
