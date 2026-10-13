import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPilotId, unauthorized } from "@/lib/crew/auth";

/**
 * GET /api/crew/members/[id]/syncs/latest
 * Latest grade sync snapshot for a crew member.
 *
 * Filters out partial rows (CTLS-only / Outlook-only sweeps push rows with
 * empty grades). A partial row must never shadow a full sync as "latest".
 * Grant-scoped: the pilot's own crew, or a live grades-scope grant.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const pilotId = await getPilotId();
  if (!pilotId) {
    return NextResponse.json(unauthorized(), { status: 401 });
  }
  const { id: crewMemberId } = await params;

  const supabase = await createClient();

  // Verify access: own crew member, or a live grant with grades scope.
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
      .filter("scope->>grades", "eq", "true")
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

  // Latest FULL sync: grades array must be non-empty. Partial sweeps
  // (CTLS-only, Outlook-only) push rows with empty grades — skip them.
  const { data, error } = await supabase
    .from("crew_grade_syncs")
    .select("*")
    .eq("crew_member_id", crewMemberId)
    .filter("grades", "neq", "[]")
    .order("synced_at", { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    return NextResponse.json(
      {
        sync: null,
        message:
          "No school data yet — connect a school login or tap SYNC NOW.",
      },
      { status: 200 },
    );
  }

  return NextResponse.json({ sync: data });
}
