import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPilotId, unauthorized } from "@/lib/crew/auth";

interface GradeEntry {
  class?: string;
  name?: string;
  grade?: number | string | null;
  letter?: string | null;
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

/**
 * GET /api/crew/members/[id]/classes
 * Class list with current grades + gap-to-90, derived from the latest
 * full grade sync. Grant-scoped like the sync endpoints.
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

  const { data: latest } = await supabase
    .from("crew_grade_syncs")
    .select("grades, synced_at")
    .eq("crew_member_id", crewMemberId)
    .filter("grades", "neq", "[]")
    .order("synced_at", { ascending: false })
    .limit(1)
    .single();

  if (!latest) {
    return NextResponse.json({
      classes: [],
      synced_at: null,
      message: "No school data yet — connect a school login or tap SYNC NOW.",
    });
  }

  const raw = Array.isArray(latest.grades) ? (latest.grades as GradeEntry[]) : [];
  const classes = raw.map((g, i) => {
    const grade = toNumber(g.grade);
    const gap = grade === null ? null : Math.max(0, 90 - grade);
    return {
      id: `class-${i}`,
      name: g.class ?? g.name ?? `Class ${i + 1}`,
      grade,
      letter: g.letter ?? letterFor(grade),
      gap_to_90: gap,
    };
  });

  return NextResponse.json({ classes, synced_at: latest.synced_at });
}
