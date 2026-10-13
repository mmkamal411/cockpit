/**
 * GET /api/nudges/center
 *
 * The nudge-center applet payload in one round trip:
 *   - active: actionable nudges (pending + snoozed, due), highest score first
 *   - queued_for_later: count of nudges held for after quiet hours
 *   - history: recent acknowledged/expired/muted
 *   - stats: 7-day totals, acknowledgement rate, per-category counts
 *   - preferences: the pilot's current tuning
 *
 * Everything is best-effort — a failed stats query degrades to zeros
 * rather than failing the whole payload.
 */
import { NextResponse } from "next/server";
import { getPreferences, whyLine } from "@/lib/nudges/engine";
import { jsonError, requirePilot } from "@/lib/nudges/route-helpers";

export const dynamic = "force-dynamic";

const SELECT = "id,category,title,body,score,dedup_key,source,status,scheduled_for,delivered_at,snoozed_until,created_at,expires_at";

function withWhy(row: Record<string, unknown>) {
  return {
    ...row,
    why: whyLine({
      source: typeof row.source === "string" ? row.source : null,
      score: typeof row.score === "number" ? row.score : Number(row.score ?? 0),
      category: typeof row.category === "string" ? row.category : null,
    }),
  };
}

export async function GET(): Promise<NextResponse> {
  try {
    const auth = await requirePilot();
    if (!auth.ok) return auth.response;
    const { pilotId, supabase } = auth.ctx;
    const nowIso = new Date().toISOString();
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

    const [activeRes, queuedRes, historyRes, weekRes, prefs] = await Promise.all([
      supabase
        .from("nudges")
        .select(SELECT)
        .eq("pilot_id", pilotId)
        .in("status", ["pending", "snoozed"])
        .or(`scheduled_for.is.null,scheduled_for.lte.${nowIso}`)
        .order("score", { ascending: false })
        .limit(25),
      supabase
        .from("nudges")
        .select("id", { count: "exact", head: true })
        .eq("pilot_id", pilotId)
        .eq("status", "pending")
        .gt("scheduled_for", nowIso),
      supabase
        .from("nudges")
        .select(SELECT)
        .eq("pilot_id", pilotId)
        .in("status", ["acknowledged", "expired", "muted"])
        .order("created_at", { ascending: false })
        .limit(25),
      supabase
        .from("nudges")
        .select("status,category")
        .eq("pilot_id", pilotId)
        .gte("created_at", weekAgo),
      getPreferences(supabase, pilotId),
    ]);

    if (activeRes.error) return jsonError("Could not load the nudge center. Try again.", 500);

    const active = ((activeRes.data ?? []) as Record<string, unknown>[]).map(withWhy);
    const history = ((historyRes.data ?? []) as Record<string, unknown>[]).map(withWhy);

    // Stats degrade to zeros when the query fails — never fail the payload.
    let stats = { total_7d: 0, acknowledged_7d: 0, ack_rate_7d: 0, by_category: {} as Record<string, number> };
    if (!weekRes.error && Array.isArray(weekRes.data)) {
      const rows = weekRes.data as { status: string; category: string }[];
      const by_category: Record<string, number> = {};
      let ack = 0;
      for (const r of rows) {
        if (r.status === "acknowledged") ack++;
        by_category[r.category] = (by_category[r.category] ?? 0) + 1;
      }
      stats = {
        total_7d: rows.length,
        acknowledged_7d: ack,
        ack_rate_7d: rows.length ? Math.round((ack / rows.length) * 100) : 0,
        by_category,
      };
    }

    return NextResponse.json({
      active,
      queued_for_later: queuedRes.count ?? 0,
      history,
      stats,
      preferences: prefs,
    });
  } catch {
    return jsonError("Could not load the nudge center. Try again.", 500);
  }
}
