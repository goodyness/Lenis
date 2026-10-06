import { SEOMeta } from '../../../components/seo/SEOMeta'

export function NonCustodialModel() {
  return (
    <>
      <SEOMeta
        title="Non-Custodial Model — Lenis Developer Docs"
        description="Learn how Lenis's non-custodial architecture works: funds go directly to your wallet, Lenis never holds your money."
        ogTitle="Non-Custodial Model — Lenis Developer Docs"
        ogDescription="Lenis never holds your funds. Every payment settles directly to your designated wallet address."
      />

      <h1 className="mb-4 text-3xl font-bold tracking-tight text-slate-900">
        Non-Custodial Model
      </h1>
      <p className="mb-6 text-lg text-slate-600 leading-relaxed">
        The defining property of Lenis is that we never hold your funds. This page explains
        what that means architecturally and why it matters.
      </p>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">
        How funds flow
      </h2>
      <p className="mb-4 text-slate-600 leading-relaxed">
        When a customer pays, their crypto moves in a single on-chain transaction from their
        wallet directly to your designated payout address. Lenis never appears in the
        transaction path — there is no intermediate escrow, no pooled wallet, no settlement
        delay.
      </p>

      {/* Visual flow */}
      <div className="mb-6 flex flex-col items-center gap-2 sm:flex-row sm:justify-center">
        {[
          { label: "Customer's wallet", sub: 'Sends payment' },
          null,
          { label: 'Lenis', sub: 'Monitors on-chain' },
          null,
          { label: "Your wallet", sub: 'Receives funds' },
        ].map((item, i) =>
          item === null ? (
            <div key={i} className="text-slate-300 text-2xl font-light sm:text-3xl">→</div>
          ) : (
            <div
              key={i}
              className="flex flex-col items-center rounded-lg border border-slate-200 bg-slate-50 px-5 py-3 text-center"
            >
              <span className="font-medium text-slate-900 text-sm">{item.label}</span>
              <span className="text-xs text-slate-500">{item.sub}</span>
            </div>
          )
        )}
      </div>
      <p className="mb-4 text-slate-600 leading-relaxed">
        What Lenis actually does is coordinate the off-chain layer: generating the unique
        payment address, monitoring the blockchain for incoming transactions, validating
        confirmation depth, and firing webhooks to your application.
      </p>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">
        On-chain verification
      </h2>
      <p className="mb-4 text-slate-600 leading-relaxed">
        Every payment confirmation Lenis reports is verifiable independently on-chain. The
        transaction response includes:
      </p>
      <ul className="mb-6 list-disc space-y-2 pl-6 text-slate-600">
        <li>
          <code className="bg-slate-100 px-1 rounded text-sm">tx_hash</code> — the on-chain transaction hash
        </li>
        <li>
          <code className="bg-slate-100 px-1 rounded text-sm">block_number</code> — the block in which it was included
        </li>
        <li>
          <code className="bg-slate-100 px-1 rounded text-sm">confirmations</code> — confirmation depth at time of webhook fire
        </li>
        <li>
          <code className="bg-slate-100 px-1 rounded text-sm">network</code> — the chain where the transaction occurred
        </li>
      </ul>
      <p className="mb-4 text-slate-600 leading-relaxed">
        You can verify any payment independently by looking up the{' '}
        <code className="bg-slate-100 px-1 rounded text-sm">tx_hash</code> on a block explorer.
        You do not need to trust Lenis's confirmation — the blockchain is the source of truth.
      </p>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">
        What this means for you
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {[
          {
            title: 'No counterparty risk',
            desc: 'If Lenis went offline, your historical payments would still be on-chain and your funds would already be in your wallet.',
          },
          {
            title: 'No settlement delay',
            desc: 'Funds arrive in your wallet as soon as the on-chain transaction confirms. No end-of-day batching or T+2 settlement.',
          },
          {
            title: 'No regulatory custodianship',
            desc: 'Because Lenis never holds funds, we are not a money transmitter on your behalf. You retain full control and responsibility.',
          },
          {
            title: 'Full auditability',
            desc: 'Your accountant, auditor, or customer can verify any payment directly on the blockchain without asking Lenis.',
          },
        ].map((item) => (
          <div key={item.title} className="rounded-lg border border-slate-200 p-4">
            <h3 className="mb-1 font-semibold text-slate-900">{item.title}</h3>
            <p className="text-sm text-slate-600">{item.desc}</p>
          </div>
        ))}
      </div>
    </>
  )
}
