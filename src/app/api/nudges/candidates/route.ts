/**
 * POST /api/nudges/candidates
 *
 * Internal ingestion: producer modules (calendar, bills, weather, todos,
 * school) submit nudge candidates. Runs the engine pipeline —
 * score → category/min-score gates → dedupe → quiet-hours schedule → insert.
 *
 * Auth: either
 *   - service key: Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>
 *     (server-to-server producers; pilot_id comes from the body), or
 *   - pilot session: the candidate's pilot_id must match the signed-in pilot.
 *
 * A failed producer must never break the engine: validation problems return
 * 4xx with { error }; engine failures return 503 with { error }. The caller
 * logs and moves on — that category simply goes quiet this run.
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/admin/serviceClient";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  submitCandidate,
  getPreferences,
  NUDGE_CATEGORIES,
  type NudgeCandidate,
  type NudgeCategory,
  type NudgeTier,
} from "@/lib/nudges/engine";
import { jsonError, readJson, requirePilot } from "@/lib/nudges/route-helpers";

export const dynamic = "force-dynamic";

function isServiceKey(req: NextRequest): boolean {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return false;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${key}`;
}

function validateCandidate(body: Record<string, unknown>): { ok: true; candidate: NudgeCandidate } | { ok: false; error: string } {
  const pilot_id = body.pilot_id;
  const category = body.category;
  const title = body.title;
  const dedup_key = body.dedup_key;
  const source = body.source;

  if (typeof pilot_id !== "string" || !pilot_id.trim()) return { ok: false, error: "pilot_id is required." };
  if (typeof category !== "string" || !(NUDGE_CATEGORIES as readonly string[]).includes(category)) {
    return { ok: false, error: `category must be one of: ${NUDGE_CATEGORIES.join(", ")}.` };
  }
  if (typeof title !== "string" || !title.trim()) return { ok: false, error: "title is required." };
  if (typeof dedup_key !== "string" || !dedup_key.trim()) return { ok: false, error: "dedup_key is required." };
  if (typeof source !== "string" || !source.trim()) return { ok: false, error: "source is required." };

  const candidate: NudgeCandidate = {
    pilot_id: pilot_id.trim(),
    category: category as NudgeCategory,
    title: title.trim().slice(0, 300),
    dedup_key: dedup_key.trim().slice(0, 300),
    source: source.trim().slice(0, 80),
  };
  if (typeof body.body === "string" && body.body.trim()) candidate.body = body.body.trim().slice(0, 2000);
  if (body.source_ref && typeof body.source_ref === "object") {
    candidate.source_ref = body.source_ref as Record<string, unknown>;
  }
  for (const field of ["scheduled_for", "deadline"] as const) {
    if (typeof body[field] === "string" && body[field].trim()) {
      const d = new Date((body[field] as string).trim());
      if (Number.isNaN(d.getTime())) return { ok: false, error: `${field} must be an ISO timestamp.` };
      candidate[field] = d.toISOString();
    }
  }
  if (body.tier !== undefined) {
    if (body.tier !== "normal" && body.tier !== "urgent") return { ok: false, error: 'tier must be "normal" or "urgent".' };
    candidate.tier = body.tier as NudgeTier;
  }
  return { ok: true, candidate };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    const body = await readJson(req);
    if (!body) return jsonError("Request body must be JSON.", 400);
    const valid = validateCandidate(body);
    if (!valid.ok) return jsonError(valid.error, 422);

    let db: SupabaseClient;
    let timezone = "UTC";
    if (isServiceKey(req)) {
      db = createAdminClient();
      const { data: pilot } = await db.from("pilots").select("timezone").eq("id", valid.candidate.pilot_id).maybeSingle();
      if (pilot?.timezone) timezone = pilot.timezone as string;
    } else {
      const auth = await requirePilot();
      if (!auth.ok) return auth.response;
      if (auth.ctx.pilotId !== valid.candidate.pilot_id) {
        return jsonError("You can only submit nudges for yourself.", 403);
      }
      db = auth.ctx.supabase;
      timezone = auth.ctx.timezone;
    }

    const prefs = await getPreferences(db, valid.candidate.pilot_id);
    const outcome = await submitCandidate(db, valid.candidate, { prefs, timezone });

    switch (outcome.action) {
      case "inserted":
        return NextResponse.json(
          {
            action: "inserted",
            id: (outcome.nudge as { id?: string }).id,
            score: outcome.score,
            scheduled_for: outcome.scheduledFor,
          },
          { status: 201 },
        );
      case "deduped":
        return NextResponse.json({ action: "deduped", score: outcome.score }, { status: 200 });
      case "below_threshold":
        return NextResponse.json({ action: "suppressed", reason: "below_min_score", score: outcome.score }, { status: 200 });
      case "category_disabled":
        return NextResponse.json({ action: "suppressed", reason: "category_disabled", score: outcome.score }, { status: 200 });
    }
  } catch (e) {
    return jsonError(
      e instanceof Error ? `Nudge engine hiccup: ${e.message}` : "Nudge engine hiccup — the candidate was not stored.",
      503,
    );
  }
}
