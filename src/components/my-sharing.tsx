"use client";

import { useCallback, useEffect, useState } from "react";
import { Confetti } from "./confetti";
import { CHILD_AUTHORITY_COPY, type AgeTier } from "@/lib/child/age-tier";

interface Viewer {
  id: string;
  name: string;
  granted_by: string;
  scope: Record<string, boolean>;
  granted_at: string;
  cooling_off: { requested_at: string; effective_at: string | null } | null;
}

interface TimelineEntry {
  id: string;
  event: string;
  detail: Record<string, unknown>;
  created_at: string;
  mine: boolean;
}

interface SharingData {
  member: { id: string; name: string; tier: AgeTier };
  viewers: Viewer[];
  timeline: TimelineEntry[];
}

const SCOPE_LABELS: Record<string, string> = {
  grades: "Grades",
  attendance: "Attendance",
  checkins: "Check-ins",
};

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
  });
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function describeScope(scope: unknown): string {
  if (typeof scope !== "object" || scope === null) return "sharing settings";
  const on = Object.entries(scope as Record<string, boolean>)
    .filter(([, v]) => v)
    .map(([k]) => SCOPE_LABELS[k] ?? k);
  return on.length > 0 ? on.join(", ").toLowerCase() : "nothing";
}

function timelineText(entry: TimelineEntry): string {
  const d = entry.detail ?? {};
  switch (entry.event) {
    case "code_generated":
      return "A link code was made";
    case "code_redeemed":
      return "You linked your school to Cockpit";
    case "consent_granted":
      return "You said yes to sharing your school life";
    case "consent_declined":
      return "You decided not to link right now";
    case "scope_changed":
      return `Sharing changed — now: ${describeScope(d.scope)}`;
    case "access_paused":
      return `Sharing pauses on ${d.cooling_off_until ? fmtDate(String(d.cooling_off_until)) : "the notice date"} — 7 days' notice`;
    case "access_revoked":
      return d.via === "cooling_off_elapsed"
        ? "Sharing paused after the 7-day notice"
        : "Sharing was stopped";
    case "access_restored":
      return "Sharing was turned back on";
    case "revoke_undone":
      return "The pause was cancelled — sharing continues";
    case "tier_changed_18":
      return "You turned 18 — you're in control now";
    default:
      return "Something changed with sharing";
  }
}

function ViewerCard({
  viewer,
  tier,
  onChanged,
}: {
  viewer: Viewer;
  tier: AgeTier;
  onChanged: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [scope, setScope] = useState<Record<string, boolean>>(viewer.scope);
  const [scopeBusy, setScopeBusy] = useState(false);
  const [error, setError] = useState("");

  const canNegotiate = tier === "teen-16-17" || tier === "adult-18+";
  const initial = viewer.name.trim().charAt(0).toUpperCase() || "P";

  async function revoke() {
    if (!confirming) {
      setConfirming(true);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/sharing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "revoke", grant_id: viewer.id }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(data?.error ?? "Couldn't stop that sharing.");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't stop that sharing. Try again.");
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  async function toggleScope(key: string) {
    const next = { ...scope, [key]: !scope[key] };
    setScope(next);
    setScopeBusy(true);
    setError("");
    try {
      const res = await fetch("/api/sharing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_id: viewer.id,
          scope: {
            grades: !!next.grades,
            attendance: !!next.attendance,
            checkins: !!next.checkins,
            health: false,
          },
        }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(data?.error ?? "Couldn't save that change.");
      onChanged();
    } catch (e) {
      setScope(viewer.scope);
      setError(e instanceof Error ? e.message : "Couldn't save that change. Try again.");
    } finally {
      setScopeBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-line bg-panel-2/60 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex h-10 w-10 items-center justify-center rounded-full border border-neon-cyan/30 bg-neon-cyan/10 text-lg font-semibold text-neon-cyan"
          >
            {initial}
          </span>
          <div>
            <p className="text-base font-semibold text-star">{viewer.name}</p>
            <p className="text-xs text-dim">
              Sharing since {fmtDateTime(viewer.granted_at)}
            </p>
          </div>
        </div>
        <span className="rounded-full border border-neon-green/30 bg-neon-green/10 px-2.5 py-1 text-[11px] font-medium text-neon-green">
          {viewer.cooling_off ? "Pausing soon" : "Can see"}
        </span>
      </div>

      {viewer.cooling_off && (
        <p className="mt-3 rounded-xl border border-neon-amber/30 bg-neon-amber/5 px-3 py-2 text-xs leading-relaxed text-stardust">
          <span className="font-medium text-neon-amber">Heads up:</span> sharing
          with {viewer.name} pauses on{" "}
          {viewer.cooling_off.effective_at
            ? fmtDate(viewer.cooling_off.effective_at)
            : "the notice date"}{" "}
          — that&apos;s the 7-day notice. Nothing changes until then.
        </p>
      )}

      <div className="mt-4">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-dim">
          What they see
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {Object.entries(SCOPE_LABELS).map(([key, label]) =>
            canNegotiate && !viewer.cooling_off ? (
              <button
                key={key}
                type="button"
                onClick={() => toggleScope(key)}
                disabled={scopeBusy}
                aria-pressed={!!scope[key]}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                  scope[key]
                    ? "border-neon-cyan/50 bg-neon-cyan/10 text-neon-cyan"
                    : "border-line bg-panel text-dim hover:text-stardust"
                }`}
              >
                {scope[key] ? "✓ " : ""}{label}
              </button>
            ) : (
              <span
                key={key}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium ${
                  viewer.scope[key]
                    ? "border-neon-cyan/30 bg-neon-cyan/5 text-stardust"
                    : "border-line text-dim/60"
                }`}
              >
                {viewer.scope[key] ? "✓ " : ""}{label}
              </span>
            ),
          )}
        </div>
        {!canNegotiate && (
          <p className="mt-2 text-[11px] text-dim">
            At 16 you&apos;ll be able to fine-tune each of these yourself.
          </p>
        )}
      </div>

      {error && (
        <p role="alert" className="mt-3 text-xs text-neon-amber">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={revoke}
        disabled={busy}
        className={`mt-4 w-full rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-50 ${
          confirming
            ? "border-neon-amber/50 bg-neon-amber/10 text-neon-amber hover:bg-neon-amber/20"
            : "border-line bg-panel text-stardust hover:border-neon-amber/40 hover:text-star"
        }`}
      >
        {busy
          ? "Stopping…"
          : confirming
            ? `Tap again to stop sharing with ${viewer.name}`
            : `Stop sharing with ${viewer.name}`}
      </button>
      {confirming && !busy && (
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="mt-2 w-full text-xs text-dim underline decoration-dotted underline-offset-2 hover:text-stardust"
        >
          Keep sharing
        </button>
      )}
    </div>
  );
}

/**
 * My sharing — the child's "who can see my school life" screen (16–17
 * required for v1; 13–15 get the read + revoke view; 18+ the adult view).
 * Viewers, one-tap revoke, scope toggles, go-independent graduation with
 * confetti, and the audit history as a timeline.
 */
export function MySharing() {
  const [data, setData] = useState<SharingData | null>(null);
  const [error, setError] = useState("");
  const [confirmGo, setConfirmGo] = useState(false);
  const [goingIndependent, setGoingIndependent] = useState(false);
  const [independent, setIndependent] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await fetch("/api/sharing");
      const json = (await res.json().catch(() => null)) as (SharingData & { error?: string }) | null;
      if (!res.ok) throw new Error(json?.error ?? "Couldn't load sharing.");
      setData(json as SharingData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load sharing. Try again.");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function goIndependent() {
    if (!confirmGo) {
      setConfirmGo(true);
      return;
    }
    setGoingIndependent(true);
    try {
      const res = await fetch("/api/sharing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "go_independent" }),
      });
      if (!res.ok) throw new Error("Couldn't do that right now.");
      setIndependent(true);
      setConfirmGo(false);
      await load();
      window.setTimeout(() => setIndependent(false), 6000);
    } catch {
      setError("Couldn't go independent right now. Try again.");
      setConfirmGo(false);
    } finally {
      setGoingIndependent(false);
    }
  }

  if (error && !data) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16 text-center">
        <p aria-hidden="true" className="text-4xl">🔒</p>
        <h1 className="mt-4 text-xl font-semibold text-star">Couldn&apos;t load sharing</h1>
        <p className="mt-2 text-sm text-stardust">{error}</p>
        <button
          type="button"
          onClick={load}
          className="mt-6 rounded-xl border border-neon-cyan/40 bg-neon-cyan/10 px-6 py-2.5 text-sm font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/20"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto w-full max-w-2xl px-4 py-16 text-center">
        <p className="text-sm text-stardust">Loading who can see your school life…</p>
      </div>
    );
  }

  const { member, viewers, timeline } = data;
  const firstName = member.name.trim().split(" ")[0] || member.name;

  return (
    <div className="relative mx-auto w-full max-w-2xl px-4 py-10">
      {independent && <Confetti />}

      <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-neon-cyan">
        My sharing
      </p>
      <h1 className="mt-2 text-2xl font-semibold text-star">
        You&apos;re in charge of who sees your school life
      </h1>
      <p className="mt-2 max-w-xl text-sm leading-relaxed text-stardust">
        {CHILD_AUTHORITY_COPY}
      </p>

      {independent && (
        <div className="mt-6 rounded-2xl border border-neon-green/40 bg-neon-green/5 p-5 text-center">
          <p aria-hidden="true" className="text-4xl">🎓</p>
          <p className="mt-2 text-base font-semibold text-star">
            You&apos;re flying solo, {firstName}
          </p>
          <p className="mt-1 text-sm text-stardust">
            Nobody else can see your school life now. You can invite someone back anytime.
          </p>
        </div>
      )}

      <section aria-label="Who can see" className="mt-8">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-dim">
          Who can see · {viewers.length}
        </h2>
        {viewers.length === 0 ? (
          <div className="rounded-2xl border border-line bg-panel-2/60 p-6 text-center">
            <p aria-hidden="true" className="text-3xl">🌌</p>
            <p className="mt-3 text-sm font-medium text-star">
              Nobody else can see your school life right now
            </p>
            <p className="mt-1 text-sm text-dim">
              It&apos;s just you. If a parent makes you a link code, it&apos;ll show up here after you accept.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {viewers.map((v) => (
              <ViewerCard key={v.id} viewer={v} tier={member.tier} onChanged={load} />
            ))}
          </div>
        )}
      </section>

      {(member.tier === "teen-16-17" || member.tier === "adult-18+") && viewers.length > 0 && (
        <section aria-label="Go independent" className="mt-8">
          <div className="rounded-2xl border border-line bg-panel-2/40 p-5">
            <p className="text-sm font-semibold text-star">Go independent</p>
            <p className="mt-1 text-sm leading-relaxed text-stardust">
              Stop sharing with everyone at once. Your history stays — only
              future access ends. You can invite anyone back anytime.
            </p>
            <button
              type="button"
              onClick={goIndependent}
              disabled={goingIndependent}
              className={`mt-3 rounded-xl border px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-50 ${
                confirmGo
                  ? "border-neon-green/50 bg-neon-green/10 text-neon-green hover:bg-neon-green/20"
                  : "border-line bg-panel text-stardust hover:text-star"
              }`}
            >
              {goingIndependent
                ? "Doing it…"
                : confirmGo
                  ? "Yes — I'm ready to fly solo"
                  : "Go independent"}
            </button>
            {confirmGo && !goingIndependent && (
              <button
                type="button"
                onClick={() => setConfirmGo(false)}
                className="mt-2 block text-xs text-dim underline decoration-dotted underline-offset-2 hover:text-stardust"
              >
                Not yet
              </button>
            )}
          </div>
        </section>
      )}

      <section aria-label="History" className="mt-10">
        <h2 className="mb-4 text-xs font-semibold uppercase tracking-[0.2em] text-dim">
          History
        </h2>
        {timeline.length === 0 ? (
          <p className="text-sm text-dim">Nothing here yet — changes will show up as they happen.</p>
        ) : (
          <ol className="relative space-y-5 border-l border-line pl-6">
            {timeline.map((entry) => (
              <li key={entry.id} className="relative">
                <span
                  aria-hidden="true"
                  className={`absolute -left-[31px] top-1 h-2.5 w-2.5 rounded-full border ${
                    entry.mine
                      ? "border-neon-cyan/60 bg-neon-cyan/40"
                      : "border-dim/50 bg-panel"
                  }`}
                />
                <p className="text-sm text-star">{timelineText(entry)}</p>
                <p className="mt-0.5 text-xs text-dim">{fmtDateTime(entry.created_at)}</p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
