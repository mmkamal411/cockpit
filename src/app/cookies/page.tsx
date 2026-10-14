import type { Metadata } from "next";
import { LegalPage, LegalSection } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Cookie Policy — Crystal",
  description: "What cookies Crystal uses and how to control them.",
};

export default function CookiesPage() {
  return (
    <LegalPage title="Cookie Policy" updated="October 14, 2026">
      <LegalSection heading="The short version">
        <p>
          Crystal uses a small number of cookies — mostly to keep you signed
          in and remember your preferences. There are no advertising cookies,
          no cross-site trackers, and nothing sold to data brokers.
        </p>
      </LegalSection>

      <LegalSection heading="Cookies we set">
        <ul>
          <li>
            <strong>Sign-in cookies (required):</strong> these keep your session
            alive after you sign in with a code or Google. Without them,
            you&apos;d be signed out on every page. They&apos;re set by our
            authentication provider and expire when you sign out or after a
            period of inactivity.
          </li>
          <li>
            <strong>Preference cookies (required):</strong> small settings like
            your chosen theme or whether you&apos;ve dismissed a notice, so
            the app looks the way you left it.
          </li>
          <li>
            <strong>Security cookies (required):</strong> tokens that protect
            forms against forgery and help us detect abuse.
          </li>
        </ul>
        <p>
          That&apos;s the whole list. We don&apos;t run third-party analytics
          beacons, social-media pixels, or ad-tech scripts on the landing
          pages or in the app.
        </p>
      </LegalSection>

      <LegalSection heading="Local storage">
        <p>
          Beyond cookies, your browser may hold small amounts of local storage
          for things like draft check-ins or cached layout choices. This data
          stays on your device and is cleared if you sign out or clear site
          data.
        </p>
      </LegalSection>

      <LegalSection heading="Your controls">
        <ul>
          <li>
            Your browser can block or delete cookies — but blocking the
            required sign-in cookies above will sign you out of Crystal.
          </li>
          <li>
            Because we don&apos;t set advertising or tracking cookies, there
            is no cookie-consent banner and nothing to opt out of.
          </li>
          <li>
            &quot;Do Not Track&quot; browser signals are respected as a matter
            of course: there&apos;s nothing to track you with.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="Questions">
        <p>
          Anything unclear? Once signed in, ask us through the Support section
          in the app — we answer plainly, and we&apos;ll update this page if
          our cookie practices ever change.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
