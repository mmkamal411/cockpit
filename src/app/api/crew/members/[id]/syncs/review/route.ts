import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPilotId, unauthorized } from "@/lib/crew/auth";
import {
  friendlyPipeline,
  hoursSince,
  sanitizeSyncSnapshot,
} from "@/lib/sync-review";

/**
 * GET /api/crew/members/[id]/syncs/review
 * Sync Data Review payload: the latest TWO full sync rows (latest + the
 * previous one, so the client can badge what's new or changed), sanitized
 * into the review field inventory, plus pull metadata and freshness.
 *
 * Partial sweeps (CTLS-only / Outlook-only rows with empty grades) are
 * skipped — a partial row must never stand in as "the latest pull".
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

  const { data: member } = await supabase
    .from("crew_members")
    .select("id, name, pilot_id")
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

  const { data: rows, error } = await supabase
    .from("crew_grade_syncs")
    .select(
      "synced_at, pull_method, device_name, grades, gpa, due_next, past_periods, synergy_mail, office365_emails, class_details, ctls_syllabi, attendance, ctls_announcements, ctls_upcoming, zero_guard_flags",
    )
    .eq("crew_member_id", crewMemberId)
    .filter("grades", "neq", "[]")
    .order("synced_at", { ascending: false })
    .limit(2);

  if (error || !rows || rows.length === 0) {
    return NextResponse.json({
      member: { id: crewMemberId, name: member?.name ?? null },
      header: null,
      current: null,
      previous: null,
      message: "No school data yet — connect a school login or tap SYNC NOW.",
    });
  }

  const current = sanitizeSyncSnapshot(rows[0]);
  const previous = rows[1] ? sanitizeSyncSnapshot(rows[1]) : null;

  const hours = hoursSince(current.syncedAt);
  const previousHours = previous ? hoursSince(previous.syncedAt) : null;

  return NextResponse.json({
    member: { id: crewMemberId, name: member?.name ?? null },
    header: {
      pipeline: friendlyPipeline(current.pullMethod, current.deviceName),
      pull_method: current.pullMethod,
      device_name: current.deviceName,
      synced_at: current.syncedAt,
      hours_since_sync: hours,
      stale: hours !== null && hours > 24,
      previous_synced_at: previous?.syncedAt ?? null,
      previous_hours_since_sync: previousHours,
      previous_pipeline: previous
        ? friendlyPipeline(previous.pullMethod, previous.deviceName)
        : null,
    },
    current,
    previous,
  });
}
