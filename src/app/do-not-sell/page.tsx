import type { Metadata } from "next";
import { LegalPage, LegalSection } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Do Not Sell or Share My Personal Information — Crystal",
  description:
    "Crystal never sells personal information. Your privacy rights under California and other state laws.",
};

export default function DoNotSellPage() {
  return (
    <LegalPage title="Do Not Sell or Share My Personal Information" updated="October 14, 2026">
      <LegalSection heading="The short version">
        <p>
          Crystal <strong>does not sell your personal information</strong>,
          and we do not share it for cross-context behavioral advertising.
          There is nothing to opt out of — but this page explains your rights
          anyway, in plain language.
        </p>
      </LegalSection>

      <LegalSection heading="What the law means by “sell”">
        <p>
          Laws like California&apos;s CCPA/CPRA use &quot;sell&quot; broadly:
          it can include sharing personal information with a third party for
          money <em>or</em> for other valuable consideration — for example,
          handing your data to an ad network so it can target you. We do
          neither. Your tasks, grades, health entries, messages, and usage
          patterns are never handed to advertisers, data brokers, or any
          third party for their own marketing.
        </p>
      </LegalSection>

      <LegalSection heading="Who does see your data">
        <ul>
          <li>
            <strong>You</strong> — it&apos;s your cockpit.
          </li>
          <li>
            <strong>Our infrastructure providers</strong> (database, hosting,
            email delivery) — they process data only to run the service, under
            contract, and can&apos;t use it for anything else.
          </li>
          <li>
            <strong>Services you connect</strong> (school portals, calendars,
            email) — only what you authorize, only to make the integration
            work.
          </li>
        </ul>
        <p>
          None of these are sales or advertising sharing. See our Privacy
          Policy for the full list.
        </p>
      </LegalSection>

      <LegalSection heading="Your rights (California and beyond)">
        <ul>
          <li>
            <strong>Know:</strong> ask what personal information we have about
            you and how we use it.
          </li>
          <li>
            <strong>Delete:</strong> ask us to delete your personal
            information — you can also do this yourself in Settings.
          </li>
          <li>
            <strong>Correct:</strong> fix anything inaccurate.
          </li>
          <li>
            <strong>Limit sensitive use:</strong> we don&apos;t use sensitive
            personal information (like precise health details) for anything
            beyond running the features you asked for.
          </li>
          <li>
            <strong>No discrimination:</strong> exercising these rights will
            never change your price, your features, or how we treat you.
          </li>
        </ul>
        <p>
          Many other states (Colorado, Connecticut, Virginia, and others)
          grant similar rights. We honor them the same way regardless of
          where you live.
        </p>
      </LegalSection>

      <LegalSection heading="How to exercise your rights">
        <p>
          The fastest way: sign in, open Settings, and view, download, or
          delete your data directly. For anything else — or if you&apos;d
          rather have a person do it — reach us through the Support section
          in the app. We verify it&apos;s really you (a quick email
          confirmation), then respond within the timeframe your state&apos;s
          law requires — California gives us 45 days, and we usually move
          much faster.
        </p>
      </LegalSection>

      <LegalSection heading="Authorized agents">
        <p>
          Someone can make a request on your behalf with your written
          permission (California calls this an &quot;authorized agent&quot;).
          We&apos;ll need proof of the permission and to verify your identity
          before we act.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
