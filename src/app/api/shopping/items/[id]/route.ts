import { NextResponse } from "next/server";
import { requirePilot, serverError } from "@/lib/api-auth";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PATCH /api/shopping/items/[id]
 * Body: { name?, quantity?, unit?, checked?, notes?, recurring?, recurring_interval_days? }
 * General field update. For check-offs, prefer POST .../check (writes history).
 */
export async function PATCH(req: Request, { params }: RouteParams) {
  const auth = await requirePilot();
  if (auth instanceof NextResponse) return auth;
  const { supabase } = auth;
  const { id } = await params;

  try {
    const body = await req.json().catch(() => ({}));
    const patch: Record<string, unknown> = {};
    if (typeof body.name === "string" && body.name.trim()) {
      patch.name = body.name.trim().slice(0, 120);
    }
    if (body.quantity === null || Number.isFinite(body.quantity)) {
      patch.quantity = body.quantity;
    }
    if (body.unit === null || (typeof body.unit === "string" && body.unit.trim())) {
      patch.unit = body.unit === null ? null : body.unit.trim().slice(0, 20);
    }
    if (typeof body.checked === "boolean") {
      patch.checked = body.checked;
      patch.checked_at = body.checked ? new Date().toISOString() : null;
    }
    if (body.notes === null || typeof body.notes === "string") {
      patch.notes = body.notes === null ? null : body.notes.slice(0, 280);
    }
    if (typeof body.recurring === "boolean") {
      patch.recurring = body.recurring;
    }
    if (body.recurring_interval_days === null || Number.isInteger(body.recurring_interval_days)) {
      patch.recurring_interval_days = body.recurring_interval_days;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("shopping_items")
      .update(patch)
      .eq("id", id)
      .select("id, name, quantity, unit, checked, recurring, notes, position")
      .single();
    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "That item wasn't found." }, { status: 404 });
    }
    return NextResponse.json({ item: data });
  } catch {
    return serverError();
  }
}

/**
 * DELETE /api/shopping/items/[id]
 * Removes the item. Purchase history keeps the pattern.
 */
export async function DELETE(_req: Request, { params }: RouteParams) {
  const auth = await requirePilot();
  if (auth instanceof NextResponse) return auth;
  const { supabase } = auth;
  const { id } = await params;

  try {
    const { error, count } = await supabase
      .from("shopping_items")
      .delete({ count: "exact" })
      .eq("id", id);
    if (error) throw error;
    if (!count) {
      return NextResponse.json({ error: "That item wasn't found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return serverError();
  }
}
