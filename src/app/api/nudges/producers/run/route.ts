/**
 * POST /api/nudges/producers/run
 *
 * Scheduled trigger for the nudge producers (meeting-soon + bill-due).
 * A scheduler (cron, scheduled worker) hits this on a cadence — 15 minutes
 * is the recommended default; the producers are dedupe-safe so most runs
 * are cheap no-ops.
 *
 * Auth: service key only — Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>.
 * Pilot sessions get 401: one scheduled run can cover every pilot.
 *
 * Body (JSON, optional): { "pilot_id": "uuid" } to run for one pilot only.
 * Omit the body to run for every pilot.
 *
 * Response 200: { ok: true, ran_at, pilots_run, pilots: [...] } with
 * per-producer inserted/deduped/suppressed/skipped counts and any captured
 * (non-fatal) errors. A failed producer never fails the run — its category
 * simply goes quiet until the next cycle.
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/admin/serviceClient";
import { runProducers } from "@/lib/nudges/producers";
import { jsonError, readJson } from "@/lib/nudges/route-helpers";

export const dynamic = "force-dynamic";

function isServiceKey(req: NextRequest): boolean {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return false;
  return req.headers.get("authorization") === `Bearer ${key}`;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  if (!isServiceKey(req)) {
    return jsonError("Producer runs need the service key. Sign-in sessions can't run them.", 401);
  }

  const body = await readJson(req);
  if (!body) return jsonError("Request body must be JSON.", 400);
  if (body.pilot_id !== undefined && (typeof body.pilot_id !== "string" || !body.pilot_id.trim())) {
    return jsonError("pilot_id must be a pilot id.", 422);
  }

  let db;
  try {
    db = createAdminClient();
  } catch {
    return jsonError("Scheduled nudge runs aren't set up on this server yet. The service key is missing.", 503);
  }

  try {
    const pilotId = typeof body.pilot_id === "string" ? body.pilot_id.trim() : undefined;
    const summary = await runProducers(db, { pilotId });
    return NextResponse.json({ ok: true, ...summary });
  } catch {
    return jsonError("The nudge run hit a problem and stopped. It will try again on the next scheduled run.", 503);
  }
}
