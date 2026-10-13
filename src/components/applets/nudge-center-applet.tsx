"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Nudge {
  id: string;
  category: string;
  title: string;
  body: string | null;
  score: number;
  source: string;
  status: string;
  scheduled_for: string | null;
  delivered_at: string | null;
  snoozed_until: string | null;
  created_at: string;
  why: string;
}

interface NudgePrefs {
  pilot_id: string;
  categories: Record<string, boolean>;
  min_score: number;
  quiet_hours_start: string;
  quiet_hours_end: string;
  breakthrough_allowed: boolean;
}

interface CenterStats {
  total_7d: number;
  acknowledged_7d: number;
  ack_rate_7d: number;
  by_category: Record<string, number>;
}

interface CenterPayload {
  active: Nudge[];
  queued_for_later: number;
  history: Nudge[];
  stats: CenterStats;
  preferences: NudgePrefs;
}

const CATEGORY_META: Record<string, { label: string; chip: string }> = {
  meeting: { label: "Meeting", chip: "border-neon-cyan/30 bg-neon-cyan/10 text-neon-cyan" },
  bill: { label: "Bill", chip: "border-neon-amber/30 bg-neon-amber/10 text-neon-amber" },
  weather: { label: "Weather", chip: "border-neon-teal/30 bg-neon-teal/10 text-neon-teal" },
  todo: { label: "To do", chip: "border-neon-purple/30 bg-neon-purple/10 text-neon-purple" },
  school: { label: "School", chip: "border-neon-green/30 bg-neon-green/10 text-neon-green" },
  health: { label: "Health", chip: "border-neon-teal/30 bg-neon-teal/10 text-neon-teal" },
  system: { label: "System", chip: "border-line bg-panel-3 text-stardust" },
};

const CATEGORY_ORDER = ["meeting", "bill", "weather", "todo", "school", "health", "system"];

function categoryEnabled(prefs: NudgePrefs, category: string): boolean {
  return prefs.categories[category] !== false;
}

function relTime(iso: string | null): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  const abs = Math.abs(ms);
  const mins = Math.round(abs / 60000);
  if (mins < 1) return ms >= 0 ? "any moment" : "just now";
  if (mins < 60) return ms >= 0 ? `in ${mins}m` : `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return ms >= 0 ? `in ${hrs}h` : `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return ms >= 0 ? `in ${days}d` : `${days}d ago`;
}

/** Next occurrence of a pilot-local "HH:MM" (quiet-hours end), in this browser's clock. */
function nextQuietEnd(hhmm: string): string {
  const [h, m] = hhmm.split(":").map((n) => Number(n) || 0);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  if (d.getTime() <= Date.now()) d.setDate(d.getDate() + 1);
  return d.toISOString();
}

function scoreTier(score: number): { word: string; cls: string } {
  if (score >= 85) return { word: "urgent", cls: "text-neon-amber" };
  if (score >= 65) return { word: "important", cls: "text-neon-cyan" };
  if (score >= 40) return { word: "worth a look", cls: "text-stardust" };
  return { word: "low-key", cls: "text-dim" };
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-dim">
      {children}
    </h3>
  );
}

/** Nudge Center — the pilot's proactive-notification command deck. */
export function NudgeCenterApplet() {
  const [payload, setPayload] = useState<CenterPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<NudgePrefs | null>(null);
  const [prefsNote, setPrefsNote] = useState<string | null>(null);
  const prefsTimer = useRef<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/nudges/center", { cache: "no-store" });
      const data = (await res.json()) as CenterPayload & { error?: string };
      if (!res.ok) throw new Error(data.error || "The nudge center didn't load.");
      setPayload(data);
      setPrefs(data.preferences);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "The nudge center didn't load.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function act(id: string, action: "acknowledge" | "snooze", until?: string) {
    setActing(id);
    try {
      const res = await fetch(
        `/api/nudges/${id}/${action}`,
        action === "snooze"
          ? {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ until }),
            }
          : { method: "POST" },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(data?.error || "That didn't go through.");
      }
      // Optimistic: drop it from the active list, then refresh counts.
      setPayload((p) => (p ? { ...p, active: p.active.filter((n) => n.id !== id) } : p));
      load();
    } catch (e) {
      setPrefsNote(e instanceof Error ? e.message : "That didn't go through.");
    } finally {
      setActing(null);
    }
  }

  /** Debounced preference save — one PATCH per pause in the pilot's fiddling. */
  function savePrefs(next: NudgePrefs) {
    setPrefs(next);
    setPrefsNote(null);
    if (prefsTimer.current) window.clearTimeout(prefsTimer.current);
    prefsTimer.current = window.setTimeout(async () => {
      try {
        const res = await fetch("/api/nudges/preferences", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            categories: next.categories,
            min_score: next.min_score,
            quiet_hours_start: next.quiet_hours_start,
            quiet_hours_end: next.quiet_hours_end,
            breakthrough_allowed: next.breakthrough_allowed,
          }),
        });
        if (!res.ok) throw new Error();
        setPrefsNote("Saved.");
      } catch {
        setPrefsNote("Couldn't save that — check your connection.");
      }
    }, 600);
  }

  if (loading && !payload) {
    return (
      <div className="flex min-h-[240px] items-center justify-center">
        <p className="animate-pulse text-sm text-dim">Tuning the dials…</p>
      </div>
    );
  }

  if (loadError && !payload) {
    return (
      <div className="flex min-h-[240px] flex-col items-center justify-center gap-3 text-center">
        <p className="text-sm text-stardust">{loadError}</p>
        <button
          type="button"
          onClick={load}
          className="rounded-xl border border-neon-amber/40 bg-neon-amber/10 px-4 py-2 text-sm font-medium text-neon-amber transition-colors hover:bg-neon-amber/20"
        >
          Try again
        </button>
      </div>
    );
  }

  const active = payload?.active ?? [];
  const history = payload?.history ?? [];
  const queued = payload?.queued_for_later ?? 0;
  const stats = payload?.stats;

  return (
    <div className="space-y-6">
      {prefsNote && (
        <p role="status" className="rounded-xl border border-line bg-panel-2/70 px-4 py-2 text-xs text-stardust">
          {prefsNote}
        </p>
      )}

      {/* Active nudges */}
      <section aria-label="Active nudges">
        <SectionTitle>Needs your attention</SectionTitle>
        {queued > 0 && (
          <p className="mb-3 rounded-xl border border-neon-purple/30 bg-neon-purple/5 px-4 py-2.5 text-xs leading-relaxed text-stardust">
            {queued} {queued === 1 ? "nudge" : "nudges"} waiting for morning — held back by your
            quiet hours, not lost.
          </p>
        )}
        {active.length === 0 ? (
          <div className="rounded-2xl border border-line bg-panel-2/60 px-5 py-8 text-center">
            <p className="text-sm text-star">All quiet on the flight deck.</p>
            <p className="mt-1 text-xs leading-relaxed text-dim">
              No nudges right now — I&apos;ll tap your shoulder when something needs you.
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {active.map((n) => {
              const meta = CATEGORY_META[n.category] ?? CATEGORY_META.system;
              const tier = scoreTier(n.score);
              const busy = acting === n.id;
              return (
                <li
                  key={n.id}
                  className="rounded-2xl border border-line bg-panel-2/70 px-4 py-3.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="mb-1.5 flex flex-wrap items-center gap-2">
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${meta.chip}`}>
                          {meta.label}
                        </span>
                        <span className={`text-[11px] font-medium ${tier.cls}`}>
                          {tier.word} · {Math.round(n.score)}
                        </span>
                        {n.scheduled_for && (
                          <span className="text-[11px] text-dim">{relTime(n.scheduled_for)}</span>
                        )}
                        {n.status === "snoozed" && n.snoozed_until && (
                          <span className="text-[11px] text-dim">
                            snoozed · back {relTime(n.snoozed_until)}
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-medium leading-snug text-star">{n.title}</p>
                      {n.body && (
                        <p className="mt-1 text-xs leading-relaxed text-stardust">{n.body}</p>
                      )}
                      <details className="mt-1.5">
                        <summary className="cursor-pointer text-[11px] text-dim hover:text-stardust">
                          Why am I seeing this?
                        </summary>
                        <p className="mt-1 text-[11px] leading-relaxed text-dim">{n.why}</p>
                      </details>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => act(n.id, "acknowledge")}
                      className="rounded-xl border border-neon-teal/40 bg-neon-teal/10 px-3.5 py-1.5 text-xs font-medium text-neon-teal transition-colors hover:bg-neon-teal/20 disabled:opacity-40"
                    >
                      {busy ? "Working…" : "Got it"}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => act(n.id, "snooze", new Date(Date.now() + 60 * 60 * 1000).toISOString())}
                      className="rounded-xl border border-line bg-panel-3/60 px-3.5 py-1.5 text-xs text-stardust transition-colors hover:border-neon-amber/40 hover:text-star disabled:opacity-40"
                    >
                      Snooze 1h
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => act(n.id, "snooze", nextQuietEnd(prefs?.quiet_hours_end ?? "07:00"))}
                      className="rounded-xl border border-line bg-panel-3/60 px-3.5 py-1.5 text-xs text-stardust transition-colors hover:border-neon-amber/40 hover:text-star disabled:opacity-40"
                    >
                      Morning
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Preferences */}
      {prefs && (
        <section aria-label="Nudge preferences">
          <SectionTitle>How I nudge you</SectionTitle>
          <div className="rounded-2xl border border-line bg-panel-2/60 px-4 py-4">
            <ul className="divide-y divide-white/5">
              {CATEGORY_ORDER.map((cat) => {
                const meta = CATEGORY_META[cat];
                const on = categoryEnabled(prefs, cat);
                return (
                  <li key={cat} className="flex items-center justify-between py-2.5">
                    <span className="text-sm text-stardust">{meta.label} reminders</span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      aria-label={`${meta.label} reminders`}
                      onClick={() =>
                        savePrefs({ ...prefs, categories: { ...prefs.categories, [cat]: !on } })
                      }
                      className={`relative h-6 w-11 rounded-full transition-colors ${
                        on ? "bg-neon-teal/70" : "bg-panel-3"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-5 w-5 rounded-full bg-star transition-all ${
                          on ? "left-[22px]" : "left-0.5"
                        }`}
                      />
                    </button>
                  </li>
                );
              })}
            </ul>

            <div className="mt-4 border-t border-white/5 pt-4">
              <p className="mb-2 text-xs text-stardust">Quiet hours <span className="text-dim">(your time)</span></p>
              <div className="flex items-center gap-3">
                <input
                  type="time"
                  aria-label="Quiet hours start"
                  value={prefs.quiet_hours_start}
                  onChange={(e) => savePrefs({ ...prefs, quiet_hours_start: e.target.value })}
                  className="rounded-xl border border-line bg-panel-3 px-3 py-2 text-sm text-star focus:border-neon-teal/60 focus:outline-none"
                />
                <span className="text-xs text-dim">to</span>
                <input
                  type="time"
                  aria-label="Quiet hours end"
                  value={prefs.quiet_hours_end}
                  onChange={(e) => savePrefs({ ...prefs, quiet_hours_end: e.target.value })}
                  className="rounded-xl border border-line bg-panel-3 px-3 py-2 text-sm text-star focus:border-neon-teal/60 focus:outline-none"
                />
              </div>
              <label className="mt-3 flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={prefs.breakthrough_allowed}
                  onChange={(e) => savePrefs({ ...prefs, breakthrough_allowed: e.target.checked })}
                  className="mt-0.5 h-4 w-4 accent-teal-300"
                />
                <span className="text-xs leading-relaxed text-stardust">
                  Let truly urgent nudges break through quiet hours
                </span>
              </label>
            </div>

            <div className="mt-4 border-t border-white/5 pt-4">
              <div className="mb-1 flex items-center justify-between">
                <p className="text-xs text-stardust">Sensitivity</p>
                <p className="text-xs text-dim">
                  {prefs.min_score === 0
                    ? "Everything comes through"
                    : `Only scores ${prefs.min_score}+`}
                </p>
              </div>
              <input
                type="range"
                min={0}
                max={150}
                step={5}
                aria-label="Minimum nudge score"
                value={prefs.min_score}
                onChange={(e) => savePrefs({ ...prefs, min_score: Number(e.target.value) })}
                className="w-full accent-teal-300"
              />
              <div className="flex justify-between text-[10px] text-dim">
                <span>Everything</span>
                <span>Only urgent</span>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Stats + history */}
      <section aria-label="Nudge history">
        <SectionTitle>Recently</SectionTitle>
        {stats && stats.total_7d > 0 && (
          <p className="mb-3 text-xs text-dim">
            {stats.total_7d} {stats.total_7d === 1 ? "nudge" : "nudges"} in the last 7 days ·{" "}
            {stats.ack_rate_7d}% acknowledged
          </p>
        )}
        {history.length === 0 ? (
          <p className="rounded-2xl border border-line bg-panel-2/60 px-5 py-6 text-center text-xs text-dim">
            Nothing in the log yet — acknowledged and expired nudges land here.
          </p>
        ) : (
          <ul className="space-y-2">
            {history.slice(0, 10).map((n) => {
              const meta = CATEGORY_META[n.category] ?? CATEGORY_META.system;
              return (
                <li
                  key={n.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-line/60 bg-panel-2/40 px-4 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs text-stardust">{n.title}</p>
                    <p className="text-[10px] text-dim">
                      {meta.label} · {n.status} · {relTime(n.created_at)}
                    </p>
                  </div>
                  <span className={`shrink-0 text-[11px] ${scoreTier(n.score).cls}`}>
                    {Math.round(n.score)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
