import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPilotId, unauthorized } from "@/lib/crew/auth";

/**
 * GET /api/crew/members/[id]/path-to-90?class=<name>
 * Checkbox state for a class's Path-to-90 actions. Server-side so it
 * follows the pilot (and the child) across devices.
 * Grant-scoped: the steward pilot, or a live grades-scope grant
 * (matches the path_checks_grantee_select RLS policy).
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

  let query = supabase
    .from("path_to_90_checks")
    .select("class_name, action_id, checked, checked_at, checked_by")
    .eq("crew_member_id", crewMemberId);
  if (className) query = query.eq("class_name", className);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: "Couldn't load checklist state. Try again." },
      { status: 500 },
    );
  }
  return NextResponse.json({ checks: data });
}

interface CheckBody {
  class_name?: string;
  action_id?: string;
  checked?: boolean;
  checked_by?: string;
}

/**
 * POST /api/crew/members/[id]/path-to-90
 * Upsert one checkbox. Body: { class_name, action_id, checked, checked_by? }.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const pilotId = await getPilotId();
  if (!pilotId) return NextResponse.json(unauthorized(), { status: 401 });
  const { id: crewMemberId } = await params;

  let body: CheckBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "We couldn't read that request. Try again." },
      { status: 400 },
    );
  }

  const className = (body.class_name ?? "").trim();
  const actionId = (body.action_id ?? "").trim();
  if (!className || !actionId) {
    return NextResponse.json(
      { error: "Missing class or action." },
      { status: 400 },
    );
  }
  const checkedBy =
    body.checked_by === "crew" ? "crew" : ("pilot" as const);

  const supabase = await createClient();

  const { data: member } = await supabase
    .from("crew_members")
    .select("id, pilot_id")
    .eq("id", crewMemberId)
    .single();
  if (member?.pilot_id !== pilotId) {
    return NextResponse.json(
      { error: "Couldn't find that crew member." },
      { status: 404 },
    );
  }

  const { data, error } = await supabase
    .from("path_to_90_checks")
    .upsert(
      {
        crew_member_id: crewMemberId,
        class_name: className,
        action_id: actionId,
        checked: !!body.checked,
        checked_at: body.checked ? new Date().toISOString() : null,
        checked_by: checkedBy,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "crew_member_id,class_name,action_id" },
    )
    .select("class_name, action_id, checked, checked_at, checked_by")
    .single();

  if (error) {
    console.error(
      JSON.stringify({
        route: "POST /api/crew/members/[id]/path-to-90",
        operation: "upsert path_to_90_checks",
        error: error.message,
      }),
    );
    return NextResponse.json(
      { error: "Couldn't save that checkbox. Try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({ check: data });
}
