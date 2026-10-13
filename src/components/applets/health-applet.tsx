"use client";

import { useCallback, useEffect, useState } from "react";

type Metric = "weight" | "sleep" | "water" | "exercise";

interface HealthLog {
  id: string;
  metric: Metric;
  value: number;
  unit: string;
  meta: Record<string, unknown>;
  logged_at: string;
}

interface Streak {
  metric: Metric;
  current_streak: number;
  best_streak: number;
}

interface Goal {
  metric: Metric;
  target_value: number;
  unit: string;
}

const METRICS: { id: Metric; label: string; icon: string; unit: string; accent: string }[] = [
  { id: "weight", label: "Weight", icon: "⚖️", unit: "lb", accent: "text-amber-300" },
  { id: "sleep", label: "Sleep", icon: "😴", unit: "h", accent: "text-neon-cyan" },
  { id: "water", label: "Water", icon: "💧", unit: "glasses", accent: "text-cyan-300" },
  { id: "exercise", label: "Exercise", icon: "🏃", unit: "min", accent: "text-neon-green" },
];

/** Health — the Med Bay. Manual logging, gentle trends, celebrating streaks. */
export function HealthApplet() {
  const [latest, setLatest] = useState<Partial<Record<Metric, HealthLog>>>({});
  const [streaks, setStreaks] = useState<Streak[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Metric | null>(null);
  const [trend, setTrend] = useState<Metric | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [logsRes, streaksRes, goalsRes] = await Promise.all([
        fetch("/api/health/logs?limit=200", { cache: "no-store" }),
        fetch("/api/health/streaks", { cache: "no-store" }),
        fetch("/api/health/goals", { cache: "no-store" }),
      ]);
      for (const [res, what] of [
        [logsRes, "logs"],
        [streaksRes, "streaks"],
        [goalsRes, "goals"],
      ] as const) {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            typeof body?.error === "string" ? body.error : `Your ${what} didn't load. Try again.`,
          );
        }
      }
      const logs: HealthLog[] = (await logsRes.json()).logs ?? [];
      const first: Partial<Record<Metric, HealthLog>> = {};
      for (const log of logs) {
        if (!first[log.metric]) first[log.metric] = log;
      }
      setLatest(first);
      setStreaks((await streaksRes.json()).streaks ?? []);
      setGoals((await goalsRes.json()).goals ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Your health log didn't load. Try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const streakFor = (m: Metric) => streaks.find((s) => s.metric === m);
  const goalFor = (m: Metric) => goals.find((g) => g.metric === m);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-neon-green">Med Bay</p>
        <h2 className="mt-1 text-xl font-semibold text-star">Your fuel gauges</h2>
        <p className="mt-1 text-sm text-stardust">
          A quiet logbook for your body. No judgment, no nagging — just your numbers.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-line bg-panel-2/60 p-4 text-center">
          <p className="text-sm text-stardust">{error}</p>
          <button
            type="button"
            onClick={() => {
              setLoading(true);
              load();
            }}
            className="mt-2 rounded-xl border border-neon-cyan/40 bg-neon-cyan/10 px-4 py-2 text-sm font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/20"
          >
            Try again
          </button>
        </div>
      )}

      {/* Metric tiles */}
      <div className="grid grid-cols-2 gap-3">
        {loading
          ? [0, 1, 2, 3].map((i) => (
              <div key={i} className="h-32 animate-pulse rounded-2xl border border-line bg-panel-2/60" />
            ))
          : METRICS.map((m) => {
              const log = latest[m.id];
              const streak = streakFor(m.id);
              const goal = goalFor(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setSheet(m.id)}
                  className="rounded-2xl border border-line bg-panel-2/60 p-4 text-left transition-colors hover:border-neon-green/30"
                >
                  <div className="flex items-center justify-between">
                    <span aria-hidden="true" className="text-xl">{m.icon}</span>
                    {streak && streak.current_streak >= 2 && (
                      <span className="text-xs font-medium text-amber-300">
                        🔥 {streak.current_streak}d
                      </span>
                    )}
                  </div>
                  <p className="mt-2 text-xs font-medium uppercase tracking-wider text-dim">{m.label}</p>
                  <p className={`mt-0.5 text-2xl font-semibold ${log ? m.accent : "text-dim"}`}>
                    {log ? `${log.value} ${log.unit}` : "—"}
                  </p>
                  <p className="mt-1 text-xs text-dim">
                    {log ? "Tap to log" : "Tap to log your first entry"}
                    {goal ? ` · goal ${goal.target_value} ${goal.unit}` : ""}
                  </p>
                </button>
              );
            })}
      </div>

      <p className="text-xs text-dim">
        Your health data stays yours — it&apos;s never shared, and support can&apos;t see it.
      </p>

      {sheet && (
        <LogSheet
          metric={sheet}
          goal={goalFor(sheet)}
          onClose={() => setSheet(null)}
          onSaved={load}
          onViewTrend={() => {
            setTrend(sheet);
            setSheet(null);
          }}
        />
      )}

      {trend && <TrendView metric={trend} onClose={() => setTrend(null)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Log sheet                                                           */
/* ------------------------------------------------------------------ */

function LogSheet({
  metric,
  goal,
  onClose,
  onSaved,
  onViewTrend,
}: {
  metric: Metric;
  goal?: Goal;
  onClose: () => void;
  onSaved: () => void;
  onViewTrend: () => void;
}) {
  const def = METRICS.find((m) => m.id === metric)!;
  const [value, setValue] = useState("");
  const [unit, setUnit] = useState(def.unit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Sleep extras
  const [quality, setQuality] = useState(3);
  // Exercise extras
  const [exType, setExType] = useState("walk");
  const [effort, setEffort] = useState(3);

  const placeholder =
    metric === "weight" ? "e.g. 172" :
    metric === "sleep" ? "e.g. 7.5" :
    metric === "water" ? "e.g. 6" : "e.g. 30";

  async function save() {
    const v = parseFloat(value);
    if (!Number.isFinite(v)) {
      setError("Enter a number.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const meta: Record<string, unknown> =
        metric === "sleep" ? { quality } :
        metric === "exercise" ? { type: exType, effort } : {};
      const res = await fetch("/api/health/log", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ metric, value: v, unit, meta }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body?.error === "string" ? body.error : "Couldn't save that.");
      }
      setSaved(true);
      onSaved();
      setTimeout(onClose, 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={`Log ${def.label}`}>
      <div className="w-full max-w-md rounded-3xl border border-line bg-panel p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-star">
            {def.icon} Log {def.label.toLowerCase()}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full border border-line p-2 text-dim hover:text-star"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {saved ? (
          <p className="py-8 text-center text-lg text-neon-green">Logged ✓ Nice.</p>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="flex gap-2">
              <input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") save();
                }}
                inputMode="decimal"
                placeholder={placeholder}
                aria-label={`${def.label} value`}
                autoFocus
                className="min-w-0 flex-1 rounded-xl border border-line bg-panel-2 px-4 py-3 text-2xl text-star placeholder:text-dim focus:border-neon-green/60 focus:outline-none"
              />
              {metric === "weight" && (
                <div className="flex rounded-xl border border-line" role="group" aria-label="Weight unit">
                  {(["lb", "kg"] as const).map((u) => (
                    <button
                      key={u}
                      type="button"
                      onClick={() => setUnit(u)}
                      aria-pressed={unit === u}
                      className={`px-4 text-sm font-medium ${unit === u ? "text-neon-green" : "text-dim"}`}
                    >
                      {u}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {metric === "sleep" && (
              <div>
                <p className="mb-2 text-sm text-stardust">How was it?</p>
                <div className="flex gap-2" role="radiogroup" aria-label="Sleep quality">
                  {[1, 2, 3, 4, 5].map((q) => (
                    <button
                      key={q}
                      type="button"
                      role="radio"
                      aria-checked={quality === q}
                      onClick={() => setQuality(q)}
                      className={`flex-1 rounded-xl border py-2.5 text-sm transition-colors ${
                        quality === q
                          ? "border-neon-cyan/60 bg-neon-cyan/10 text-star"
                          : "border-line text-dim"
                      }`}
                    >
                      {["😫", "😕", "😐", "🙂", "😄"][q - 1]}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {metric === "exercise" && (
              <>
                <div>
                  <p className="mb-2 text-sm text-stardust">What did you do?</p>
                  <div className="flex flex-wrap gap-2">
                    {["walk", "run", "lift", "yoga", "other"].map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setExType(t)}
                        aria-pressed={exType === t}
                        className={`rounded-full border px-4 py-2 text-sm capitalize transition-colors ${
                          exType === t
                            ? "border-neon-green/60 bg-neon-green/10 text-star"
                            : "border-line text-dim"
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-2 text-sm text-stardust">How hard?</p>
                  <div className="flex gap-2" role="radiogroup" aria-label="Effort">
                    {[1, 2, 3, 4, 5].map((e) => (
                      <button
                        key={e}
                        type="button"
                        role="radio"
                        aria-checked={effort === e}
                        onClick={() => setEffort(e)}
                        className={`flex-1 rounded-xl border py-2 text-sm transition-colors ${
                          effort === e
                            ? "border-neon-green/60 bg-neon-green/10 text-star"
                            : "border-line text-dim"
                        }`}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}

            {goal && (
              <p className="text-xs text-dim">
                Your goal: {goal.target_value} {goal.unit}
              </p>
            )}

            {error && <p className="text-sm text-red-300">{error}</p>}

            <button
              type="button"
              onClick={save}
              disabled={saving || !value.trim()}
              className="w-full rounded-xl border border-neon-green/40 bg-neon-green/10 py-3 text-sm font-semibold text-neon-green transition-colors hover:bg-neon-green/20 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {saving ? "Saving…" : "Save"}
            </button>

            <button
              type="button"
              onClick={onViewTrend}
              className="w-full py-1 text-sm text-neon-cyan hover:underline"
            >
              View 30-day trend →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Trend view                                                          */
/* ------------------------------------------------------------------ */

function TrendView({ metric, onClose }: { metric: Metric; onClose: () => void }) {
  const def = METRICS.find((m) => m.id === metric)!;
  const [data, setData] = useState<{
    daily: { date: string; value: number | null; rolling_avg: number | null }[];
    average: number | null;
    delta_vs_prior: number | null;
    unit: string | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/health/trends?metric=${metric}&period=30d`, { cache: "no-store" });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(typeof body?.error === "string" ? body.error : "The trend didn't load.");
        }
        setData(body);
      } catch (err) {
        setError(err instanceof Error ? err.message : "The trend didn't load.");
      }
    })();
  }, [metric]);

  const points = data?.daily.filter((d) => d.value !== null) ?? [];
  const max = points.length > 0 ? Math.max(...points.map((p) => p.value as number)) : 1;
  const min = points.length > 0 ? Math.min(...points.map((p) => p.value as number)) : 0;
  const span = Math.max(max - min, 0.001);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={`${def.label} trend`}>
      <div className="w-full max-w-md rounded-3xl border border-line bg-panel p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-star">
            {def.icon} {def.label} — 30 days
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-full border border-line p-2 text-dim hover:text-star"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>

        {error ? (
          <p className="py-6 text-center text-sm text-stardust">{error}</p>
        ) : !data ? (
          <div className="h-40 animate-pulse rounded-xl bg-panel-2/60" />
        ) : points.length === 0 ? (
          <p className="py-6 text-center text-sm text-stardust">
            No entries yet — log a few days and the trend will appear here.
          </p>
        ) : (
          <div className="mt-4">
            <svg viewBox="0 0 300 120" className="w-full" role="img" aria-label={`${def.label} trend chart`}>
              {points.map((p, i) => {
                const x = 10 + (i / Math.max(points.length - 1, 1)) * 280;
                const y = 110 - ((p.value as number - min) / span) * 95;
                return <circle key={p.date} cx={x} cy={y} r="3.5" fill="#5eead4" />;
              })}
              <polyline
                points={points
                  .map((p, i) => {
                    const x = 10 + (i / Math.max(points.length - 1, 1)) * 280;
                    const y = 110 - ((p.value as number - min) / span) * 95;
                    return `${x},${y}`;
                  })
                  .join(" ")}
                fill="none"
                stroke="#5eead4"
                strokeWidth="2"
                opacity="0.7"
              />
            </svg>
            <div className="mt-3 space-y-1 text-sm text-stardust">
              <p>
                30-day average:{" "}
                <span className="font-semibold text-star">
                  {data.average} {data.unit}
                </span>
              </p>
              {data.delta_vs_prior !== null && (
                <p>
                  vs the prior 30 days:{" "}
                  <span className={`font-semibold ${data.delta_vs_prior >= 0 ? "text-neon-green" : "text-amber-300"}`}>
                    {data.delta_vs_prior >= 0 ? "+" : ""}{data.delta_vs_prior} {data.unit}
                  </span>
                </p>
              )}
              <p className="pt-1 text-xs text-dim">
                These are observations from your own log. If something worries you, talk to your doctor.
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
