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

const CREATE_CURL = `curl -X POST https://api.lenis.io/merchant/api-keys \\
  -H "Authorization: Bearer sk_test_YOUR_EXISTING_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"name": "production-backend"}'`

const LIST_CURL = `curl "https://api.lenis.io/merchant/api-keys" \\
  -H "Authorization: Bearer sk_test_YOUR_KEY"`

const DELETE_CURL = `curl -X DELETE "https://api.lenis.io/merchant/api-keys/key_01HABC9999" \\
  -H "Authorization: Bearer sk_test_YOUR_KEY"`

const CREATE_PYTHON = `import requests

response = requests.post(
    "https://api.lenis.io/merchant/api-keys",
    headers={"Authorization": "Bearer sk_test_YOUR_EXISTING_KEY"},
    json={"name": "production-backend"}
)
new_key = response.json()
# Store new_key["key"] securely — it's only shown once!
print(new_key["key"])`

export function ApiKeysDocs() {
  return (
    <>
      <SEOMeta
        title="API Keys API Reference — Lenis Developer Docs"
        description="API reference for managing Lenis API keys: create, list, and delete keys programmatically."
        ogTitle="API Keys API Reference — Lenis Developer Docs"
        ogDescription="Reference for POST/GET/DELETE /merchant/api-keys"
      />

      <h1 className="mb-4 text-3xl font-bold tracking-tight text-slate-900">API Keys</h1>
      <p className="mb-8 text-lg text-slate-600 leading-relaxed">
        API keys authenticate your requests to the Lenis API. You can manage keys
        programmatically through this endpoint, or through the Dashboard under{' '}
        <strong>API Keys</strong>.
      </p>

      <div className="mb-8 rounded-lg border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm font-medium text-amber-800">⚠ Key security</p>
        <p className="mt-1 text-sm text-amber-700">
          An API key is shown only once at creation time. Store it immediately in a secrets
          manager or environment variable. If you lose a key, delete it and create a new one.
        </p>
      </div>

      {/* POST /merchant/api-keys */}
      <section className="mb-12">
        <div className="mb-3 flex items-center gap-3">
          {methodBadge('POST')}
          <code className="font-mono text-base font-medium text-slate-900">/merchant/api-keys</code>
        </div>
        <p className="mb-4 text-slate-600 leading-relaxed">
          Create a new API key. Requires an existing authenticated session or key. The
          returned <code className="bg-slate-100 px-1 rounded text-sm">key</code> value is only
          returned in this response — save it immediately.
        </p>

        <h3 className="mb-2 font-semibold text-slate-800">Request parameters</h3>
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
            <tbody>
              <tr>
                <td className="px-3 py-2 font-mono text-slate-900">name</td>
                <td className="px-3 py-2 text-slate-500">string</td>
                <td className="px-3 py-2 text-slate-500">Yes</td>
                <td className="px-3 py-2 text-slate-600">A descriptive label for the key (e.g. "production-backend")</td>
              </tr>
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
                { field: 'id', type: 'string', desc: 'Unique key identifier (used for deletion)' },
                { field: 'key', type: 'string', desc: 'The API key value — shown only at creation' },
                { field: 'name', type: 'string', desc: 'Your provided label' },
                { field: 'prefix', type: 'string', desc: 'Key prefix (e.g. "sk_test_51ab...") for identification' },
                { field: 'created_at', type: 'string', desc: 'ISO 8601 creation timestamp' },
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

        <CodeSample code={CREATE_CURL} language="bash" title="curl" />
        <CodeSample code={CREATE_PYTHON} language="python" title="Python" />
      </section>

      {/* GET /merchant/api-keys */}
      <section className="mb-12">
        <div className="mb-3 flex items-center gap-3">
          {methodBadge('GET')}
          <code className="font-mono text-base font-medium text-slate-900">/merchant/api-keys</code>
        </div>
        <p className="mb-4 text-slate-600 leading-relaxed">
          List all API keys for the authenticated merchant. Key values are not returned here —
          only identifiers and metadata.
        </p>
        <CodeSample code={LIST_CURL} language="bash" title="curl" />
      </section>

      {/* DELETE /merchant/api-keys/{key_id} */}
      <section className="mb-12">
        <div className="mb-3 flex items-center gap-3">
          {methodBadge('DELETE')}
          <code className="font-mono text-base font-medium text-slate-900">/merchant/api-keys/{'{key_id}'}</code>
        </div>
        <p className="mb-4 text-slate-600 leading-relaxed">
          Permanently revoke an API key. This action is irreversible. Any requests using
          the revoked key will immediately receive a 401 error.
        </p>
        <CodeSample code={DELETE_CURL} language="bash" title="curl" />
      </section>
    </>
  )
}
