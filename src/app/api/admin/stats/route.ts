import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/admin/serviceClient";
import { adminRoute } from "@/lib/admin/routeHandler";
import { checkCloudflare, checkCrystal, checkGoogleOAuth, checkSupabase } from "../integrations/route";

/** Admin data must never be statically cached. */

/**
 * GET /api/admin/stats
 * Returns { pilots, crew_members, grade_syncs_24h, todos, integrations_ok,
 *           integrations_total } — the headline numbers for the admin
 * overview screen.
 */
export const GET = adminRoute(async () => {
  const admin = createAdminClient();

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [pilots, crewMembers, todos, gradeSyncs, supabaseHealth, crystalHealth] =
    await Promise.all([
      admin.from("pilots").select("id", { count: "exact", head: true }),
      admin.from("crew_members").select("id", { count: "exact", head: true }),
      admin.from("todos").select("id", { count: "exact", head: true }),
      admin
        .from("crew_grade_syncs")
        .select("id", { count: "exact", head: true })
        .gte("synced_at", dayAgo),
      checkSupabase(),
      checkCrystal(),
    ]);

  for (const result of [pilots, crewMembers, todos, gradeSyncs]) {
    if (result.error) throw new Error(result.error.message);
  }

  const integrations = [supabaseHealth, crystalHealth, checkGoogleOAuth(), checkCloudflare()];

  return NextResponse.json({
    pilots: pilots.count ?? 0,
    crew_members: crewMembers.count ?? 0,
    grade_syncs_24h: gradeSyncs.count ?? 0,
    todos: todos.count ?? 0,
    integrations_ok: integrations.filter((integration) => integration.status === "ok").length,
    integrations_total: integrations.length,
  });
});
