import { SEOMeta } from '../../../components/seo/SEOMeta'

interface StatusNode {
  status: string
  description: string
  color: string
  textColor: string
  borderColor: string
}

const STATUSES: StatusNode[] = [
  {
    status: 'pending',
    description: 'Payment intent created. Awaiting on-chain deposit.',
    color: 'bg-slate-100',
    textColor: 'text-slate-700',
    borderColor: 'border-slate-300',
  },
  {
    status: 'detected',
    description: 'On-chain transaction detected in the mempool or a new block.',
    color: 'bg-blue-50',
    textColor: 'text-blue-700',
    borderColor: 'border-blue-300',
  },
  {
    status: 'confirming',
    description: 'Transaction included in a block. Awaiting required confirmation depth.',
    color: 'bg-amber-50',
    textColor: 'text-amber-700',
    borderColor: 'border-amber-300',
  },
  {
    status: 'confirmed',
    description: 'Required confirmations reached. Payment complete.',
    color: 'bg-emerald-50',
    textColor: 'text-emerald-700',
    borderColor: 'border-emerald-300',
  },
]

const TERMINAL_STATUSES: StatusNode[] = [
  {
    status: 'underpaid',
    description: 'Payment received but the amount was less than required.',
    color: 'bg-orange-50',
    textColor: 'text-orange-700',
    borderColor: 'border-orange-300',
  },
  {
    status: 'expired',
    description: 'No payment was detected before the intent expired.',
    color: 'bg-red-50',
    textColor: 'text-red-700',
    borderColor: 'border-red-300',
  },
]

export function PaymentLifecycle() {
  return (
    <>
      <SEOMeta
        title="Payment Lifecycle — Lenis Developer Docs"
        description="Understand the Lenis payment status state machine: pending, detected, confirming, confirmed, underpaid, and expired."
        ogTitle="Payment Lifecycle — Lenis Developer Docs"
        ogDescription="The Lenis payment status state machine: pending → detected → confirming → confirmed (or underpaid/expired)."
      />

      <h1 className="mb-4 text-3xl font-bold tracking-tight text-slate-900">
        Payment Lifecycle
      </h1>
      <p className="mb-6 text-lg text-slate-600 leading-relaxed">
        Every Lenis payment moves through a defined set of statuses as it progresses from
        creation to final settlement. Understanding this state machine helps you build
        robust payment flows and handle all outcomes correctly.
      </p>

      <h2 className="mb-4 mt-8 text-xl font-semibold text-slate-900">Status flow</h2>

      {/* Main flow diagram */}
      <div className="mb-4 flex flex-col items-start gap-0">
        {STATUSES.map((node, idx) => (
          <div key={node.status} className="flex flex-col items-start">
            <div
              className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${node.color} ${node.borderColor}`}
              style={{ minWidth: '320px' }}
            >
              <code className={`font-mono font-semibold text-sm ${node.textColor}`}>
                {node.status}
              </code>
              <span className="text-sm text-slate-600">{node.description}</span>
            </div>
            {idx < STATUSES.length - 1 && (
              <div className="ml-6 my-1 text-slate-400 text-lg font-light">↓</div>
            )}
          </div>
        ))}
      </div>

      {/* Terminal states branch */}
      <div className="ml-6 mb-6">
        <p className="mb-2 text-xs font-medium text-slate-400 uppercase tracking-wider">
          Alternative terminal states (from pending or confirming)
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          {TERMINAL_STATUSES.map((node) => (
            <div
              key={node.status}
              className={`flex items-start gap-3 rounded-lg border px-4 py-3 ${node.color} ${node.borderColor}`}
              style={{ minWidth: '220px' }}
            >
              <code className={`font-mono font-semibold text-sm ${node.textColor}`}>
                {node.status}
              </code>
              <span className="text-sm text-slate-600">{node.description}</span>
            </div>
          ))}
        </div>
      </div>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">
        Status descriptions
      </h2>
      <div className="mb-6 overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="px-4 py-3 text-left font-semibold text-slate-700">Status</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">Webhook event</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">Terminal?</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {[
              { status: 'pending', event: '—', terminal: 'No' },
              { status: 'detected', event: 'payment.detected', terminal: 'No' },
              { status: 'confirming', event: 'payment.confirming', terminal: 'No' },
              { status: 'confirmed', event: 'payment.confirmed', terminal: 'Yes ✓' },
              { status: 'underpaid', event: 'payment.underpaid', terminal: 'Yes' },
              { status: 'expired', event: 'payment.expired', terminal: 'Yes' },
            ].map((row) => (
              <tr key={row.status}>
                <td className="px-4 py-3 font-mono text-slate-900">{row.status}</td>
                <td className="px-4 py-3 text-slate-600">{row.event}</td>
                <td className="px-4 py-3 text-slate-600">{row.terminal}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">Handling each state</h2>
      <ul className="space-y-3 text-slate-600">
        <li className="flex gap-2">
          <code className="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-xs font-mono font-medium text-slate-700">confirmed</code>
          <span>This is the only state where fulfillment is safe. Always fulfill in your webhook handler for this event.</span>
        </li>
        <li className="flex gap-2">
          <code className="shrink-0 rounded bg-orange-100 px-1.5 py-0.5 text-xs font-mono font-medium text-orange-700">underpaid</code>
          <span>Notify the customer. You may choose to request a top-up or refund depending on your business logic.</span>
        </li>
        <li className="flex gap-2">
          <code className="shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-xs font-mono font-medium text-red-700">expired</code>
          <span>The payment window (typically 60 minutes) elapsed with no on-chain payment. Create a new payment intent if the customer wants to retry.</span>
        </li>
        <li className="flex gap-2">
          <code className="shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-mono font-medium text-amber-700">confirming</code>
          <span>Show a "payment processing" state in your UI. Do not fulfill yet — the transaction could still be orphaned on low-confirmation-count chains.</span>
        </li>
      </ul>
    </>
  )
}
