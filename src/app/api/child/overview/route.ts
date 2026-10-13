import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPilotId, unauthorized } from "@/lib/crew/auth";
import { ageTier, type AgeTier } from "@/lib/child/age-tier";

export const dynamic = "force-dynamic";

interface GradeEntry {
  class?: string;
  name?: string;
  grade?: number | string | null;
  letter?: string | null;
}

interface AssignmentEntry {
  title?: string;
  due?: string;
  score?: number | string | null;
}

interface ClassDetailEntry {
  class?: string;
  name?: string;
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

/** Tolerant due-date parse: M/D/YYYY, M/D (this year), or ISO. */
function parseDue(due: string | undefined): Date | null {
  if (!due) return null;
  const s = due.trim();
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const d = new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  m = s.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (m) {
    const d = new Date(new Date().getFullYear(), Number(m[1]) - 1, Number(m[2]));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** "HH:MM" (24h) → minutes since midnight. */
function toMinutes(hhmm: string): number | null {
  const m = hhmm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * GET /api/child/overview — everything the child Home needs in one call.
 * Only the linked child pilot may call it (RLS + this check).
 *
 * Returns: member, tier, classes sorted by TODAY'S relevance
 * (due-today → missing → biggest gap → name), the bell-strip period,
 * whether they checked in today, tonight's ONE action, and sync freshness.
 */
export async function GET() {
  const pilotId = await getPilotId();
  if (!pilotId) return NextResponse.json(unauthorized(), { status: 401 });
  const supabase = await createClient();

  const { data: pilot } = await supabase
    .from("pilots")
    .select("child_crew_member_id, timezone")
    .eq("id", pilotId)
    .single();
  const memberId = pilot?.child_crew_member_id as string | null;
  if (!memberId) {
    return NextResponse.json(
      { error: "This screen is for linked child accounts." },
      { status: 404 },
    );
  }

  const { data: member } = await supabase
    .from("crew_members")
    .select("id, name, birthdate")
    .eq("id", memberId)
    .single();
  if (!member) {
    return NextResponse.json({ error: "Couldn't find your school profile." }, { status: 404 });
  }
  const tier: AgeTier = ageTier((member.birthdate as string | null) ?? null);
  const timeZone = (pilot?.timezone as string | null) ?? "America/New_York";

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Latest grade sync (RLS: grade_syncs_child_self_select).
  const { data: latest } = await supabase
    .from("crew_grade_syncs")
    .select("grades, class_details, synced_at")
    .eq("crew_member_id", memberId)
    .order("synced_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const grades = (
    latest && Array.isArray(latest.grades) ? (latest.grades as GradeEntry[]) : []
  );
  const details = (
    latest && Array.isArray(latest.class_details)
      ? (latest.class_details as ClassDetailEntry[])
      : []
  );
  const detailByClass = new Map<string, ClassDetailEntry>();
  for (const d of details) {
    const name = (d.class ?? d.name ?? "").trim();
    if (name && !detailByClass.has(name)) detailByClass.set(name, d);
  }

  interface ClassInfo {
    name: string;
    grade: number | null;
    letter: string | null;
    gap_to_90: number | null;
    missing_count: number;
    due_today_count: number;
  }

  const classes: ClassInfo[] = grades.map((g, i) => {
    const name = (g.class ?? g.name ?? `Class ${i + 1}`).trim();
    const grade = toNumber(g.grade);
    const detail = detailByClass.get(name);
    const assignments = Array.isArray(detail?.assignments) ? detail!.assignments : [];
    let missing = 0;
    let dueToday = 0;
    for (const a of assignments) {
      if (a.score !== null && a.score !== undefined) continue;
      const due = parseDue(a.due);
      if (!due) continue;
      if (due < today) missing += 1;
      else if (sameDay(due, today)) dueToday += 1;
    }
    return {
      name,
      grade,
      letter: g.letter ?? letterFor(grade),
      gap_to_90: grade === null ? null : Math.max(0, 90 - grade),
      missing_count: missing,
      due_today_count: dueToday,
    };
  });

  // Today's relevance: due today first, then missing, then biggest gap.
  classes.sort((a, b) => {
    if (b.due_today_count !== a.due_today_count) return b.due_today_count - a.due_today_count;
    if (b.missing_count !== a.missing_count) return b.missing_count - a.missing_count;
    const ga = a.gap_to_90 ?? -1;
    const gb = b.gap_to_90 ?? -1;
    if (gb !== ga) return gb - ga;
    return a.name.localeCompare(b.name);
  });

  // Tonight's ONE action: the most urgent ungraded assignment, else the
  // biggest gap, else nothing (the UI falls back to the check-in nudge).
  let oneAction: { title: string; class_name: string | null; due_label: string } | null = null;
  {
    const candidates: { title: string; className: string; due: Date }[] = [];
    for (const d of details) {
      const className = (d.class ?? d.name ?? "").trim();
      for (const a of d.assignments ?? []) {
        if (a.score !== null && a.score !== undefined) continue;
        const due = parseDue(a.due);
        if (!due) continue;
        candidates.push({ title: a.title ?? "Untitled assignment", className, due });
      }
    }
    candidates.sort((x, y) => x.due.getTime() - y.due.getTime());
    const top = candidates[0];
    if (top) {
      oneAction = {
        title: top.title,
        class_name: top.className || null,
        due_label:
          top.due < today
            ? "was due " + top.due.toLocaleDateString(undefined, { month: "short", day: "numeric" })
            : sameDay(top.due, today)
              ? "due today"
              : "due " + top.due.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      };
    } else if (classes.length > 0 && (classes[0].gap_to_90 ?? 0) > 0) {
      oneAction = {
        title: `Close the gap in ${classes[0].name}`,
        class_name: classes[0].name,
        due_label: `${classes[0].gap_to_90!.toFixed(1)} points to 90`,
      };
    }
  }

  // Bell strip: district → schedule → current period in the pilot's timezone.
  let bell: { period: string; ends_at: string; label: string } | null = null;
  try {
    const { data: link } = await supabase
      .from("crew_school_links")
      .select("district")
      .eq("crew_member_id", memberId)
      .maybeSingle();
    const district = ((link?.district as string) ?? "").toLowerCase().replace(/[^a-z]/g, "");
    if (district) {
      const { data: keys } = await supabase
        .from("school_schedules")
        .select("district_key")
        .limit(50);
      const distinct = [...new Set(((keys ?? []) as { district_key: string }[]).map((k) => k.district_key))];
      const match = distinct
        .filter((k) => district.includes(k.toLowerCase()) || k.toLowerCase().includes(district))
        .sort((a, b) => b.length - a.length)[0];
      if (match) {
        const { data: periods } = await supabase
          .from("school_schedules")
          .select("period_name, period_order, start_time, end_time")
          .eq("district_key", match)
          .order("period_order", { ascending: true });
        const nowStr = new Intl.DateTimeFormat("en-GB", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          timeZone,
        }).format(new Date());
        const nowMin = toMinutes(nowStr);
        const list = ((periods ?? []) as { period_name: string; start_time: string; end_time: string }[])
          .map((p) => ({ ...p, s: toMinutes(p.start_time), e: toMinutes(p.end_time) }))
          .filter((p) => p.s !== null && p.e !== null);
        if (nowMin !== null) {
          const current = list.find((p) => nowMin >= p.s! && nowMin < p.e!);
          if (current) {
            const endFmt = new Date(`2000-01-01T${current.end_time}:00`).toLocaleTimeString(
              undefined,
              { hour: "numeric", minute: "2-digit" },
            );
            bell = {
              period: current.period_name,
              ends_at: endFmt,
              label: `${current.period_name} · ends ${endFmt}`,
            };
          } else {
            const next = list.find((p) => nowMin < p.s!);
            if (next) {
              bell = { period: next.period_name, ends_at: "", label: `${next.period_name} starts ${next.start_time}` };
            }
          }
        }
      }
    }
  } catch {
    /* bell strip is best-effort; home works without it */
  }

  // Checked in today? (RLS: checkins_child_self.)
  const todayStr = new Date().toISOString().slice(0, 10);
  const { data: checkin } = await supabase
    .from("checkins")
    .select("id")
    .eq("crew_member_id", memberId)
    .eq("checkin_date", todayStr)
    .limit(1)
    .maybeSingle();

  return NextResponse.json({
    member: { id: memberId, name: member.name as string, tier },
    classes,
    bell,
    checked_in_today: !!checkin,
    one_action: oneAction,
    synced_at: (latest?.synced_at as string | null) ?? null,
    has_data: classes.length > 0,
  });
}
