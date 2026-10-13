import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPilotId, unauthorized } from "@/lib/crew/auth";

interface AssignmentEntry {
  title?: string;
  due?: string;
  score?: number | null;
  percent?: number | null;
  category?: string;
  status?: string;
  notes?: string;
  max_points?: number | null;
}

interface ClassDetailEntry {
  class?: string;
  name?: string;
  grade?: number | string | null;
  letter?: string | null;
  period?: string;
  teacher?: string;
  categories?: Record<string, unknown>;
  assignments?: AssignmentEntry[];
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = parseFloat(value.replace("%", ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function letterFor(grade: number | null): string | null {
  if (grade === null) return null;
  if (grade >= 90) return "A";
  if (grade >= 80) return "B";
  if (grade >= 74) return "C";
  if (grade >= 70) return "D";
  return "F";
}

/** Parse "M/D/YYYY" into a Date, or null when unparseable. */
function parseDue(due: string | undefined): Date | null {
  if (!due) return null;
  const m = due.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const d = new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function fmtDue(due: string | undefined): string {
  const d = parseDue(due);
  if (!d) return due ?? "No due date";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * GET /api/crew/members/[id]/class-detail?class=<class name>
 * Full detail for one class from the latest grade sync: grade, teacher,
 * assignments split into missing / upcoming / recent, synced_at.
 * Grant-scoped like the other crew endpoints.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const pilotId = await getPilotId();
  if (!pilotId) return NextResponse.json(unauthorized(), { status: 401 });
  const { id: crewMemberId } = await params;
  const className = request.nextUrl.searchParams.get("class") ?? "";

  const supabase = await createClient();

  const { data: member } = await supabase
    .from("crew_members")
    .select("id, pilot_id")
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

  if (!className.trim()) {
    return NextResponse.json(
      { error: "Tell us which class to open." },
      { status: 400 },
    );
  }

  const { data: latest } = await supabase
    .from("crew_grade_syncs")
    .select("class_details, synced_at")
    .eq("crew_member_id", crewMemberId)
    .order("synced_at", { ascending: false })
    .limit(1)
    .single();

  if (!latest?.class_details) {
    return NextResponse.json({
      class: null,
      synced_at: null,
      message: "No school data yet — connect a school login or tap SYNC NOW.",
    });
  }

  const details = Array.isArray(latest.class_details)
    ? (latest.class_details as ClassDetailEntry[])
    : [];
  const entry = details.find(
    (d) => (d.class ?? d.name ?? "").trim() === className.trim(),
  );

  if (!entry) {
    return NextResponse.json({
      class: null,
      synced_at: latest.synced_at,
      message: `Couldn't find "${className}" in the latest sync.`,
    });
  }

  const grade = toNumber(entry.grade);
  const gap = grade === null ? null : Math.max(0, 90 - grade);
  const assignments = Array.isArray(entry.assignments) ? entry.assignments : [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const withDue = assignments.map((a) => ({
    title: a.title ?? "Untitled assignment",
    due: a.due ?? null,
    due_label: fmtDue(a.due),
    due_date: parseDue(a.due),
    score: a.score ?? null,
    percent: a.percent ?? null,
    category: a.category ?? null,
    notes: a.notes ?? "",
  }));

  // Missing: no score and due in the past. Priority: oldest first.
  const missing = withDue
    .filter((a) => a.score === null && a.due_date !== null && a.due_date < today)
    .sort((a, b) => (a.due_date as Date).getTime() - (b.due_date as Date).getTime());

  // Upcoming: no score and due today or later. Soonest first.
  const upcoming = withDue
    .filter(
      (a) => a.score === null && (a.due_date === null || a.due_date >= today),
    )
    .sort((a, b) => {
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return a.due_date.getTime() - b.due_date.getTime();
    });

  // Recent: scored, newest first, top 5.
  const recent = withDue
    .filter((a) => a.score !== null)
    .sort((a, b) => {
      if (!a.due_date) return 1;
      if (!b.due_date) return -1;
      return b.due_date.getTime() - a.due_date.getTime();
    })
    .slice(0, 5);

  const name = entry.class ?? entry.name ?? className;

  return NextResponse.json({
    class: {
      name,
      grade,
      letter: entry.letter ?? letterFor(grade),
      gap_to_90: gap,
      teacher: entry.teacher ?? null,
      period: entry.period ?? null,
      has_category_weights:
        !!entry.categories && Object.keys(entry.categories).length > 0,
      categories: entry.categories ?? {},
    },
    missing,
    upcoming,
    recent,
    synced_at: latest.synced_at,
    stale:
      Date.now() - new Date(latest.synced_at).getTime() > 24 * 60 * 60 * 1000,
    hours_since_sync: Math.max(
      0,
      Math.round(
        (Date.now() - new Date(latest.synced_at).getTime()) / 3600000,
      ),
    ),
  });
}
