import { SEOMeta } from '../../../components/seo/SEOMeta'
import { CodeSample } from '../../../components/docs/CodeSample'

const TEST_KEY_EXAMPLE = `# Test mode — routes to testnet, no real funds
curl -X POST https://api.lenis.io/v1/payments \\
  -H "Authorization: Bearer sk_test_51abc..."

# Live mode — routes to mainnet, real funds
curl -X POST https://api.lenis.io/v1/payments \\
  -H "Authorization: Bearer sk_live_51abc..."`

export function TestVsLive() {
  return (
    <>
      <SEOMeta
        title="Test Mode vs Live Mode — Lenis Developer Docs"
        description="Understand the difference between test and live modes in Lenis. Test keys use testnets with no real funds; live keys use mainnets."
        ogTitle="Test Mode vs Live Mode — Lenis Developer Docs"
        ogDescription="Test keys route payments on testnets; live keys use mainnets. Data is fully isolated between modes."
      />

      <h1 className="mb-4 text-3xl font-bold tracking-tight text-slate-900">
        Test Mode vs Live Mode
      </h1>
      <p className="mb-6 text-lg text-slate-600 leading-relaxed">
        Lenis gives you two completely separate environments controlled by your API key prefix.
        Test mode lets you build and validate your integration with no risk of moving real funds.
      </p>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">How they differ</h2>
      <div className="mb-6 overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="px-4 py-3 text-left font-semibold text-slate-700">Feature</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">
                Test (<code className="font-mono text-xs">sk_test_*</code>)
              </th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">
                Live (<code className="font-mono text-xs">sk_live_*</code>)
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            <tr>
              <td className="px-4 py-3 font-medium text-slate-700">Networks</td>
              <td className="px-4 py-3 text-slate-600">Testnets (Sepolia, Mumbai, Base Sepolia)</td>
              <td className="px-4 py-3 text-slate-600">Mainnets (Ethereum, Polygon, Base, etc.)</td>
            </tr>
            <tr>
              <td className="px-4 py-3 font-medium text-slate-700">Real funds</td>
              <td className="px-4 py-3 text-slate-600">No — uses testnet tokens with no value</td>
              <td className="px-4 py-3 text-slate-600">Yes — real crypto is transferred</td>
            </tr>
            <tr>
              <td className="px-4 py-3 font-medium text-slate-700">Data isolation</td>
              <td className="px-4 py-3 text-slate-600">Fully isolated from live data</td>
              <td className="px-4 py-3 text-slate-600">Fully isolated from test data</td>
            </tr>
            <tr>
              <td className="px-4 py-3 font-medium text-slate-700">Webhooks</td>
              <td className="px-4 py-3 text-slate-600">Fired for all test events</td>
              <td className="px-4 py-3 text-slate-600">Fired for all live events</td>
            </tr>
            <tr>
              <td className="px-4 py-3 font-medium text-slate-700">Dashboard visibility</td>
              <td className="px-4 py-3 text-slate-600">Visible only in Test mode view</td>
              <td className="px-4 py-3 text-slate-600">Visible only in Live mode view</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">Testnet routing</h2>
      <p className="mb-4 text-slate-600 leading-relaxed">
        When you use a test API key, Lenis automatically maps mainnet network identifiers to
        their testnet equivalents:
      </p>
      <div className="mb-6 overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="px-4 py-3 text-left font-semibold text-slate-700">You specify</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">Test routes to</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            <tr>
              <td className="px-4 py-3 font-mono text-slate-900">ethereum</td>
              <td className="px-4 py-3 text-slate-600">Sepolia</td>
            </tr>
            <tr>
              <td className="px-4 py-3 font-mono text-slate-900">polygon</td>
              <td className="px-4 py-3 text-slate-600">Polygon Mumbai (Amoy)</td>
            </tr>
            <tr>
              <td className="px-4 py-3 font-mono text-slate-900">base</td>
              <td className="px-4 py-3 text-slate-600">Base Sepolia</td>
            </tr>
            <tr>
              <td className="px-4 py-3 font-mono text-slate-900">arbitrum</td>
              <td className="px-4 py-3 text-slate-600">Arbitrum Sepolia</td>
            </tr>
            <tr>
              <td className="px-4 py-3 font-mono text-slate-900">optimism</td>
              <td className="px-4 py-3 text-slate-600">Optimism Sepolia</td>
            </tr>
          </tbody>
        </table>
      </div>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">Switching between modes</h2>
      <p className="mb-3 text-slate-600 leading-relaxed">
        Switching environments requires only a key swap — no code changes needed. Store your
        key in an environment variable and change the variable value per deployment:
      </p>
      <CodeSample code={TEST_KEY_EXAMPLE} language="bash" />

      <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm font-medium text-amber-800">⚠ Before going live</p>
        <ul className="mt-2 space-y-1 text-sm text-amber-700">
          <li>— Complete KYC verification in your dashboard</li>
          <li>— Test your webhook signature verification with real test events</li>
          <li>— Confirm your payout wallet address is correct</li>
          <li>— Set your live webhook endpoint URL</li>
        </ul>
      </div>
    </>
  )
}
