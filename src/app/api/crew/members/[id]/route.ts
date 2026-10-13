import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPilotId, unauthorized } from "@/lib/crew/auth";

/**
 * GET /api/crew/members/[id] — one crew member's profile.
 * RLS scopes to the pilot's own crew; a stranger's UUID 404s.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const pilotId = await getPilotId();
  if (!pilotId) {
    return NextResponse.json(unauthorized(), { status: 401 });
  }
  const { id } = await params;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crew_members")
    .select("id, name, birthdate, relationship, created_at")
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Couldn't find that crew member." },
      { status: 404 },
    );
  }

  return NextResponse.json({ member: data });
}

/**
 * DELETE /api/crew/members/[id] — remove a crew member.
 * Cascades to grade syncs, grants, school links (FK ON DELETE CASCADE).
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const pilotId = await getPilotId();
  if (!pilotId) {
    return NextResponse.json(unauthorized(), { status: 401 });
  }
  const { id } = await params;

  const supabase = await createClient();
  const { error } = await supabase
    .from("crew_members")
    .delete()
    .eq("id", id);

  if (error) {
    console.error(
      JSON.stringify({
        route: "DELETE /api/crew/members/[id]",
        operation: "delete crew_members",
        error: error.message,
      }),
    );
    return NextResponse.json(
      { error: "Couldn't remove them right now. Try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
