import { SEOMeta } from '../../../components/seo/SEOMeta'
import { CodeSample } from '../../../components/docs/CodeSample'

const GOOD_KEYS = `import uuid

# ✅ Good — unique per business operation
key_uuid = str(uuid.uuid4())
key_business = f"order-{order_id}-payment-attempt-{attempt_number}"
key_invoice = f"invoice-{invoice_id}-send-{timestamp}"

# ❌ Bad — not unique
key_static = "my-payment"   # Same for every payment
key_date_only = "2025-01-01"  # Collides for multiple payments per day`

const RETRY_WITH_KEY = `import requests, uuid

def create_payment_with_retry(
    amount: str,
    currency: str,
    network: str,
    order_id: str,
    max_attempts: int = 3,
) -> dict:
    # Use a stable key tied to the order — same key on retry
    idempotency_key = f"order-{order_id}-payment-1"

    for attempt in range(max_attempts):
        try:
            response = requests.post(
                "https://api.lenis.io/v1/payments",
                headers={
                    "Authorization": f"Bearer {os.environ['LENIS_API_KEY']}",
                    "Idempotency-Key": idempotency_key,
                    # Same key on retry — Lenis returns cached response
                },
                json={
                    "amount": amount,
                    "currency": currency,
                    "network": network,
                    "metadata": {"order_id": order_id},
                },
                timeout=30,
            )
            response.raise_for_status()
            return response.json()
        except requests.Timeout:
            if attempt == max_attempts - 1:
                raise
            # On retry, same idempotency key ensures we get the original
            # payment if it was created despite the timeout

    raise RuntimeError("Max retries exceeded")`

const REUSE_ERROR_HANDLING = `# Handle the idempotency key reuse error (different body, same key)
try:
    payment = create_payment(amount="100.00", key="order-1234-payment-1")
except requests.HTTPError as e:
    if e.response.status_code == 422:
        error = e.response.json()
        if error["error"]["code"] == "idempotency_key_reuse":
            # Key was used with different parameters — logic bug
            # Investigate why the same key is being used with different bodies
            raise ValueError("Idempotency key reused with different parameters")
    raise`

export function IdempotencyKeyUsage() {
  return (
    <>
      <SEOMeta
        title="Idempotency Key Usage — Lenis Developer Docs"
        description="How to generate and use idempotency keys safely with the Lenis API: UUID generation, retry patterns, 24-hour TTL, and reuse error handling."
        ogTitle="Idempotency Key Usage — Lenis Developer Docs"
        ogDescription="Generate good idempotency keys, use them for safe retries, and handle the 24-hour TTL and reuse errors."
      />

      <h1 className="mb-4 text-3xl font-bold tracking-tight text-slate-900">
        Idempotency Key Usage
      </h1>
      <p className="mb-6 text-lg text-slate-600 leading-relaxed">
        Using idempotency keys correctly prevents duplicate payments and makes your
        integration resilient to network failures. This page covers how to generate
        good keys, use them for retries, and handle edge cases.
      </p>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">
        Generating good idempotency keys
      </h2>
      <p className="mb-3 text-slate-600 leading-relaxed">
        A good idempotency key is unique to the specific operation and stays the same
        across retries of that operation:
      </p>
      <CodeSample code={GOOD_KEYS} language="python" />

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">
        Using keys for safe retries
      </h2>
      <p className="mb-3 text-slate-600 leading-relaxed">
        When a request times out, you don't know if the server processed it or not.
        Retrying with the same idempotency key is safe — Lenis returns the original
        response if the request was processed:
      </p>
      <CodeSample
        code={RETRY_WITH_KEY}
        language="python"
        title="Safe retry with idempotency key"
      />

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">
        The 24-hour TTL
      </h2>
      <p className="mb-4 text-slate-600 leading-relaxed">
        Idempotency keys expire after 24 hours. After expiry, the same key can be reused
        for a new operation (though this is not recommended for clarity). The 24-hour
        window covers all reasonable retry scenarios:
      </p>
      <ul className="mb-6 space-y-1 list-disc pl-6 text-slate-600">
        <li>Network failures — typically resolved within seconds or minutes</li>
        <li>Temporary service outages — typically resolved within hours</li>
        <li>Application crashes — restart and retry within the same window</li>
      </ul>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">
        When not to retry
      </h2>
      <p className="mb-4 text-slate-600 leading-relaxed">
        Not all errors are safe to retry. Only retry on network errors and server errors
        (5xx). Do not retry on:
      </p>
      <div className="mb-6 overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="px-4 py-3 text-left font-semibold text-slate-700">Status</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">Retry?</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">Reason</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {[
              { status: 'Connection timeout', retry: '✓ Yes', reason: 'Unknown if request arrived — retry with same key' },
              { status: '5xx Server Error', retry: '✓ Yes', reason: 'Transient server issue — retry with same key' },
              { status: '401 Unauthorized', retry: '✗ No', reason: 'Fix your API key first' },
              { status: '400 Bad Request', retry: '✗ No', reason: 'Invalid parameters — fix the request body' },
              { status: '422 (key reuse)', retry: '✗ No', reason: 'Logic error — same key used with different params' },
            ].map((row) => (
              <tr key={row.status}>
                <td className="px-4 py-3 font-medium text-slate-900">{row.status}</td>
                <td className="px-4 py-3 text-slate-600">{row.retry}</td>
                <td className="px-4 py-3 text-slate-600">{row.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">
        Handling the reuse error
      </h2>
      <p className="mb-3 text-slate-600 leading-relaxed">
        If you send the same key with a different request body, Lenis returns a 422.
        This indicates a logic bug in your code — investigate rather than blindly retrying:
      </p>
      <CodeSample code={REUSE_ERROR_HANDLING} language="python" />
    </>
  )
}
