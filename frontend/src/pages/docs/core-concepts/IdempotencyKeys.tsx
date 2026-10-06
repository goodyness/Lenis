import { SEOMeta } from '../../../components/seo/SEOMeta'
import { CodeSample } from '../../../components/docs/CodeSample'

const IDEMPOTENCY_EXAMPLE = `curl -X POST https://api.lenis.io/v1/payments \\
  -H "Authorization: Bearer sk_test_YOUR_API_KEY" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: order-9876-attempt-1" \\
  -d '{
    "amount": "50.00",
    "currency": "USDC",
    "network": "base"
  }'`

const REUSE_ERROR = `{
  "error": {
    "code": "idempotency_key_reuse",
    "message": "An Idempotency-Key was reused with a different request body.",
    "status": 422
  }
}`

export function IdempotencyKeys() {
  return (
    <>
      <SEOMeta
        title="Idempotency Keys — Lenis Developer Docs"
        description="Learn how to use Idempotency-Key headers to safely retry failed requests without creating duplicate payments."
        ogTitle="Idempotency Keys — Lenis Developer Docs"
        ogDescription="Use idempotency keys to safely retry API requests. Lenis deduplicates requests with the same key within 24 hours."
      />

      <h1 className="mb-4 text-3xl font-bold tracking-tight text-slate-900">
        Idempotency Keys
      </h1>
      <p className="mb-6 text-lg text-slate-600 leading-relaxed">
        Idempotency keys let you safely retry API requests without worrying about creating
        duplicate payments. If a request fails due to a network timeout, you can re-send
        the exact same request and Lenis will return the original response instead of
        creating a second resource.
      </p>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">
        The <code className="text-lg font-mono bg-slate-100 px-1.5 rounded">Idempotency-Key</code> header
      </h2>
      <p className="mb-3 text-slate-600 leading-relaxed">
        Add the <code className="bg-slate-100 px-1 rounded text-sm">Idempotency-Key</code> header
        to any <code className="bg-slate-100 px-1 rounded text-sm">POST</code> request. The value
        must be unique per operation. A UUID v4 or a business-meaningful key (e.g.{' '}
        <code className="bg-slate-100 px-1 rounded text-sm">order-{'{id}'}-attempt-{'{n}'}</code>)
        both work.
      </p>
      <CodeSample code={IDEMPOTENCY_EXAMPLE} language="bash" />

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">How it works</h2>
      <ol className="mb-6 space-y-3 text-slate-600">
        <li className="flex gap-3">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-700">
            1
          </span>
          <span>
            You send a <code className="bg-slate-100 px-1 rounded text-sm">POST</code> request with a unique{' '}
            <code className="bg-slate-100 px-1 rounded text-sm">Idempotency-Key</code>.
          </span>
        </li>
        <li className="flex gap-3">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-700">
            2
          </span>
          <span>
            Lenis processes the request and stores the result keyed by your idempotency key.
          </span>
        </li>
        <li className="flex gap-3">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-700">
            3
          </span>
          <span>
            If the same key is sent again within 24 hours with an identical request body,
            Lenis returns the cached response — no new resource is created.
          </span>
        </li>
        <li className="flex gap-3">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-200 text-xs font-bold text-slate-700">
            4
          </span>
          <span>
            After 24 hours the key expires and can be reused (though this is not recommended
            for clarity).
          </span>
        </li>
      </ol>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">The reuse error</h2>
      <p className="mb-3 text-slate-600 leading-relaxed">
        If you send the same idempotency key with a <em>different</em> request body (different
        amount, currency, etc.), Lenis returns a{' '}
        <code className="bg-slate-100 px-1 rounded text-sm">422</code> error to protect you from
        subtle bugs:
      </p>
      <CodeSample code={REUSE_ERROR} language="json" />

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">When to use them</h2>
      <ul className="mb-6 space-y-2 list-disc pl-6 text-slate-600">
        <li>
          Any <code className="bg-slate-100 px-1 rounded text-sm">POST</code> that creates a payment, payment link,
          webhook, or API key
        </li>
        <li>Requests made from backend services where timeouts may trigger automatic retries</li>
        <li>Anywhere your retry logic could send the same logical operation more than once</li>
      </ul>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">
        Generating good keys
      </h2>
      <p className="mb-3 text-slate-600 leading-relaxed">
        The best idempotency keys are unique to the business operation, not just random. Use
        a compound key that encodes the intent:
      </p>
      <ul className="space-y-1 list-disc pl-6 text-slate-600 text-sm">
        <li>
          <code className="bg-slate-100 px-1 rounded">order-{'{order_id}'}-payment-1</code> — for checkout flows
        </li>
        <li>
          <code className="bg-slate-100 px-1 rounded">invoice-{'{invoice_id}'}-send-1</code> — for invoice creation
        </li>
        <li>
          <code className="bg-slate-100 px-1 rounded">{'{uuid_v4}'}</code> — when no natural key exists
        </li>
      </ul>
    </>
  )
}
