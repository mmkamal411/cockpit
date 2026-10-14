import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPilotId, unauthorized } from "@/lib/crew/auth";

/**
 * GET /api/crew/members — roster of the pilot's crew members.
 * Includes members linked TO the pilot via a live access grant
 * (e.g. a child who claimed a steward's link code), marked
 * `via_grant: true`. Grant-scoped rows come from the my_granted_crew
 * definer RPC because crew_members RLS is steward-only.
 */
export async function GET() {
  const pilotId = await getPilotId();
  if (!pilotId) {
    return NextResponse.json(unauthorized(), { status: 401 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crew_members")
    .select("id, name, birthdate, relationship, sync_preferences, created_at")
    .order("created_at", { ascending: true });

  if (error) {
    console.error(
      JSON.stringify({
        route: "GET /api/crew/members",
        operation: "select crew_members",
        error: error.message,
      }),
    );
    return NextResponse.json(
      { error: "Couldn't load your crew right now. Try again." },
      { status: 500 },
    );
  }

  // Members linked to this pilot through someone else's live grant.
  let granted: {
    id: string;
    name: string;
    birthdate: string | null;
    relationship: string | null;
    created_at: string;
  }[] = [];
  try {
    const { data: grantedJson, error: grantedError } = await supabase.rpc("my_granted_crew");
    if (!grantedError && Array.isArray(grantedJson)) {
      granted = grantedJson.filter(
        (g) => !(data ?? []).some((m) => m.id === g.id),
      );
    }
  } catch {
    // A missing function (migration not run yet) must not blank the roster.
  }

  // Attach school sync status for each member (drives the "needs attention"
  // indicator and the re-auth form in the Crew applet).
  const memberIds = (data ?? []).map((m) => m.id);
  const statusByMember: Record<string, { sync_status: string; last_synced_at: string | null }> = {};
  if (memberIds.length > 0) {
    const { data: links } = await supabase
      .from("crew_school_links")
      .select("crew_member_id, sync_status, last_synced_at")
      .in("crew_member_id", memberIds);
    for (const link of links ?? []) {
      statusByMember[link.crew_member_id] = {
        sync_status: link.sync_status,
        last_synced_at: link.last_synced_at,
      };
    }
  }

  const members = (data ?? []).map((m) => ({
    ...m,
    via_grant: false,
    school_sync: statusByMember[m.id] ?? { sync_status: "idle", last_synced_at: null },
  }));

  // Granted members: the steward's sync status is not visible to grantees
  // under RLS — show "linked" so the UI never lies about a school login
  // the grantee cannot manage.
  for (const g of granted) {
    members.push({
      ...g,
      via_grant: true,
      sync_preferences: null,
      school_sync: { sync_status: "linked", last_synced_at: null },
    });
  }

  return NextResponse.json({ members });
}

interface AddMemberBody {
  name?: string;
  birthdate?: string;
  relationship?: string;
  sync_preferences?: Record<string, boolean>;
}

/** Relationships the picker offers. School-specific logic keys on "child". */
const RELATIONSHIPS = ["child", "spouse", "parent", "other"] as const;

/** Sync-preference keys the UI offers (step 3 toggles). */
const SYNC_PREF_KEYS = ["Grades", "Attendance", "Assignments", "School messages"] as const;

/**
 * Birthdate sanity bounds: not in the future, not more than 25 years past.
 * Returns a plain-English error, or null when the date is fine.
 */
export function validateBirthdate(birthdate: string): string | null {
  const parsed = new Date(birthdate);
  if (Number.isNaN(parsed.getTime())) {
    return "That birthdate doesn't look right. Try YYYY-MM-DD.";
  }
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (parsed > today) {
    return "That birthdate is in the future — check the year and try again.";
  }
  const oldest = new Date(today);
  oldest.setFullYear(oldest.getFullYear() - 25);
  if (parsed < oldest) {
    return "That birthdate is more than 25 years ago — check the year and try again.";
  }
  return null;
}

/** Keep only known sync-preference keys; drop anything unexpected. */
function sanitizeSyncPrefs(input: unknown): Record<string, boolean> {
  if (!input || typeof input !== "object") return {};
  const out: Record<string, boolean> = {};
  for (const key of SYNC_PREF_KEYS) {
    const v = (input as Record<string, unknown>)[key];
    if (typeof v === "boolean") out[key] = v;
  }
  return out;
}

/**
 * POST /api/crew/members — add a crew member.
 * Body: { name, birthdate (YYYY-MM-DD), relationship? }.
 * pilot_id comes from the session — never from the client.
 */
export async function POST(request: NextRequest) {
  const pilotId = await getPilotId();
  if (!pilotId) {
    return NextResponse.json(unauthorized(), { status: 401 });
  }

  let body: AddMemberBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "We couldn't read that request. Try again." },
      { status: 400 },
    );
  }

  const name = (body.name ?? "").trim();
  if (!name) {
    return NextResponse.json(
      { error: "Give your crew member a name so Crystal knows who they are." },
      { status: 400 },
    );
  }
  if (!body.birthdate) {
    return NextResponse.json(
      { error: "Add a birthdate — it helps Crystal get the details right." },
      { status: 400 },
    );
  }

  // Validate the birthdate parses as a real date and is sane.
  const birthdateError = validateBirthdate(body.birthdate);
  if (birthdateError) {
    return NextResponse.json({ error: birthdateError }, { status: 400 });
  }

  const relationship = (body.relationship ?? "child").trim().toLowerCase();
  if (!(RELATIONSHIPS as readonly string[]).includes(relationship)) {
    return NextResponse.json(
      { error: "Pick who they're joining as — child, spouse, parent, or other." },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crew_members")
    .insert({
      pilot_id: pilotId,
      name,
      birthdate: body.birthdate,
      relationship,
      sync_preferences: sanitizeSyncPrefs(body.sync_preferences),
    })
    .select("id, name, birthdate, relationship, sync_preferences, created_at")
    .single();

  if (error) {
    console.error(
      JSON.stringify({
        route: "POST /api/crew/members",
        operation: "insert crew_members",
        error: error.message,
      }),
    );
    return NextResponse.json(
      { error: "Couldn't add them right now. Try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({ member: data }, { status: 201 });
}
