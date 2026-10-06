import { SEOMeta } from '../../../components/seo/SEOMeta'
import { CodeSample } from '../../../components/docs/CodeSample'

const EVENT_ENVELOPE = `{
  "id": "evt_01HXYZ1234ABCDEF",
  "type": "payment.confirmed",
  "created_at": "2025-01-01T12:05:00Z",
  "api_version": "2024-01-01",
  "data": {
    "id": "pay_01HXYZ1234ABCDEF",
    "status": "confirmed",
    "amount": "100.00",
    "currency": "USDC",
    "network": "polygon",
    "payment_address": "0xABC...DEF",
    "checkout_url": "https://pay.lenis.io/c/abc123",
    "tx_hash": "0x1a2b3c4d5e6f...",
    "block_number": 55234512,
    "confirmations": 12,
    "from_address": "0xCUSTOMER...",
    "metadata": {"order_id": "1234"},
    "created_at": "2025-01-01T11:00:00Z",
    "confirmed_at": "2025-01-01T12:05:00Z"
  }
}`

const EVENT_TYPES = [
  {
    type: 'payment.created',
    trigger: 'POST /v1/payments creates a Payment',
    description: 'Fired immediately when a payment intent is created.',
  },
  {
    type: 'payment.detected',
    trigger: 'On-chain payment detected',
    description: 'An incoming transaction to the payment address has been seen on-chain (may be unconfirmed).',
  },
  {
    type: 'payment.confirming',
    trigger: 'Payment awaiting confirmations',
    description: 'Transaction is included in a block but has not yet reached the required confirmation depth.',
  },
  {
    type: 'payment.confirmed',
    trigger: 'Payment fully confirmed',
    description: 'Required confirmation depth reached. This is the signal to fulfill the order.',
  },
  {
    type: 'payment.expired',
    trigger: 'Payment intent expired',
    description: 'The payment window expired with no on-chain payment detected.',
  },
  {
    type: 'payment.underpaid',
    trigger: 'Payment received but below amount',
    description: 'An on-chain payment was received but the amount was less than required.',
  },
  {
    type: 'payment.link.created',
    trigger: 'Payment link created',
    description: 'A new payment link was created via the API or dashboard.',
  },
  {
    type: 'payment.link.deactivated',
    trigger: 'Payment link deactivated',
    description: 'A payment link was deactivated and is no longer accepting payments.',
  },
]

export function EventTypes() {
  return (
    <>
      <SEOMeta
        title="Webhook Event Types — Lenis Developer Docs"
        description="Reference for all 8 Lenis webhook event types, their triggers, and the canonical event envelope JSON structure."
        ogTitle="Webhook Event Types — Lenis Developer Docs"
        ogDescription="All 8 Lenis webhook event types: payment lifecycle events and payment link events."
      />

      <h1 className="mb-4 text-3xl font-bold tracking-tight text-slate-900">Event Types</h1>
      <p className="mb-6 text-lg text-slate-600 leading-relaxed">
        Lenis fires events at every significant state change in the payment lifecycle. Subscribe
        only to the events your application needs.
      </p>

      <h2 className="mb-4 mt-8 text-xl font-semibold text-slate-900">All event types</h2>
      <div className="mb-8 overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="px-4 py-3 text-left font-semibold text-slate-700">Event type</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">Trigger</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {EVENT_TYPES.map((e) => (
              <tr key={e.type}>
                <td className="px-4 py-3 font-mono text-sm text-slate-900">{e.type}</td>
                <td className="px-4 py-3 text-slate-600">{e.trigger}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mb-4 mt-8 text-xl font-semibold text-slate-900">Event descriptions</h2>
      <div className="mb-8 space-y-4">
        {EVENT_TYPES.map((e) => (
          <div key={e.type} className="rounded-lg border border-slate-200 p-4">
            <code className="font-mono text-sm font-semibold text-slate-900">{e.type}</code>
            <p className="mt-1 text-sm text-slate-600">{e.description}</p>
          </div>
        ))}
      </div>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">Event envelope</h2>
      <p className="mb-3 text-slate-600 leading-relaxed">
        All events share the same top-level envelope structure. The{' '}
        <code className="bg-slate-100 px-1 rounded text-sm">data</code> object contains the
        full resource that triggered the event:
      </p>
      <CodeSample code={EVENT_ENVELOPE} language="json" title="payment.confirmed event" />

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">
        Subscribing to all events
      </h2>
      <p className="text-slate-600 leading-relaxed">
        To receive all event types, use the wildcard value when registering your endpoint:
      </p>
      <CodeSample
        code={`"events": ["*"]`}
        language="json"
      />
    </>
  )
}
