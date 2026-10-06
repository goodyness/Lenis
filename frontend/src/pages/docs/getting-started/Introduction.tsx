import { Link } from 'react-router-dom'
import { SEOMeta } from '../../../components/seo/SEOMeta'

export function Introduction() {
  return (
    <>
      <SEOMeta
        title="Introduction — Lenis Developer Docs"
        description="Get started with the Lenis Developer API. Learn what Lenis offers and how to integrate non-custodial crypto payments into your application."
        ogTitle="Introduction — Lenis Developer Docs"
        ogDescription="Get started with the Lenis Developer API. Learn what Lenis offers and how to integrate non-custodial crypto payments into your application."
      />

      <h1 className="mb-4 text-3xl font-bold tracking-tight text-slate-900">
        Introduction
      </h1>
      <p className="mb-6 text-lg text-slate-600 leading-relaxed">
        Welcome to the Lenis Developer API documentation. Lenis provides non-custodial Web3
        payment infrastructure that lets you accept crypto payments without an intermediary
        holding your funds.
      </p>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">What is Lenis?</h2>
      <p className="mb-4 text-slate-600 leading-relaxed">
        Lenis is a payment processor for the decentralized web. When a customer pays you,
        funds move directly from their wallet to yours. Lenis coordinates the cryptographic
        handshake, validates on-chain confirmations, and fires a signed webhook to your
        application — nothing more. We are a routing layer, not a bank.
      </p>
      <p className="mb-4 text-slate-600 leading-relaxed">
        The Developer API gives you programmatic access to everything the Lenis platform
        offers: creating payment intents, managing payment links, querying transaction
        history, and configuring webhooks — all through a clean REST interface.
      </p>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">Who is this for?</h2>
      <ul className="mb-6 list-disc space-y-2 pl-6 text-slate-600">
        <li>Developers building e-commerce stores or SaaS platforms that want to accept crypto</li>
        <li>Teams integrating crypto checkout into existing payment flows</li>
        <li>Builders creating custom checkout UIs on top of the Lenis infrastructure</li>
        <li>Anyone who wants reliable, non-custodial crypto payment processing with webhook delivery</li>
      </ul>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">What the API offers</h2>
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {[
          {
            title: 'Payment Intents',
            desc: 'Create payment requests with a fixed amount and currency. Lenis generates a unique checkout URL and on-chain address.',
          },
          {
            title: 'Payment Links',
            desc: 'Reusable links that let any payer initiate a payment. Perfect for invoices, donation pages, or product listings.',
          },
          {
            title: 'Webhooks',
            desc: 'Receive signed HTTP callbacks for every payment event — from detection to confirmation or expiry.',
          },
          {
            title: 'Transaction History',
            desc: 'Query full transaction history with filtering, pagination, and on-chain verification data.',
          },
        ].map((item) => (
          <div key={item.title} className="rounded-lg border border-slate-200 p-4">
            <h3 className="mb-1 font-semibold text-slate-900">{item.title}</h3>
            <p className="text-sm text-slate-600">{item.desc}</p>
          </div>
        ))}
      </div>

      <h2 className="mb-4 mt-8 text-xl font-semibold text-slate-900">Quick links</h2>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Link
          to="/docs/getting-started/quickstart"
          className="inline-flex items-center rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2"
        >
          Quickstart →
        </Link>
        <Link
          to="/docs/getting-started/authentication"
          className="inline-flex items-center rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
        >
          Authentication
        </Link>
        <Link
          to="/docs/api-reference/payments"
          className="inline-flex items-center rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2"
        >
          API Reference
        </Link>
      </div>
    </>
  )
}
