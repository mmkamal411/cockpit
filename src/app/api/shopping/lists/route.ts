import { NextResponse } from "next/server";
import { requirePilot, serverError } from "@/lib/api-auth";

/**
 * GET /api/shopping/lists
 * The pilot's own lists plus lists shared with them (marked shared: true
 * with the sharer's name and permission). Requires auth.
 */
export async function GET() {
  const auth = await requirePilot();
  if (auth instanceof NextResponse) return auth;
  const { supabase, user } = auth;

  try {
    const { data: lists, error } = await supabase
      .from("shopping_lists")
      .select("id, name, icon, sort_order, archived, created_at, pilot_id")
      .eq("archived", false)
      .order("sort_order", { ascending: true })
      .order("created_at", { ascending: true });
    if (error) throw error;

    // Mark lists shared with the caller (RLS already scopes visibility).
    const listIds = (lists ?? []).map((l) => l.id);
    const shareInfo = new Map<string, { shared_by: string; permission: "view" | "edit" }>();
    if (listIds.length > 0) {
      const { data: shares } = await supabase
        .from("shopping_list_shares")
        .select("list_id, owner_display_name, permission")
        .in("list_id", listIds)
        .eq("shared_with_pilot_id", user.id);
      for (const s of shares ?? []) {
        shareInfo.set(s.list_id, {
          shared_by: s.owner_display_name || "Someone",
          permission: s.permission as "view" | "edit",
        });
      }
    }

    const { data: items, error: itemsError } = await supabase
      .from("shopping_items")
      .select("list_id")
      .eq("checked", false);
    if (itemsError) throw itemsError;

    const counts = new Map<string, number>();
    for (const item of items ?? []) {
      counts.set(item.list_id, (counts.get(item.list_id) ?? 0) + 1);
    }

    return NextResponse.json({
      lists: (lists ?? []).map((l) => {
        const shared = shareInfo.get(l.id);
        return {
          ...l,
          unchecked_count: counts.get(l.id) ?? 0,
          shared: shared !== undefined,
          ...(shared ? { shared_by: shared.shared_by, permission: shared.permission } : {}),
        };
      }),
    });
  } catch {
    return serverError();
  }
}

/**
 * POST /api/shopping/lists
 * Body: { name, icon? }. Creates a list.
 */
export async function POST(req: Request) {
  const auth = await requirePilot();
  if (auth instanceof NextResponse) return auth;
  const { supabase, user } = auth;

  try {
    const body = await req.json().catch(() => ({}));
    const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
    if (!name) {
      return NextResponse.json({ error: "Give your list a name." }, { status: 400 });
    }
    const icon = typeof body.icon === "string" && body.icon.trim() ? body.icon.trim().slice(0, 8) : "🛒";

    const { data, error } = await supabase
      .from("shopping_lists")
      .insert({ pilot_id: user.id, name, icon })
      .select("id, name, icon, sort_order, archived")
      .single();
    if (error) throw error;
    return NextResponse.json({ list: { ...data, unchecked_count: 0 } }, { status: 201 });
  } catch {
    return serverError();
  }
}
