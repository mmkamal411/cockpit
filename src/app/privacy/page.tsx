import type { Metadata } from "next";
import { LegalPage, LegalSection } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Privacy Policy — Crystal",
  description: "How Crystal collects, uses, and protects your personal information.",
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="October 14, 2026">
      <LegalSection heading="The short version">
        <p>
          Your life goes into Crystal — tasks, grades, health, money — so
          privacy isn&apos;t a feature here, it&apos;s the foundation. We
          collect the minimum we need to run the service, we never sell your
          personal information, your behavioral data never leaves your
          account, and you can delete your data any time.
        </p>
      </LegalSection>

      <LegalSection heading="What we collect">
        <ul>
          <li>
            <strong>Account info:</strong> your email address (used for sign-in
            codes) and, if you sign in with Google, the basic profile Google
            shares (name, email, profile photo).
          </li>
          <li>
            <strong>Your content:</strong> tasks, lists, notes, school data you
            connect, health entries, bills, subscriptions, messages you sync,
            and anything you upload. This is yours — we store it so the app
            works.
          </li>
          <li>
            <strong>Connected services:</strong> if you link school portals,
            calendars, or email, we receive the data you authorize, scoped to
            what the integration needs. Credentials live in your device&apos;s
            secure storage, never in plain text on our servers.
          </li>
          <li>
            <strong>Usage signals:</strong> how you use the app (which modules
            you open, when you dismiss a nudge). Raw signals are kept for 14
            days, then aggregated or deleted. They&apos;re used only to arrange
            your cockpit and improve your nudges — never to profile you for
            anyone else.
          </li>
          <li>
            <strong>Technical basics:</strong> device type, browser, and
            approximate region, used for security and reliability. Never
            precise GPS.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="How we use it">
        <ul>
          <li>To run Crystal: sign you in, sync your data, render your cockpit.</li>
          <li>To personalize: arrange your modules and time your nudges around your rhythms.</li>
          <li>To protect the service: detect abuse, fraud, and security incidents.</li>
          <li>To communicate: sign-in codes, important service notices, and only the emails you ask for.</li>
        </ul>
        <p>
          We do <strong>not</strong> use your content to train AI models for
          anyone else, and no cross-user learning happens — your behavioral
          profile never leaves your account.
        </p>
      </LegalSection>

      <LegalSection heading="Who we share with">
        <ul>
          <li>
            <strong>Service providers:</strong> the companies that host our
            infrastructure (database, hosting, email delivery). They process
            data only to run the service and can&apos;t use it for their own
            purposes.
          </li>
          <li>
            <strong>Integrations you choose:</strong> school systems, calendar,
            and email providers you connect receive only what you authorize.
          </li>
          <li>
            <strong>Legal requirements:</strong> if the law requires it (a
            valid court order, for example), we&apos;ll disclose the minimum
            necessary — and tell you unless we&apos;re legally forbidden.
          </li>
          <li>
            <strong>Never:</strong> advertisers, data brokers, or anyone else
            buying access to you. We don&apos;t sell personal information, full
            stop.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="Your rights">
        <ul>
          <li>
            <strong>See and download</strong> your data from Settings any time.
          </li>
          <li>
            <strong>Correct</strong> anything that&apos;s wrong — most of it
            you can edit directly in the app.
          </li>
          <li>
            <strong>Delete</strong> your account and data from Settings. We
            remove it from active systems promptly; backups expire within 90
            days.
          </li>
          <li>
            <strong>Opt out of sales/sharing:</strong> there&apos;s nothing to
            opt out of — we don&apos;t sell or share personal information for
            advertising. See our Do Not Sell My Info page.
          </li>
        </ul>
        <p>
          If you&apos;re in California, the EU, the UK, or another region with
          privacy laws, you have additional rights (access, portability,
          restriction, objection). Exercise them from Settings or through
          in-app Support — we respond within the time the law requires.
        </p>
      </LegalSection>

      <LegalSection heading="Children">
        <p>
          Crystal doesn&apos;t ask about children at signup. If a parent adds a
          child under 13, that child&apos;s account is managed by the parent
          (no child login, limited data collection). Teens get age-appropriate
          controls over who sees what, including the right to take their
          account independent. We never knowingly collect data from a child
          under 13 without a parent managing the account — if you believe that
          happened, contact us through in-app Support and we&apos;ll fix it.
        </p>
      </LegalSection>

      <LegalSection heading="Security">
        <p>
          Data travels over encrypted connections (TLS) and is encrypted at
          rest. Access is role-based and audited; support staff can only see
          what they need to help you, and only with your consent where the
          data is sensitive. No system is perfect — if we ever have a breach
          that affects you, we&apos;ll tell you promptly and plainly.
        </p>
      </LegalSection>

      <LegalSection heading="Changes to this policy">
        <p>
          We&apos;ll update this page when our practices change, and
          we&apos;ll flag significant changes inside the app before they take
          effect. The date at the top tells you when it was last revised.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
