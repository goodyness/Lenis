import { SEOMeta } from '../../components/seo/SEOMeta'

export function PrivacyPage() {
  return (
    <>
      <SEOMeta
        title="Privacy Policy — Lenis"
        description="Lenis Privacy Policy — how we collect, use, and protect your personal information."
        ogTitle="Privacy Policy — Lenis"
        ogDescription="Lenis Privacy Policy — how we collect, use, and protect your personal information."
      />

      {/* Hero */}
      <section className="bg-slate-50 py-16 text-center">
        <div className="mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
          <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Privacy Policy
          </h1>
          <p className="mt-3 text-sm text-slate-500">Last updated: January 1, 2025</p>
        </div>
      </section>

      {/* Content */}
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">

        <h2 className="mb-4 mt-0 text-xl font-semibold text-slate-900 first:mt-0">
          1. Introduction
        </h2>
        <p className="mb-4 leading-relaxed text-slate-600">
          Lenis ("we", "us", or "our") operates a non-custodial Web3 payment infrastructure
          platform. This Privacy Policy explains what personal data we collect when you use our
          website, platform, APIs, and associated services (collectively, the "Service"), how we
          use it, and the rights you have in relation to it.
        </p>
        <p className="mb-4 leading-relaxed text-slate-600">
          By accessing or using the Service, you acknowledge that you have read and understood
          this Privacy Policy. If you do not agree with our practices, you should not use the
          Service.
        </p>

        <h2 className="mb-4 mt-10 text-xl font-semibold text-slate-900">
          2. Information We Collect
        </h2>
        <p className="mb-4 leading-relaxed text-slate-600">
          We collect information in several ways:
        </p>
        <ul className="mb-4 list-disc pl-6 leading-relaxed text-slate-600">
          <li className="mb-2">
            <strong className="font-medium text-slate-800">Account information.</strong> When you
            register, we collect your name, email address, and the hashed credential you choose.
          </li>
          <li className="mb-2">
            <strong className="font-medium text-slate-800">Identity verification data.</strong>{' '}
            To comply with applicable regulations, we may request government-issued identity
            documents during KYC review. These documents are processed by our third-party
            verification provider and are not stored on Lenis servers after verification is
            complete.
          </li>
          <li className="mb-2">
            <strong className="font-medium text-slate-800">Payment and transaction data.</strong>{' '}
            We record transaction amounts, wallet addresses, network identifiers, timestamps, and
            status changes. This data is necessary to provide the Service and is retained for
            audit purposes.
          </li>
          <li className="mb-2">
            <strong className="font-medium text-slate-800">Usage and log data.</strong> We
            automatically collect IP addresses, browser type, operating system, referring URLs,
            and API request logs. These are used to operate, secure, and improve the Service.
          </li>
          <li className="mb-2">
            <strong className="font-medium text-slate-800">Communications.</strong> If you
            contact us via the contact form or email, we retain your message and contact details
            to respond to your inquiry.
          </li>
        </ul>

        <h2 className="mb-4 mt-10 text-xl font-semibold text-slate-900">
          3. How We Use Your Information
        </h2>
        <p className="mb-4 leading-relaxed text-slate-600">
          We use the information we collect to:
        </p>
        <ul className="mb-4 list-disc pl-6 leading-relaxed text-slate-600">
          <li className="mb-2">Provide, operate, and maintain the Service</li>
          <li className="mb-2">Verify your identity and comply with anti-money laundering (AML) and KYC requirements</li>
          <li className="mb-2">Process and settle payments as directed by you</li>
          <li className="mb-2">Send transactional emails (payment receipts, verification status, security alerts)</li>
          <li className="mb-2">Detect, investigate, and prevent fraud or abuse</li>
          <li className="mb-2">Respond to your support requests and inquiries</li>
          <li className="mb-2">Improve the Service through aggregated, anonymised analytics</li>
        </ul>
        <p className="mb-4 leading-relaxed text-slate-600">
          We do not sell, rent, or trade your personal data to third parties for their own
          marketing purposes.
        </p>

        <h2 className="mb-4 mt-10 text-xl font-semibold text-slate-900">
          4. Data Sharing and Disclosure
        </h2>
        <p className="mb-4 leading-relaxed text-slate-600">
          We may share your information with:
        </p>
        <ul className="mb-4 list-disc pl-6 leading-relaxed text-slate-600">
          <li className="mb-2">
            <strong className="font-medium text-slate-800">Service providers.</strong> Third
            parties that help us deliver the Service (email delivery, cloud hosting, identity
            verification). These providers are contractually bound to handle your data only as
            directed by us.
          </li>
          <li className="mb-2">
            <strong className="font-medium text-slate-800">Law enforcement and regulators.</strong>{' '}
            When required by applicable law, court order, or regulatory authority, we may
            disclose your information. We will notify you where legally permitted to do so.
          </li>
          <li className="mb-2">
            <strong className="font-medium text-slate-800">Business transfers.</strong> In the
            event of a merger, acquisition, or sale of all or a portion of our assets, your
            information may be transferred as part of that transaction.
          </li>
        </ul>

        <h2 className="mb-4 mt-10 text-xl font-semibold text-slate-900">
          5. Data Retention
        </h2>
        <p className="mb-4 leading-relaxed text-slate-600">
          We retain your personal data for as long as necessary to provide the Service and comply
          with our legal obligations. Transaction records are retained for a minimum of five years
          in accordance with applicable financial regulations. You may request deletion of your
          account data at any time (see Section 7), subject to our legal retention requirements.
        </p>

        <h2 className="mb-4 mt-10 text-xl font-semibold text-slate-900">
          6. Cookies and Tracking
        </h2>
        <p className="mb-4 leading-relaxed text-slate-600">
          We use only technically necessary session cookies to maintain your authenticated
          session. We do not use third-party advertising trackers, analytics cookies, or
          fingerprinting scripts on authenticated pages.
        </p>
        <p className="mb-4 leading-relaxed text-slate-600">
          Our public marketing pages may use privacy-respecting, cookieless analytics to
          understand aggregate traffic patterns. No personally identifiable information is
          collected through this mechanism.
        </p>

        <h2 className="mb-4 mt-10 text-xl font-semibold text-slate-900">
          7. Your Rights
        </h2>
        <p className="mb-4 leading-relaxed text-slate-600">
          Depending on your jurisdiction, you may have the following rights regarding your
          personal data:
        </p>
        <ul className="mb-4 list-disc pl-6 leading-relaxed text-slate-600">
          <li className="mb-2">
            <strong className="font-medium text-slate-800">Access.</strong> Request a copy of the
            personal data we hold about you.
          </li>
          <li className="mb-2">
            <strong className="font-medium text-slate-800">Rectification.</strong> Ask us to
            correct inaccurate or incomplete personal data.
          </li>
          <li className="mb-2">
            <strong className="font-medium text-slate-800">Erasure.</strong> Request deletion of
            your personal data, subject to legal retention requirements.
          </li>
          <li className="mb-2">
            <strong className="font-medium text-slate-800">Portability.</strong> Receive your
            data in a structured, machine-readable format.
          </li>
          <li className="mb-2">
            <strong className="font-medium text-slate-800">Objection.</strong> Object to
            processing of your data based on our legitimate interests.
          </li>
        </ul>
        <p className="mb-4 leading-relaxed text-slate-600">
          To exercise any of these rights, please contact us via the{' '}
          <a href="/contact" className="font-medium text-slate-900 underline underline-offset-4 hover:text-slate-700">
            contact form
          </a>
          . We will respond within 30 days.
        </p>

        <h2 className="mb-4 mt-10 text-xl font-semibold text-slate-900">
          8. Security
        </h2>
        <p className="mb-4 leading-relaxed text-slate-600">
          We implement industry-standard security controls including TLS encryption in transit,
          AES-256 encryption at rest, access controls, and regular security reviews. However, no
          system is completely secure. If you discover a potential security vulnerability, please
          contact us responsibly via the contact form.
        </p>

        <h2 className="mb-4 mt-10 text-xl font-semibold text-slate-900">
          9. Changes to This Policy
        </h2>
        <p className="mb-4 leading-relaxed text-slate-600">
          We may update this Privacy Policy from time to time. We will notify you of material
          changes by email or by posting a prominent notice in the platform. The "Last updated"
          date at the top of this page reflects the most recent revision.
        </p>

        <h2 className="mb-4 mt-10 text-xl font-semibold text-slate-900">
          10. Contact Us
        </h2>
        <p className="mb-4 leading-relaxed text-slate-600">
          If you have questions about this Privacy Policy or wish to exercise your data rights,
          please reach out via our{' '}
          <a href="/contact" className="font-medium text-slate-900 underline underline-offset-4 hover:text-slate-700">
            contact form
          </a>
          . We aim to respond to all privacy inquiries within 30 days.
        </p>

      </div>
    </>
  )
}
