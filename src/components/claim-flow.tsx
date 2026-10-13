"use client";

import { useState } from "react";
import { ConsentScreen } from "./consent-screen";
import { ageTier, tierExplainer, type AgeTier } from "@/lib/child/age-tier";

export interface ClaimPreview {
  valid: boolean;
  reason?: string;
  crew_member_name?: string;
  steward_name?: string;
  birthdate?: string | null;
  expires_at?: string;
}

type Step = "consent" | "working" | "done" | "error";

const ERROR_COPY: Record<string, string> = {
  invalid: "That code doesn't look right. Check the 6 digits on your parent's screen and try again.",
  expired: "That code expired — codes only last 15 minutes. Ask your parent to make a fresh one.",
  unavailable: "We couldn't check that code right now. Check your connection and try again.",
};

/**
 * The signed-in half of the claim flow: preview → consent → done.
 * Rendered by /claim/[code] after the server has validated the code.
 */
export function ClaimFlow({ code, preview }: { code: string; preview: ClaimPreview }) {
  const [step, setStep] = useState<Step>("consent");
  const [error, setError] = useState("");
  const [attestedBirthdate, setAttestedBirthdate] = useState("");
  const [needsBirthdate, setNeedsBirthdate] = useState(!preview.birthdate);
  const [birthdateError, setBirthdateError] = useState("");

  const tier: AgeTier = ageTier(preview.birthdate ?? null);
  const childName = preview.crew_member_name ?? "there";
  const stewardName = preview.steward_name ?? "Your parent";

  async function accept() {
    setBirthdateError("");
    let birthdate: string | null = preview.birthdate ?? null;
    if (needsBirthdate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(attestedBirthdate)) {
        setBirthdateError("Add your birthdate so we set up the right sharing for your age.");
        return;
      }
      birthdate = attestedBirthdate;
    }
    setStep("working");
    setError("");
    try {
      const res = await fetch("/api/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, birthdate }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) {
        setError(data?.error ?? ERROR_COPY.invalid);
        setStep("error");
        return;
      }
      setStep("done");
    } catch {
      setError("Something hiccuped on our end. Try again in a moment.");
      setStep("error");
    }
  }

  function decline() {
    window.location.href = "/home";
  }

  if (step === "working") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-black px-4">
        <div className="w-full max-w-md rounded-3xl border border-line bg-panel/70 p-8 text-center backdrop-blur-xl">
          <p aria-hidden="true" className="text-4xl">🔗</p>
          <p className="mt-4 text-sm text-stardust">Linking your school…</p>
        </div>
      </div>
    );
  }

  if (step === "done") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-black px-4 py-10">
        <div className="w-full max-w-md rounded-3xl border border-line bg-panel/70 p-8 text-center shadow-[0_24px_80px_rgb(0_0_0/0.55)] backdrop-blur-xl">
          <p aria-hidden="true" className="text-5xl">🎉</p>
          <h1 className="mt-4 text-xl font-semibold text-star">You&apos;re in, {childName.split(" ")[0]}</h1>
          <p className="mt-2 text-sm leading-relaxed text-stardust">
            Your school is linked. {tierExplainer(tier, childName.split(" ")[0])}
          </p>
          <a
            href="/home"
            className="mt-6 inline-block rounded-xl border border-neon-green/40 bg-neon-green/10 px-6 py-3 text-sm font-semibold text-neon-green transition-colors hover:bg-neon-green/20"
          >
            Open my cockpit
          </a>
        </div>
      </div>
    );
  }

  if (step === "error") {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-black px-4">
        <div className="w-full max-w-md rounded-3xl border border-line bg-panel/70 p-8 text-center backdrop-blur-xl">
          <p aria-hidden="true" className="text-4xl">🔑</p>
          <h1 className="mt-4 text-xl font-semibold text-star">That didn&apos;t work</h1>
          <p className="mt-2 text-sm leading-relaxed text-stardust">{error}</p>
          <div className="mt-6 flex flex-col gap-3">
            <button
              type="button"
              onClick={() => setStep("consent")}
              className="rounded-xl border border-neon-cyan/40 bg-neon-cyan/10 px-6 py-2.5 text-sm font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/20"
            >
              Try again
            </button>
            <a href="/home" className="text-sm text-dim transition-colors hover:text-stardust">
              Back to Cockpit
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ConsentScreen
      childName={childName}
      stewardName={stewardName}
      tier={tier}
      onAccept={accept}
      onDecline={decline}
      accepting={false}
    >
      {needsBirthdate && (
        <div className="mt-5 rounded-2xl border border-line bg-panel-2/60 p-4">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-stardust">
              Your birthdate
            </span>
            <input
              type="date"
              value={attestedBirthdate}
              onChange={(e) => setAttestedBirthdate(e.target.value)}
              max={new Date().toISOString().slice(0, 10)}
              className="w-full rounded-xl border border-line bg-panel px-4 py-2.5 text-sm text-star focus:border-neon-cyan/60 focus:outline-none"
            />
          </label>
          <p className="mt-2 text-xs leading-relaxed text-dim">
            We use this once to set up the right sharing for your age — then it&apos;s yours to manage.
          </p>
          {birthdateError && (
            <p className="mt-2 text-xs text-neon-amber">{birthdateError}</p>
          )}
        </div>
      )}
    </ConsentScreen>
  );
}
