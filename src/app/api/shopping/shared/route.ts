import { NextResponse } from "next/server";
import { requirePilot, serverError } from "@/lib/api-auth";

/**
 * GET /api/shopping/shared
 * Lists shared WITH the caller — the "shared with me" view. Each entry
 * carries the owner's name and the permission, so the UI can mark
 * read-only lists and show who shared them.
 */
export async function GET() {
  const auth = await requirePilot();
  if (auth instanceof NextResponse) return auth;
  const { supabase, user } = auth;

  try {
    const { data: shares, error } = await supabase
      .from("shopping_list_shares")
      .select("list_id, owner_display_name, permission")
      .eq("shared_with_pilot_id", user.id)
      .order("created_at", { ascending: true });
    if (error) throw error;

    const listIds = (shares ?? []).map((s) => s.list_id as string);
    if (listIds.length === 0) {
      return NextResponse.json({ lists: [] });
    }

    const { data: lists, error: listsError } = await supabase
      .from("shopping_lists")
      .select("id, name, icon")
      .in("id", listIds)
      .eq("archived", false);
    if (listsError) throw listsError;

    const shareById = new Map(
      (shares ?? []).map((s) => [
        s.list_id as string,
        {
          shared_by: (s.owner_display_name as string) || "Someone",
          permission: s.permission as "view" | "edit",
        },
      ]),
    );

    // Unchecked counts per shared list (items RLS already scopes to readable).
    const counts = new Map<string, number>();
    const { data: items } = await supabase
      .from("shopping_items")
      .select("list_id")
      .in("list_id", listIds)
      .eq("checked", false);
    for (const item of items ?? []) {
      const lid = item.list_id as string;
      counts.set(lid, (counts.get(lid) ?? 0) + 1);
    }

    return NextResponse.json({
      lists: (lists ?? []).map((l) => {
        const share = shareById.get(l.id as string);
        return {
          id: l.id,
          name: l.name,
          icon: l.icon,
          unchecked_count: counts.get(l.id as string) ?? 0,
          shared: true,
          shared_by: share?.shared_by ?? "Someone",
          permission: share?.permission ?? "view",
        };
      }),
    });
  } catch {
    return serverError();
  }
}
