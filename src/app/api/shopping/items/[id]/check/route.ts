import { NextResponse } from "next/server";
import { requirePilot, serverError } from "@/lib/api-auth";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/** Normalize an item name for pattern matching: lowercase, trimmed, collapsed. */
function normalizeName(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * POST /api/shopping/items/[id]/check
 * Body: { checked?: boolean } (default true). Idempotent check-off.
 * Records purchase_history for the v1.1 pattern engine (check-offs only).
 */
export async function POST(req: Request, { params }: RouteParams) {
  const auth = await requirePilot();
  if (auth instanceof NextResponse) return auth;
  const { supabase, user } = auth;
  const { id } = await params;

  try {
    const body = await req.json().catch(() => ({}));
    const checked = body.checked !== false;

    const { data: item, error: fetchError } = await supabase
      .from("shopping_items")
      .select("id, name, list_id, checked")
      .eq("id", id)
      .single();
    if (fetchError || !item) {
      return NextResponse.json({ error: "That item wasn't found." }, { status: 404 });
    }

    const { error } = await supabase
      .from("shopping_items")
      .update({ checked, checked_at: checked ? new Date().toISOString() : null })
      .eq("id", id);
    if (error) throw error;

    if (checked && !item.checked) {
      await supabase.from("purchase_history").insert({
        pilot_id: user.id,
        item_name_normalized: normalizeName(item.name),
        list_id: item.list_id,
      });
    }

    return NextResponse.json({ ok: true, checked });
  } catch {
    return serverError();
  }
}
