import { SEOMeta } from '../../components/seo/SEOMeta'

export function TermsPage() {
  return (
    <>
      <SEOMeta
        title="Terms & Conditions — Lenis"
        description="Terms and Conditions for using the Lenis crypto payment platform."
        ogTitle="Terms & Conditions — Lenis"
        ogDescription="Terms and Conditions for using the Lenis crypto payment platform."
      />

      {/* Hero */}
      <section className="bg-slate-50 py-16 text-center">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Terms &amp; Conditions
          </h1>
          <p className="mt-3 text-sm text-slate-500">Last updated: January 1, 2025</p>
        </div>
      </section>

      {/* Content */}
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
        <h2 className="mb-4 mt-0 text-xl font-semibold text-slate-900 first:mt-0">
          1. Acceptance of Terms
        </h2>
        <p className="mb-4 leading-relaxed text-slate-600">
          By accessing or using the Lenis platform, its APIs, SDKs, or any associated services
          (collectively, the "Service"), you agree to be bound by these Terms &amp; Conditions. If
          you do not agree to all of these terms, you must not access or use the Service. These
          terms apply to all visitors, merchants, developers, and others who access the Service.
        </p>
        <p className="mb-4 leading-relaxed text-slate-600">
          Lenis reserves the right to update or modify these Terms at any time without prior
          notice. Your continued use of the Service following any changes constitutes your
          acceptance of the revised Terms. We encourage you to review this page periodically.
        </p>

        <h2 className="mb-4 mt-10 text-xl font-semibold text-slate-900">
          2. Description of Service
        </h2>
        <p className="mb-4 leading-relaxed text-slate-600">
          Lenis provides non-custodial Web3 financial infrastructure that enables merchants to
          accept cryptocurrency payments. The platform offers hosted payment pages, a developer
          API, webhook notifications, real-time payment tracking, and settlement management tools.
        </p>
        <p className="mb-4 leading-relaxed text-slate-600">
          Lenis does not hold, custody, or control any cryptocurrency funds on behalf of merchants
          or their customers. All transactions are settled directly to wallet addresses designated
          by the merchant. Lenis is a technology provider and is not a money services business,
          bank, or financial institution.
        </p>

        <h2 className="mb-4 mt-10 text-xl font-semibold text-slate-900">
          3. User Accounts and API Keys
        </h2>
        <p className="mb-4 leading-relaxed text-slate-600">
          To access the Service, you must create an account and complete identity verification as
          required. You are responsible for maintaining the confidentiality of your account
          credentials and API keys. You agree to notify Lenis immediately of any unauthorised use
          of your account or API keys.
        </p>
        <p className="mb-4 leading-relaxed text-slate-600">
          API keys grant programmatic access to your account and carry the same privileges as your
          user credentials. You must not share API keys publicly, embed them in client-side code,
          or store them in version control. Lenis will not be liable for any loss or damage
          arising from your failure to protect your credentials.
        </p>

        <h2 className="mb-4 mt-10 text-xl font-semibold text-slate-900">
          4. Prohibited Uses
        </h2>
        <p className="mb-4 leading-relaxed text-slate-600">
          You may not use the Service for any unlawful purpose or in violation of any applicable
          regulations, including but not limited to anti-money laundering (AML) and know-your-
          customer (KYC) requirements. Specifically, you must not:
        </p>
        <ul className="mb-4 list-disc pl-6 leading-relaxed text-slate-600">
          <li className="mb-2">
            Use the Service to process payments for illegal goods or services
          </li>
          <li className="mb-2">
            Attempt to circumvent, disable, or interfere with security features of the platform
          </li>
          <li className="mb-2">
            Reverse-engineer, decompile, or disassemble any portion of the Service
          </li>
          <li className="mb-2">
            Use automated means to access the Service in a manner that exceeds reasonable usage
            or violates rate limits
          </li>
          <li className="mb-2">
            Misrepresent your identity or provide false information during registration or
            verification
          </li>
        </ul>

        <h2 className="mb-4 mt-10 text-xl font-semibold text-slate-900">
          5. Limitation of Liability
        </h2>
        <p className="mb-4 leading-relaxed text-slate-600">
          To the fullest extent permitted by applicable law, Lenis and its officers, directors,
          employees, and agents shall not be liable for any indirect, incidental, special,
          consequential, or punitive damages, including loss of profits, data, or goodwill,
          arising out of or in connection with your use of the Service.
        </p>
        <p className="mb-4 leading-relaxed text-slate-600">
          In no event shall Lenis's total liability to you for all claims arising out of or
          related to these Terms or the Service exceed the greater of (a) the fees you paid to
          Lenis in the twelve months preceding the claim, or (b) one hundred US dollars (USD 100).
          Some jurisdictions do not allow limitations on implied warranties or exclusion of certain
          damages, so some of these limitations may not apply to you.
        </p>

        <h2 className="mb-4 mt-10 text-xl font-semibold text-slate-900">
          6. Governing Law
        </h2>
        <p className="mb-4 leading-relaxed text-slate-600">
          These Terms and any dispute arising out of or related to them or the Service shall be
          governed by and construed in accordance with the laws of the jurisdiction in which Lenis
          is incorporated, without regard to its conflict-of-law provisions.
        </p>
        <p className="mb-4 leading-relaxed text-slate-600">
          Any legal action or proceeding arising under these Terms shall be brought exclusively in
          the courts located in that jurisdiction, and you hereby consent to personal jurisdiction
          and venue there. If any provision of these Terms is held to be invalid or unenforceable,
          the remaining provisions will continue in full force and effect.
        </p>
      </div>
    </>
  )
}
