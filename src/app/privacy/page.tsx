'use client';

import Navbar from '@/components/Navbar';

// ─── Brand Palette ──────────────────────────────────────────────
const GOLD = '#C8B89A';
const GOLD_BORDER = 'rgba(200,184,154,0.30)';
const BG_CARD = '#111111';
const BORDER_STRONG = 'rgba(200,184,154,0.18)';
const TEXT_PRIMARY = '#F5F5F8';
const TEXT_MUTED = '#AAA';

const LAST_UPDATED = 'April 8, 2026';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <h2
        className="text-xl font-bold mb-4"
        style={{ color: GOLD, letterSpacing: '-0.01em' }}
      >
        {title}
      </h2>
      <div className="space-y-3 text-[15px] leading-relaxed" style={{ color: TEXT_MUTED }}>
        {children}
      </div>
    </section>
  );
}

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen" style={{ backgroundColor: '#0A0A0A', color: TEXT_PRIMARY }}>
      <Navbar />
      <main className="max-w-3xl mx-auto px-6 py-16">
        <div
          className="rounded-2xl p-8 md:p-12"
          style={{
            backgroundColor: BG_CARD,
            border: `1px solid ${BORDER_STRONG}`,
            boxShadow: '0 4px 24px rgba(0,0,0,0.3)',
          }}
        >
          <div className="mb-10 pb-8" style={{ borderBottom: `1px solid ${GOLD_BORDER}` }}>
            <h1
              className="text-4xl font-bold mb-3"
              style={{ color: TEXT_PRIMARY, letterSpacing: '-0.02em' }}
            >
              Privacy Policy
            </h1>
            <p className="text-sm" style={{ color: TEXT_MUTED }}>
              Last updated: {LAST_UPDATED}
            </p>
          </div>

          <Section title="1. Introduction">
            <p>
              Melch.Cloud (&ldquo;Melch&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) operates a creative operations
              and analytics platform for direct-to-consumer brands and their agencies. This Privacy
              Policy explains what information we collect, how we use it, who we share it with, and
              the rights you have over your data.
            </p>
            <p>
              By using Melch.Cloud, installing the Melch.Cloud Shopify app, or submitting content
              through our platform, you agree to the practices described in this policy.
            </p>
          </Section>

          <Section title="2. Information We Collect">
            <p>
              <strong style={{ color: TEXT_PRIMARY }}>Account information.</strong> Name, email
              address, organization, and role when you or a teammate creates an account.
            </p>
            <p>
              <strong style={{ color: TEXT_PRIMARY }}>Brand and creative content.</strong> Files,
              images, videos, briefs, comments, and metadata you or your collaborators upload
              through the Melch.Cloud submission and creative queue workflows.
            </p>
            <p>
              <strong style={{ color: TEXT_PRIMARY }}>Shopify store data.</strong> When you install
              the Melch.Cloud Shopify app, we access data you authorize through OAuth, which may
              include store profile, products, orders, customers, fulfillments, discounts, price
              rules, inventory, locations, marketing events, and returns. We only access scopes you
              have explicitly granted during installation.
            </p>
            <p>
              <strong style={{ color: TEXT_PRIMARY }}>Usage and diagnostic data.</strong> IP
              address, browser and device information, pages visited, feature interactions, and
              error reports collected through our own logs and tools such as Sentry and PostHog.
            </p>
            <p>
              <strong style={{ color: TEXT_PRIMARY }}>Cookies and similar technologies.</strong>{' '}
              Session cookies used for authentication and preferences. We do not use advertising
              cookies.
            </p>
          </Section>

          <Section title="3. How We Use Your Information">
            <p>We use the information we collect to:</p>
            <ul className="list-disc pl-6 space-y-2">
              <li>Provide, operate, and maintain the Melch.Cloud platform and its features.</li>
              <li>
                Sync creative batches, orders, customers, and products between Shopify, Dropbox,
                and Melch.Cloud.
              </li>
              <li>
                Generate analytics, reporting, and dashboards for brands and agencies about their
                store performance and creative output.
              </li>
              <li>Authenticate users, enforce access controls, and protect against abuse.</li>
              <li>Respond to support requests and communicate service updates.</li>
              <li>Improve product quality, debug issues, and monitor performance.</li>
              <li>Comply with legal obligations.</li>
            </ul>
            <p>
              We do <strong style={{ color: TEXT_PRIMARY }}>not</strong> sell your personal
              information, and we do not use Shopify customer data to train machine learning
              models for other customers.
            </p>
          </Section>

          <Section title="4. Shopify Data and App Permissions">
            <p>
              The Melch.Cloud Shopify app is used solely to power analytics, creative operations,
              and reporting features on behalf of the merchant who installs it. We request only
              the scopes required to deliver those features.
            </p>
            <p>
              Shopify data is stored in our secure database (Supabase / PostgreSQL) hosted in the
              United States and is accessible only to authorized users within the merchant&rsquo;s
              organization and to a limited set of Melch employees for support and operations.
            </p>
            <p>
              When a merchant uninstalls the Melch.Cloud app, we stop collecting new data from
              that store and delete or anonymize previously collected Shopify data within 30 days,
              except where retention is required by law.
            </p>
          </Section>

          <Section title="5. Third-Party Service Providers">
            <p>
              We rely on a small number of trusted sub-processors to run Melch.Cloud. Each is
              bound by a data processing agreement and appropriate security commitments:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li>
                <strong style={{ color: TEXT_PRIMARY }}>Supabase</strong> &mdash; database,
                authentication, and file storage.
              </li>
              <li>
                <strong style={{ color: TEXT_PRIMARY }}>Vercel</strong> &mdash; application
                hosting and edge delivery.
              </li>
              <li>
                <strong style={{ color: TEXT_PRIMARY }}>Dropbox</strong> &mdash; creative asset
                handoff and storage, when connected by the user.
              </li>
              <li>
                <strong style={{ color: TEXT_PRIMARY }}>Shopify</strong> &mdash; source of store,
                order, and customer data when the Shopify app is installed.
              </li>
              <li>
                <strong style={{ color: TEXT_PRIMARY }}>Sentry</strong> &mdash; error monitoring
                and diagnostics.
              </li>
              <li>
                <strong style={{ color: TEXT_PRIMARY }}>PostHog</strong> &mdash; product analytics
                and feature telemetry.
              </li>
              <li>
                <strong style={{ color: TEXT_PRIMARY }}>Inngest</strong> &mdash; background job
                processing.
              </li>
            </ul>
          </Section>

          <Section title="6. Data Retention">
            <p>
              We retain account and platform data for as long as your account is active or as
              needed to provide the service. You may request deletion of your account and
              associated data at any time by contacting us at the address below. We may retain
              limited information where required for legal, tax, audit, or fraud-prevention
              purposes.
            </p>
          </Section>

          <Section title="7. Security">
            <p>
              We apply industry-standard technical and organizational measures to protect your
              data, including encryption in transit (TLS 1.2+), encryption at rest, least-privilege
              access controls, audit logging, and regular review of our infrastructure and
              dependencies. No system is perfectly secure, and we will notify affected users and
              regulators of any incident as required by applicable law.
            </p>
          </Section>

          <Section title="8. Your Rights">
            <p>
              Depending on your location, you may have the right to access, correct, export, or
              delete your personal information, to object to or restrict certain processing, and
              to withdraw consent where processing is based on consent. To exercise any of these
              rights, contact us at{' '}
              <a href="mailto:privacy@melch.cloud" style={{ color: GOLD }}>
                privacy@melch.cloud
              </a>
              .
            </p>
            <p>
              If you are a customer of a Shopify merchant using Melch.Cloud and wish to exercise
              rights over data about you that was collected through that merchant&rsquo;s store,
              please contact the merchant directly. We will assist the merchant in fulfilling any
              valid request.
            </p>
          </Section>

          <Section title="9. GDPR Data Requests">
            <p>
              Melch.Cloud honors Shopify&rsquo;s mandatory GDPR webhooks:{' '}
              <code style={{ color: GOLD }}>customers/data_request</code>,{' '}
              <code style={{ color: GOLD }}>customers/redact</code>, and{' '}
              <code style={{ color: GOLD }}>shop/redact</code>. When we receive these webhooks we
              respond within the timelines required by Shopify and applicable law.
            </p>
          </Section>

          <Section title="10. International Transfers">
            <p>
              Melch.Cloud is operated from the United States. If you access the service from
              outside the U.S., your information will be transferred to, stored, and processed in
              the U.S. and other jurisdictions where our service providers operate. We rely on
              appropriate safeguards, including Standard Contractual Clauses where required.
            </p>
          </Section>

          <Section title="11. Children's Privacy">
            <p>
              Melch.Cloud is a business tool and is not directed to children under 16. We do not
              knowingly collect personal information from children.
            </p>
          </Section>

          <Section title="12. Changes to This Policy">
            <p>
              We may update this Privacy Policy from time to time. When we do, we will update the
              &ldquo;Last updated&rdquo; date at the top of this page and, for material changes,
              notify you by email or in-app message.
            </p>
          </Section>

          <Section title="13. Contact Us">
            <p>
              Questions about this Privacy Policy or our data practices? Email us at{' '}
              <a href="mailto:privacy@melch.cloud" style={{ color: GOLD }}>
                privacy@melch.cloud
              </a>
              .
            </p>
            <p>
              Melch Media, LLC &middot; Melch.Cloud &middot; United States
            </p>
          </Section>
        </div>
      </main>
    </div>
  );
}
