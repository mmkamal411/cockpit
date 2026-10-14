import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPilotId, unauthorized } from "@/lib/crew/auth";

// ---------------------------------------------------------------------------
// Types for the raw sync payload (crew_grade_syncs.class_details).
// ---------------------------------------------------------------------------
interface SyncAssignment {
  due?: string;
  notes?: string;
  score?: number | null;
  title?: string;
  status?: string;
  percent?: number | null;
  category?: string;
  max_points?: number | null;
}

interface SyncClassDetail {
  class?: string;
  grade?: number | string | null;
  letter?: string | null;
  period?: string;
  teacher?: string;
  categories?: Record<string, unknown>;
  assignments?: SyncAssignment[];
  assignment_count?: number;
}

interface ClassCard {
  id: string;
  name: string;
  full_name: string;
  teacher: string | null;
  grade: number | null;
  letter: string | null;
  gap_to_90: number | null;
  on_track: boolean;
  missing_count: number;
  upcoming_count: number;
  total_assignments: number;
}

interface Priority {
  id: string;
  kind: "missing" | "upcoming";
  title: string;
  class_name: string;
  due: string | null;
  category: string | null;
  why: string;
  done: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = parseFloat(value.replace("%", ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Cobb County letter grades: A 90+, B 80+, C 74+, D 70+, F below. */
function letterFor(grade: number | null): string | null {
  if (grade === null) return null;
  if (grade >= 90) return "A";
  if (grade >= 80) return "B";
  if (grade >= 74) return "C";
  if (grade >= 70) return "D";
  return "F";
}

/** "AP Computer Science Principles A (11.0190092)" -> "AP Computer Science Principles A" */
function shortName(full: string): string {
  return full.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

/** Parse "10/2/2026" into a Date, or null when unparseable. */
function parseDue(due: string | undefined): Date | null {
  if (!due) return null;
  const m = due.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Missing = past due with no score yet. */
function isMissing(a: SyncAssignment, today: Date): boolean {
  const d = parseDue(a.due);
  return a.score == null && d !== null && d < today;
}

/** Upcoming = due today or later with no score yet. */
function isUpcoming(a: SyncAssignment, today: Date): boolean {
  const d = parseDue(a.due);
  return a.score == null && d !== null && d >= today;
}

/** Test > Project > Quiz > Lab > anything else, for priority ranking. */
function categoryWeight(category: string | null | undefined): number {
  const c = (category ?? "").toLowerCase();
  if (c.includes("test") || c.includes("exam")) return 4;
  if (c.includes("project")) return 3;
  if (c.includes("quiz")) return 2;
  if (c.includes("lab")) return 1;
  return 0;
}

function priorityActionId(className: string, title: string): string {
  return `weekly-priority:${className}::${title}`;
}

/**
 * GET /api/crew/members/[id]/school-overview
 * One dashboard-ready payload: class cards, quick stats, and the top-3
 * weekly priorities, all derived from the latest full grade sync.
 * Grant-scoped like the sibling crew endpoints.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const pilotId = await getPilotId();
  if (!pilotId) return NextResponse.json(unauthorized(), { status: 401 });
  const { id: crewMemberId } = await params;

  const supabase = await createClient();

  const { data: member } = await supabase
    .from("crew_members")
    .select("id, name, pilot_id")
    .eq("id", crewMemberId)
    .single();

  let hasAccess = member?.pilot_id === pilotId;
  if (!hasAccess) {
    const { data: grant } = await supabase
      .from("crew_access_grants")
      .select("id")
      .eq("crew_member_id", crewMemberId)
      .eq("grantee_pilot_id", pilotId)
      .is("revoked_at", null)
      .limit(1)
      .single();
    hasAccess = !!grant;
  }
  if (!hasAccess) {
    return NextResponse.json(
      { error: "Couldn't find that crew member." },
      { status: 404 },
    );
  }

  const { data: latest } = await supabase
    .from("crew_grade_syncs")
    .select("class_details, synced_at")
    .eq("crew_member_id", crewMemberId)
    .order("synced_at", { ascending: false })
    .limit(1)
    .single();

  if (!latest || !Array.isArray(latest.class_details) || latest.class_details.length === 0) {
    return NextResponse.json({
      member: { id: crewMemberId, name: member?.name ?? "Crew member" },
      synced_at: null,
      classes: [],
      stats: null,
      priorities: [],
      message: "No school data yet — connect a school login or tap SYNC NOW.",
    });
  }

  const details = latest.class_details as SyncClassDetail[];
  const today = startOfToday();

  // Done-state for priorities, from the shared Path-to-90 checkbox store.
  const { data: checks } = await supabase
    .from("path_to_90_checks")
    .select("action_id")
    .eq("crew_member_id", crewMemberId)
    .eq("checked", true);
  const doneSet = new Set((checks ?? []).map((c) => c.action_id as string));

  const missingPool: Array<{ cls: SyncClassDetail; a: SyncAssignment }> = [];
  const upcomingPool: Array<{ cls: SyncClassDetail; a: SyncAssignment }> = [];

  const classes: ClassCard[] = details.map((c, i) => {
    const fullName = c.class ?? `Class ${i + 1}`;
    const grade = toNumber(c.grade);
    const gap = grade === null ? null : Math.max(0, 90 - grade);
    const assignments = Array.isArray(c.assignments) ? c.assignments : [];
    let missingCount = 0;
    let upcomingCount = 0;
    for (const a of assignments) {
      if (isMissing(a, today)) {
        missingCount++;
        missingPool.push({ cls: c, a });
      } else if (isUpcoming(a, today)) {
        upcomingCount++;
        upcomingPool.push({ cls: c, a });
      }
    }
    return {
      id: `class-${i}`,
      name: shortName(fullName),
      full_name: fullName,
      teacher: c.teacher ?? null,
      grade,
      letter: letterFor(grade),
      gap_to_90: gap,
      on_track: grade !== null && grade >= 90,
      missing_count: missingCount,
      upcoming_count: upcomingCount,
      total_assignments: c.assignment_count ?? assignments.length,
    };
  });

  // Quick stats.
  const gradedClasses = classes.filter((c) => c.grade !== null);
  const avgGrade =
    gradedClasses.length === 0
      ? null
      : Math.round(
          (gradedClasses.reduce((s, c) => s + (c.grade as number), 0) /
            gradedClasses.length) *
            10,
        ) / 10;
  const stats = {
    class_count: classes.length,
    on_track_count: classes.filter((c) => c.on_track).length,
    needs_work_count: classes.filter((c) => !c.on_track && c.grade !== null).length,
    avg_grade: avgGrade,
    missing_count: missingPool.length,
    upcoming_count: upcomingPool.length,
  };

  // Weekly priorities: missing work first, then high-weight upcoming tests/projects.
  const gapByClass = new Map(classes.map((c) => [c.full_name, c.gap_to_90 ?? 0]));
  missingPool.sort((x, y) => {
    const gx = gapByClass.get(x.cls.class ?? "") ?? 0;
    const gy = gapByClass.get(y.cls.class ?? "") ?? 0;
    return gy - gx; // biggest gap to 90 first
  });
  upcomingPool.sort((x, y) => {
    const cw = categoryWeight(y.a.category) - categoryWeight(x.a.category);
    if (cw !== 0) return cw;
    const dx = parseDue(x.a.due)?.getTime() ?? Infinity;
    const dy = parseDue(y.a.due)?.getTime() ?? Infinity;
    return dx - dy;
  });

  const priorities: Priority[] = [];
  for (const { cls, a } of missingPool) {
    if (priorities.length >= 3) break;
    const className = cls.class ?? "";
    const title = a.title ?? "Untitled assignment";
    const clsGrade = toNumber(cls.grade);
    const gapText =
      clsGrade === null ? "" : `${(90 - clsGrade).toFixed(1)} points from 90 — `;
    priorities.push({
      id: `missing-${priorities.length}`,
      kind: "missing",
      title,
      class_name: shortName(className),
      due: a.due ?? null,
      category: a.category ?? null,
      why:
        gapText === ""
          ? "Missing work holds the grade back — turning it in moves things fastest."
          : `${gapText}closing out missing work moves it fastest.`,
      done: doneSet.has(priorityActionId(className, title)),
    });
  }
  for (const { cls, a } of upcomingPool) {
    if (priorities.length >= 3) break;
    const className = cls.class ?? "";
    const title = a.title ?? "Untitled assignment";
    const cat = (a.category ?? "").toLowerCase();
    const heavy =
      cat.includes("test") || cat.includes("exam") || cat.includes("project");
    priorities.push({
      id: `upcoming-${priorities.length}`,
      kind: "upcoming",
      title,
      class_name: shortName(className),
      due: a.due ?? null,
      category: a.category ?? null,
      why: heavy
        ? "High-weight work — a strong score here can lift the whole class."
        : "Coming up soon — a little prep now keeps it on track.",
      done: doneSet.has(priorityActionId(className, title)),
    });
  }

  return NextResponse.json({
    member: { id: crewMemberId, name: member?.name ?? "Crew member" },
    synced_at: latest.synced_at,
    classes,
    stats,
    priorities,
  });
}
