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
      'Integrate blockchain payments into any application with our REST API. Generate test-mode keys instantly on sign-up, and go live once your account is verified.',
    icon: '{}',
  },
  {
    title: 'Escrow System',
    description:
      'Protect both parties in high-value transactions. Our programmable escrow holds funds on-chain under agreed conditions and releases them automatically when terms are met.',
    icon: '◈',
  },
]

export function FeatureGrid() {
  return (
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
  )
}
