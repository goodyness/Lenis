import { useState } from 'react'
import { Link } from 'react-router-dom'
import { SEOMeta } from '../../components/seo/SEOMeta'
import { useAuthStore } from '../../lib/auth-store'

// ── Types ─────────────────────────────────────────────────────────────────────

interface FeatureRow {
  label: string
  free: string
  growth: string
  scale: string
  enterprise: string
}

// ── Feature matrix data aligned with Settings Billing ─────────────────────────

const FEATURE_ROWS: FeatureRow[] = [
  {
    label: 'Monthly transactions volume',
    free: 'Up to 50 txs',
    growth: 'Up to 1,000 txs',
    scale: 'Up to 10,000 txs',
    enterprise: 'Unlimited volume',
  },
  {
    label: 'Settlement model',
    free: 'Non-custodial EVM',
    growth: 'Non-custodial EVM',
    scale: 'Non-custodial EVM',
    enterprise: 'Non-custodial EVM',
  },
  {
    label: 'Supported EVM chains',
    free: 'Base, Polygon',
    growth: 'All 5 EVM chains',
    scale: 'All EVM chains + Priority RPC',
    enterprise: 'Custom chains & dedicated nodes',
  },
  {
    label: 'Payment links & Invoices',
    free: 'Up to 5 active',
    growth: 'Unlimited active',
    scale: 'Unlimited active',
    enterprise: 'Unlimited active',
  },
  {
    label: 'Custom store branding & logo',
    free: '—',
    growth: '✓ (Logo & custom color)',
    scale: '✓ (Full custom theme)',
    enterprise: '✓ (Whitelabel / Custom domain)',
  },
  {
    label: 'Webhook event dispatches',
    free: 'Standard',
    growth: 'Real-time signed webhooks',
    scale: 'Custom retry policies',
    enterprise: 'Dedicated high-throughput queue',
  },
  {
    label: 'Multi-wallet routing',
    free: '—',
    growth: '—',
    scale: '✓ Automated load balancing',
    enterprise: '✓ Custom treasury routing',
  },
  {
    label: 'Reports & CSV analytics',
    free: 'Basic summary',
    growth: 'Full CSV exports',
    scale: 'Advanced financial breakdown',
    enterprise: 'Custom BI data streams',
  },
  {
    label: 'Customer directory & CRM',
    free: 'Basic',
    growth: '✓ Full payer analytics',
    scale: '✓ Payer directory & reminders',
    enterprise: '✓ Dedicated CRM sync',
  },
  {
    label: 'Support & SLAs',
    free: 'Community',
    growth: 'Priority 24/7 technical',
    scale: 'Dedicated email & account rep',
    enterprise: 'Dedicated engineer (4h SLA)',
  },
  {
    label: 'API rate limits',
    free: '60 req / min',
    growth: '300 req / min',
    scale: '1,000 req / min',
    enterprise: 'Custom high-throughput limit',
  },
]

// ── Cell helper ───────────────────────────────────────────────────────────────

function Cell({ value }: { value: string }) {
  if (value === '✓') {
    return (
      <span className="text-emerald-600 font-bold" aria-label="Included">
        ✓
      </span>
    )
  }
  if (value === '—') {
    return (
      <span className="text-slate-300" aria-label="Not included">
        —
      </span>
    )
  }
  return <span className="text-slate-600 text-xs font-medium">{value}</span>
}

// ── Component ─────────────────────────────────────────────────────────────────

export function PricingPage() {
  const [billingPeriod, setBillingPeriod] = useState<'monthly' | 'yearly'>('monthly')
  const user = useAuthStore((s) => s.user)
  const accessToken = useAuthStore((s) => s.accessToken)
  const isAuthenticated = Boolean(accessToken || user)
  const currentTier = user?.subscription_tier || 'free'

  const TIERS = [
    {
      tier: 'free',
      name: 'Starter',
      badge: 'Free Forever',
      price: '$0',
      period: 'forever',
      description: 'Perfect for testing, early-stage developers & pilot merchants.',
      features: [
        'Up to 50 transactions / mo',
        'Non-custodial EVM settlements',
        'Base & Polygon networks',
        'Standard Webhooks & API keys',
        'Standard email support',
      ],
      highlight: false,
    },
    {
      tier: 'growth',
      name: 'Growth Pro',
      badge: 'Popular for Businesses',
      price: billingPeriod === 'yearly' ? '$290' : '$29',
      period: billingPeriod === 'yearly' ? 'yr' : 'mo',
      description: 'Designed for scaling e-commerce, SaaS & crypto merchants.',
      features: [
        'Up to 1,000 transactions / mo',
        'All EVM chains + Priority indexing',
        'Custom store branding & logo',
        'Instant Email & In-App Alerts',
        'Priority 24/7 technical support',
        'API rate limit: 300 req/min',
      ],
      highlight: true,
    },
    {
      tier: 'scale',
      name: 'Scale Business',
      badge: 'High Throughput',
      price: billingPeriod === 'yearly' ? '$990' : '$99',
      period: billingPeriod === 'yearly' ? 'yr' : 'mo',
      description: 'For high-volume web3 apps, fintechs & large merchants.',
      features: [
        'Up to 10,000 transactions / mo',
        'Dedicated high-throughput RPC indexers',
        'Multi-wallet settlement routing',
        'Automated customer payment reminders',
        'Dedicated account manager',
        'Early access to new blockchain chains',
      ],
      highlight: false,
    },
  ]

  return (
    <>
      <SEOMeta
        title="Pricing — Lenis"
        description="Transparent non-custodial crypto payment pricing. Starter, Growth Pro, and Scale Business plans."
        ogTitle="Pricing — Lenis"
        ogDescription="Transparent non-custodial crypto payment pricing. Starter, Growth Pro, and Scale Business plans."
      />

      {/* ── Hero ── */}
      <section className="bg-slate-50 px-4 py-16 text-center sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl">
          <div className="mb-4 inline-flex items-center rounded-full border border-slate-200 bg-white px-4 py-1.5 text-xs font-semibold text-slate-700 shadow-xs">
            💎 Simple, Transparent Plans
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-slate-900 sm:text-5xl">
            Predictable pricing for Web3 payments
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base text-slate-600">
            Start for free. Scale on crypto. No hidden processing percentages or lock-ins.
          </p>

          {/* Billing Switcher */}
          <div className="mt-8 flex items-center justify-center gap-3">
            <span className={`text-xs font-semibold ${billingPeriod === 'monthly' ? 'text-slate-900 font-bold' : 'text-slate-500'}`}>
              Monthly Billing
            </span>
            <button
              type="button"
              onClick={() => setBillingPeriod((p) => (p === 'monthly' ? 'yearly' : 'monthly'))}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                billingPeriod === 'yearly' ? 'bg-slate-900' : 'bg-slate-300'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  billingPeriod === 'yearly' ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
            <span className={`text-xs font-semibold flex items-center gap-1.5 ${billingPeriod === 'yearly' ? 'text-slate-900 font-bold' : 'text-slate-500'}`}>
              <span>Annual Billing</span>
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                Save ~17% (2 Months Free)
              </span>
            </span>
          </div>
        </div>
      </section>

      {/* ── Tier cards ── */}
      <section
        className="bg-white px-4 py-16 sm:px-6 lg:px-8"
        aria-labelledby="plans-heading"
      >
        <h2 id="plans-heading" className="sr-only">
          Pricing plans
        </h2>
        <div className="mx-auto grid max-w-6xl grid-cols-1 gap-8 sm:grid-cols-3 items-stretch">
          {TIERS.map((tier) => {
            const isCurrent = isAuthenticated && currentTier === tier.tier

            let ctaText = 'Get started free'
            let ctaLink = '/sign-up'

            if (isAuthenticated) {
              if (isCurrent) {
                ctaText = '✓ Current Active Plan'
                ctaLink = '/dashboard/settings?tab=billing'
              } else if (tier.tier === 'free') {
                ctaText = 'Manage in Billing'
                ctaLink = '/dashboard/settings?tab=billing'
              } else {
                ctaText = `Upgrade to ${tier.name}`
                ctaLink = `/dashboard/settings?tab=billing&upgrade=${tier.tier}`
              }
            } else {
              if (tier.tier === 'free') {
                ctaText = 'Get started free'
                ctaLink = '/sign-up'
              } else {
                ctaText = `Get started with ${tier.name}`
                ctaLink = `/sign-up?plan=${tier.tier}`
              }
            }

            return (
              <article
                key={tier.name}
                className={`flex flex-col justify-between rounded-2xl border p-8 shadow-sm transition-all ${
                  tier.highlight
                    ? 'border-slate-900 bg-slate-900 text-white shadow-xl ring-2 ring-slate-900'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3
                      className={`text-lg font-bold ${
                        tier.highlight ? 'text-white' : 'text-slate-900'
                      }`}
                    >
                      {tier.name}
                    </h3>
                    <span
                      className={`text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-md ${
                        tier.highlight
                          ? 'bg-slate-800 text-emerald-400 border border-slate-700'
                          : 'bg-slate-100 text-slate-700 border border-slate-200'
                      }`}
                    >
                      {tier.badge}
                    </span>
                  </div>

                  <div className="mb-4">
                    <span
                      className={`text-4xl font-extrabold tracking-tight ${
                        tier.highlight ? 'text-white' : 'text-slate-900'
                      }`}
                    >
                      {tier.price}
                    </span>
                    {tier.period && (
                      <span
                        className={`ml-1 text-xs font-medium ${
                          tier.highlight ? 'text-slate-400' : 'text-slate-500'
                        }`}
                      >
                        /{tier.period}
                      </span>
                    )}
                  </div>

                  <p
                    className={`mb-6 text-xs leading-relaxed min-h-[36px] ${
                      tier.highlight ? 'text-slate-300' : 'text-slate-600'
                    }`}
                  >
                    {tier.description}
                  </p>

                  <ul className="space-y-3 border-t border-slate-100/20 pt-4 text-xs">
                    {tier.features.map((feat, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className={tier.highlight ? 'text-emerald-400 font-bold' : 'text-emerald-600 font-bold'}>
                          ✓
                        </span>
                        <span className={tier.highlight ? 'text-slate-200' : 'text-slate-600'}>
                          {feat}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="mt-8 pt-4">
                  <Link
                    to={ctaLink}
                    className={`inline-flex w-full items-center justify-center rounded-lg px-6 py-3 text-xs font-bold transition-all focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                      tier.highlight
                        ? 'bg-white text-slate-900 hover:bg-slate-100 focus:ring-white focus:ring-offset-slate-900 shadow-sm'
                        : isCurrent
                        ? 'bg-slate-100 text-slate-700 border border-slate-200'
                        : 'bg-slate-900 text-white hover:bg-slate-800 focus:ring-slate-900'
                    }`}
                  >
                    {ctaText}
                  </Link>
                </div>
              </article>
            )
          })}
        </div>
      </section>

      {/* ── Feature matrix table ── */}
      <section
        className="bg-slate-50 px-4 py-16 sm:px-6 lg:px-8"
        aria-labelledby="features-table-heading"
      >
        <div className="mx-auto max-w-6xl">
          <div className="text-center mb-10">
            <h2
              id="features-table-heading"
              className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl"
            >
              Comprehensive Plan Feature Comparison
            </h2>
            <p className="mt-2 text-xs text-slate-500">
              Explore limits, EVM networks, and tools available across all tiers.
            </p>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-xs">
            <table className="w-full text-left text-xs" aria-label="Feature comparison by plan">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80">
                  <th
                    scope="col"
                    className="py-4 pl-6 pr-4 font-bold text-slate-900 uppercase tracking-wider text-[11px]"
                  >
                    Platform Capability
                  </th>
                  <th scope="col" className="px-4 py-4 text-center font-bold text-slate-900">
                    Starter
                  </th>
                  <th scope="col" className="px-4 py-4 text-center font-bold text-slate-900 bg-indigo-50/40">
                    Growth Pro
                  </th>
                  <th scope="col" className="px-4 py-4 text-center font-bold text-slate-900">
                    Scale Business
                  </th>
                  <th scope="col" className="px-4 py-4 text-center font-bold text-slate-900 pr-6">
                    Enterprise
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {FEATURE_ROWS.map((row, idx) => (
                  <tr
                    key={row.label}
                    className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/40'}
                  >
                    <td className="py-3.5 pl-6 pr-4 font-medium text-slate-900">{row.label}</td>
                    <td className="px-4 py-3.5 text-center">
                      <Cell value={row.free} />
                    </td>
                    <td className="px-4 py-3.5 text-center bg-indigo-50/20 font-semibold text-slate-900">
                      <Cell value={row.growth} />
                    </td>
                    <td className="px-4 py-3.5 text-center font-semibold text-slate-900">
                      <Cell value={row.scale} />
                    </td>
                    <td className="px-4 py-3.5 pr-6 text-center text-slate-700">
                      <Cell value={row.enterprise} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section
        className="bg-white px-4 py-16 sm:px-6 lg:px-8"
        aria-labelledby="faq-heading"
      >
        <div className="mx-auto max-w-3xl">
          <h2
            id="faq-heading"
            className="mb-8 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl text-center"
          >
            Frequently Asked Questions
          </h2>
          <dl className="space-y-6 text-xs">
            <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
              <dt className="font-bold text-slate-900 text-sm">
                How do crypto subscription payments work?
              </dt>
              <dd className="mt-1.5 leading-relaxed text-slate-600">
                You can upgrade using supported EVM tokens (USDC, USDT, ETH, POL, BNB) across Base, Polygon, Arbitrum, Ethereum, and BSC. The system assigns a secure load-balanced platform treasury wallet for instant on-chain verification.
              </dd>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
              <dt className="font-bold text-slate-900 text-sm">What happens when my plan expires?</dt>
              <dd className="mt-1.5 leading-relaxed text-slate-600">
                You receive automated email and in-app reminders 7 days and 2 days before expiry. When your period ends, you enter a <strong>4-day Grace Period</strong> with uninterrupted plan access. If not renewed after the grace window, your account gracefully transitions to the Starter Free plan without data loss.
              </dd>
            </div>
            <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
              <dt className="font-bold text-slate-900 text-sm">Are there per-transaction processing fees?</dt>
              <dd className="mt-1.5 leading-relaxed text-slate-600">
                No. Lenis uses a non-custodial flat SaaS subscription model. You receive 100% of your incoming customer crypto payments directly into your self-custodied payout wallets.
              </dd>
            </div>
          </dl>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="bg-slate-900 px-4 py-20 sm:px-6 lg:px-8 text-center text-white">
        <div className="mx-auto max-w-4xl">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Ready to scale non-custodial crypto payments?
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-xs text-slate-400">
            Start free on testnet or upgrade instantly to unlock production webhooks, branding, and multi-wallet indexing.
          </p>
          <div className="mt-8">
            <Link
              to={isAuthenticated ? '/dashboard/settings?tab=billing' : '/sign-up'}
              className="inline-flex items-center justify-center rounded-lg bg-white px-8 py-3.5 text-xs font-bold text-slate-900 transition-colors hover:bg-slate-100 shadow-sm"
            >
              {isAuthenticated ? 'Go to Billing & Plans →' : 'Create Free Account →'}
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}

