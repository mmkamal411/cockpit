/**
 * POST /api/nudges/:id/acknowledge
 *
 * Marks a nudge acknowledged — "got it, stand down." Keeps the legacy
 * dismissed_at column in sync so older readers (admin views) agree.
 */
import { NextRequest, NextResponse } from "next/server";
import { jsonError, requirePilot } from "@/lib/nudges/route-helpers";

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<unknown> },
): Promise<NextResponse> {
  try {
    const { id } = (await ctx.params) as { id?: string };
    if (!id) return jsonError("Nudge id is required.", 400);

    const auth = await requirePilot();
    if (!auth.ok) return auth.response;
    const { pilotId, supabase } = auth.ctx;

    const { data, error } = await supabase
      .from("nudges")
      .update({ status: "acknowledged", dismissed_at: new Date().toISOString() })
      .eq("id", id)
      .eq("pilot_id", pilotId)
      .select("id")
      .maybeSingle();

    if (error) return jsonError("Could not acknowledge that nudge. Try again.", 500);
    if (!data) return jsonError("Nudge not found.", 404);
    return NextResponse.json({ ok: true, id });
  } catch {
    return jsonError("Could not acknowledge that nudge. Try again.", 500);
  }
}
