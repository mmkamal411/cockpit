/**
 * GET /api/nudges?status=
 *
 * Lists the pilot's nudges.
 *   ?status=pending   (default) — actionable now: pending + snoozed, due,
 *                       highest score first
 *   ?status=delivered — surfaced already, awaiting acknowledgement
 *   ?status=history   — acknowledged / expired / muted, newest first
 *   ?status=all       — everything, newest first
 *
 * Runs the expiry sweep opportunistically (best-effort; never fails the read).
 * Each nudge carries a `why` line — the "why am I seeing this?" transparency.
 */
import { NextRequest, NextResponse } from "next/server";
import { expireOld, whyLine } from "@/lib/nudges/engine";
import { jsonError, requirePilot } from "@/lib/nudges/route-helpers";

export const dynamic = "force-dynamic";

const SELECT = "id,category,title,body,score,dedup_key,source,status,scheduled_for,delivered_at,snoozed_until,created_at,expires_at";

type StatusFilter = "pending" | "delivered" | "history" | "all";

function toWhy(row: Record<string, unknown>): string {
  return whyLine({
    source: typeof row.source === "string" ? row.source : null,
    score: typeof row.score === "number" ? row.score : Number(row.score ?? 0),
    category: typeof row.category === "string" ? row.category : null,
  });
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    const auth = await requirePilot();
    if (!auth.ok) return auth.response;
    const { pilotId, supabase } = auth.ctx;

    // Best-effort sweep: expire past-due nudges, resurface elapsed snoozes.
    try {
      await expireOld(supabase, new Date(), pilotId);
    } catch {
      // The read must survive a failed sweep.
    }

    const raw = req.nextUrl.searchParams.get("status") ?? "pending";
    const filter: StatusFilter =
      raw === "delivered" || raw === "history" || raw === "all" ? raw : "pending";

    let query = supabase.from("nudges").select(SELECT).eq("pilot_id", pilotId);
    if (filter === "pending") {
      query = query
        .in("status", ["pending", "snoozed"])
        .or(`scheduled_for.is.null,scheduled_for.lte.${new Date().toISOString()}`)
        .order("score", { ascending: false })
        .limit(50);
    } else if (filter === "delivered") {
      query = query.eq("status", "delivered").order("created_at", { ascending: false }).limit(50);
    } else if (filter === "history") {
      query = query
        .in("status", ["acknowledged", "expired", "muted"])
        .order("created_at", { ascending: false })
        .limit(50);
    } else {
      query = query.order("created_at", { ascending: false }).limit(100);
    }

    const { data, error } = await query;
    if (error) return jsonError("Could not load your nudges. Try again.", 500);

    const nudges = ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      ...row,
      why: toWhy(row),
    }));

    // Quiet-hours queue: pending nudges scheduled for the future.
    let queued = 0;
    if (filter === "pending") {
      const { count } = await supabase
        .from("nudges")
        .select("id", { count: "exact", head: true })
        .eq("pilot_id", pilotId)
        .eq("status", "pending")
        .gt("scheduled_for", new Date().toISOString());
      queued = count ?? 0;
    }

    return NextResponse.json({ nudges, queued_for_later: queued, status: filter });
  } catch {
    return jsonError("Could not load your nudges. Try again.", 500);
  }
}
