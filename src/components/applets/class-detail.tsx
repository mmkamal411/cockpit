"use client";

import { useEffect, useMemo, useState } from "react";

interface Assignment {
  title: string;
  due: string | null;
  due_label: string;
  score: number | null;
  percent: number | null;
  category: string | null;
  notes: string;
}

interface ClassInfo {
  name: string;
  grade: number | null;
  letter: string | null;
  gap_to_90: number | null;
  teacher: string | null;
  period: string | null;
  has_category_weights: boolean;
  categories: Record<string, unknown>;
}

interface ClassDetailPayload {
  class: ClassInfo | null;
  missing: Assignment[];
  upcoming: Assignment[];
  recent: Assignment[];
  synced_at: string | null;
  stale?: boolean;
  hours_since_sync?: number | null;
  message?: string;
}

interface CheckRow {
  action_id: string;
  checked: boolean;
}

interface PathAction {
  id: string;
  text: string;
  sub?: string;
}

/** URL-safe slug for stable action IDs. */
function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function gradeTone(grade: number | null): string {
  if (grade === null) return "text-dim";
  if (grade >= 90) return "text-neon-green";
  if (grade >= 80) return "text-star";
  if (grade >= 74) return "text-neon-amber";
  return "text-red-400";
}

/**
 * ClassDetail — one class's full picture. Opens from the member detail
 * class list. Leads with the gap-to-90 mission (shame-free), then the top 3
 * ranked actions with checkboxes that persist to Supabase (path_to_90_checks
 * via the path-to-90 API — never localStorage).
 */
export function ClassDetail({
  memberId,
  className,
  onBack,
}: {
  memberId: string;
  className: string;
  onBack: () => void;
}) {
  const [data, setData] = useState<ClassDetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [checksError, setChecksError] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setLoadError("");
      try {
        const res = await fetch(
          `/api/crew/members/${memberId}/class-detail?class=${encodeURIComponent(className)}`,
        );
        const json: ClassDetailPayload = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setLoadError(
            (json as unknown as { error?: string }).error ??
              "Couldn't open this class right now.",
          );
          return;
        }
        setData(json);
        // Load persisted checkbox state.
        try {
          const cRes = await fetch(
            `/api/crew/members/${memberId}/path-to-90?class=${encodeURIComponent(json.class?.name ?? className)}`,
          );
          if (cRes.ok) {
            const cJson = await cRes.json();
            const map: Record<string, boolean> = {};
            for (const row of (cJson.checks ?? []) as CheckRow[]) {
              map[row.action_id] = row.checked;
            }
            if (!cancelled) setChecks(map);
          }
        } catch {
          if (!cancelled) setChecksError("Checklist state couldn't load — checks won't save right now.");
        }
      } catch {
        if (!cancelled)
          setLoadError(
            "We couldn't reach the server. Check your connection and try again.",
          );
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [memberId, className]);

  /** Data-driven top-3 actions, ranked by impact. */
  const actions: PathAction[] = useMemo(() => {
    if (!data?.class) return [];
    const out: PathAction[] = [];
    const missing = data.missing;
    const upcoming = data.upcoming;
    const recent = data.recent;
    const grade = data.class.grade;
    const teacher = data.class.teacher;

    if (missing.length > 0) {
      const m = missing[0];
      out.push({
        id: `missing:${slug(m.title)}`,
        text: `Turn in "${m.title}"`,
        sub: `Due ${m.due_label} — missing work is the fastest way to move the grade.`,
      });
    }
    if (upcoming.length > 0 && out.length < 3) {
      const u = upcoming[0];
      out.push({
        id: `upcoming:${slug(u.title)}`,
        text: `Get ahead on "${u.title}"`,
        sub: `Due ${u.due_label}${u.category ? ` · ${u.category}` : ""} — start before it's urgent.`,
      });
    }
    if (out.length < 3) {
      if (grade !== null && grade < 74 && teacher) {
        out.push({
          id: "ask-teacher-makeup",
          text: `Ask ${teacher} about makeup or extra credit`,
          sub: "One short, polite email can unlock points that are sitting on the table.",
        });
      } else if (recent.length > 0) {
        const lowest = [...recent].sort(
          (a, b) => (a.score ?? 0) - (b.score ?? 0),
        )[0];
        out.push({
          id: `review:${slug(lowest.title)}`,
          text: `Review "${lowest.title}"`,
          sub: `Scored ${lowest.score} — find the 2–3 questions that cost the most and redo them.`,
        });
      } else {
        out.push({
          id: "stay-ahead",
          text: "Stay ahead — preview next week's work",
          sub: "Read the next unit's intro so class time is review, not first contact.",
        });
      }
    }
    return out.slice(0, 3);
  }, [data]);

  async function toggleCheck(actionId: string) {
    const next = !checks[actionId];
    setChecks((prev) => ({ ...prev, [actionId]: next }));
    setSavingId(actionId);
    setChecksError("");
    try {
      const res = await fetch(`/api/crew/members/${memberId}/path-to-90`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          class_name: data?.class?.name ?? className,
          action_id: actionId,
          checked: next,
          checked_by: "pilot",
        }),
      });
      if (!res.ok) {
        throw new Error();
      }
    } catch {
      // Roll back the optimistic toggle.
      setChecks((prev) => ({ ...prev, [actionId]: !next }));
      setChecksError("Couldn't save that checkbox. Try again.");
    } finally {
      setSavingId(null);
    }
  }

  if (loading) {
    return (
      <div className="space-y-5" aria-busy="true">
        <button
          type="button"
          onClick={onBack}
          className="mb-1 flex items-center gap-1.5 text-sm text-stardust transition-colors hover:text-star"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Back to classes
        </button>
        <p className="text-sm text-stardust">Opening {className}…</p>
      </div>
    );
  }

  if (loadError || !data?.class) {
    return (
      <div className="space-y-5">
        <button
          type="button"
          onClick={onBack}
          className="mb-1 flex items-center gap-1.5 text-sm text-stardust transition-colors hover:text-star"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Back to classes
        </button>
        <div
          role="alert"
          className="rounded-xl border border-neon-amber/30 bg-neon-amber/5 px-4 py-4"
        >
          <p className="text-sm font-medium text-star">
            This class wouldn&apos;t open
          </p>
          <p className="mt-1 text-sm leading-relaxed text-stardust">
            {loadError || data?.message || "Something went wrong loading the class."}
          </p>
          <button
            type="button"
            onClick={onBack}
            className="mt-3 rounded-xl border border-neon-green/40 bg-neon-green/10 px-4 py-2 text-sm font-medium text-neon-green transition-colors hover:bg-neon-green/20"
          >
            Back to the class list
          </button>
        </div>
      </div>
    );
  }

  const c = data.class;
  const gap = c.gap_to_90;
  const atGoal = gap === 0;

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={onBack}
        className="mb-1 flex items-center gap-1.5 text-sm text-stardust transition-colors hover:text-star"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M15 18l-6-6 6-6" />
        </svg>
        Back to classes
      </button>

      {/* Mission header — gap to 90 first, shame-free */}
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-neon-green">
          {atGoal ? "On target" : "Mission"}
        </p>
        <h2 className="mt-1 text-xl font-semibold text-star">{c.name}</h2>
        <p className="mt-1 text-sm leading-relaxed text-stardust">
          {gap === null
            ? "No grade posted yet for this class."
            : atGoal
              ? "At or above 90 — the mission now is holding the line."
              : `${gap.toFixed(1)} points to 90. Every point below is recoverable — here's the path.`}
        </p>
      </div>

      {/* Grade hero: numeric + letter side by side, separated by lines */}
      <div className="flex items-stretch rounded-xl border border-line bg-panel-2/60">
        <div className="flex flex-1 flex-col items-center justify-center px-4 py-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-dim">
            Current grade
          </p>
          <p className={`mt-1 text-3xl font-bold ${gradeTone(c.grade)}`}>
            {c.grade !== null ? c.grade.toFixed(1) : "—"}
          </p>
        </div>
        <div className="w-px bg-line" aria-hidden="true" />
        <div className="flex flex-1 flex-col items-center justify-center px-4 py-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-dim">
            Letter
          </p>
          <p className={`mt-1 text-3xl font-bold ${gradeTone(c.grade)}`}>
            {c.letter ?? "—"}
          </p>
        </div>
        <div className="w-px bg-line" aria-hidden="true" />
        <div className="flex flex-1 flex-col items-center justify-center px-4 py-4">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-dim">
            To 90
          </p>
          <p className={`mt-1 text-3xl font-bold ${atGoal ? "text-neon-green" : "text-neon-amber"}`}>
            {gap === null ? "—" : atGoal ? "✓" : gap.toFixed(1)}
          </p>
        </div>
      </div>

      {/* Path to 90 — top 3 ranked actions */}
      <div className="space-y-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-neon-green">
          Path to 90 · top 3
        </p>
        {checksError && (
          <p role="alert" className="text-xs text-neon-amber">{checksError}</p>
        )}
        {actions.length === 0 ? (
          <p className="rounded-xl border border-line bg-panel-2/60 px-4 py-3 text-sm text-dim">
            No actions right now — the next sync may bring new work.
          </p>
        ) : (
          actions.map((a, i) => {
            const checked = !!checks[a.id];
            const saving = savingId === a.id;
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => toggleCheck(a.id)}
                disabled={saving}
                aria-pressed={checked}
                className={`flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition-colors disabled:opacity-60 ${
                  checked
                    ? "border-neon-green/40 bg-neon-green/10"
                    : "border-line bg-panel-2/60 hover:border-neon-green/30"
                }`}
              >
                <span
                  aria-hidden="true"
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors ${
                    checked
                      ? "border-neon-green bg-neon-green/25 text-neon-green"
                      : "border-dim/60 text-transparent"
                  }`}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 12.5l5 5L20 6.5" />
                  </svg>
                </span>
                <span className="min-w-0">
                  <span className={`block text-sm font-medium ${checked ? "text-dim line-through" : "text-star"}`}>
                    <span className="mr-1.5 text-xs font-bold text-neon-green">{i + 1}</span>
                    {a.text}
                  </span>
                  {a.sub && (
                    <span className="mt-0.5 block text-xs leading-relaxed text-dim">
                      {a.sub}
                    </span>
                  )}
                </span>
              </button>
            );
          })
        )}
      </div>

      {/* Missing assignments */}
      <div className="space-y-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-neon-amber">
          Missing · {data.missing.length}
        </p>
        {data.missing.length === 0 ? (
          <p className="rounded-xl border border-line bg-panel-2/60 px-4 py-3 text-sm text-dim">
            Nothing missing — nice. Keeping it that way is the whole game.
          </p>
        ) : (
          data.missing.map((a, i) => (
            <div
              key={`m-${i}-${a.title}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-neon-amber/25 bg-neon-amber/5 px-4 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-star">{a.title}</p>
                <p className="text-xs text-dim">
                  Due {a.due_label}
                  {a.category ? ` · ${a.category}` : ""}
                </p>
              </div>
              <span className="shrink-0 rounded-md border border-neon-amber/40 px-2 py-0.5 text-xs font-medium text-neon-amber">
                Missing
              </span>
            </div>
          ))
        )}
      </div>

      {/* Upcoming assignments */}
      <div className="space-y-2">
        <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-dim">
          Coming up · {data.upcoming.length}
        </p>
        {data.upcoming.length === 0 ? (
          <p className="rounded-xl border border-line bg-panel-2/60 px-4 py-3 text-sm text-dim">
            Nothing on the calendar — enjoy the quiet, or get ahead.
          </p>
        ) : (
          data.upcoming.map((a, i) => (
            <div
              key={`u-${i}-${a.title}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-line bg-panel-2/60 px-4 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-star">{a.title}</p>
                <p className="text-xs text-dim">
                  Due {a.due_label}
                  {a.category ? ` · ${a.category}` : ""}
                </p>
              </div>
              <span className="shrink-0 text-xs text-dim">{a.due_label}</span>
            </div>
          ))
        )}
      </div>

      {/* Recent graded work */}
      {data.recent.length > 0 && (
        <div className="space-y-2">
          <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-dim">
            Recently graded
          </p>
          {data.recent.map((a, i) => (
            <div
              key={`r-${i}-${a.title}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-line bg-panel-2/40 px-4 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-stardust">{a.title}</p>
                <p className="text-xs text-dim">
                  {a.due_label}
                  {a.category ? ` · ${a.category}` : ""}
                </p>
              </div>
              <span className={`shrink-0 text-sm font-semibold ${gradeTone(a.score)}`}>
                {a.score !== null ? a.score.toFixed(0) : "—"}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Teacher */}
      <div className="rounded-xl border border-line bg-panel-2/60 px-4 py-3">
        <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-dim">
          Teacher
        </p>
        <p className="mt-1 text-sm text-star">
          {c.teacher ?? "Not listed in the latest sync."}
        </p>
        {c.period && (
          <p className="mt-0.5 text-xs text-dim">Period {c.period}</p>
        )}
      </div>

      {data.synced_at && (
        <p className="text-xs text-dim">
          Synced {new Date(data.synced_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          {" at "}
          {new Date(data.synced_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
        </p>
      )}
      {data.stale && data.hours_since_sync !== null && data.hours_since_sync !== undefined && (
        <p
          role="alert"
          className="rounded-xl border border-neon-amber/30 bg-neon-amber/5 px-4 py-2.5 text-sm text-neon-amber"
        >
          These grades are{" "}
          {data.hours_since_sync >= 48
            ? `${Math.round(data.hours_since_sync / 24)} days`
            : `${data.hours_since_sync} hours`}{" "}
          old. Sync the school login for the latest numbers.
        </p>
      )}
    </div>
  );
}
