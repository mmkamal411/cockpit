import { NextResponse } from "next/server";
import { requirePilot, serverError } from "@/lib/api-auth";

interface RouteParams {
  params: Promise<{ shareId: string }>;
}

/**
 * DELETE /api/shopping/shares/[shareId]
 * Owner only: revoke a share. The invite token dies with the share (cascade).
 * The invitee keeps nothing — their access ends immediately.
 */
export async function DELETE(_req: Request, { params }: RouteParams) {
  const auth = await requirePilot();
  if (auth instanceof NextResponse) return auth;
  const { supabase, user } = auth;
  const { shareId } = await params;

  try {
    const { error, count } = await supabase
      .from("shopping_list_shares")
      .delete({ count: "exact" })
      .eq("id", shareId)
      .eq("owner_pilot_id", user.id);
    if (error) throw error;
    if (!count) {
      return NextResponse.json({ error: "That share wasn't found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return serverError();
  }
}
