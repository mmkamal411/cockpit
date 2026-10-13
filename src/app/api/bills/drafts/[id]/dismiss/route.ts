import { NextRequest, NextResponse } from "next/server";
import { pilotRoute, dbErrorMessage, NotFoundError } from "@/lib/api/pilotRoute";

/**
 * POST /api/bills/drafts/[id]/dismiss
 *
 * Dismisses a detection candidate. The row is kept as dismissed (it feeds
 * parser learning later) — nothing is deleted.
 *
 * Returns { ok: true }.
 */
export const POST = pilotRoute(async ({ supabase, pilotId }, _req: NextRequest, { params }) => {
  const { id } = await params;

  const { data, error } = await supabase
    .from("bill_drafts")
    .update({ state: "dismissed" })
    .eq("id", id)
    .eq("pilot_id", pilotId)
    .eq("state", "pending")
    .select("id")
    .single();

  if (error) {
    const { message, status } = dbErrorMessage(error);
    return NextResponse.json({ error: message }, { status });
  }
  if (!data) throw new NotFoundError("That suggestion isn't waiting anymore.");
  return NextResponse.json({ ok: true });
});
