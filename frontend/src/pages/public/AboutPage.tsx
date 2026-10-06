import { Link } from 'react-router-dom'
import { SEOMeta } from '../../components/seo/SEOMeta'

// ── Values data ───────────────────────────────────────────────────────────────

interface Value {
  title: string
  description: string
}

const VALUES: Value[] = [
  {
    title: 'Non-custodial by design',
    description:
      'Lenis never holds your funds. Every payment settles directly to the wallet address you designate. We are a technology provider — not a bank, exchange, or custodian.',
  },
  {
    title: 'Developer-first',
    description:
      'Our REST API is built for engineers who want clean abstractions, predictable error shapes, idempotency guarantees, and webhook delivery that actually works.',
  },
  {
    title: 'Transparent infrastructure',
    description:
      'Every payment, status change, and settlement is recorded on-chain. You can verify your own transaction history without relying on Lenis at all.',
  },
  {
    title: 'Privacy-respecting',
    description:
      'We collect only what is necessary to operate the service. We do not sell customer data. We do not profile your payers beyond what your own analytics already capture.',
  },
]

// ── Team / milestone timeline ─────────────────────────────────────────────────

interface Milestone {
  year: string
  description: string
}

const MILESTONES: Milestone[] = [
  {
    year: '2022',
    description: 'Lenis founded to solve the fragmented crypto payments landscape for merchants.',
  },
  {
    year: '2023',
    description:
      'Launched payment links and hosted checkout pages. First 500 merchants onboarded across Ethereum and Polygon.',
  },
  {
    year: '2024',
    description:
      'Introduced the developer API with full test/live mode isolation, webhook delivery, and multi-chain support.',
  },
  {
    year: '2025',
    description:
      'Released Python and TypeScript SDKs. Expanded to Base, Arbitrum, and Optimism networks.',
  },
]

// ── Component ─────────────────────────────────────────────────────────────────

export function AboutPage() {
  return (
    <>
      <SEOMeta
        title="About Lenis — Non-custodial Crypto Payment Infrastructure"
        description="Learn about Lenis, our mission to build non-custodial Web3 financial infrastructure, and the team behind the platform."
        ogTitle="About Lenis — Non-custodial Crypto Payment Infrastructure"
        ogDescription="Learn about Lenis, our mission to build non-custodial Web3 financial infrastructure, and the team behind the platform."
      />

      {/* ── Hero ── */}
      <section className="bg-slate-50 px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
            Payments that stay in your hands
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-slate-600">
            Lenis builds non-custodial Web3 financial infrastructure for merchants and developers.
            Our mission is simple: make it trivially easy to accept crypto payments without
            surrendering custody of your funds to an intermediary.
          </p>
        </div>
      </section>

      {/* ── Mission statement ── */}
      <section
        className="bg-white px-4 py-24 sm:px-6 lg:px-8"
        aria-labelledby="mission-heading"
      >
        <div className="mx-auto max-w-3xl">
          <h2
            id="mission-heading"
            className="mb-6 text-3xl font-bold tracking-tight text-slate-900"
          >
            Our mission
          </h2>
          <p className="mb-4 leading-relaxed text-slate-600">
            The promise of crypto payments has always been self-custody and censorship resistance.
            Yet most payment gateways quietly reintroduce the same custodial risks as traditional
            finance — holding your funds, controlling your access, and extracting rent from every
            transaction.
          </p>
          <p className="mb-4 leading-relaxed text-slate-600">
            Lenis was built on a different premise: a payment processor should be a routing layer,
            not a bank. When a customer pays you, the funds move from their wallet directly to
            yours. Lenis coordinates the cryptographic handshake, validates the on-chain
            confirmation, and fires a signed webhook to your application — nothing more.
          </p>
          <p className="leading-relaxed text-slate-600">
            We believe non-custodial infrastructure is not just technically superior — it is the
            only honest model for a censorship-resistant financial web.
          </p>
        </div>
      </section>

      {/* ── Core values ── */}
      <section
        className="bg-slate-50 px-4 py-24 sm:px-6 lg:px-8"
        aria-labelledby="values-heading"
      >
        <div className="mx-auto max-w-7xl">
          <h2
            id="values-heading"
            className="mb-12 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl"
          >
            What we believe in
          </h2>
          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2">
            {VALUES.map((value) => (
              <article
                key={value.title}
                className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm"
              >
                <h3 className="mb-3 text-lg font-semibold text-slate-900">{value.title}</h3>
                <p className="leading-relaxed text-slate-600">{value.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── Timeline ── */}
      <section
        className="bg-white px-4 py-24 sm:px-6 lg:px-8"
        aria-labelledby="timeline-heading"
      >
        <div className="mx-auto max-w-3xl">
          <h2
            id="timeline-heading"
            className="mb-12 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl"
          >
            Where we've been
          </h2>
          <ol className="relative border-l border-slate-200" aria-label="Company milestones">
            {MILESTONES.map((m) => (
              <li key={m.year} className="mb-10 ml-6">
                <span
                  className="absolute -left-3 flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 ring-4 ring-white"
                  aria-hidden="true"
                />
                <time
                  dateTime={m.year}
                  className="mb-1 block text-sm font-semibold text-slate-900"
                >
                  {m.year}
                </time>
                <p className="text-sm leading-relaxed text-slate-600">{m.description}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="bg-slate-900 px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl text-center">
          <h2 className="mb-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Ready to get started?
          </h2>
          <p className="mx-auto mb-8 max-w-xl text-lg text-slate-400">
            Create a free account and accept your first crypto payment in minutes.
          </p>
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Link
              to="/sign-up"
              className="inline-flex w-full items-center justify-center rounded-md bg-white px-8 py-3.5 text-base font-medium text-slate-900 transition-colors hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-slate-900 sm:w-auto"
            >
              Create free account
            </Link>
            <Link
              to="/contact"
              className="inline-flex w-full items-center justify-center rounded-md border border-slate-600 px-8 py-3.5 text-base font-medium text-white transition-colors hover:border-slate-400 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-slate-900 sm:w-auto"
            >
              Contact us
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}
