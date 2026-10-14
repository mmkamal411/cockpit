import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/admin/serviceClient";
import {
  resolveMailCrewMember,
  syncPilotOutlookMail,
  type MailSyncResult,
} from "@/lib/mail-sync";

export const dynamic = "force-dynamic";

/**
 * POST /api/mail/sync/run
 *
 * Scheduled trigger for Outlook school-mail sync across every pilot.
 * A scheduler (Cloudflare cron worker, or the cockpit-scheduler worker
 * hitting this on a cadence — hourly on school days is the recommended
 * default; the pulls are date-windowed so most runs are cheap) calls this.
 *
 * Auth: service key only — Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>.
 * Pilot sessions get 401: one scheduled run covers every pilot, and the
 * school-mail rows land on each pilot's crew member via rpc_push_crew_grade_sync.
 *
 * Body (JSON, optional): { "pilot_id": "uuid" } to run for one pilot only.
 * Omit the body to run for every pilot with an outlook connection.
 *
 * Response 200: { ok: true, ran_at, pilots_run, results } with per-pilot
 * connection outcomes. A failed pilot never fails the run — its connections
 * simply stay quiet until the next cycle.
 */
export async function POST(req: NextRequest) {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey || req.headers.get("authorization") !== `Bearer ${serviceKey}`) {
    return NextResponse.json(
      { error: "Scheduled mail runs need the service key. Sign-in sessions can't run them." },
      { status: 401 },
    );
  }

  let db;
  try {
    db = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: "Scheduled mail runs aren't set up on this server yet. The service key is missing." },
      { status: 503 },
    );
  }

  let pilotId: string | undefined;
  try {
    const body = await req.json().catch(() => null);
    if (body && typeof body.pilot_id === "string" && body.pilot_id.trim()) {
      pilotId = body.pilot_id.trim();
    }
  } catch {
    pilotId = undefined;
  }

  // Every pilot with at least one syncable outlook connection.
  let pilotIds: string[];
  if (pilotId) {
    pilotIds = [pilotId];
  } else {
    const { data, error } = await db
      .from("calendar_connections")
      .select("pilot_id")
      .eq("provider", "outlook")
      .in("status", ["active", "needs_reconsent"]);
    if (error) {
      return NextResponse.json(
        { error: "Couldn't list Outlook connections right now." },
        { status: 500 },
      );
    }
    pilotIds = [...new Set((data ?? []).map((r: { pilot_id: string }) => r.pilot_id))];
  }

  const perPilot: Array<{ pilot_id: string; results: MailSyncResult[] | null; error: string | null }> = [];
  for (const pid of pilotIds) {
    try {
      const crewMemberId = await resolveMailCrewMember(db, pid);
      if (!crewMemberId) {
        perPilot.push({ pilot_id: pid, results: [], error: null });
        continue;
      }
      const results = await syncPilotOutlookMail(pid, crewMemberId, db);
      perPilot.push({ pilot_id: pid, results, error: null });
    } catch (e) {
      perPilot.push({
        pilot_id: pid,
        results: null,
        error: e instanceof Error ? e.message : "Sync failed.",
      });
    }
  }

  const ranAt = new Date().toISOString();
  return NextResponse.json({
    ok: true,
    ran_at: ranAt,
    pilots_run: perPilot.length,
    synced_emails: perPilot.reduce(
      (n, p) => n + (p.results ?? []).reduce((m, r) => m + r.emails, 0),
      0,
    ),
    pilots: perPilot.map((p) => ({
      pilot_id: p.pilot_id,
      error: p.error,
      connections: (p.results ?? []).map((r) => ({
        account: r.accountEmail,
        outcome: r.outcome,
        emails: r.emails,
        message: r.message,
      })),
    })),
  });
}
