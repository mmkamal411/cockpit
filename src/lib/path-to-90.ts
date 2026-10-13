/**
 * Path-to-90 — deterministic action math.
 *
 * Pure math, no LLM. The LLM may write words; it never computes grades.
 * Ported from the d-dash `buildPathActions` implementation (verified in
 * production 2026-10-11; see the archaeology report §3).
 *
 * Pipeline:
 *   1. Zeros first — every graded 0 becomes a "Turn in X" action.
 *      Impact = zeroImpact(weight, categoryAvg, n): (weight/100) × (categoryAvg / n)
 *      — the approximate overall-grade gain from turning a 0 into average work.
 *   2. Missing (sync-flagged, no score) — same impact math, lowest category.
 *   3. Study levers — categories ranked by opportunity = (weight/100) × (100 − avg).
 *      Each lever names a weak topic cluster (2+ assignments under 85%) or falls
 *      back to the single worst graded assignment. Categories with NO graded
 *      data are skipped entirely: fewer, specific > more, vague.
 * Rank: turn-ins first, then study levers; within kind, impact desc; top 3.
 */

export interface PathAssignment {
  title: string;
  /** Percent score 0–100; null = not graded yet. */
  score: number | null;
  category: string | null;
  /** True when the sync (or the student) flagged this as missing. */
  missing?: boolean;
}

export interface CategoryDatum {
  name: string;
  /** Percent of the overall grade (0–100). */
  weight: number;
  /** Graded average in the category (0–100); null = no graded data. */
  average: number | null;
  /** Number of graded assignments in the category. */
  gradedCount: number;
}

export type PathActionKind = "turnin" | "study";

export interface PathAction {
  /** Stable id, e.g. "turnin:chapter-4-quiz". */
  id: string;
  kind: PathActionKind;
  /** Specific headline — always cites an assignment or unit + impact. */
  text: string;
  /** Category · weight · why, in one plain line. */
  sub: string;
  /** Estimated overall-grade gain, in points. */
  impactPts: number;
  category: string | null;
  /** The cited assignment title (for "You flagged this" matching). */
  citedTitle: string | null;
  /** True when this action matched a topic from the child's check-ins. */
  flagged?: boolean;
}

export interface CategoryOpportunity {
  name: string;
  weight: number;
  average: number | null;
  /** Max overall-grade gain if this category went to 100%. */
  opportunityPts: number;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Approximate overall-grade gain from turning one zero into average work. */
function zeroImpact(
  weight: number,
  categoryAvg: number,
  nInCategory: number,
): number {
  if (weight <= 0 || categoryAvg <= 0 || nInCategory <= 0) return 0;
  return (weight / 100) * (categoryAvg / nInCategory);
}

/**
 * Overall-grade opportunity for a category: (weight/100) × (100 − avg).
 * Skips categories with no graded data.
 */
export function computeOpportunities(
  categories: CategoryDatum[],
): CategoryOpportunity[] {
  return categories
    .filter((c) => c.weight > 0 && c.average !== null && c.average < 100)
    .map((c) => ({
      name: c.name,
      weight: c.weight,
      average: c.average,
      opportunityPts: (c.weight / 100) * (100 - (c.average as number)),
    }))
    .sort((a, b) => b.opportunityPts - a.opportunityPts);
}

/** Tiny topic labeler: finds the most frequent meaningful word in titles. */
function topicLabel(titles: string[]): string {
  const stop = new Set([
    "the", "and", "for", "with", "test", "quiz", "homework", "hw",
    "chapter", "ch", "unit", "assignment", "practice", "review", "lab",
    "project", "exam", "worksheet", "notes", "extra", "credit",
  ]);
  const counts = new Map<string, number>();
  for (const t of titles) {
    for (const w of t.toLowerCase().split(/[^a-z0-9]+/)) {
      if (w.length >= 4 && !stop.has(w)) {
        counts.set(w, (counts.get(w) ?? 0) + 1);
      }
    }
  }
  let best = "";
  let bestN = 0;
  for (const [w, n] of counts) {
    if (n > bestN) {
      best = w;
      bestN = n;
    }
  }
  return best ? best[0].toUpperCase() + best.slice(1) : "";
}

export interface BuildPathOptions {
  /** Topics the child flagged as confusing in recent check-ins. */
  flaggedTopics?: string[];
}

function matchesFlagged(text: string, flaggedTopics: string[]): boolean {
  const lower = text.toLowerCase();
  return flaggedTopics.some(
    (t) => t.length >= 3 && lower.includes(t.toLowerCase()),
  );
}

/**
 * Build the top-3 Path-to-90 actions. Deterministic — same inputs, same
 * actions. Every action cites a specific assignment or unit with point
 * impact; generic advice ("Push Tests Higher") is never produced.
 */
export function buildPathActions(
  assignments: PathAssignment[],
  categories: CategoryDatum[],
  opts: BuildPathOptions = {},
): PathAction[] {
  const flaggedTopics = opts.flaggedTopics ?? [];
  const out: PathAction[] = [];

  const byCat = new Map<string, PathAssignment[]>();
  for (const a of assignments) {
    const key = a.category ?? "Ungraded";
    const arr = byCat.get(key) ?? [];
    arr.push(a);
    byCat.set(key, arr);
  }
  const catDatum = new Map(categories.map((c) => [c.name, c]));

  // --- 1. Zeros first -------------------------------------------------
  const zeros = assignments.filter((a) => a.score === 0);
  for (const z of zeros) {
    const datum = z.category ? catDatum.get(z.category) : undefined;
    const impact = datum
      ? zeroImpact(
          datum.weight,
          datum.average ?? 0,
          Math.max(1, datum.gradedCount),
        )
      : 0.5;
    out.push({
      id: `turnin:${slug(z.title)}`,
      kind: "turnin",
      text: `Turn in "${z.title}"`,
      sub: `${z.category ?? "Gradebook"}${datum ? ` · ${datum.weight}% of grade` : ""} — a zero is the heaviest drag on the average.`,
      impactPts: impact,
      category: z.category,
      citedTitle: z.title,
      flagged: matchesFlagged(z.title, flaggedTopics),
    });
  }

  // --- 2. Missing (no score) -------------------------------------------
  const missing = assignments.filter((a) => a.score === null && a.missing);
  for (const m of missing.slice(0, Math.max(0, 4 - out.length))) {
    const datum = m.category ? catDatum.get(m.category) : undefined;
    const impact = datum
      ? zeroImpact(
          datum.weight,
          datum.average ?? 0,
          Math.max(1, datum.gradedCount),
        )
      : 0.5;
    out.push({
      id: `missing:${slug(m.title)}`,
      kind: "turnin",
      text: `Turn in "${m.title}"`,
      sub: `${m.category ?? "Gradebook"}${datum ? ` · ${datum.weight}% of grade` : ""} — missing work is the fastest climb.`,
      impactPts: impact,
      category: m.category,
      citedTitle: m.title,
      flagged: matchesFlagged(m.title, flaggedTopics),
    });
  }

  // --- 3. Study levers by opportunity -----------------------------------
  for (const opp of computeOpportunities(categories)) {
    if (out.length >= 6) break;
    const inCat = byCat.get(opp.name) ?? [];
    const graded = inCat.filter((a) => a.score !== null);
    if (graded.length === 0) continue; // no graded data — skip, never vague

    const weak = graded.filter((a) => (a.score as number) < 85);
    const avg = opp.average as number;
    if (weak.length >= 2) {
      const label = topicLabel(weak.map((w) => w.title)) || opp.name;
      const weakAvg =
        weak.reduce((s, w) => s + (w.score as number), 0) / weak.length;
      out.push({
        id: `study:${slug(opp.name)}-${slug(label)}`,
        kind: "study",
        text: `Master ${label} (${weakAvg.toFixed(0)}% avg)`,
        sub: `${opp.name} · ${opp.weight}% of grade — the points are leaking in one cluster.`,
        impactPts: opp.opportunityPts / 2,
        category: opp.name,
        citedTitle: weak.map((w) => w.title).join(", "),
        flagged: matchesFlagged(label, flaggedTopics),
      });
    } else {
      const worst = [...graded].sort(
        (a, b) => (a.score as number) - (b.score as number),
      )[0];
      out.push({
        id: `review:${slug(opp.name)}-${slug(worst.title)}`,
        kind: "study",
        text: `Review "${worst.title}"`,
        sub: `${opp.name} · ${opp.weight}% of grade · scored ${worst.score} — redo the 2–3 questions that cost the most.`,
        impactPts: opp.opportunityPts / 3,
        category: opp.name,
        citedTitle: worst.title,
        flagged: matchesFlagged(worst.title, flaggedTopics),
      });
    }
  }

  // Rank: turn-ins first, then study; within kind, impact desc; top 3.
  const rank = (a: PathAction) => (a.kind === "turnin" ? 0 : 1);
  return out
    .sort((a, b) => rank(a) - rank(b) || b.impactPts - a.impactPts)
    .slice(0, 3);
}

/** Grade band for class-page variants: crisis <75 · middle 75–90 · steady >90. */
export type GradeBand = "none" | "crisis" | "middle" | "steady";

export function bandForGrade(grade: number | null): GradeBand {
  if (grade === null) return "none";
  if (grade < 75) return "crisis";
  if (grade > 90) return "steady";
  return "middle";
}

/**
 * Amber ramp, NEVER red — a hard design token (Meheldi, locked 2026-10-11).
 * Used for grade numbers, bars, and chips.
 */
export function gradeHex(grade: number | null): string {
  if (grade === null) return "#94a3b8"; // slate — no data
  if (grade >= 90) return "#a3e635"; // lime
  if (grade >= 80) return "#22d3ee"; // cyan
  if (grade >= 74) return "#fbbf24"; // amber
  if (grade >= 70) return "#fb923c"; // orange
  return "#f59e0b"; // amber-500 — never red, even here
}

/** One-line "points to your goal" copy. */
export function gapCopy(grade: number | null): string {
  if (grade === null) return "No grades on the instruments yet — holding position.";
  const gap = 90 - grade;
  if (gap <= 0) return "Holding the 90 line — steady as she goes.";
  return `${gap.toFixed(1)} points to the 90 line. Every point is recoverable.`;
}

/** Cool-down copy under grade displays. */
export const COOLDOWN_COPY =
  "Grades refresh with each sync — one grade is a snapshot, not a verdict.";
