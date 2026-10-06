import { SEOMeta } from '../../../components/seo/SEOMeta'
import { CodeSample } from '../../../components/docs/CodeSample'

const methodBadge = (method: 'GET' | 'POST' | 'DELETE') => {
  const styles = {
    GET: 'bg-emerald-100 text-emerald-700',
    POST: 'bg-blue-100 text-blue-700',
    DELETE: 'bg-red-100 text-red-700',
  }
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-bold uppercase ${styles[method]}`}>
      {method}
    </span>
  )
}

const LIST_CURL = `curl "https://api.lenis.io/v1/transactions?network=polygon&limit=50" \\
  -H "Authorization: Bearer sk_test_YOUR_KEY"`

const GET_ONE_CURL = `curl "https://api.lenis.io/v1/transactions/txn_01HXYZ9999" \\
  -H "Authorization: Bearer sk_test_YOUR_KEY"`

const LIST_TS = `const params = new URLSearchParams({
  network: "polygon",
  limit: "50",
  offset: "0",
});

const response = await fetch(
  \`https://api.lenis.io/v1/transactions?\${params}\`,
  { headers: { "Authorization": "Bearer sk_test_YOUR_KEY" } }
);
const { items, total } = await response.json();`

export function TransactionsDocs() {
  return (
    <>
      <SEOMeta
        title="Transactions API Reference — Lenis Developer Docs"
        description="API reference for the Lenis Transactions endpoints: list on-chain transactions and retrieve individual transaction details."
        ogTitle="Transactions API Reference — Lenis Developer Docs"
        ogDescription="Reference for GET /v1/transactions and GET /v1/transactions/{id}"
      />

      <h1 className="mb-4 text-3xl font-bold tracking-tight text-slate-900">Transactions</h1>
      <p className="mb-8 text-lg text-slate-600 leading-relaxed">
        Transactions represent the on-chain settlement records linked to confirmed payments.
        Each transaction includes the block hash, confirmation depth, and the exact amount
        received on-chain.
      </p>

      {/* GET /v1/transactions */}
      <section className="mb-12">
        <div className="mb-3 flex items-center gap-3">
          {methodBadge('GET')}
          <code className="font-mono text-base font-medium text-slate-900">/v1/transactions</code>
        </div>
        <p className="mb-4 text-slate-600 leading-relaxed">
          List all on-chain transactions for the authenticated merchant. Supports filtering
          by network, currency, and date range.
        </p>

        <h3 className="mb-2 font-semibold text-slate-800">Query parameters</h3>
        <div className="mb-4 overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Name</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Type</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Required</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[
                { name: 'network', type: 'string', req: 'No', desc: 'Filter by network (e.g. "polygon")' },
                { name: 'currency', type: 'string', req: 'No', desc: 'Filter by token symbol' },
                { name: 'payment_id', type: 'string', req: 'No', desc: 'Filter by associated payment ID' },
                { name: 'from_date', type: 'string', req: 'No', desc: 'ISO 8601 start date filter' },
                { name: 'to_date', type: 'string', req: 'No', desc: 'ISO 8601 end date filter' },
                { name: 'limit', type: 'integer', req: 'No', desc: 'Results per page (default: 20, max: 100)' },
                { name: 'offset', type: 'integer', req: 'No', desc: 'Pagination offset' },
              ].map((row) => (
                <tr key={row.name}>
                  <td className="px-3 py-2 font-mono text-slate-900">{row.name}</td>
                  <td className="px-3 py-2 text-slate-500">{row.type}</td>
                  <td className="px-3 py-2 text-slate-500">{row.req}</td>
                  <td className="px-3 py-2 text-slate-600">{row.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <h3 className="mb-2 font-semibold text-slate-800">Response fields</h3>
        <div className="mb-4 overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50">
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Field</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Type</th>
                <th className="px-3 py-2 text-left font-semibold text-slate-700">Description</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {[
                { field: 'id', type: 'string', desc: 'Unique transaction identifier' },
                { field: 'payment_id', type: 'string', desc: 'Associated payment ID' },
                { field: 'tx_hash', type: 'string', desc: 'On-chain transaction hash' },
                { field: 'block_number', type: 'integer', desc: 'Block number of inclusion' },
                { field: 'confirmations', type: 'integer', desc: 'Confirmation depth at time of recording' },
                { field: 'amount_received', type: 'string', desc: 'Actual on-chain amount received' },
                { field: 'currency', type: 'string', desc: 'Token symbol' },
                { field: 'network', type: 'string', desc: 'Chain the transaction occurred on' },
                { field: 'from_address', type: 'string', desc: "Sender's wallet address" },
                { field: 'to_address', type: 'string', desc: "Receiver's wallet address" },
                { field: 'confirmed_at', type: 'string', desc: 'ISO 8601 confirmation timestamp' },
              ].map((row) => (
                <tr key={row.field}>
                  <td className="px-3 py-2 font-mono text-slate-900">{row.field}</td>
                  <td className="px-3 py-2 text-slate-500">{row.type}</td>
                  <td className="px-3 py-2 text-slate-600">{row.desc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <CodeSample code={LIST_CURL} language="bash" title="curl" />
        <CodeSample code={LIST_TS} language="typescript" title="TypeScript" />
      </section>

      {/* GET /v1/transactions/{id} */}
      <section className="mb-12">
        <div className="mb-3 flex items-center gap-3">
          {methodBadge('GET')}
          <code className="font-mono text-base font-medium text-slate-900">/v1/transactions/{'{id}'}</code>
        </div>
        <p className="mb-4 text-slate-600 leading-relaxed">
          Retrieve a single transaction record including full on-chain metadata.
        </p>
        <CodeSample code={GET_ONE_CURL} language="bash" title="curl" />
      </section>
    </>
  )
}
