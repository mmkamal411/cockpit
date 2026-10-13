"use client";

import { useEffect, useMemo, useState } from "react";
import {
  buildPathActions,
  computeOpportunities,
  bandForGrade,
  gradeHex,
  gapCopy,
  COOLDOWN_COPY,
  type PathAssignment,
  type CategoryDatum,
  type PathAction,
} from "@/lib/path-to-90";
import {
  flaggedTopics,
  checkinText,
  type CheckinRow,
} from "@/lib/checkin-topics";
import { peerTipsFor } from "@/lib/peer-tips";
import { CheckinFlow, type SavedCheckin } from "@/components/checkin-flow";
import { ClassResources } from "@/components/class-resources";

interface Assignment {
  title: string;
  due: string | null;
  due_label: string;
  due_date?: string | null;
  score: number | null;
  percent: number | null;
  max_points: number | null;
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
  graded: Assignment[];
  synced_at: string | null;
  message?: string;
}

interface CheckRow {
  action_id: string;
  checked: boolean;
}

interface ManualMissingItem {
  id: string;
  title: string;
  category: string | null;
}

/** URL-safe slug for stable action IDs. */
function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = parseFloat(value.replace("%", ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Normalize a sync assignment to a 0–100 percent, or null when unknown. */
function pctOf(a: Assignment): number | null {
  if (a.percent !== null && Number.isFinite(a.percent)) {
    return Math.max(0, Math.min(100, a.percent));
  }
  if (a.score !== null && a.max_points && a.max_points > 0) {
    return Math.max(0, Math.min(100, (a.score / a.max_points) * 100));
  }
  if (a.score !== null && a.score >= 0 && a.score <= 100) return a.score;
  return null;
}

/** Amber ramp, never red — grade numbers inherit the hard design token. */
function gradeTone(grade: number | null): string {
  if (grade === null) return "text-dim";
  if (grade >= 90) return "text-neon-green";
  if (grade >= 80) return "text-star";
  if (grade >= 74) return "text-neon-amber";
  return "text-neon-amber";
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function titleCase(s: string): string {
  return s.replace(/\w\S*/g, (w) => w[0].toUpperCase() + w.slice(1));
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
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
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-neon-green">
      {children}
    </p>
  );
}

/** Native details/summary collapse — details on demand, never a data dump. */
function Collapsible({
  title,
  children,
  defaultOpen = false,
}: {
  title: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  return (
    <details
      open={defaultOpen}
      className="group rounded-xl border border-line bg-panel-2/40"
    >
      <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-stardust transition-colors hover:text-star [&::-webkit-details-marker]:hidden">
        <span className="mr-2 inline-block text-xs transition-transform group-open:rotate-90" aria-hidden="true">
          ▶
        </span>
        {title}
      </summary>
      <div className="space-y-3 border-t border-line px-4 py-4">{children}</div>
    </details>
  );
}

/** Comeback sparkline — grade trajectory, oldest to newest. */
function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) {
    return (
      <p className="text-xs text-dim">
        The trajectory line appears once a few grades are in.
      </p>
    );
  }
  const w = 220;
  const h = 44;
  const min = Math.min(...points, 70);
  const max = Math.max(...points, 100);
  const span = Math.max(1, max - min);
  const step = w / (points.length - 1);
  const coords = points.map(
    (p, i) => `${(i * step).toFixed(1)},${(h - 4 - ((p - min) / span) * (h - 8)).toFixed(1)}`,
  );
  const first = points[0];
  const last = points[points.length - 1];
  const delta = last - first;
  return (
    <div>
      <svg
        width={w}
        height={h}
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label={`Grade trajectory: ${first.toFixed(0)} to ${last.toFixed(0)}`}
        className="w-full"
      >
        <polyline
          points={coords.join(" ")}
          fill="none"
          stroke={gradeHex(last)}
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {coords.map((c, i) => {
          const [x, y] = c.split(",");
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={i === coords.length - 1 ? 4 : 2.5}
              fill={gradeHex(points[i])}
            />
          );
        })}
      </svg>
      <p className="mt-1 text-xs text-dim">
        {delta > 0.05
          ? `Up ${delta.toFixed(1)} across these grades — climbing.`
          : delta < -0.05
            ? `Down ${Math.abs(delta).toFixed(1)} — the plan below is the course correction.`
            : "Holding steady across these grades."}
      </p>
    </div>
  );
}

/**
 * ClassDetail — one class's full picture, in three variants:
 * - crisis (<75): recovery-plan hero; everything else collapsed.
 * - steady (>90): compact "Holding the 90 line"; details collapsed.
 * - middle: the full page — sparkline → This Week → Path-to-90 → tips →
 *   Tonight's ONE → assignments by impact → opportunity bars → What-If →
 *   check-in → words/files divider → Files/Links → Dawson's Word → teacher.
 *
 * Path-to-90 checkboxes are teen-owned; the parent view is read-only
 * (viewerIsChild=false). Check-in text feeds the plan via "You flagged this".
 */
export function ClassDetail({
  memberId,
  className,
  onBack,
  viewerIsChild = false,
  childFirstName,
}: {
  memberId: string;
  className: string;
  onBack: () => void;
  viewerIsChild?: boolean;
  childFirstName?: string;
}) {
  const [data, setData] = useState<ClassDetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [checksError, setChecksError] = useState("");
  const [savingId, setSavingId] = useState<string | null>(null);
  const [checkins, setCheckins] = useState<CheckinRow[]>([]);
  const [checkinsNote, setCheckinsNote] = useState("");
  const [manualMissing, setManualMissing] = useState<ManualMissingItem[]>([]);
  const [manualTitle, setManualTitle] = useState("");
  const [manualCategory, setManualCategory] = useState("");
  const [manualError, setManualError] = useState("");
  const [whatIfTitle, setWhatIfTitle] = useState("");
  const [whatIfScore, setWhatIfScore] = useState(90);

  const firstName = childFirstName?.split(" ")[0] ?? "your child";
  const checkedBy = viewerIsChild ? "crew" : "pilot";

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
        const cls = json.class?.name ?? className;
        // Checkbox state (Supabase — never localStorage).
        try {
          const cRes = await fetch(
            `/api/crew/members/${memberId}/path-to-90?class=${encodeURIComponent(cls)}`,
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
          if (!cancelled)
            setChecksError("Checklist state couldn't load — checks won't save right now.");
        }
        // Recent check-ins → timeline + "You flagged this" wiring.
        try {
          const kRes = await fetch(
            `/api/crew/members/${memberId}/checkins?class=${encodeURIComponent(cls)}&days=14`,
          );
          if (kRes.ok) {
            const kJson = await kRes.json();
            if (!cancelled) setCheckins((kJson.checkins ?? []) as CheckinRow[]);
          } else if (!cancelled) {
            setCheckinsNote("Check-ins will appear here once they're switched on.");
          }
        } catch {
          if (!cancelled) setCheckinsNote("Check-ins will appear here once they're switched on.");
        }
        // Manually logged missing work.
        try {
          const mRes = await fetch(
            `/api/crew/members/${memberId}/manual-missing?class=${encodeURIComponent(cls)}`,
          );
          if (mRes.ok) {
            const mJson = await mRes.json();
            if (!cancelled)
              setManualMissing((mJson.items ?? []) as ManualMissingItem[]);
          }
        } catch {
          /* logger is additive — the page works without it */
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

  /** Per-category weight/average/count from the sync payload + graded work. */
  const categoryData: CategoryDatum[] = useMemo(() => {
    if (!data?.class) return [];
    const raw = data.class.categories ?? {};
    const graded = data.graded ?? [];
    return Object.entries(raw)
      .map(([name, w]) => {
        let weight = toNumber(w) ?? 0;
        if (weight > 0 && weight <= 1) weight = weight * 100; // fraction → percent
        const inCat = graded.filter((a) => a.category === name);
        const pcts = inCat
          .map(pctOf)
          .filter((p): p is number => p !== null);
        return {
          name,
          weight,
          average: pcts.length > 0 ? pcts.reduce((s, p) => s + p, 0) / pcts.length : null,
          gradedCount: pcts.length,
        };
      })
      .filter((c) => c.weight > 0);
  }, [data]);

  /** Topics the child flagged as confusing in the last 7 days of check-ins. */
  const flagged = useMemo(() => flaggedTopics(checkins), [checkins]);

  /** Deterministic Path-to-90 actions — pure math, never an LLM. */
  const actions: PathAction[] = useMemo(() => {
    if (!data) return [];
    const inputs: PathAssignment[] = [];
    for (const a of data.graded ?? []) {
      inputs.push({
        title: a.title,
        score: pctOf(a),
        category: a.category,
      });
    }
    for (const a of data.missing) {
      inputs.push({
        title: a.title,
        score: null,
        category: a.category,
        missing: true,
      });
    }
    for (const m of manualMissing) {
      inputs.push({
        title: m.title,
        score: null,
        category: m.category,
        missing: true,
      });
    }
    return buildPathActions(inputs, categoryData, { flaggedTopics: flagged });
  }, [data, categoryData, manualMissing, flagged]);

  const opportunities = useMemo(
    () => computeOpportunities(categoryData),
    [categoryData],
  );

  /** Zeros first, then other missing — the triage order. */
  const zerosFirst = useMemo(() => {
    if (!data) return [];
    const graded = data.graded ?? [];
    const zeros = graded.filter((a) => pctOf(a) === 0);
    const manual = manualMissing.map((m) => ({
      title: m.title,
      due: null,
      due_label: "logged by you",
      category: m.category,
      score: null,
      percent: null,
      max_points: null,
      notes: "",
      manualId: m.id,
    }));
    return [
      ...zeros.map((a) => ({ ...a, manualId: undefined as string | undefined })),
      ...data.missing,
      ...manual,
    ];
  }, [data, manualMissing]);

  const thisWeek = useMemo(() => {
    if (!data) return [];
    const now = Date.now();
    const week = 7 * 86_400_000;
    return data.upcoming.filter((a) => {
      if (!a.due_date) return false;
      const t = new Date(a.due_date).getTime();
      return t >= now - 86_400_000 && t <= now + week;
    });
  }, [data]);

  const sparkPoints = useMemo(() => {
    const pts = (data?.graded ?? [])
      .map(pctOf)
      .filter((p): p is number => p !== null);
    return pts.slice(-8);
  }, [data]);

  /** Tonight's ONE action — the pick persists via path_to_90_checks. */
  const tonightKeyPrefix = `tonight:${slug(data?.class?.name ?? className)}:`;
  const tonightPickId = useMemo(() => {
    const key = Object.keys(checks).find(
      (k) => k.startsWith(tonightKeyPrefix) && checks[k],
    );
    if (!key) return actions[0]?.id ?? null;
    const picked = key.slice(tonightKeyPrefix.length);
    return actions.some((a) => a.id === picked) ? picked : (actions[0]?.id ?? null);
  }, [checks, actions, tonightKeyPrefix]);
  const tonightAction = actions.find((a) => a.id === tonightPickId) ?? actions[0] ?? null;

  async function persistCheck(actionId: string, checked: boolean) {
    const res = await fetch(`/api/crew/members/${memberId}/path-to-90`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        class_name: data?.class?.name ?? className,
        action_id: actionId,
        checked,
        checked_by: checkedBy,
      }),
    });
    if (!res.ok) throw new Error();
  }

  async function toggleCheck(actionId: string) {
    if (!viewerIsChild) return; // teen owns the checkboxes; parent is read-only
    const next = !checks[actionId];
    setChecks((prev) => ({ ...prev, [actionId]: next }));
    setSavingId(actionId);
    setChecksError("");
    try {
      await persistCheck(actionId, next);
    } catch {
      setChecks((prev) => ({ ...prev, [actionId]: !next }));
      setChecksError("Couldn't save that checkbox. Try again.");
    } finally {
      setSavingId(null);
    }
  }

  async function pickTonight(actionId: string) {
    if (!viewerIsChild) return;
    const prev = tonightPickId;
    const nextKey = `${tonightKeyPrefix}${actionId}`;
    setChecks((p) => ({ ...p, [nextKey]: true }));
    setSavingId(nextKey);
    try {
      if (prev && prev !== actionId) {
        await persistCheck(`${tonightKeyPrefix}${prev}`, false);
      }
      await persistCheck(nextKey, true);
      setChecks((p) => {
        const copy = { ...p };
        for (const k of Object.keys(copy)) {
          if (k.startsWith(tonightKeyPrefix) && k !== nextKey) copy[k] = false;
        }
        return copy;
      });
    } catch {
      setChecksError("Couldn't save tonight's pick. Try again.");
    } finally {
      setSavingId(null);
    }
  }

  async function addManualMissing() {
    if (!manualTitle.trim()) {
      setManualError("Give the missing work a name so it can join the plan.");
      return;
    }
    setManualError("");
    try {
      const res = await fetch(`/api/crew/members/${memberId}/manual-missing`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          class_name: data?.class?.name ?? className,
          title: manualTitle.trim(),
          category: manualCategory || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Couldn't log that.");
      setManualMissing((p) => [json.item as ManualMissingItem, ...p]);
      setManualTitle("");
      setManualCategory("");
    } catch (e) {
      setManualError(e instanceof Error ? e.message : "Couldn't log that. Try again.");
    }
  }

  async function removeManualMissing(id: string) {
    try {
      const res = await fetch(
        `/api/crew/members/${memberId}/manual-missing?id=${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error();
      setManualMissing((p) => p.filter((m) => m.id !== id));
    } catch {
      setManualError("Couldn't remove that. Try again.");
    }
  }

  function onCheckinSaved(saved: SavedCheckin) {
    setCheckins((p) => [
      {
        confusing: saved.confusing.join(" "),
        note: saved.note,
        due_next: saved.due_next.join(" "),
        worked_on: saved.worked_on.join(" "),
        created_at: saved.created_at,
      },
      ...p,
    ]);
  }

  if (loading) {
    return (
      <div className="space-y-5" aria-busy="true">
        <BackButton onBack={onBack} />
        <p className="text-sm text-stardust">Opening {className}…</p>
      </div>
    );
  }

  if (loadError || !data?.class) {
    return (
      <div className="space-y-5">
        <BackButton onBack={onBack} />
        <div
          role="alert"
          className="rounded-xl border border-neon-amber/30 bg-neon-amber/5 px-4 py-4"
        >
          <p className="text-sm font-medium text-star">This class wouldn&apos;t open</p>
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
  const band = bandForGrade(c.grade);
  const atGoal = gap === 0;
  const weakTopics = actions
    .filter((a) => a.kind === "study")
    .map((a) => a.category ?? "")
    .filter(Boolean);
  const tips = peerTipsFor(c.name, { weakUnits: weakTopics, limit: 3 });

  // Shared check-ins only for Dawson's Word ("Just for me" never appears here).
  const sharedCheckins = checkins.filter(
    (k) => (k as unknown as { channel?: string }).channel !== "private",
  );
  const theme = flagged.length > 0 ? titleCase(flagged[0]) : null;

  const actionCard = (a: PathAction, i: number) => {
    const checked = !!checks[a.id];
    const saving = savingId === a.id;
    return (
      <div
        key={a.id}
        className={`rounded-xl border px-4 py-3 transition-colors ${
          checked
            ? "border-neon-green/40 bg-neon-green/10"
            : "border-line bg-panel-2/60"
        }`}
      >
        <div className="flex items-start gap-3">
          <button
            type="button"
            onClick={() => void toggleCheck(a.id)}
            disabled={saving || !viewerIsChild}
            aria-pressed={checked}
            aria-label={viewerIsChild ? `Mark "${a.text}" done` : `${firstName}'s checkbox (read-only for you)`}
            title={
              viewerIsChild
                ? "Mark done"
                : `These are ${firstName}'s to check — you can watch the progress here.`
            }
            className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-colors ${
              checked
                ? "border-neon-green bg-neon-green/25 text-neon-green"
                : "border-dim/60 text-transparent"
            } ${viewerIsChild ? "cursor-pointer" : "cursor-default"}`}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 12.5l5 5L20 6.5" />
            </svg>
          </button>
          <div className="min-w-0 flex-1">
            <p className={`text-sm font-medium ${checked ? "text-dim line-through" : "text-star"}`}>
              <span className="mr-1.5 text-xs font-bold text-neon-green">{i + 1}</span>
              {a.text}
            </p>
            {a.sub && (
              <p className="mt-0.5 text-xs leading-relaxed text-dim">{a.sub}</p>
            )}
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <span className="rounded-full border border-neon-green/40 bg-neon-green/10 px-2 py-0.5 text-[11px] font-semibold text-neon-green">
                +{a.impactPts.toFixed(1)} pts
              </span>
              {a.flagged && (
                <span className="rounded-full border border-neon-amber/40 bg-neon-amber/10 px-2 py-0.5 text-[11px] font-medium text-neon-amber">
                  🚩 You flagged this
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const missionHeader = (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-neon-green">
        {atGoal ? "On target" : band === "crisis" ? "Recovery plan" : "Mission"}
      </p>
      <h2 className="mt-1 text-xl font-semibold text-star">{c.name}</h2>
      <p className="mt-1 text-sm leading-relaxed text-stardust">
        {band === "crisis"
          ? "This is a comeback story, not a verdict. Three moves below — that's the whole plan."
          : gapCopy(c.grade)}
      </p>
      {(c.teacher || c.period) && (
        <p className="mt-1 text-xs text-dim">
          {c.teacher}
          {c.period ? ` · Period ${c.period}` : ""}
        </p>
      )}
    </div>
  );

  const gradeHero = (
    <div>
      {/* Grade header: numeric | letter, same size, separated by a line */}
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
      {/* Gap-to-90 bar with the 90 marker */}
      {c.grade !== null && (
        <div className="mt-3">
          <div
            className="relative h-2.5 overflow-visible rounded-full bg-panel"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(c.grade)}
            aria-label={`${gapCopy(c.grade)}`}
          >
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${Math.min(100, c.grade)}%`,
                background: gradeHex(c.grade),
              }}
            />
            <div
              className="absolute -top-1 h-4 w-0.5 bg-star"
              style={{ left: "90%" }}
              aria-hidden="true"
            />
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-dim">
            <span>0</span>
            <span className="font-medium text-stardust">90 — the line</span>
            <span>100</span>
          </div>
        </div>
      )}
      <p className="mt-2 text-xs italic text-dim">{COOLDOWN_COPY}</p>
    </div>
  );

  const pathTo90Section = (
    <div className="space-y-2">
      <SectionLabel>Path to 90 · top 3</SectionLabel>
      {!viewerIsChild && actions.length > 0 && (
        <p className="rounded-xl border border-line bg-panel-2/40 px-4 py-2.5 text-xs leading-relaxed text-dim">
          These are {firstName}&apos;s to check off — you can watch the progress
          here. Cheering counts.
        </p>
      )}
      {checksError && (
        <p role="alert" className="text-xs text-neon-amber">{checksError}</p>
      )}
      {actions.length === 0 ? (
        <p className="rounded-xl border border-line bg-panel-2/60 px-4 py-3 text-sm text-dim">
          No actions right now — the next sync may bring new work.
        </p>
      ) : (
        actions.map(actionCard)
      )}
    </div>
  );

  const peerTipsSection = (
    <div className="space-y-2">
      <SectionLabel>98% Playbook · peer tips</SectionLabel>
      {tips.length === 0 ? (
        <p className="rounded-xl border border-line bg-panel-2/60 px-4 py-3 text-sm text-dim">
          Peer tips for this class are being written — the students who aced it
          are sharing their playbook soon.
        </p>
      ) : (
        tips.map((t) => (
          <div
            key={t.id}
            className="rounded-xl border border-line bg-panel-2/60 px-4 py-3"
          >
            <p className="text-sm leading-relaxed text-star">“{t.text}”</p>
            <p className="mt-1 text-xs text-dim">— {t.from}</p>
          </div>
        ))
      )}
    </div>
  );

  const tonightSection = tonightAction && (
    <div className="rounded-xl border border-neon-green/40 bg-neon-green/5 px-4 py-4">
      <SectionLabel>Tonight&apos;s ONE action</SectionLabel>
      <p className="mt-2 text-base font-semibold text-star">{tonightAction.text}</p>
      {tonightAction.sub && (
        <p className="mt-1 text-xs leading-relaxed text-dim">{tonightAction.sub}</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void toggleCheck(tonightAction.id)}
          disabled={!viewerIsChild || !!checks[tonightAction.id]}
          className="rounded-xl border border-neon-green/50 bg-neon-green/15 px-4 py-2 text-sm font-semibold text-neon-green transition-colors hover:bg-neon-green/25 disabled:opacity-40"
        >
          {checks[tonightAction.id] ? "✓ Done for tonight" : "Done for tonight"}
        </button>
      </div>
      {actions.length > 1 && viewerIsChild && (
        <div className="mt-3 border-t border-line pt-3">
          <p className="text-xs text-dim">Not feeling it? Pick another:</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {actions
              .filter((a) => a.id !== tonightAction.id)
              .map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => void pickTonight(a.id)}
                  disabled={savingId === `${tonightKeyPrefix}${a.id}`}
                  className="rounded-full border border-line px-3 py-1 text-xs text-stardust hover:border-neon-green/40 hover:text-star disabled:opacity-50"
                >
                  {a.text.length > 42 ? `${a.text.slice(0, 42)}…` : a.text}
                </button>
              ))}
          </div>
        </div>
      )}
      {!viewerIsChild && (
        <p className="mt-2 text-xs text-dim">
          {firstName} picks tonight&apos;s focus — one thing, not five.
        </p>
      )}
    </div>
  );

  const missingLogger = (
    <div className="rounded-xl border border-dashed border-dim/40 bg-panel-2/40 px-4 py-3">
      <p className="text-xs font-medium text-stardust">
        Know about missing work the sync doesn&apos;t show? Log it — it joins the plan.
      </p>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          value={manualTitle}
          onChange={(e) => setManualTitle(e.target.value)}
          placeholder="Assignment name"
          aria-label="Missing assignment name"
          className="flex-1 rounded-xl border border-line bg-panel px-3 py-2 text-sm text-star placeholder:text-dim/70 focus:border-neon-green/50 focus:outline-none"
        />
        <select
          value={manualCategory}
          onChange={(e) => setManualCategory(e.target.value)}
          aria-label="Category"
          className="rounded-xl border border-line bg-panel px-3 py-2 text-sm text-star focus:border-neon-green/50 focus:outline-none"
        >
          <option value="">Category (optional)</option>
          {categoryData.map((cd) => (
            <option key={cd.name} value={cd.name}>
              {cd.name} · {cd.weight}%
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => void addManualMissing()}
          className="rounded-xl border border-neon-amber/50 bg-neon-amber/10 px-4 py-2 text-sm font-medium text-neon-amber hover:bg-neon-amber/20"
        >
          Log it
        </button>
      </div>
      {manualError && (
        <p role="alert" className="mt-1.5 text-xs text-neon-amber">{manualError}</p>
      )}
    </div>
  );

  const assignmentsSection = (
    <div className="space-y-4">
      <div className="space-y-2">
        <SectionLabel>Missing · {zerosFirst.length}</SectionLabel>
        {zerosFirst.length === 0 ? (
          <p className="rounded-xl border border-line bg-panel-2/60 px-4 py-3 text-sm text-dim">
            Nothing missing — nice. Keeping it that way is the whole game.
          </p>
        ) : (
          zerosFirst.map((a, i) => (
            <div
              key={`m-${i}-${a.title}`}
              className="flex items-center justify-between gap-3 rounded-xl border border-neon-amber/25 bg-neon-amber/5 px-4 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-star">{a.title}</p>
                <p className="text-xs text-dim">
                  {a.due_label}
                  {a.category ? ` · ${a.category}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {"manualId" in a && a.manualId && (
                  <button
                    type="button"
                    onClick={() => void removeManualMissing(a.manualId as string)}
                    aria-label={`Remove logged item ${a.title}`}
                    className="rounded-md px-1.5 py-0.5 text-xs text-dim hover:text-star"
                  >
                    ✕
                  </button>
                )}
                <span className="rounded-md border border-neon-amber/40 px-2 py-0.5 text-xs font-medium text-neon-amber">
                  Missing
                </span>
              </div>
            </div>
          ))
        )}
        {missingLogger}
      </div>

      <div className="space-y-2">
        <SectionLabel>Coming up · {data.upcoming.length}</SectionLabel>
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

      {data.recent.length > 0 && (
        <Collapsible title={`Recently graded · ${data.recent.length}`}>
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
              <span className={`shrink-0 text-sm font-semibold ${gradeTone(pctOf(a))}`}>
                {pctOf(a) !== null ? `${pctOf(a)!.toFixed(0)}` : "—"}
              </span>
            </div>
          ))}
        </Collapsible>
      )}
    </div>
  );

  const opportunitySection = opportunities.length > 0 && (
    <div className="space-y-2">
      <SectionLabel>Where the points live</SectionLabel>
      <p className="text-xs text-dim">
        Max grade gain if each category went to 100% — biggest bars first.
      </p>
      {opportunities.map((o) => (
        <div key={o.name} className="rounded-xl border border-line bg-panel-2/60 px-4 py-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <p className="truncate text-sm text-star">
              {o.name}
              <span className="ml-1.5 text-xs text-dim">
                {o.weight}% of grade · {o.average!.toFixed(0)}% avg
              </span>
            </p>
            <p className="shrink-0 text-xs font-semibold text-neon-green">
              +{o.opportunityPts.toFixed(1)} pts
            </p>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-panel">
            <div
              className="h-full rounded-full bg-neon-green/70"
              style={{
                width: `${Math.min(100, (o.opportunityPts / Math.max(...opportunities.map((x) => x.opportunityPts))) * 100)}%`,
              }}
            />
          </div>
        </div>
      ))}
    </div>
  );

  const ungradedForWhatIf = useMemo(() => {
    if (!data) return [];
    return [...data.missing, ...data.upcoming].slice(0, 20);
  }, [data]);

  const whatIfSection = (
    <div className="space-y-2">
      <SectionLabel>What-if simulator</SectionLabel>
      {ungradedForWhatIf.length === 0 || c.grade === null ? (
        <p className="rounded-xl border border-line bg-panel-2/60 px-4 py-3 text-sm text-dim">
          The simulator wakes up when there&apos;s upcoming work and a current grade to move.
        </p>
      ) : (
        <div className="space-y-3 rounded-xl border border-line bg-panel-2/60 px-4 py-4">
          <div>
            <label className="text-xs font-medium text-dim" htmlFor="whatif-pick">
              Pick an assignment
            </label>
            <select
              id="whatif-pick"
              value={whatIfTitle}
              onChange={(e) => {
                setWhatIfTitle(e.target.value);
                setWhatIfScore(90);
              }}
              className="mt-1 w-full rounded-xl border border-line bg-panel px-3 py-2 text-sm text-star focus:border-neon-green/50 focus:outline-none"
            >
              <option value="">Choose…</option>
              {ungradedForWhatIf.map((a, i) => (
                <option key={i} value={a.title}>
                  {a.title}{a.category ? ` · ${a.category}` : ""}
                </option>
              ))}
            </select>
          </div>
          {whatIfTitle && (() => {
            const picked = ungradedForWhatIf.find((a) => a.title === whatIfTitle);
            const datum = picked?.category
              ? categoryData.find((cd) => cd.name === picked.category)
              : undefined;
            if (!datum || datum.weight <= 0 || datum.average === null) {
              return (
                <p className="text-xs text-dim">
                  No category weight for this one yet — the estimate needs a
                  weighted category from the latest sync.
                </p>
              );
            }
            const n = Math.max(1, datum.gradedCount);
            const newAvg = (datum.average * n + whatIfScore) / (n + 1);
            const projected = Math.max(
              0,
              Math.min(100, c.grade! - (datum.weight / 100) * datum.average + (datum.weight / 100) * newAvg),
            );
            const delta = projected - c.grade!;
            return (
              <div className="space-y-2">
                <label className="text-xs font-medium text-dim" htmlFor="whatif-score">
                  If you score <span className="font-semibold text-star">{whatIfScore}</span> on it…
                </label>
                <input
                  id="whatif-score"
                  type="range"
                  min={0}
                  max={100}
                  value={whatIfScore}
                  onChange={(e) => setWhatIfScore(Number(e.target.value))}
                  className="w-full accent-[#a3e635]"
                />
                <p className="text-sm text-star">
                  Grade would move{" "}
                  <span className="font-bold" style={{ color: gradeHex(projected) }}>
                    {c.grade!.toFixed(1)} → {projected.toFixed(1)}
                  </span>{" "}
                  <span className={delta >= 0 ? "text-neon-green" : "text-neon-amber"}>
                    ({delta >= 0 ? "+" : ""}{delta.toFixed(1)})
                  </span>
                </p>
                <p className="text-[11px] text-dim">
                  Estimate from {datum.name} ({datum.weight}% of grade, {n} graded so far).
                </p>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );

  const checkinSection = (
    <div className="space-y-3">
      <SectionLabel>Daily check-in</SectionLabel>
      {theme && (
        <p className="rounded-xl border border-neon-amber/30 bg-neon-amber/5 px-4 py-2.5 text-xs text-neon-amber">
          🚩 You flagged <span className="font-semibold">{theme}</span> this week — it&apos;s tagged on the plan above.
        </p>
      )}
      <CheckinFlow
        memberId={memberId}
        className={c.name}
        onSaved={onCheckinSaved}
      />
      {/* Timeline — themes highlighted, not just a list */}
      <div className="space-y-2">
        {checkinsNote && checkins.length === 0 ? (
          <p className="text-xs text-dim">{checkinsNote}</p>
        ) : checkins.length === 0 ? (
          <p className="rounded-xl border border-line bg-panel-2/60 px-4 py-3 text-sm text-dim">
            No check-ins yet — the first one takes 30 seconds.
          </p>
        ) : (
          <ol className="relative space-y-2 border-l border-line pl-4">
            {checkins.slice(0, 7).map((k, i) => {
              const isPrivate =
                (k as unknown as { channel?: string }).channel === "private";
              if (isPrivate && !viewerIsChild) return null; // "Just for me" never appears for the parent
              const text = checkinText(k);
              const chips = [
                ...(Array.isArray(k.worked_on) ? k.worked_on : k.worked_on ? [k.worked_on] : []),
                ...(Array.isArray(k.due_next) ? k.due_next : k.due_next ? [k.due_next] : []),
              ].slice(0, 4);
              return (
                <li key={i} className="relative">
                  <span
                    className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-neon-green"
                    aria-hidden="true"
                  />
                  <p className="text-[11px] font-medium uppercase tracking-wider text-dim">
                    {fmtDate(k.created_at)}
                    {isPrivate && (
                      <span className="ml-1.5 rounded-full border border-line px-1.5 py-0.5 normal-case tracking-normal">
                        🔒 Just for me
                      </span>
                    )}
                  </p>
                  {chips.length > 0 && (
                    <p className="mt-0.5 text-xs text-stardust">{chips.join(" · ")}</p>
                  )}
                  {text && (
                    <p className="mt-0.5 text-sm leading-relaxed text-star">“{text}”</p>
                  )}
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </div>
  );

  const dawsonsWord = sharedCheckins.length > 0 && (
    <div className="space-y-2">
      <SectionLabel>{firstName}&apos;s word</SectionLabel>
      <p className="text-xs text-dim">
        In {firstName}&apos;s own words — worth reading before emailing any teacher.
      </p>
      {sharedCheckins.slice(0, 3).map((k, i) => {
        const text = checkinText(k);
        return (
          <figure
            key={i}
            className="rounded-xl border border-line bg-panel-2/60 px-4 py-3"
          >
            <blockquote className="text-sm italic leading-relaxed text-star">
              “{text || "Checked in — no words this time."}”
            </blockquote>
            <figcaption className="mt-1 text-xs text-dim">
              — {firstName}, {fmtDate(k.created_at)}
            </figcaption>
          </figure>
        );
      })}
    </div>
  );

  const teacherCard = (
    <div className="rounded-xl border border-line bg-panel-2/60 px-4 py-3">
      <SectionLabel>Teacher</SectionLabel>
      <p className="mt-1 text-sm text-star">
        {c.teacher ?? "Not listed in the latest sync."}
      </p>
      {actions.some((a) => a.kind === "study") && c.teacher && (
        <p className="mt-1.5 text-xs leading-relaxed text-stardust">
          <span className="font-medium text-star">What to ask in office hours: </span>
          “{actions.find((a) => a.kind === "study")!.text} — where should I start?”
          Office hours are the fastest way to unlock makeup and extra credit — go
          with one specific question.
        </p>
      )}
    </div>
  );

  const footer = (
    <div>
      {data.synced_at && (
        <p className="text-xs text-dim">
          Synced {new Date(data.synced_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
          {" at "}
          {new Date(data.synced_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
        </p>
      )}
    </div>
  );

  const fullPage = (
    <>
      {/* Comeback sparkline */}
      <div className="space-y-2">
        <SectionLabel>Trajectory</SectionLabel>
        <Sparkline points={sparkPoints} />
      </div>

      {/* This Week strip */}
      {thisWeek.length > 0 && (
        <div className="space-y-2">
          <SectionLabel>This week</SectionLabel>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {thisWeek.map((a, i) => (
              <div
                key={i}
                className="shrink-0 rounded-xl border border-line bg-panel-2/60 px-3 py-2"
              >
                <p className="max-w-40 truncate text-xs font-medium text-star">{a.title}</p>
                <p className="text-[11px] text-dim">{a.due_label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {pathTo90Section}
      {peerTipsSection}
      {tonightSection}
      {assignmentsSection}
      {opportunitySection}
      {whatIfSection}
      {checkinSection}

      {/* Meheldi's divider: words above, files below — separate, both saved */}
      <div className="flex items-center gap-3" aria-hidden="true">
        <div className="h-px flex-1 bg-line" />
        <p className="text-[11px] uppercase tracking-[0.2em] text-dim">
          Your words above · your files below — separate, both saved
        </p>
        <div className="h-px flex-1 bg-line" />
      </div>

      <div className="space-y-2">
        <SectionLabel>Learn &amp; resources</SectionLabel>
        <ClassResources
          memberId={memberId}
          className={c.name}
          viewerIsChild={viewerIsChild}
        />
      </div>

      {dawsonsWord}
      {teacherCard}
      {footer}
    </>
  );

  return (
    <div className="space-y-5">
      <BackButton onBack={onBack} />
      {missionHeader}
      {band === "crisis" ? (
        <>
          {gradeHero}
          {/* Recovery-plan hero: fastest lever + teacher conversation + one study action */}
          <div className="space-y-2">
            <SectionLabel>Recovery plan · three moves</SectionLabel>
            {(() => {
              const turnin = actions.find((a) => a.kind === "turnin");
              const study = actions.find((a) => a.kind === "study");
              const cards: React.ReactNode[] = [];
              if (turnin) {
                cards.push(
                  <div key="lever" className="rounded-xl border border-neon-amber/40 bg-neon-amber/5 px-4 py-3">
                    <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-neon-amber">
                      Fastest lever
                    </p>
                    <div className="mt-2">{actionCard(turnin, 0)}</div>
                  </div>,
                );
              }
              if (c.teacher) {
                cards.push(
                  <div key="teacher" className="rounded-xl border border-line bg-panel-2/60 px-4 py-3">
                    <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-dim">
                      Teacher conversation
                    </p>
                    <p className="mt-1.5 text-sm leading-relaxed text-star">
                      Talk to {c.teacher} this week — one short, polite ask about
                      makeup or extra credit can unlock points sitting on the table.
                    </p>
                  </div>,
                );
              }
              if (study) {
                cards.push(
                  <div key="study" className="rounded-xl border border-line bg-panel-2/60 px-4 py-3">
                    <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-dim">
                      One study move
                    </p>
                    <div className="mt-2">{actionCard(study, cards.length)}</div>
                  </div>,
                );
              }
              if (cards.length === 0) {
                cards.push(
                  <p key="none" className="rounded-xl border border-line bg-panel-2/60 px-4 py-3 text-sm text-dim">
                    The next sync will bring the numbers this plan needs — check
                    back after the sync lands.
                  </p>,
                );
              }
              return cards;
            })()}
          </div>
          <Collapsible title="Full class page">
            {fullPage}
          </Collapsible>
        </>
      ) : band === "steady" ? (
        <>
          <div className="rounded-xl border border-neon-green/30 bg-neon-green/5 px-4 py-4 text-center">
            <p className="text-sm font-semibold text-neon-green">
              Holding the 90 line — steady as she goes.
            </p>
            <p className="mt-1 text-xs text-dim">
              The mission now is protecting the lead: turn everything in, stay ahead on the next unit.
            </p>
          </div>
          {gradeHero}
          <Collapsible title="Details, plan & resources">
            {fullPage}
          </Collapsible>
        </>
      ) : (
        <>
          {gradeHero}
          {fullPage}
        </>
      )}
    </div>
  );
}
