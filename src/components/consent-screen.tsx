"use client";

import {
  type AgeTier,
  consentWillSee,
  consentWillNotSee,
  tierLabel,
  CHILD_AUTHORITY_COPY,
} from "@/lib/child/age-tier";

interface ConsentScreenProps {
  childName: string;
  stewardName: string;
  tier: AgeTier;
  onAccept: () => void;
  onDecline: () => void;
  accepting?: boolean;
  /** Rendered above the decision buttons (e.g. a birthdate input). */
  children?: React.ReactNode;
}

/**
 * The explicit consent screen (13–15 / 16–17 / 18+ claim flow).
 *
 * Names exactly what the parent WILL see and will NOT see — ≤8th-grade
 * plain English, two clear columns, login-page glass aesthetics. There is
 * no "accept" buried in small print: the two lists ARE the decision.
 */
export function ConsentScreen({
  childName,
  stewardName,
  tier,
  onAccept,
  onDecline,
  accepting = false,
  children,
}: ConsentScreenProps) {
  const willSee = consentWillSee(tier);
  const willNotSee = consentWillNotSee();
  const firstName = childName.trim().split(" ")[0] || childName;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-black px-4 py-10">
      <div className="w-full max-w-2xl rounded-3xl border border-line bg-panel/70 p-6 shadow-[0_24px_80px_rgb(0_0_0/0.55)] backdrop-blur-xl sm:p-10">
        <p aria-hidden="true" className="text-4xl">
          🎒
        </p>
        <p className="mt-4 text-[11px] font-medium uppercase tracking-[0.25em] text-neon-cyan">
          Link your school · {tierLabel(tier)}
        </p>
        <h1 className="mt-2 text-2xl font-semibold text-star">
          {stewardName} invited you to Cockpit, {firstName}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-stardust">
          Linking your school means {stewardName} can follow along with your
          classes. Here&apos;s exactly what that means — no fine print:
        </p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-neon-green/30 bg-neon-green/5 p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-neon-green">
              They WILL see
            </h2>
            <ul className="mt-3 space-y-2.5">
              {willSee.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-star">
                  <span aria-hidden="true" className="mt-0.5 shrink-0 text-neon-green">
                    ✓
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-line bg-panel-2/60 p-5">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-stardust">
              They will NOT see
            </h2>
            <ul className="mt-3 space-y-2.5">
              {willNotSee.map((item) => (
                <li key={item} className="flex items-start gap-2 text-sm text-stardust">
                  <span aria-hidden="true" className="mt-0.5 shrink-0 text-dim">
                    ✕
                  </span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>

        {tier === "teen-13-15" && (
          <p className="mt-4 rounded-xl border border-neon-amber/30 bg-neon-amber/5 px-4 py-3 text-xs leading-relaxed text-stardust">
            <span className="font-medium text-neon-amber">Good to know:</span> you
            can pause sharing anytime and it stops right away. If {stewardName}{" "}
            ever turns sharing off, it waits 7 days first — and you&apos;ll be
            told — so nobody makes that call in the heat of the moment.
          </p>
        )}
        {tier === "teen-16-17" && (
          <p className="mt-4 rounded-xl border border-neon-cyan/30 bg-neon-cyan/5 px-4 py-3 text-xs leading-relaxed text-stardust">
            <span className="font-medium text-neon-cyan">You&apos;re in charge:</span>{" "}
            {CHILD_AUTHORITY_COPY}
          </p>
        )}
        {tier === "adult-18+" && (
          <p className="mt-4 rounded-xl border border-neon-cyan/30 bg-neon-cyan/5 px-4 py-3 text-xs leading-relaxed text-stardust">
            <span className="font-medium text-neon-cyan">You&apos;re an adult:</span>{" "}
            you&apos;re in control. What {stewardName} could see before stays
            visible — change it anytime in <span className="text-star">Family & School → My sharing</span>.
          </p>
        )}

        {children}

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={onAccept}
            disabled={accepting}
            className="flex-1 rounded-xl border border-neon-green/40 bg-neon-green/10 px-6 py-3 text-sm font-semibold text-neon-green transition-colors hover:bg-neon-green/20 disabled:cursor-wait disabled:opacity-60"
          >
            {accepting ? "Linking your school…" : "Yes, link my school"}
          </button>
          <button
            type="button"
            onClick={onDecline}
            disabled={accepting}
            className="rounded-xl border border-line bg-panel-2/60 px-6 py-3 text-sm font-medium text-stardust transition-colors hover:text-star disabled:opacity-60"
          >
            Not now
          </button>
        </div>
        <p className="mt-4 text-center text-xs leading-relaxed text-dim">
          You can change any of this later in{" "}
          <span className="text-stardust">Family & School → My sharing</span>. Nothing is
          permanent.
        </p>
      </div>
    </div>
  );
}
