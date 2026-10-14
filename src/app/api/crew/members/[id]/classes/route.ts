import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPilotId, unauthorized } from "@/lib/crew/auth";

interface GradeEntry {
  class?: string;
  name?: string;
  grade?: number | string | null;
  letter?: string | null;
}

interface SynergyMailEntry {
  preview?: string;
  subject?: string;
  date?: string;
}

interface Office365MailEntry {
  preview?: string;
  sender?: string;
  subject?: string;
  date?: string;
}

interface SchoolMessage {
  source: "synergy" | "outlook";
  sender: string | null;
  subject: string | null;
  preview: string | null;
  date: string | null;
}

/** Merge Synergy + Office 365 teacher mail into one newest-first list. */
function mergeMessages(
  synergy: unknown,
  office365: unknown,
  limit: number,
): SchoolMessage[] {
  const out: SchoolMessage[] = [];
  if (Array.isArray(synergy)) {
    for (const m of synergy as SynergyMailEntry[]) {
      out.push({
        source: "synergy",
        sender: null,
        subject: typeof m.subject === "string" ? m.subject : null,
        preview: typeof m.preview === "string" ? m.preview : null,
        date: typeof m.date === "string" ? m.date : null,
      });
    }
  }
  if (Array.isArray(office365)) {
    for (const m of office365 as Office365MailEntry[]) {
      out.push({
        source: "outlook",
        sender: typeof m.sender === "string" ? m.sender : null,
        subject: typeof m.subject === "string" ? m.subject : null,
        preview: typeof m.preview === "string" ? m.preview : null,
        date: typeof m.date === "string" ? m.date : null,
      });
    }
  }
  out.sort((a, b) => {
    const ta = a.date ? Date.parse(a.date) : NaN;
    const tb = b.date ? Date.parse(b.date) : NaN;
    if (Number.isNaN(ta) && Number.isNaN(tb)) return 0;
    if (Number.isNaN(ta)) return 1;
    if (Number.isNaN(tb)) return -1;
    return tb - ta;
  });
  return out.slice(0, limit);
}

interface ClassDetail {
  class?: string;
  name?: string;
  grade?: number | string | null;
  letter?: string | null;
  period?: string;
  teacher?: string | null;
  assignments?: AssignmentEntry[];
}

interface AssignmentEntry {
  title?: string;
  due?: string | null;
  score?: number | string | null;
  status?: string | null;
  percent?: number | string | null;
  category?: string | null;
  max_points?: number | string | null;
  notes?: string | null;
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

import { pickSectionSources, normalizeDueNext, type SyncRow } from "@/lib/school-sections";

/**
 * GET /api/crew/members/[id]/classes
 * Member school overview, derived from recent grade syncs:
 * - classes with current grades + gap-to-90 + teacher lookup (via class_details)
 *   from the NEWEST sync row with grades
 * - due_next: upcoming assignments ({assignment, due, class}) for the 7-day due scan,
 *   from the newest row that HAS due_next (laptop-worker rows can be grades-only).
 *   Entries may key the title as `assignment` (laptop workers) or `title`
 *   (ParentVUE fallback pull) — both are accepted.
 * - gpa (weighted/unweighted/cumulative when the sync carries it)
 * - attendance summary ({absences, tardies, ...} when present)
 * - messages: Synergy + Office 365 teacher mail merged, newest first (top 8),
 *   from the newest row that HAS mail
 * - stale / hours_since_sync freshness flags (>24h since sync = stale)
 * Grant-scoped like the sync endpoints.
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

  // The latest row carries the freshest grades, but laptop-worker rows can be
  // grades-only (empty due_next/mail) while the 4x-daily parent pulls carry
  // the full payload. Take the newest row for classes, and the newest rows
  // that actually have due_next / mail for those sections — a grades-only
  // row must never blank "This week" or "Messages". The window is generous
  // (20, not 5): hourly grades-only pushes can flush the section-carrying
  // rows out of a small window.
  const { data: rows } = (await supabase
    .from("crew_grade_syncs")
    .select("grades, class_details, synced_at, gpa, due_next, attendance, synergy_mail, office365_emails")
    .eq("crew_member_id", crewMemberId)
    .filter("grades", "neq", "[]")
    .order("synced_at", { ascending: false })
    .limit(20)) as { data: SyncRow[] | null };

  const latest = rows?.[0];
  if (!latest) {
    return NextResponse.json({
      classes: [],
      synced_at: null,
      gpa: null,
      due_next: [],
      attendance: null,
      messages: [],
      stale: false,
      hours_since_sync: null,
      message: "No school data yet — connect a school login or tap SYNC NOW.",
    });
  }

  // Teacher lookup from class_details (keyed by class name).
  const details = Array.isArray(latest.class_details)
    ? (latest.class_details as ClassDetail[])
    : [];
  const teacherByClass = new Map<string, string>();
  for (const d of details) {
    const key = (d.class ?? d.name ?? "").trim().toLowerCase();
    if (key && d.teacher) teacherByClass.set(key, d.teacher);
  }

  const syncedAtMs = new Date(latest.synced_at).getTime();
  const hoursSinceSync = Math.max(
    0,
    Math.round((Date.now() - syncedAtMs) / 3600000),
  );

  const { dueSource, mailSource } = pickSectionSources(rows);

  const raw = Array.isArray(latest.grades) ? (latest.grades as GradeEntry[]) : [];
  const classes = raw.map((g, i) => {
    const grade = toNumber(g.grade);
    const gap = grade === null ? null : Math.max(0, 90 - grade);
    const name = g.class ?? g.name ?? `Class ${i + 1}`;
    return {
      id: `class-${i}`,
      name,
      grade,
      letter: g.letter ?? letterFor(grade),
      gap_to_90: gap,
      teacher: teacherByClass.get(name.trim().toLowerCase()) ?? null,
    };
  });

  return NextResponse.json({
    classes,
    synced_at: latest.synced_at,
    gpa:
      latest.gpa && typeof latest.gpa === "object" && Object.keys(latest.gpa).length > 0
        ? latest.gpa
        : null,
    due_next: normalizeDueNext(dueSource.due_next),
    attendance:
      latest.attendance && typeof latest.attendance === "object" && Object.keys(latest.attendance).length > 0
        ? latest.attendance
        : null,
    messages: mergeMessages(mailSource.synergy_mail, mailSource.office365_emails, 8),
    stale: hoursSinceSync > 24,
    hours_since_sync: hoursSinceSync,
  });
}
