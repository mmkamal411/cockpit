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
    .select("id, name, birthdate, relationship, sync_preferences, created_at")
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

/** Sync-preference keys the UI offers. Kept in sync with the members route. */
const SYNC_PREF_KEYS = ["Grades", "Attendance", "Assignments", "School messages"] as const;

/**
 * PATCH /api/crew/members/[id] — update a crew member's sync preferences.
 * Body: { sync_preferences: { Grades: true, ... } }. Steward-only (RLS).
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const pilotId = await getPilotId();
  if (!pilotId) {
    return NextResponse.json(unauthorized(), { status: 401 });
  }
  const { id } = await params;

  let body: { sync_preferences?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "We couldn't read that request. Try again." },
      { status: 400 },
    );
  }

  const prefs: Record<string, boolean> = {};
  if (body.sync_preferences && typeof body.sync_preferences === "object") {
    for (const key of SYNC_PREF_KEYS) {
      const v = (body.sync_preferences as Record<string, unknown>)[key];
      if (typeof v === "boolean") prefs[key] = v;
    }
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crew_members")
    .update({ sync_preferences: prefs })
    .eq("id", id)
    .eq("pilot_id", pilotId)
    .select("id, sync_preferences")
    .single();

  if (error || !data) {
    console.error(
      JSON.stringify({
        route: "PATCH /api/crew/members/[id]",
        operation: "update sync_preferences",
        error: error?.message ?? "not found",
      }),
    );
    return NextResponse.json(
      { error: "Couldn't save that right now. Try again." },
      { status: 500 },
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
