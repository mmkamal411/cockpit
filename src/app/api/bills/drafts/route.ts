import { NextResponse } from "next/server";
import { pilotRoute, dbErrorMessage } from "@/lib/api/pilotRoute";

/**
 * GET /api/bills/drafts
 * Query: state=pending|confirmed|dismissed (default: pending).
 *
 * Detection candidates awaiting pilot approval. In v1 the email parser
 * that feeds this tray is deferred (needs the Mail module), so the tray
 * will usually be empty — the table and endpoints exist so the parser
 * has a contract to write to when it lands.
 *
 * Returns { drafts: [...] }.
 */
export const GET = pilotRoute(async ({ supabase, pilotId }, req) => {
  const state = req.nextUrl.searchParams.get("state") ?? "pending";
  const want = ["pending", "confirmed", "dismissed"].includes(state) ? state : "pending";

  // Prune expired pending drafts opportunistically (cheap, keeps the tray honest).
  await supabase
    .from("bill_drafts")
    .delete()
    .eq("pilot_id", pilotId)
    .eq("state", "pending")
    .lt("expires_at", new Date().toISOString());

  const { data, error } = await supabase
    .from("bill_drafts")
    .select("*")
    .eq("pilot_id", pilotId)
    .eq("state", want)
    .order("created_at", { ascending: false });

  if (error) {
    const { message, status } = dbErrorMessage(error);
    return NextResponse.json({ error: message }, { status });
  }
  return NextResponse.json({ drafts: data ?? [] });
});
