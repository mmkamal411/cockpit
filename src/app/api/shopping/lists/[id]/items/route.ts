import { NextResponse } from "next/server";
import { requirePilot, serverError } from "@/lib/api-auth";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/shopping/lists/[id]/items
 * Items for a list, unchecked first, then by position.
 */
export async function GET(_req: Request, { params }: RouteParams) {
  const auth = await requirePilot();
  if (auth instanceof NextResponse) return auth;
  const { supabase } = auth;
  const { id } = await params;

  try {
    const { data, error } = await supabase
      .from("shopping_items")
      .select("id, name, quantity, unit, checked, checked_at, recurring, recurring_interval_days, notes, position")
      .eq("list_id", id)
      .order("checked", { ascending: true })
      .order("position", { ascending: true });
    if (error) throw error;
    return NextResponse.json({ items: data ?? [] });
  } catch {
    return serverError();
  }
}

/**
 * POST /api/shopping/lists/[id]/items
 * Body: { name, quantity?, unit?, notes? }. Fast add path.
 */
export async function POST(req: Request, { params }: RouteParams) {
  const auth = await requirePilot();
  if (auth instanceof NextResponse) return auth;
  const { supabase, user } = auth;
  const { id } = await params;

  try {
    // Confirm the list belongs to the pilot (RLS on items also enforces this).
    const { data: list, error: listError } = await supabase
      .from("shopping_lists")
      .select("id")
      .eq("id", id)
      .single();
    if (listError || !list) {
      return NextResponse.json({ error: "That list wasn't found." }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 120) : "";
    if (!name) {
      return NextResponse.json({ error: "What should we add?" }, { status: 400 });
    }

    const { data: maxPos } = await supabase
      .from("shopping_items")
      .select("position")
      .eq("list_id", id)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle();

    const { data, error } = await supabase
      .from("shopping_items")
      .insert({
        list_id: id,
        pilot_id: user.id,
        name,
        quantity: Number.isFinite(body.quantity) ? body.quantity : null,
        unit: typeof body.unit === "string" ? body.unit.trim().slice(0, 20) : null,
        notes: typeof body.notes === "string" ? body.notes.trim().slice(0, 280) : null,
        position: (maxPos?.position ?? -1) + 1,
      })
      .select("id, name, quantity, unit, checked, recurring, notes, position")
      .single();
    if (error) throw error;
    return NextResponse.json({ item: data }, { status: 201 });
  } catch {
    return serverError();
  }
}
