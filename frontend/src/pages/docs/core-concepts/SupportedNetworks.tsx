import { SEOMeta } from '../../../components/seo/SEOMeta'

export function SupportedNetworks() {
  return (
    <>
      <SEOMeta
        title="Supported Networks — Lenis Developer Docs"
        description="View all blockchain networks supported by Lenis, including Ethereum, Polygon, Base, Arbitrum, and Optimism, along with their testnet equivalents."
        ogTitle="Supported Networks — Lenis Developer Docs"
        ogDescription="Lenis supports Ethereum, Polygon, Base, Arbitrum, and Optimism mainnets and their testnet equivalents."
      />

      <h1 className="mb-4 text-3xl font-bold tracking-tight text-slate-900">
        Supported Networks
      </h1>
      <p className="mb-6 text-lg text-slate-600 leading-relaxed">
        Lenis supports EVM-compatible networks across multiple chains. You specify the
        network when creating a payment intent; Lenis generates an appropriate receiving
        address and monitors the correct chain.
      </p>

      <h2 className="mb-4 mt-8 text-xl font-semibold text-slate-900">Networks</h2>
      <div className="mb-6 overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="px-4 py-3 text-left font-semibold text-slate-700">Network</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">
                API identifier
              </th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">Testnet</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">
                Native token
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {[
              { name: 'Ethereum', id: 'ethereum', testnet: 'Sepolia', token: 'ETH' },
              { name: 'Polygon', id: 'polygon', testnet: 'Amoy (Mumbai)', token: 'MATIC / POL' },
              { name: 'Base', id: 'base', testnet: 'Base Sepolia', token: 'ETH' },
              { name: 'Arbitrum', id: 'arbitrum', testnet: 'Arbitrum Sepolia', token: 'ETH' },
              { name: 'Optimism', id: 'optimism', testnet: 'Optimism Sepolia', token: 'ETH' },
            ].map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-3 font-medium text-slate-900">{row.name}</td>
                <td className="px-4 py-3 font-mono text-slate-600">{row.id}</td>
                <td className="px-4 py-3 text-slate-600">{row.testnet}</td>
                <td className="px-4 py-3 text-slate-600">{row.token}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mb-4 mt-8 text-xl font-semibold text-slate-900">Accepted tokens</h2>
      <p className="mb-4 text-slate-600 leading-relaxed">
        Each network supports a set of accepted tokens. When creating a payment intent you
        specify a <code className="bg-slate-100 px-1 rounded text-sm">currency</code> (e.g.{' '}
        <code className="bg-slate-100 px-1 rounded text-sm">USDC</code>) and Lenis resolves the
        correct contract address for the chosen network automatically.
      </p>
      <div className="mb-6 overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="px-4 py-3 text-left font-semibold text-slate-700">Token</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">
                <code className="font-mono text-xs">currency</code> value
              </th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">Available on</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {[
              { token: 'USD Coin', currency: 'USDC', networks: 'All networks' },
              { token: 'Tether', currency: 'USDT', networks: 'Ethereum, Polygon, Arbitrum' },
              { token: 'Dai', currency: 'DAI', networks: 'Ethereum, Polygon' },
              { token: 'Ether', currency: 'ETH', networks: 'Ethereum, Base, Arbitrum, Optimism' },
              { token: 'Wrapped Ether', currency: 'WETH', networks: 'Polygon, Base' },
            ].map((row) => (
              <tr key={row.currency}>
                <td className="px-4 py-3 font-medium text-slate-900">{row.token}</td>
                <td className="px-4 py-3 font-mono text-slate-600">{row.currency}</td>
                <td className="px-4 py-3 text-slate-600">{row.networks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mb-4 text-slate-600 leading-relaxed">
        The full list of accepted tokens per network is available via the{' '}
        <code className="bg-slate-100 px-1 rounded text-sm">accepted_tokens</code> field returned
        by the{' '}
        <code className="bg-slate-100 px-1 rounded text-sm">GET /v1/networks</code> endpoint.
        Use this to dynamically populate token selectors in your checkout UI.
      </p>

      <div className="mt-6 rounded-lg border border-blue-200 bg-blue-50 p-4">
        <p className="text-sm font-medium text-blue-800">Token contract addresses</p>
        <p className="mt-1 text-sm text-blue-700">
          Lenis uses the canonical, widely-adopted contract addresses for each token on each
          chain. You do not need to specify contract addresses yourself — Lenis resolves them
          based on the <code className="bg-blue-100 px-1 rounded">network</code> and{' '}
          <code className="bg-blue-100 px-1 rounded">currency</code> you provide.
        </p>
      </div>
    </>
  )
}
