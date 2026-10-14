import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPilotId, unauthorized } from "@/lib/crew/auth";

/**
 * GET /api/crew/members/[id] — one crew member's profile.
 * RLS scopes to the pilot's own crew; a stranger's UUID 404s.
 */
const MEMBER_COLUMNS_WITH_PREFS =
  "id, name, birthdate, relationship, sync_preferences, created_at";
const MEMBER_COLUMNS_BASE = "id, name, birthdate, relationship, created_at";

/**
 * True when a PostgREST error means a column is missing from the table
 * (migration not run yet). The profile must degrade gracefully, not 404.
 */
function isMissingColumnError(error: { code?: string; message?: string }) {
  return (
    error?.code === "42703" || // Postgres undefined_column
    error?.code === "PGRST204" || // PostgREST unknown column
    /column .* does not exist/i.test(error?.message ?? "")
  );
}

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
  // Prefer the full column set; fall back when migration 041
  // (sync_preferences) has not been applied yet.
  let { data, error } = await supabase
    .from("crew_members")
    .select(MEMBER_COLUMNS_WITH_PREFS)
    .eq("id", id)
    .single();

  if (error && isMissingColumnError(error)) {
    const retry = await supabase
      .from("crew_members")
      .select(MEMBER_COLUMNS_BASE)
      .eq("id", id)
      .single();
    data = retry.data ? { ...retry.data, sync_preferences: null } : retry.data;
    error = retry.error;
  }

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
    // Migration 041 (sync_preferences column) not applied yet — say so
    // plainly instead of a generic 500.
    if (isMissingColumnError(error ?? {})) {
      return NextResponse.json(
        {
          error:
            "Sync preferences aren't ready yet — the database update hasn't been applied. Your other settings still work.",
        },
        { status: 503 },
      );
    }
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
