import type { Metadata } from "next";
import { LegalPage, LegalSection } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Terms of Service — Crystal",
  description: "Crystal's terms of service, in plain language.",
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="October 14, 2026">
      <LegalSection heading="The short version">
        <p>
          Crystal is your personal co-pilot — a web app that helps you manage
          tasks, school, health, money, and communication in one calm place.
          By creating an account or using Crystal, you agree to these terms.
          If you don&apos;t agree, please don&apos;t use the service.
        </p>
      </LegalSection>

      <LegalSection heading="Your account">
        <ul>
          <li>
            You sign in with your email (a one-time code) or with Google. Keep
            access to that email account — it&apos;s your key.
          </li>
          <li>
            You must be at least 13 years old to use Crystal on your own. If
            you&apos;re under 13, a parent or guardian must create and manage
            your account.
          </li>
          <li>
            One person per account. Don&apos;t share your sign-in or pretend to
            be someone else.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="What you can and can't do">
        <ul>
          <li>Use Crystal for your own personal productivity — that&apos;s what it&apos;s for.</li>
          <li>
            Don&apos;t try to break in, scrape other users&apos; data, overload
            the service, or use Crystal for anything illegal.
          </li>
          <li>
            Don&apos;t upload content you don&apos;t have the right to share,
            or anything harmful, hateful, or exploitative.
          </li>
          <li>
            We may suspend or close accounts that abuse the service or put
            others at risk.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="Your data">
        <p>
          Everything you put into Crystal — tasks, notes, grades, health
          entries — belongs to you. You grant us the limited permission we
          need to store it, show it back to you, and run the features you ask
          for (like syncing school grades or generating reminders). We never
          sell your personal information, and we never use your content to
          train models for anyone else. See our Privacy Policy for the full
          picture.
        </p>
      </LegalSection>

      <LegalSection heading="Crystal is a tool, not a professional">
        <p>
          Crystal can organize your life, but it is <strong>not</strong> a
          doctor, therapist, lawyer, accountant, or financial advisor. Health
          summaries, money reminders, and school guidance are organizational
          help, not professional advice. For decisions that matter, talk to a
          qualified professional.
        </p>
      </LegalSection>

      <LegalSection heading="Availability and changes">
        <ul>
          <li>
            We work hard to keep Crystal running, but we can&apos;t promise
            100% uptime. Scheduled maintenance and occasional outages happen.
          </li>
          <li>
            We may update features, and occasionally retire ones that
            aren&apos;t working. We&apos;ll give reasonable notice when a
            change affects your data or core workflows.
          </li>
          <li>
            We may update these terms. If the change is significant,
            we&apos;ll tell you inside the app before it takes effect. Keeping
            your account after that point means you accept the new terms.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="Liability">
        <p>
          To the fullest extent the law allows, Crystal is provided
          &quot;as is&quot; without warranties. We&apos;re not liable for
          indirect or consequential damages — things like lost income from a
          missed reminder. Our total liability for any claim is limited to the
          amount you paid us in the 12 months before the claim (which is $0
          while Crystal is free).
        </p>
      </LegalSection>

      <LegalSection heading="Ending your account">
        <p>
          You can delete your account any time from Settings — that removes
          your data as described in our Privacy Policy. We can also close
          accounts for serious or repeated violations of these terms.
        </p>
      </LegalSection>

      <LegalSection heading="Questions">
        <p>
          Once signed in, reach us through the Support section in the app —
          Help Center, AI support chat, or a ticket with a real person. We read
          every message.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
