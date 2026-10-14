"use client";

import { useCallback, useEffect, useState } from "react";

type Metric = "weight" | "sleep" | "water" | "exercise" | "blood_glucose" | "steps";

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
  { id: "blood_glucose", label: "Blood sugar", icon: "🩸", unit: "mg/dL", accent: "text-red-300" },
  { id: "steps", label: "Steps", icon: "👟", unit: "steps", accent: "text-neon-purple" },
];

/** Context tags for a glucose reading. */
const GLUCOSE_CONTEXTS = [
  { id: "fasting", label: "Fasting" },
  { id: "before_meal", label: "Before meal" },
  { id: "after_meal", label: "After meal" },
  { id: "bedtime", label: "Bedtime" },
  { id: "other", label: "Other" },
] as const;

/** General reference ranges (ADA). Shown as reference only — never as personal targets. */
const GLUCOSE_REF = {
  fastingBand: [80, 130] as const,
  postMealLine: 180,
};

/** The medical disclaimer shown on every glucose surface. */
const GLUCOSE_DISCLAIMER =
  "This is a tracking tool, not medical advice. Your estimated A1C is a rough calculation from your readings — it is not a substitute for lab tests. Talk to your doctor about your personal targets and treatment.";

const glucoseContextLabel = (c: string) =>
  GLUCOSE_CONTEXTS.find((g) => g.id === c)?.label ?? "Other";

/** "2026-10-13T14:05:00" in the browser's local time — for datetime-local inputs. */
function toLocalInput(iso: string) {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Short readable stamp for a logged entry, in the pilot's timezone. */
function fmtEntryDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

/** Health — the Med Bay. Manual logging, gentle trends, celebrating streaks. */
export function HealthApplet() {
  const [latest, setLatest] = useState<Partial<Record<Metric, HealthLog>>>({});
  const [todaySteps, setTodaySteps] = useState<number | null>(null);
  const [streaks, setStreaks] = useState<Streak[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Metric | null>(null);
  const [trend, setTrend] = useState<Metric | null>(null);
  const [goalsSheet, setGoalsSheet] = useState<{ focus: Metric | null } | null>(null);
  const [entriesFor, setEntriesFor] = useState<Metric | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [logsRes, streaksRes, goalsRes, stepsRes] = await Promise.all([
        fetch("/api/health/logs?limit=200", { cache: "no-store" }),
        fetch("/api/health/streaks", { cache: "no-store" }),
        fetch("/api/health/goals", { cache: "no-store" }),
        fetch("/api/health/logs?today_only=true&metric=steps", { cache: "no-store" }),
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
      // Steps append through the day — the tile shows today's total, not the latest entry.
      if (stepsRes.ok) {
        const stepsBody = await stepsRes.json().catch(() => ({}));
        setTodaySteps(
          typeof stepsBody.today_total === "number" ? stepsBody.today_total : null,
        );
      } else {
        setTodaySteps(null);
      }
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
          ? METRICS.map((m) => (
              <div key={m.id} className="h-32 animate-pulse rounded-2xl border border-line bg-panel-2/60" />
            ))
          : METRICS.map((m) => {
              const log = latest[m.id];
              const streak = streakFor(m.id);
              const goal = goalFor(m.id);
              // Steps append through the day — the tile shows today's total.
              const isSteps = m.id === "steps";
              const displayValue = isSteps
                ? todaySteps !== null
                  ? todaySteps.toLocaleString("en-US")
                  : null
                : log
                  ? `${log.value} ${log.unit}`
                  : null;
              const caption = isSteps
                ? todaySteps !== null
                  ? "steps today · tap to log more"
                  : "Tap to log your first steps"
                : log
                  ? "Tap to log"
                  : "Tap to log your first entry";
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
                  <p className={`mt-0.5 text-2xl font-semibold ${displayValue ? m.accent : "text-dim"}`}>
                    {displayValue ?? "—"}
                  </p>
                  <p className="mt-1 text-xs text-dim">
                    {caption}
                    {goal ? ` · goal ${goal.target_value} ${goal.unit}` : ""}
                  </p>
                </button>
              );
            })}
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setGoalsSheet({ focus: null })}
          className="text-sm text-neon-cyan hover:underline"
        >
          🎯 Edit goals
        </button>
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
          onEditGoal={() => {
            setGoalsSheet({ focus: sheet });
            setSheet(null);
          }}
          onManageEntries={() => {
            setEntriesFor(sheet);
            setSheet(null);
          }}
        />
      )}

      {entriesFor && (
        <EntriesView
          metric={entriesFor}
          onClose={() => setEntriesFor(null)}
          onChanged={load}
        />
      )}

      {goalsSheet && (
        <GoalsEditor
          goals={goals}
          focus={goalsSheet.focus}
          onClose={() => setGoalsSheet(null)}
          onSaved={load}
        />
      )}

      {trend && trend !== "blood_glucose" && <TrendView metric={trend} onClose={() => setTrend(null)} />}
      {trend === "blood_glucose" && <GlucoseTrendView onClose={() => setTrend(null)} />}
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
  onEditGoal,
  onManageEntries,
}: {
  metric: Metric;
  goal?: Goal;
  onClose: () => void;
  onSaved: () => void;
  onViewTrend: () => void;
  onEditGoal: () => void;
  onManageEntries: () => void;
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
  // Glucose extras
  const [context, setContext] = useState<string>("fasting");
  const [loggedAt, setLoggedAt] = useState(() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });

  const placeholder =
    metric === "weight" ? "e.g. 172" :
    metric === "sleep" ? "e.g. 7.5" :
    metric === "water" ? "e.g. 6" :
    metric === "blood_glucose" ? "e.g. 112" :
    metric === "steps" ? "e.g. 5000" : "e.g. 30";

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
        metric === "exercise" ? { type: exType, effort } :
        metric === "blood_glucose" ? { context } : {};
      const payload: Record<string, unknown> = { metric, value: v, unit, meta };
      if (metric === "blood_glucose" && loggedAt) {
        const dt = new Date(loggedAt);
        if (!Number.isNaN(dt.getTime())) payload.logged_at = dt.toISOString();
      }
      const res = await fetch("/api/health/log", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
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

            {metric === "blood_glucose" && (
              <>
                <div>
                  <p className="mb-2 text-sm text-stardust">When was this taken?</p>
                  <div className="flex flex-wrap gap-2">
                    {GLUCOSE_CONTEXTS.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setContext(c.id)}
                        aria-pressed={context === c.id}
                        className={`rounded-full border px-4 py-2 text-sm transition-colors ${
                          context === c.id
                            ? "border-red-300/60 bg-red-300/10 text-star"
                            : "border-line text-dim"
                        }`}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-sm text-stardust" htmlFor="glucose-time">
                    Time of reading
                  </label>
                  <input
                    id="glucose-time"
                    type="datetime-local"
                    value={loggedAt}
                    onChange={(e) => setLoggedAt(e.target.value)}
                    className="w-full rounded-xl border border-line bg-panel-2 px-4 py-2.5 text-sm text-star focus:border-neon-green/60 focus:outline-none"
                  />
                </div>
                <p className="rounded-xl border border-line bg-panel-2/60 px-4 py-3 text-xs leading-relaxed text-dim">
                  {GLUCOSE_DISCLAIMER}
                </p>
              </>
            )}

            {goal ? (
              <p className="text-xs text-dim">
                Your goal: {goal.target_value} {goal.unit}{" "}
                <button
                  type="button"
                  onClick={onEditGoal}
                  className="text-neon-cyan hover:underline"
                >
                  Change
                </button>
              </p>
            ) : (
              <button
                type="button"
                onClick={onEditGoal}
                className="text-left text-xs text-neon-cyan hover:underline"
              >
                Set a goal for {def.label.toLowerCase()} →
              </button>
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
            <button
              type="button"
              onClick={onManageEntries}
              className="w-full py-1 text-sm text-dim hover:text-star hover:underline"
            >
              Manage past entries
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Goal editor — create or change the per-metric targets (PUT /api/health/goals).
/* Goals are supported for weight, sleep, water, exercise, and steps.      */
/* ------------------------------------------------------------------ */

const GOAL_METRICS = METRICS.filter((m) => m.id !== "blood_glucose");

function GoalsEditor({
  goals,
  focus,
  onClose,
  onSaved,
}: {
  goals: Goal[];
  focus: Metric | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(goals.map((g) => [g.metric, String(g.target_value)])),
  );
  const [saving, setSaving] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savedTick, setSavedTick] = useState<string | null>(null);
  const goalFor = (m: Metric) => goals.find((g) => g.metric === m);

  async function save(metric: Metric) {
    const def = GOAL_METRICS.find((m) => m.id === metric)!;
    const v = parseFloat(values[metric] ?? "");
    if (!Number.isFinite(v) || v <= 0) {
      setErrors((e) => ({ ...e, [metric]: "Enter a goal number, like 8000." }));
      return;
    }
    setSaving(metric);
    setErrors((e) => ({ ...e, [metric]: "" }));
    try {
      const res = await fetch("/api/health/goals", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ metric, target_value: v, unit: def.unit }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof body?.error === "string" ? body.error : "Couldn't save that goal.",
        );
      }
      setSavedTick(metric);
      onSaved();
      setTimeout(() => setSavedTick(null), 1500);
    } catch (err) {
      setErrors((e) => ({
        ...e,
        [metric]: err instanceof Error ? err.message : "Couldn't save that goal.",
      }));
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Edit health goals">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl border border-line bg-panel p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-star">🎯 Your goals</h3>
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
        <p className="mt-1 text-sm text-stardust">
          Targets, not report cards. Set one where it helps and skip the rest.
        </p>

        <div className="mt-4 space-y-3">
          {GOAL_METRICS.map((m) => {
            const goal = goalFor(m.id);
            const isFocus = focus === m.id;
            return (
              <div
                key={m.id}
                className={`rounded-2xl border p-4 ${isFocus ? "border-neon-cyan/50 bg-neon-cyan/5" : "border-line bg-panel-2/40"}`}
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-star">
                    <span aria-hidden="true" className="mr-2">{m.icon}</span>
                    {m.label}
                  </p>
                  {savedTick === m.id ? (
                    <span className="text-sm text-neon-green">Saved ✓</span>
                  ) : (
                    <p className="text-xs text-dim">
                      {goal ? `Now: ${goal.target_value} ${goal.unit}` : "No goal yet"}
                    </p>
                  )}
                </div>
                <div className="mt-3 flex gap-2">
                  <input
                    value={values[m.id] ?? ""}
                    onChange={(e) => setValues((v) => ({ ...v, [m.id]: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") save(m.id);
                    }}
                    inputMode="decimal"
                    placeholder={goal ? String(goal.target_value) : `e.g. ${m.id === "steps" ? "8000" : m.id === "sleep" ? "8" : m.id === "water" ? "8" : m.id === "exercise" ? "30" : "170"}`}
                    aria-label={`${m.label} goal`}
                    className="min-w-0 flex-1 rounded-xl border border-line bg-panel-2 px-4 py-2.5 text-star placeholder:text-dim focus:border-neon-green/60 focus:outline-none"
                  />
                  <span className="flex items-center px-1 text-sm text-dim">{m.unit}</span>
                  <button
                    type="button"
                    onClick={() => save(m.id)}
                    disabled={saving === m.id}
                    className="rounded-xl border border-neon-green/40 bg-neon-green/10 px-5 text-sm font-semibold text-neon-green transition-colors hover:bg-neon-green/20 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {saving === m.id ? "Saving…" : goal ? "Update" : "Set"}
                  </button>
                </div>
                {errors[m.id] && <p className="mt-2 text-sm text-red-300">{errors[m.id]}</p>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Glucose trend view — readings chart with ADA reference bands,       */
/* estimated A1C, lab A1C history, and the medical disclaimer.        */
/* ------------------------------------------------------------------ */

interface GlucoseReading {
  logged_at: string;
  value: number;
  context: string;
}

interface A1CData {
  estimated_a1c: number | null;
  enough_data: boolean;
  min_days: number;
  estimated_from: {
    avg_glucose_mg_dl: number;
    days_of_data: number;
    readings_count: number;
    window_days: number;
  } | null;
  lab_results: { id: string; value: number; logged_at: string; lab_name: string | null }[];
}

function GlucoseTrendView({ onClose }: { onClose: () => void }) {
  const [readings, setReadings] = useState<GlucoseReading[]>([]);
  const [a1c, setA1c] = useState<A1CData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showLabForm, setShowLabForm] = useState(false);
  const [editingLab, setEditingLab] = useState<{ id: string; value: number; logged_at: string; lab_name: string | null } | null>(null);
  const [deletingLab, setDeletingLab] = useState<string | null>(null);
  const [labBusy, setLabBusy] = useState(false);
  const [labActionError, setLabActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [trendRes, a1cRes] = await Promise.all([
        fetch("/api/health/trends?metric=blood_glucose&period=30d", { cache: "no-store" }),
        fetch("/api/health/a1c", { cache: "no-store" }),
      ]);
      const trendBody = await trendRes.json().catch(() => ({}));
      const a1cBody = await a1cRes.json().catch(() => ({}));
      if (!trendRes.ok) {
        throw new Error(typeof trendBody?.error === "string" ? trendBody.error : "The trend didn't load.");
      }
      if (!a1cRes.ok) {
        throw new Error(typeof a1cBody?.error === "string" ? a1cBody.error : "The A1C estimate didn't load.");
      }
      setReadings(trendBody.readings ?? []);
      setA1c(a1cBody);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The trend didn't load.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });

  async function deleteLab(id: string) {
    setLabBusy(true);
    setLabActionError(null);
    try {
      const res = await fetch(`/api/health/logs/${id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof body?.error === "string" ? body.error : "Couldn't delete that result.",
        );
      }
      setDeletingLab(null);
      load();
    } catch (err) {
      setLabActionError(err instanceof Error ? err.message : "Couldn't delete that result.");
    } finally {
      setLabBusy(false);
    }
  }

  // Chart geometry: keep the reference bands in view even with few readings.
  const values = readings.map((r) => r.value);
  const lo = Math.min(60, ...(values.length > 0 ? values : [60]));
  const hi = Math.max(220, ...(values.length > 0 ? values : [220]));
  const span = Math.max(hi - lo, 1);
  const yOf = (v: number) => 128 - ((v - lo) / span) * 112;
  const xOf = (i: number) => 14 + (i / Math.max(readings.length - 1, 1)) * 272;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label="Blood sugar trend">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl border border-line bg-panel p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-star">🩸 Blood sugar — 30 days</h3>
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

        {/* Disclaimer — always visible on this surface */}
        <p className="mt-3 rounded-xl border border-amber-300/30 bg-amber-300/5 px-4 py-3 text-xs leading-relaxed text-amber-200/90">
          {GLUCOSE_DISCLAIMER}
        </p>

        {error ? (
          <p className="py-6 text-center text-sm text-stardust">{error}</p>
        ) : loading ? (
          <div className="mt-4 h-40 animate-pulse rounded-xl bg-panel-2/60" />
        ) : readings.length === 0 ? (
          <p className="py-6 text-center text-sm text-stardust">
            No readings yet — log your blood sugar and the trend will appear here.
          </p>
        ) : (
          <div className="mt-4">
            <svg viewBox="0 0 300 140" className="w-full" role="img" aria-label="Blood sugar readings with reference bands">
              {/* Fasting reference band 80–130 */}
              <rect x="10" y={yOf(GLUCOSE_REF.fastingBand[1])} width="280"
                height={yOf(GLUCOSE_REF.fastingBand[0]) - yOf(GLUCOSE_REF.fastingBand[1])}
                fill="#5eead4" opacity="0.08" />
              {/* Post-meal reference line 180 */}
              <line x1="10" y1={yOf(GLUCOSE_REF.postMealLine)} x2="290" y2={yOf(GLUCOSE_REF.postMealLine)}
                stroke="#fcd34d" strokeWidth="1" strokeDasharray="5 4" opacity="0.6" />
              <polyline
                points={readings.map((r, i) => `${xOf(i)},${yOf(r.value)}`).join(" ")}
                fill="none" stroke="#fca5a5" strokeWidth="2" opacity="0.7"
              />
              {readings.map((r, i) => (
                <circle key={`${r.logged_at}-${i}`} cx={xOf(i)} cy={yOf(r.value)} r="3.5" fill="#fca5a5">
                  <title>{`${r.value} mg/dL — ${glucoseContextLabel(r.context)}, ${fmtDate(r.logged_at)}`}</title>
                </circle>
              ))}
            </svg>
            <div className="mt-1 space-y-1 text-xs text-dim">
              <p>
                <span className="inline-block h-2 w-4 rounded-sm bg-neon-cyan/30 align-middle" />{" "}
                Typical fasting reference: 80–130 mg/dL
              </p>
              <p>
                <span className="inline-block h-0 w-4 border-t-2 border-dashed border-amber-300/70 align-middle" />{" "}
                Post-meal reference: under 180 mg/dL
              </p>
              <p className="pt-1">
                General reference ranges from the American Diabetes Association — not your personal
                targets. Ask your doctor what&apos;s right for you.
              </p>
            </div>
          </div>
        )}

        {/* Estimated A1C */}
        <div className="mt-5 rounded-2xl border border-line bg-panel-2/60 p-4">
          <p className="text-xs font-medium uppercase tracking-wider text-dim">Estimated A1C</p>
          {!a1c || loading ? (
            <div className="mt-2 h-8 animate-pulse rounded bg-panel-2" />
          ) : a1c.enough_data && a1c.estimated_a1c !== null ? (
            <div className="mt-1">
              <p className="text-3xl font-semibold text-star">
                {a1c.estimated_a1c}<span className="text-lg text-dim">%</span>
              </p>
              <p className="mt-1 text-xs text-dim">
                Estimated from your average of {a1c.estimated_from?.avg_glucose_mg_dl} mg/dL across{" "}
                {a1c.estimated_from?.days_of_data} days of readings. This is an estimate, not a lab result.
              </p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-stardust">
              Not enough readings yet — log blood sugar on at least {a1c.min_days} different days
              and your estimated A1C will appear here.
              {a1c.estimated_from && a1c.estimated_from.days_of_data > 0 && (
                <> You have {a1c.estimated_from.days_of_data} day{a1c.estimated_from.days_of_data === 1 ? "" : "s"} so far.</>
              )}
            </p>
          )}
        </div>

        {/* Lab A1C results */}
        <div className="mt-4">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wider text-dim">Lab results</p>
            <button
              type="button"
              onClick={() => setShowLabForm((s) => !s)}
              className="text-sm text-neon-cyan hover:underline"
            >
              {showLabForm ? "Cancel" : "+ Log a lab result"}
            </button>
          </div>
          {showLabForm && (
            <LabA1CForm
              onSaved={() => {
                setShowLabForm(false);
                load();
              }}
              onCancel={() => setShowLabForm(false)}
            />
          )}
          {editingLab && (
            <LabA1CForm
              initial={editingLab}
              onSaved={() => {
                setEditingLab(null);
                load();
              }}
              onCancel={() => setEditingLab(null)}
            />
          )}
          {labActionError && <p className="mt-2 text-sm text-red-300">{labActionError}</p>}
          <div className="mt-2 space-y-2">
            {(a1c?.lab_results ?? []).length === 0 && !loading && (
              <p className="text-xs text-dim">No lab results logged yet.</p>
            )}
            {(a1c?.lab_results ?? []).map((l) => (
              <div key={l.id} className="rounded-xl border border-neon-cyan/25 bg-neon-cyan/5 px-4 py-2.5">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="mr-2 rounded-md bg-neon-cyan/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-neon-cyan">
                      Lab
                    </span>
                    <span className="text-lg font-semibold text-star">{l.value}%</span>
                  </div>
                  <p className="text-xs text-dim">
                    {fmtDate(l.logged_at)}{l.lab_name ? ` · ${l.lab_name}` : ""}
                  </p>
                </div>
                {deletingLab === l.id ? (
                  <div className="mt-2 flex items-center justify-end gap-2">
                    <span className="text-xs text-stardust">Delete this result?</span>
                    <button
                      type="button"
                      onClick={() => deleteLab(l.id)}
                      disabled={labBusy}
                      className="rounded-lg border border-red-300/50 bg-red-300/10 px-3 py-1 text-xs font-medium text-red-300 disabled:opacity-40"
                    >
                      {labBusy ? "Deleting…" : "Yes, delete"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDeletingLab(null)}
                      disabled={labBusy}
                      className="rounded-lg border border-line px-3 py-1 text-xs text-dim disabled:opacity-40"
                    >
                      Keep
                    </button>
                  </div>
                ) : (
                  <div className="mt-1 flex justify-end gap-3">
                    <button
                      type="button"
                      onClick={() => {
                        setDeletingLab(null);
                        setEditingLab(l);
                      }}
                      className="text-xs text-neon-cyan hover:underline"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setEditingLab(null);
                        setDeletingLab(l.id);
                      }}
                      className="text-xs text-red-300/80 hover:underline"
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <p className="mt-4 text-xs text-dim">
          Your health data stays yours — it&apos;s never shared, and support can&apos;t see it.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Lab A1C entry form                                                  */
/* ------------------------------------------------------------------ */

function LabA1CForm({
  initial,
  onSaved,
  onCancel,
}: {
  initial?: { id: string; value: number; logged_at: string; lab_name: string | null };
  onSaved: () => void;
  onCancel?: () => void;
}) {
  const [value, setValue] = useState(initial ? String(initial.value) : "");
  const [date, setDate] = useState(() =>
    initial ? initial.logged_at.slice(0, 10) : new Date().toISOString().slice(0, 10),
  );
  const [labName, setLabName] = useState(initial?.lab_name ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const v = parseFloat(value);
    if (!Number.isFinite(v)) {
      setError("Enter your A1C as a number, like 6.5.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        value: v,
        logged_at: new Date(date + "T12:00:00").toISOString(),
        meta: labName.trim() ? { lab_name: labName.trim() } : {},
      };
      const res = initial
        ? await fetch(`/api/health/logs/${initial.id}`, {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          })
        : await fetch("/api/health/log", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ metric: "a1c_lab", unit: "%", ...payload }),
          });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body?.error === "string" ? body.error : "Couldn't save that.");
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save that.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mt-2 space-y-3 rounded-2xl border border-line bg-panel-2/40 p-4">
      {initial && <p className="text-sm font-medium text-star">Correct this lab result</p>}
      <div className="flex gap-2">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          inputMode="decimal"
          placeholder="e.g. 6.5"
          aria-label="Lab A1C value"
          className="min-w-0 flex-1 rounded-xl border border-line bg-panel-2 px-4 py-2.5 text-xl text-star placeholder:text-dim focus:border-neon-green/60 focus:outline-none"
        />
        <span className="flex items-center px-2 text-sm text-dim">%</span>
      </div>
      <div className="flex gap-2">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-label="Lab test date"
          className="flex-1 rounded-xl border border-line bg-panel-2 px-4 py-2.5 text-sm text-star focus:border-neon-green/60 focus:outline-none"
        />
        <input
          value={labName}
          onChange={(e) => setLabName(e.target.value)}
          placeholder="Lab name (optional)"
          aria-label="Lab name"
          className="flex-1 rounded-xl border border-line bg-panel-2 px-4 py-2.5 text-sm text-star placeholder:text-dim focus:border-neon-green/60 focus:outline-none"
        />
      </div>
      {error && <p className="text-sm text-red-300">{error}</p>}
      <div className="flex gap-2">
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-xl border border-line py-2.5 text-sm font-medium text-dim transition-colors hover:text-star"
          >
            Cancel
          </button>
        )}
        <button
          type="button"
          onClick={save}
          disabled={saving || !value.trim()}
          className="flex-1 rounded-xl border border-neon-green/40 bg-neon-green/10 py-2.5 text-sm font-semibold text-neon-green transition-colors hover:bg-neon-green/20 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "Saving…" : initial ? "Save changes" : "Save lab result"}
        </button>
      </div>
    </div>
  );
}

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

/* ------------------------------------------------------------------ */
/* Entries view — the recent entries for one metric, with edit (PATCH) */
/* and delete (DELETE). Mis-typed entries get corrected here.          */
/* ------------------------------------------------------------------ */

interface LogEntry {
  id: string;
  metric: Metric;
  value: number;
  unit: string;
  meta: Record<string, unknown>;
  logged_at: string;
}

function EntriesView({
  metric,
  onClose,
  onChanged,
}: {
  metric: Metric;
  onClose: () => void;
  onChanged: () => void;
}) {
  const def = METRICS.find((m) => m.id === metric)!;
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editError, setEditError] = useState<string | null>(null);
  const [editSaving, setEditSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const fetchEntries = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/health/logs?metric=${metric}&limit=50`, {
        cache: "no-store",
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof body?.error === "string" ? body.error : "Those entries didn't load.",
        );
      }
      setEntries(body.logs ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Those entries didn't load.");
    } finally {
      setLoading(false);
    }
  }, [metric]);

  useEffect(() => {
    (async () => {
      await fetchEntries();
    })();
  }, [fetchEntries]);

  function startEdit(entry: LogEntry) {
    setEditingId(entry.id);
    setEditValue(String(entry.value));
    setEditDate(toLocalInput(entry.logged_at));
    setEditError(null);
    setDeletingId(null);
  }

  async function saveEdit(id: string) {
    const v = parseFloat(editValue);
    if (!Number.isFinite(v)) {
      setEditError("Enter a number.");
      return;
    }
    const dt = new Date(editDate);
    if (!editDate || Number.isNaN(dt.getTime())) {
      setEditError("Pick a date and time.");
      return;
    }
    setEditSaving(true);
    setEditError(null);
    try {
      const res = await fetch(`/api/health/logs/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: v, logged_at: dt.toISOString() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof body?.error === "string" ? body.error : "Couldn't save that change.",
        );
      }
      setEditingId(null);
      onChanged();
      await fetchEntries();
    } catch (err) {
      setEditError(err instanceof Error ? err.message : "Couldn't save that change.");
    } finally {
      setEditSaving(false);
    }
  }

  async function confirmDelete(id: string) {
    setDeleteBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/health/logs/${id}`, { method: "DELETE" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(
          typeof body?.error === "string" ? body.error : "Couldn't delete that entry.",
        );
      }
      setDeletingId(null);
      onChanged();
      await fetchEntries();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Couldn't delete that entry.");
    } finally {
      setDeleteBusy(false);
    }
  }

  const contextOf = (e: LogEntry) =>
    e.metric === "blood_glucose" && typeof e.meta.context === "string"
      ? glucoseContextLabel(e.meta.context)
      : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`${def.label} entries`}
    >
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-3xl border border-line bg-panel p-6">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-star">
            {def.icon} {def.label} — past entries
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
          <div className="py-6 text-center">
            <p className="text-sm text-stardust">{error}</p>
            <button
              type="button"
              onClick={() => {
                setLoading(true);
                fetchEntries();
              }}
              className="mt-2 rounded-xl border border-neon-cyan/40 bg-neon-cyan/10 px-4 py-2 text-sm font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/20"
            >
              Try again
            </button>
          </div>
        ) : loading ? (
          <div className="mt-4 space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-16 animate-pulse rounded-xl bg-panel-2/60" />
            ))}
          </div>
        ) : entries.length === 0 ? (
          <p className="py-6 text-center text-sm text-stardust">
            No entries yet — log {def.label.toLowerCase()} and they&apos;ll show up here.
          </p>
        ) : (
          <div className="mt-4 space-y-2">
            {actionError && <p className="text-sm text-red-300">{actionError}</p>}
            {entries.map((e) => (
              <div
                key={e.id}
                className="rounded-xl border border-line bg-panel-2/40 px-4 py-3"
              >
                {editingId === e.id ? (
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <input
                        value={editValue}
                        onChange={(ev) => setEditValue(ev.target.value)}
                        inputMode="decimal"
                        aria-label="Corrected value"
                        className="min-w-0 flex-1 rounded-xl border border-line bg-panel-2 px-3 py-2 text-star focus:border-neon-green/60 focus:outline-none"
                      />
                      <span className="flex items-center text-sm text-dim">{e.unit}</span>
                    </div>
                    <input
                      type="datetime-local"
                      value={editDate}
                      onChange={(ev) => setEditDate(ev.target.value)}
                      aria-label="Corrected date and time"
                      className="w-full rounded-xl border border-line bg-panel-2 px-3 py-2 text-sm text-star focus:border-neon-green/60 focus:outline-none"
                    />
                    {editError && <p className="text-sm text-red-300">{editError}</p>}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="flex-1 rounded-xl border border-line py-2 text-sm text-dim transition-colors hover:text-star"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={() => saveEdit(e.id)}
                        disabled={editSaving}
                        className="flex-1 rounded-xl border border-neon-green/40 bg-neon-green/10 py-2 text-sm font-semibold text-neon-green transition-colors hover:bg-neon-green/20 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {editSaving ? "Saving…" : "Save changes"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-star">
                        {e.value} {e.unit}
                        {contextOf(e) && (
                          <span className="ml-2 rounded-md bg-panel px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-dim">
                            {contextOf(e)}
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-dim">{fmtEntryDate(e.logged_at)}</p>
                    </div>
                    {deletingId === e.id ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => confirmDelete(e.id)}
                          disabled={deleteBusy}
                          className="rounded-lg border border-red-300/50 bg-red-300/10 px-3 py-1.5 text-xs font-medium text-red-300 disabled:opacity-40"
                        >
                          {deleteBusy ? "Deleting…" : "Yes, delete"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingId(null)}
                          disabled={deleteBusy}
                          className="rounded-lg border border-line px-3 py-1.5 text-xs text-dim disabled:opacity-40"
                        >
                          Keep
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={() => startEdit(e)}
                          className="text-xs text-neon-cyan hover:underline"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeletingId(e.id)}
                          className="text-xs text-red-300/80 hover:underline"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
