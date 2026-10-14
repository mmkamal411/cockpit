import type { Metadata } from "next";
import { LegalPage, LegalSection } from "@/components/legal-page";

export const metadata: Metadata = {
  title: "Accessibility — Crystal",
  description: "Crystal's accessibility commitment and features.",
};

export default function AccessibilityPage() {
  return (
    <LegalPage title="Accessibility" updated="October 14, 2026">
      <LegalSection heading="Our commitment">
        <p>
          Crystal is meant for everyone&apos;s day — which means everyone
          needs to be able to use it. Our goal is to meet the Web Content
          Accessibility Guidelines (WCAG) 2.2 at level AA across the app, and
          we treat accessibility bugs like any other bug: reported, tracked,
          and fixed.
        </p>
      </LegalSection>

      <LegalSection heading="What's in place today">
        <ul>
          <li>
            <strong>Keyboard navigation:</strong> every interactive element —
            buttons, forms, the chat widget, the landing-page guide — is
            reachable and usable by keyboard alone, with a visible focus
            indicator.
          </li>
          <li>
            <strong>Reduced motion:</strong> if your system asks for reduced
            motion, the landing hero shows a still image instead of the
            looping video, and ambient animations (like the Crystal orb&apos;s
            breathing glow) are disabled.
          </li>
          <li>
            <strong>Readable by default:</strong> the dark cockpit theme is
            built for contrast — bright text on deep panels, and error
            messages are written in plain language, not codes.
          </li>
          <li>
            <strong>Screen readers:</strong> decorative visuals are hidden
            from assistive tech, dialogs are labeled, and form fields carry
            real labels (not placeholder-only text).
          </li>
          <li>
            <strong>No dead ends:</strong> every error state offers a recovery
            path — retry, go back, or start over — never a blank page.
          </li>
        </ul>
      </LegalSection>

      <LegalSection heading="Known gaps">
        <p>
          We&apos;re still rebuilding, so some areas are a work in progress:
          complex data visualizations (like grade charts) don&apos;t yet have
          full text equivalents, and older video content lacks captions. If a
          gap blocks you, tell us — it jumps the queue.
        </p>
      </LegalSection>

      <LegalSection heading="Tell us about a barrier">
        <p>
          Hit something you can&apos;t use? Once signed in, report it through
          the Support section in the app and mention &quot;accessibility&quot;
          — those tickets go straight to the team that owns the fix. Include
          what you were trying to do, the device and browser you used, and
          any assistive technology involved. We aim to acknowledge every
          report within two business days.
        </p>
      </LegalSection>
    </LegalPage>
  );
}
