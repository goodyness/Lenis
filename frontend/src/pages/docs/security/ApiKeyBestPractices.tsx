import { SEOMeta } from '../../../components/seo/SEOMeta'
import { CodeSample } from '../../../components/docs/CodeSample'

const ENV_EXAMPLE = `# .env (never commit this file!)
LENIS_API_KEY=sk_live_your_key_here

# In your Python code
import os
api_key = os.environ["LENIS_API_KEY"]

# In your Node.js code
const apiKey = process.env.LENIS_API_KEY;`

const GITIGNORE_EXAMPLE = `# .gitignore
.env
.env.local
.env.production
*.pem
secrets/`

export function ApiKeyBestPractices() {
  return (
    <>
      <SEOMeta
        title="API Key Best Practices — Lenis Developer Docs"
        description="Security best practices for managing Lenis API keys: environment variables, rotation, test vs live isolation, and immediate revocation."
        ogTitle="API Key Best Practices — Lenis Developer Docs"
        ogDescription="How to securely manage Lenis API keys: never commit them, use environment variables, rotate regularly, revoke immediately if compromised."
      />

      <h1 className="mb-4 text-3xl font-bold tracking-tight text-slate-900">
        API Key Best Practices
      </h1>
      <p className="mb-6 text-lg text-slate-600 leading-relaxed">
        Your Lenis API keys grant full access to your payment operations. Treat them like
        passwords: protect them carefully and rotate them regularly.
      </p>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">
        Never commit keys to version control
      </h2>
      <p className="mb-3 text-slate-600 leading-relaxed">
        The most common way keys get compromised is accidental commits to Git repositories.
        Add your environment files to <code className="bg-slate-100 px-1 rounded text-sm">.gitignore</code>:
      </p>
      <CodeSample code={GITIGNORE_EXAMPLE} language="bash" />
      <p className="mt-3 mb-4 text-slate-600 leading-relaxed">
        If you accidentally commit a key, <strong>revoke it immediately</strong> from the
        dashboard — even if you delete the commit, the key may already be in history and
        other clones.
      </p>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">
        Use environment variables
      </h2>
      <p className="mb-3 text-slate-600 leading-relaxed">
        Always load keys from environment variables, never hardcode them in source files:
      </p>
      <CodeSample code={ENV_EXAMPLE} language="bash" />
      <p className="mt-3 mb-4 text-slate-600 leading-relaxed">
        In production, use a secrets manager (AWS Secrets Manager, HashiCorp Vault, etc.)
        rather than flat <code className="bg-slate-100 px-1 rounded text-sm">.env</code> files on disk.
      </p>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">
        Use test keys in development
      </h2>
      <p className="mb-4 text-slate-600 leading-relaxed">
        Only use <code className="bg-slate-100 px-1 rounded text-sm">sk_live_*</code> keys in your
        production environment. In all other environments (local, staging, CI) use{' '}
        <code className="bg-slate-100 px-1 rounded text-sm">sk_test_*</code> keys. Test keys route to
        testnets — no real funds can be moved.
      </p>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">Rotate keys regularly</h2>
      <p className="mb-4 text-slate-600 leading-relaxed">
        Rotate your live API keys periodically — at minimum quarterly, and always after:
      </p>
      <ul className="mb-4 space-y-1 list-disc pl-6 text-slate-600">
        <li>A team member with access departs</li>
        <li>A key appears in a log file or monitoring output</li>
        <li>A deployment environment is decommissioned</li>
        <li>Suspicion of any compromise</li>
      </ul>
      <p className="mb-4 text-slate-600 leading-relaxed">
        To rotate: create a new key in the Dashboard, update your environment variables,
        deploy, then delete the old key. Do it in that order to avoid downtime.
      </p>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">
        Revoke immediately if compromised
      </h2>
      <p className="mb-4 text-slate-600 leading-relaxed">
        If you suspect a key has been exposed, delete it from the Dashboard immediately.
        Navigate to <strong>Dashboard → API Keys</strong> and click "Revoke". Revocation
        is instantaneous — any request using the old key will return a 401 within seconds.
      </p>

      <h2 className="mb-3 mt-8 text-xl font-semibold text-slate-900">Summary</h2>
      <div className="overflow-hidden rounded-lg border border-slate-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <th className="px-4 py-3 text-left font-semibold text-slate-700">Practice</th>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">Why</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {[
              { practice: 'Never commit to Git', why: 'Keys in history are permanently exposed even after deletion' },
              { practice: 'Use environment variables', why: 'Separates secrets from code; easier to rotate' },
              { practice: 'Test keys in dev/staging', why: 'Prevents accidental live payments in non-production' },
              { practice: 'Rotate quarterly', why: 'Limits the blast radius of an undetected compromise' },
              { practice: 'Revoke immediately if exposed', why: 'Stops unauthorized access within seconds' },
            ].map((row) => (
              <tr key={row.practice}>
                <td className="px-4 py-3 font-medium text-slate-900">{row.practice}</td>
                <td className="px-4 py-3 text-slate-600">{row.why}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
