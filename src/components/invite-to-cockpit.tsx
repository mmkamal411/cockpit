"use client";

import { useEffect, useState } from "react";
import { ageTier, tierExplainer } from "@/lib/child/age-tier";

/**
 * "Invite [name] to Cockpit" — the parent-side entry to the child claim flow.
 *
 * Under 13 (COPPA): no invite button — plain-English stewardship copy.
 * 13+: generates the 6-digit link code (15-min, single-use) and shows it BIG
 * with a live countdown, so the parent can read it to the child in the room.
 */
export function InviteToCockpit({
  memberId,
  memberName,
  birthdate,
}: {
  memberId: string;
  memberName: string;
  birthdate: string | null;
}) {
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const tier = ageTier(birthdate);
  const firstName = memberName.trim().split(" ")[0] || memberName;

  useEffect(() => {
    if (!expiresAt) return;
    const tick = () => {
      const left = Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000));
      setSecondsLeft(left);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [expiresAt]);

  async function mint() {
    setBusy(true);
    setError("");
    setCopied(false);
    try {
      const res = await fetch(`/api/crew/members/${memberId}/link-code`, { method: "POST" });
      const data = (await res.json().catch(() => null)) as {
        code?: string;
        expires_at?: string;
        error?: string;
      } | null;
      if (!res.ok || !data?.code) {
        setError(data?.error ?? "Couldn't make a code right now. Try again.");
        return;
      }
      setCode(data.code);
      setExpiresAt(data.expires_at ?? null);
    } catch {
      setError("Couldn't make a code right now. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function copyCode() {
    if (!code) return;
    navigator.clipboard?.writeText(code).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  // Under 13: stewardship only — no accounts, no code.
  if (tier === "under13") {
    return (
      <div className="rounded-2xl border border-line bg-panel-2/60 px-4 py-4">
        <p className="text-sm font-medium text-star">Invite {firstName} to Cockpit</p>
        <p className="mt-1.5 text-sm leading-relaxed text-stardust">
          Cockpit accounts start at 13 — for now, you manage everything about{" "}
          {firstName}&apos;s school right here. You&apos;re their steward, and
          that&apos;s exactly how it should be at this age.
        </p>
      </div>
    );
  }

  const mm = Math.floor(secondsLeft / 60);
  const ss = String(secondsLeft % 60).padStart(2, "0");
  const expired = code !== null && secondsLeft <= 0;

  return (
    <div className="rounded-2xl border border-neon-cyan/30 bg-neon-cyan/5 px-4 py-4">
      <p className="text-sm font-medium text-star">Invite {firstName} to Cockpit</p>
      <p className="mt-1 text-xs leading-relaxed text-dim">
        {tierExplainer(tier, firstName)}
      </p>

      {!code && (
        <button
          type="button"
          onClick={mint}
          disabled={busy}
          className="mt-3 rounded-xl border border-neon-cyan/40 bg-neon-cyan/10 px-4 py-2 text-sm font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/20 disabled:opacity-50"
        >
          {busy ? "Making a code…" : `Make a link code for ${firstName}`}
        </button>
      )}

      {code && !expired && (
        <div className="mt-3">
          <div className="flex items-center justify-between gap-3">
            <p
              className="font-mono text-4xl font-bold tracking-[0.3em] text-neon-cyan"
              aria-label={`Link code ${code.split("").join(" ")}`}
            >
              {code}
            </p>
            <button
              type="button"
              onClick={copyCode}
              className="rounded-lg border border-line bg-panel-2/60 px-3 py-1.5 text-xs font-medium text-stardust transition-colors hover:text-star"
            >
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
          <div className="mt-2 flex items-center justify-between">
            <p className="text-xs text-dim">
              {firstName} types this at <span className="text-stardust">cockpit → Sign in → claim</span> on their device.
            </p>
            <p className={`font-mono text-xs ${secondsLeft < 120 ? "text-neon-amber" : "text-dim"}`} aria-live="polite">
              {mm}:{ss} left
            </p>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/[0.06]">
            <div
              className="h-full rounded-full bg-neon-cyan/70 transition-[width] duration-1000"
              style={{ width: `${Math.min(100, (secondsLeft / 900) * 100)}%` }}
            />
          </div>
          <button
            type="button"
            onClick={mint}
            disabled={busy}
            className="mt-2 text-xs text-dim underline decoration-dotted underline-offset-2 transition-colors hover:text-stardust disabled:opacity-50"
          >
            Make a fresh code
          </button>
        </div>
      )}

      {expired && (
        <div className="mt-3">
          <p className="text-sm text-neon-amber">That code expired — codes last 15 minutes.</p>
          <button
            type="button"
            onClick={mint}
            disabled={busy}
            className="mt-2 rounded-xl border border-neon-cyan/40 bg-neon-cyan/10 px-4 py-2 text-sm font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/20 disabled:opacity-50"
          >
            {busy ? "Making a code…" : "Make a fresh code"}
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-sm text-neon-amber">
          {error}
        </p>
      )}
    </div>
  );
}
