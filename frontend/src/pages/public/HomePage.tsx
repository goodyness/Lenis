import { Link } from 'react-router-dom'
import { SEOMeta } from '../../components/seo/SEOMeta'
import { useAuthStore } from '../../lib/auth-store'

// ── Feature highlights data ──────────────────────────────────────────────────

interface Feature {
  title: string
  description: string
  icon: string
}

const FEATURES: Feature[] = [
  {
    title: 'Payment Gateway',
    description:
      'Accept crypto payments from any wallet, anywhere. Our non-custodial gateway routes funds directly to your address — no intermediary holds your assets at any point during settlement.',
    icon: '⬡',
  },
  {
    title: 'Developer API',
    description:
      'Integrate blockchain payments into any application with our REST API. Full test/live mode isolation, idempotency keys, and webhook subscriptions keep your integration clean and reliable.',
    icon: '{}',
  },
  {
    title: 'Webhook Delivery',
    description:
      'Get real-time signed event notifications for every payment lifecycle change. Automatic retry logic with exponential back-off and a full delivery audit trail ensure nothing is missed.',
    icon: '◈',
  },
]

// ── Supported networks data ───────────────────────────────────────────────────

const NETWORKS = [
  'Ethereum',
  'Polygon',
  'Arbitrum',
  'Base',
  'Optimism',
]

// ── Pricing tiers data ────────────────────────────────────────────────────────

interface PricingTier {
  name: string
  price: string
  description: string
  detail: string
}

const PRICING_TIERS: PricingTier[] = [
  {
    name: 'Free',
    price: '$0',
    description: '0 setup fees',
    detail: 'Up to 50 transactions/month',
  },
  {
    name: 'Pro',
    price: '$49/mo',
    description: 'Priority support',
    detail: 'Up to 500 transactions/month',
  },
  {
    name: 'Enterprise',
    price: 'Custom',
    description: 'Dedicated support',
    detail: 'Unlimited transactions',
  },
]

// ── Component ─────────────────────────────────────────────────────────────────

export function HomePage() {
  const user = useAuthStore((s) => s.user)
  const accessToken = useAuthStore((s) => s.accessToken)
  const isAuthenticated = Boolean(accessToken || user)
  const dashboardUrl = user?.role === 'admin' || user?.account_type === 'admin' ? '/admin' : '/dashboard'

  return (
    <>
      <SEOMeta
        title="Lenis — Non-custodial Crypto Payment Infrastructure"
        description="Accept crypto payments programmatically. Non-custodial, developer-friendly, with a full REST API, webhooks, and test mode."
        ogTitle="Lenis — Non-custodial Crypto Payment Infrastructure"
        ogDescription="Accept crypto payments programmatically. Non-custodial, developer-friendly, with a full REST API, webhooks, and test mode."
      />

      {/* ── 1. Hero ── */}
      <section className="flex min-h-screen items-center justify-center bg-white px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl text-center">
          <div className="mb-6 inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-4 py-1.5 text-sm text-slate-600">
            Non-custodial Web3 financial infrastructure
          </div>
          <h1 className="mb-6 text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl lg:text-6xl">
            Accept crypto payments{' '}
            <span className="text-slate-500">without giving up control</span>
          </h1>
          <p className="mx-auto mb-10 max-w-2xl text-lg leading-relaxed text-slate-600 sm:text-xl">
            Lenis provides non-custodial crypto payment infrastructure for
            merchants and developers. Accept payments, issue API keys, and
            integrate blockchain finance — with keys that stay in your hands.
          </p>
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            {isAuthenticated ? (
              <Link
                to={dashboardUrl}
                className="inline-flex w-full items-center justify-center rounded-md bg-slate-900 px-8 py-3.5 text-base font-medium text-white transition-colors hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2 sm:w-auto"
              >
                Go to Dashboard →
              </Link>
            ) : (
              <Link
                to="/sign-up"
                className="inline-flex w-full items-center justify-center rounded-md bg-slate-900 px-8 py-3.5 text-base font-medium text-white transition-colors hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:ring-offset-2 sm:w-auto"
              >
                Get started free
              </Link>
            )}
            <Link
              to="/docs"
              className="inline-flex w-full items-center justify-center rounded-md border border-slate-300 bg-white px-8 py-3.5 text-base font-medium text-slate-700 transition-colors hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:ring-offset-2 sm:w-auto"
            >
              View docs
            </Link>
          </div>
        </div>
      </section>

      {/* ── 2. Feature highlights ── */}
      <section
        id="features"
        className="bg-slate-50 px-4 py-24 sm:px-6 lg:px-8"
        aria-labelledby="features-heading"
      >
        <div className="mx-auto max-w-7xl">
          <div className="mb-16 text-center">
            <h2
              id="features-heading"
              className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl"
            >
              Everything you need to build on-chain finance
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-600">
              Three core primitives. One platform. Full custody remains yours.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <article
                key={feature.title}
                className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm transition-shadow hover:shadow-md"
              >
                <div
                  className="mb-5 flex h-12 w-12 items-center justify-center rounded-lg bg-slate-900 text-xl font-bold text-white"
                  aria-hidden="true"
                >
                  {feature.icon}
                </div>
                <h3 className="mb-3 text-lg font-semibold text-slate-900">
                  {feature.title}
                </h3>
                <p className="leading-relaxed text-slate-600">
                  {feature.description}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── 3. Supported networks/tokens grid ── */}
      <section
        className="bg-white px-4 py-24 sm:px-6 lg:px-8"
        aria-labelledby="networks-heading"
      >
        <div className="mx-auto max-w-7xl text-center">
          <h2
            id="networks-heading"
            className="mb-4 text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl"
          >
            Multi-chain by default
          </h2>
          <p className="mx-auto mb-12 max-w-2xl text-lg text-slate-600">
            Accept payments across the leading EVM-compatible networks with no
            extra configuration.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            {NETWORKS.map((network) => (
              <span
                key={network}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700"
              >
                {network}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ── 4. Pricing summary teaser ── */}
      <section
        className="bg-slate-50 px-4 py-24 sm:px-6 lg:px-8"
        aria-labelledby="pricing-heading"
      >
        <div className="mx-auto max-w-7xl">
          <div className="mb-16 text-center">
            <h2
              id="pricing-heading"
              className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl"
            >
              Simple, transparent pricing
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-lg text-slate-600">
              Start for free and scale as you grow.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-3">
            {PRICING_TIERS.map((tier) => (
              <article
                key={tier.name}
                className="rounded-xl border border-slate-200 bg-white p-8 shadow-sm transition-shadow hover:shadow-md"
              >
                <h3 className="mb-2 text-lg font-semibold text-slate-900">
                  {tier.name}
                </h3>
                <p className="mb-4 text-3xl font-bold tracking-tight text-slate-900">
                  {tier.price}
                </p>
                <p className="text-sm text-slate-600">{tier.description}</p>
                <p className="mt-1 text-sm text-slate-600">{tier.detail}</p>
              </article>
            ))}
          </div>

          <div className="mt-12 text-center">
            <Link
              to="/pricing"
              className="text-base font-medium text-slate-900 underline-offset-4 hover:underline"
            >
              See full pricing →
            </Link>
          </div>
        </div>
      </section>

      {/* ── 5. CTA footer banner ── */}
      <section className="bg-slate-900 px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-7xl text-center">
          <h2 className="mb-8 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            Start building in minutes
          </h2>
          {isAuthenticated ? (
            <Link
              to={dashboardUrl}
              className="inline-flex items-center justify-center rounded-md bg-white px-8 py-3.5 text-base font-medium text-slate-900 transition-colors hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-slate-900"
            >
              Go to Dashboard →
            </Link>
          ) : (
            <Link
              to="/sign-up"
              className="inline-flex items-center justify-center rounded-md bg-white px-8 py-3.5 text-base font-medium text-slate-900 transition-colors hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-slate-900"
            >
              Get started free
            </Link>
          )}
        </div>
      </section>
    </>
  )
}
