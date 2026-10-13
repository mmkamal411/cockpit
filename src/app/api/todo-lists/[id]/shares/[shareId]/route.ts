import { NextResponse } from "next/server";
import { requirePilot, serverError } from "@/lib/api-auth";

/**
 * DELETE /api/todo-lists/[id]/shares/[shareId]
 * Owner only: revoke a share. The invitee's pending invite tokens die with
 * the share row (ON DELETE CASCADE); their access ends immediately.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; shareId: string }> },
) {
  const auth = await requirePilot();
  if (auth instanceof NextResponse) return auth;
  const { supabase, user } = auth;
  const { id, shareId } = await params;

  try {
    const { data: list } = await supabase
      .from("todo_lists")
      .select("id")
      .eq("id", id)
      .eq("pilot_id", user.id)
      .maybeSingle();
    if (!list) {
      return NextResponse.json({ error: "That list wasn't found." }, { status: 404 });
    }

    const { data: share } = await supabase
      .from("todo_list_shares")
      .select("id")
      .eq("id", shareId)
      .eq("list_id", id)
      .maybeSingle();
    if (!share) {
      return NextResponse.json({ error: "That share wasn't found." }, { status: 404 });
    }

    const { error } = await supabase.from("todo_list_shares").delete().eq("id", shareId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch {
    return serverError();
  }
}
