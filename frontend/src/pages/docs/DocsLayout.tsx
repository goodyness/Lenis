import { Link, NavLink, Outlet } from 'react-router-dom'

interface SidebarSection {
  title: string
  links: { label: string; to: string }[]
}

const SIDEBAR_SECTIONS: SidebarSection[] = [
  {
    title: 'Getting Started',
    links: [
      { label: 'Introduction', to: '/docs/getting-started' },
      { label: 'Quickstart', to: '/docs/getting-started/quickstart' },
      { label: 'Authentication', to: '/docs/getting-started/authentication' },
      { label: 'Test Mode vs Live Mode', to: '/docs/getting-started/test-vs-live' },
    ],
  },
  {
    title: 'Core Concepts',
    links: [
      { label: 'Non-Custodial Model', to: '/docs/core-concepts/non-custodial' },
      { label: 'Payment Lifecycle', to: '/docs/core-concepts/payment-lifecycle' },
      { label: 'Supported Networks', to: '/docs/core-concepts/supported-networks' },
      { label: 'Idempotency Keys', to: '/docs/core-concepts/idempotency-keys' },
    ],
  },
  {
    title: 'API Reference',
    links: [
      { label: 'Payments', to: '/docs/api-reference/payments' },
      { label: 'Payment Links', to: '/docs/api-reference/payment-links' },
      { label: 'Transactions', to: '/docs/api-reference/transactions' },
      { label: 'Webhooks', to: '/docs/api-reference/webhooks' },
      { label: 'API Keys', to: '/docs/api-reference/api-keys' },
    ],
  },
  {
    title: 'Webhooks',
    links: [
      { label: 'Setup Guide', to: '/docs/webhooks/setup-guide' },
      { label: 'Event Types', to: '/docs/webhooks/event-types' },
      { label: 'Signature Verification', to: '/docs/webhooks/signature-verification' },
      { label: 'Retry Logic', to: '/docs/webhooks/retry-logic' },
    ],
  },
  {
    title: 'SDKs',
    links: [
      { label: 'Python SDK', to: '/docs/sdks/python' },
      { label: 'TypeScript SDK', to: '/docs/sdks/typescript' },
    ],
  },
  {
    title: 'Integration Guides',
    links: [
      { label: 'E-Commerce Integration', to: '/docs/integration-guides/e-commerce' },
      { label: 'Custom Checkout Flow', to: '/docs/integration-guides/custom-checkout' },
      { label: 'Webhook Handler Setup', to: '/docs/integration-guides/webhook-handler' },
    ],
  },
  {
    title: 'Security',
    links: [
      { label: 'API Key Best Practices', to: '/docs/security/api-key-best-practices' },
      { label: 'Webhook Signature Verification', to: '/docs/security/webhook-signature' },
      { label: 'Idempotency Key Usage', to: '/docs/security/idempotency-key-usage' },
    ],
  },
]

export function DocsLayout() {
  return (
    <div className="flex min-h-screen flex-col bg-white">
      {/* Top bar */}
      <header className="fixed top-0 z-50 h-14 w-full border-b border-slate-200 bg-white">
        <div className="flex h-full items-center justify-between px-6">
          <Link
            to="/"
            className="text-lg font-semibold tracking-tight text-slate-900 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-400"
            aria-label="Lenis home"
          >
            Lenis
          </Link>
          <Link
            to="/"
            className="text-sm text-slate-600 transition-colors hover:text-slate-900"
          >
            ← Back to home
          </Link>
        </div>
      </header>

      {/* Body: sidebar + content */}
      <div className="flex flex-1 pt-14">
        {/* Sidebar */}
        <aside
          className="fixed left-0 top-14 bottom-0 w-60 overflow-y-auto border-r border-slate-200 bg-white px-4 py-6"
          aria-label="Documentation navigation"
        >
          {SIDEBAR_SECTIONS.map((section) => (
            <div key={section.title} className="mb-6">
              <h2 className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                {section.title}
              </h2>
              <ul className="flex flex-col gap-0.5" role="list">
                {section.links.map((link) => (
                  <li key={link.to}>
                    <NavLink
                      to={link.to}
                      end
                      className={({ isActive }) =>
                        [
                          'block rounded-md px-2 py-1.5 text-sm transition-colors',
                          'focus:outline-none focus:ring-2 focus:ring-slate-400',
                          isActive
                            ? 'bg-slate-100 font-medium text-slate-900'
                            : 'text-slate-600 hover:text-slate-900',
                        ].join(' ')
                      }
                    >
                      {link.label}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </aside>

        {/* Main content */}
        <main className="ml-60 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-4xl px-8 py-10">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}
