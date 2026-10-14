import { NextResponse } from "next/server";
import { requirePilot, serverError } from "@/lib/api-auth";

/**
 * GET /api/shopping/suggestions?q=...
 * The pilot's own past item names (from purchase_history), for autocomplete.
 * Ordered by how often bought, then how recently. The client merges these
 * ahead of the built-in grocery catalog — this is the "Crystal notices what
 * you buy often" personalization.
 */
export async function GET(req: Request) {
  const auth = await requirePilot();
  if (auth instanceof NextResponse) return auth;
  const { supabase } = auth;

  try {
    const q = new URL(req.url).searchParams.get("q")?.trim().toLowerCase() ?? "";

    const { data, error } = await supabase
      .from("purchase_history")
      .select("item_name_normalized, completed_at")
      .order("completed_at", { ascending: false })
      .limit(400);
    if (error) throw error;

    // Count frequency, keep most-recent order for ties.
    const freq = new Map<string, number>();
    const seen = new Set<string>();
    const ordered: string[] = [];
    for (const row of data ?? []) {
      const name = (row.item_name_normalized ?? "").trim();
      if (!name) continue;
      freq.set(name, (freq.get(name) ?? 0) + 1);
      if (!seen.has(name)) {
        seen.add(name);
        ordered.push(name);
      }
    }
    ordered.sort((a, b) => (freq.get(b) ?? 0) - (freq.get(a) ?? 0));

    const matches = q
      ? ordered.filter((n) => n.includes(q))
      : ordered;
    return NextResponse.json({ suggestions: matches.slice(0, 8) });
  } catch {
    return serverError();
  }
}
