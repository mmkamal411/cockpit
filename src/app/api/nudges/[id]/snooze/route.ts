/**
 * POST /api/nudges/:id/snooze
 *
 * Body: { "until": "<ISO timestamp in the future>" }
 * Marks a nudge snoozed until `until`; the expiry sweep resurfaces it as
 * pending once the time passes.
 */
import { NextRequest, NextResponse } from "next/server";
import { jsonError, parseFutureIso, readJson, requirePilot } from "@/lib/nudges/route-helpers";

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<unknown> },
): Promise<NextResponse> {
  try {
    const { id } = (await ctx.params) as { id?: string };
    if (!id) return jsonError("Nudge id is required.", 400);

    const body = await readJson(req);
    const until = parseFutureIso(body?.until);
    if (!until) return jsonError("Tell me when to bring this back — a future date and time.", 422);

    const auth = await requirePilot();
    if (!auth.ok) return auth.response;
    const { pilotId, supabase } = auth.ctx;

    const { data, error } = await supabase
      .from("nudges")
      .update({ status: "snoozed", snoozed_until: until })
      .eq("id", id)
      .eq("pilot_id", pilotId)
      .select("id")
      .maybeSingle();

    if (error) return jsonError("Could not snooze that nudge. Try again.", 500);
    if (!data) return jsonError("Nudge not found.", 404);
    return NextResponse.json({ ok: true, id, snoozed_until: until });
  } catch {
    return jsonError("Could not snooze that nudge. Try again.", 500);
  }
}
