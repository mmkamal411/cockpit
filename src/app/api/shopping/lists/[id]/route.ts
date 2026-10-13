import { NextResponse } from "next/server";
import { requirePilot, serverError } from "@/lib/api-auth";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PATCH /api/shopping/lists/[id]
 * Body: { name?, icon?, sort_order?, archived? }. Renames / reorders / archives.
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
      patch.name = body.name.trim().slice(0, 80);
    }
    if (typeof body.icon === "string" && body.icon.trim()) {
      patch.icon = body.icon.trim().slice(0, 8);
    }
    if (Number.isInteger(body.sort_order)) {
      patch.sort_order = body.sort_order;
    }
    if (typeof body.archived === "boolean") {
      patch.archived = body.archived;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("shopping_lists")
      .update(patch)
      .eq("id", id)
      .select("id, name, icon, sort_order, archived")
      .single();
    if (error) throw error;
    if (!data) {
      return NextResponse.json({ error: "That list wasn't found." }, { status: 404 });
    }
    return NextResponse.json({ list: data });
  } catch {
    return serverError();
  }
}

/**
 * DELETE /api/shopping/lists/[id]
 * Removes the list and its items (cascade). History stays for patterns.
 */
export async function DELETE(_req: Request, { params }: RouteParams) {
  const auth = await requirePilot();
  if (auth instanceof NextResponse) return auth;
  const { supabase } = auth;
  const { id } = await params;

  try {
    const { error, count } = await supabase
      .from("shopping_lists")
      .delete({ count: "exact" })
      .eq("id", id);
    if (error) throw error;
    if (!count) {
      return NextResponse.json({ error: "That list wasn't found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return serverError();
  }
}
