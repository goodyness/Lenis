import { SEOMeta } from '../../../components/seo/SEOMeta'
import { CodeSample } from '../../../components/docs/CodeSample'

const BEARER_EXAMPLE = `curl https://api.lenis.io/v1/payments \\
  -H "Authorization: Bearer sk_test_YOUR_API_KEY"`

const ERROR_401 = `{
  "error": {
    "code": "authentication_error",
    "message": "No valid API key provided.",
    "status": 401
  }
}`

const ERROR_403 = `{
  "error": {
    "code": "permission_denied",
    "message": "The API key does not have permission to perform this action.",
    "status": 403
  }
}`

export function Authentication() {
  return (
    <>
      <SEOMeta
        title="Authentication — Lenis Developer Docs"
        description="Learn how to authenticate with the Lenis API using Bearer tokens, manage test and live keys, and handle authentication errors."
        ogTitle="Authentication — Lenis Developer Docs"
        ogDescription="How API key authentication works in Lenis: Bearer token format, test vs live keys, error responses."
      />

      <h1 className="mb-4 text-3xl font-bold tracking-tight text-slate-900">Authentication</h1>
      <p className="mb-6 text-lg text-slate-600 leading-relaxed">
        The Lenis API uses API keys to authenticate requests. All requests must be made over
        HTTPS — plain HTTP requests will be rejected.
      </p>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">Bearer token format</h2>
      <p className="mb-3 text-slate-600 leading-relaxed">
        Pass your API key as a Bearer token in the{' '}
        <code className="bg-slate-100 px-1.5 py-0.5 rounded text-sm font-mono">Authorization</code>{' '}
        header of every request:
      </p>
      <CodeSample code={BEARER_EXAMPLE} language="bash" />

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">Test vs live keys</h2>
      <p className="mb-4 text-slate-600 leading-relaxed">
        Lenis provides two types of API keys that control which environment your requests hit:
      </p>
      <div className="mb-6 overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="px-4 py-3 text-left font-semibold text-slate-700">Key prefix</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">Environment</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">Networks</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-slate-100">
              <td className="px-4 py-3 font-mono text-slate-900">sk_test_*</td>
              <td className="px-4 py-3 text-slate-600">Test (sandbox)</td>
              <td className="px-4 py-3 text-slate-600">Testnets only (Sepolia, Mumbai, etc.)</td>
            </tr>
            <tr>
              <td className="px-4 py-3 font-mono text-slate-900">sk_live_*</td>
              <td className="px-4 py-3 text-slate-600">Live (production)</td>
              <td className="px-4 py-3 text-slate-600">Mainnets (Ethereum, Polygon, etc.)</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mb-4 text-slate-600 leading-relaxed">
        Test and live data are completely isolated. A payment created with a test key will
        never appear in your live transaction history, and vice versa. Switch environments
        by simply swapping the key you use — no code changes required.
      </p>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">Error responses</h2>
      <p className="mb-3 text-slate-600 leading-relaxed">
        When authentication fails, the API returns a structured error response:
      </p>

      <p className="mb-2 text-sm font-medium text-slate-700">
        <span className="mr-2 inline-flex items-center rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
          401
        </span>
        Missing or invalid API key
      </p>
      <CodeSample code={ERROR_401} language="json" />

      <p className="mb-2 mt-4 text-sm font-medium text-slate-700">
        <span className="mr-2 inline-flex items-center rounded bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
          403
        </span>
        Valid key but insufficient permissions
      </p>
      <CodeSample code={ERROR_403} language="json" />

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">Best practices</h2>
      <ul className="space-y-3 text-slate-600">
        <li className="flex gap-2">
          <span className="mt-0.5 text-slate-400">—</span>
          <span>
            <strong className="font-medium text-slate-900">Never hardcode keys.</strong> Use
            environment variables (<code className="bg-slate-100 px-1 rounded text-sm">LENIS_API_KEY</code>) and keep
            them out of version control.
          </span>
        </li>
        <li className="flex gap-2">
          <span className="mt-0.5 text-slate-400">—</span>
          <span>
            <strong className="font-medium text-slate-900">Use test keys in development.</strong>{' '}
            Only switch to live keys in your production environment.
          </span>
        </li>
        <li className="flex gap-2">
          <span className="mt-0.5 text-slate-400">—</span>
          <span>
            <strong className="font-medium text-slate-900">Rotate keys regularly.</strong>{' '}
            Generate a new key and delete the old one from the dashboard periodically.
          </span>
        </li>
        <li className="flex gap-2">
          <span className="mt-0.5 text-slate-400">—</span>
          <span>
            <strong className="font-medium text-slate-900">Revoke immediately if compromised.</strong>{' '}
            Delete the key from <strong>Dashboard → API Keys</strong> the moment you suspect
            exposure.
          </span>
        </li>
      </ul>
    </>
  )
}
