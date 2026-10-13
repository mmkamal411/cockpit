import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPilotId, unauthorized } from "@/lib/crew/auth";

/**
 * POST /api/crew/members/[id]/sync — SYNC NOW.
 *
 * Today: returns the current sync freshness so the UI can show an honest
 * status ("synced 4 minutes ago" / "last sync 2 days ago"). The actual
 * on-demand pull is performed by the desktop sync app, which the website
 * triggers via its local HTTP server (see the installer architecture).
 * Until the desktop app ships, this endpoint reports status only.
 *
 * GET returns the same status payload (for polling).
 */
async function syncStatus(crewMemberId: string, pilotId: string) {
  const supabase = await createClient();

  // Access check: own crew member or live grades-scope grant.
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
  if (!hasAccess) return null;

  // Latest full sync (skip partial rows).
  const { data: latest } = await supabase
    .from("crew_grade_syncs")
    .select("synced_at, device_name, pull_method")
    .eq("crew_member_id", crewMemberId)
    .filter("grades", "neq", "[]")
    .order("synced_at", { ascending: false })
    .limit(1)
    .single();

  // School link heartbeat.
  const { data: link } = await supabase
    .from("crew_school_links")
    .select("sync_status, last_synced_at")
    .eq("crew_member_id", crewMemberId)
    .single();

  const syncedAt = latest?.synced_at ?? link?.last_synced_at ?? null;
  const ageMs = syncedAt ? Date.now() - new Date(syncedAt).getTime() : null;
  const stale = ageMs === null || ageMs > 24 * 60 * 60 * 1000;

  return {
    synced_at: syncedAt,
    age_minutes: ageMs === null ? null : Math.round(ageMs / 60000),
    stale,
    status: link?.sync_status ?? "idle",
    device: latest?.device_name ?? null,
    on_demand_available: false,
    message: stale
      ? "No recent sync. The desktop sync app will enable on-demand refresh."
      : "School data is fresh.",
  };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const pilotId = await getPilotId();
  if (!pilotId) return NextResponse.json(unauthorized(), { status: 401 });
  const { id } = await params;
  const status = await syncStatus(id, pilotId);
  if (!status)
    return NextResponse.json(
      { error: "Couldn't find that crew member." },
      { status: 404 },
    );
  return NextResponse.json(status);
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const pilotId = await getPilotId();
  if (!pilotId) return NextResponse.json(unauthorized(), { status: 401 });
  const { id } = await params;
  const status = await syncStatus(id, pilotId);
  if (!status)
    return NextResponse.json(
      { error: "Couldn't find that crew member." },
      { status: 404 },
    );
  // TODO(desktop-app): POST to the local sync app's /trigger-sync endpoint
  // when the pairing protocol ships. For now, report freshness honestly.
  return NextResponse.json({
    ...status,
    triggered: false,
    message:
      "On-demand sync needs the desktop app. Scheduled syncs continue twice daily.",
  });
}
