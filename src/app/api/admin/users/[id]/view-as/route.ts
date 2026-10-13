import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/admin/serviceClient";
import { logAdminAction } from "@/lib/admin/audit";
import { adminRoute, jsonError } from "@/lib/admin/routeHandler";
import { getPilot } from "@/lib/admin/pilots";

/** Admin data must never be statically cached. */

/**
 * GET /api/admin/users/[id]/view-as
 * Read-only impersonation VIEW DATA — the payload the user's own dashboard
 * would show (crew with latest grade syncs, open todos, pending nudges,
 * active layout, integration summary). No session is created, nothing is
 * written. Secrets (integration config, vault username refs) are stripped.
 * The view itself is audit-logged.
 */
export const GET = adminRoute<{ id: string }>(async (adminEmail, _req, ctx) => {
  const { id } = await ctx.params;
  const admin = createAdminClient();

  const pilot = await getPilot(admin, id);
  if (!pilot) return jsonError("User not found", 404);

  const { data: authData } = await admin.auth.admin.getUserById(id);
  const email = authData?.user?.email ?? "";

  const [crewResult, todosResult, nudgesResult, layoutResult, integrationsResult] =
    await Promise.all([
      admin.from("crew_members").select("*").eq("pilot_id", id),
      admin
        .from("todos")
        .select("*")
        .eq("pilot_id", id)
        .eq("done", false)
        .order("due_at", { ascending: true, nullsFirst: false })
        .limit(200),
      admin
        .from("nudges")
        .select("*")
        .eq("pilot_id", id)
        .is("dismissed_at", null)
        .order("scheduled_for", { ascending: true, nullsFirst: true })
        .limit(100),
      admin
        .from("cockpit_layouts")
        .select("*")
        .eq("pilot_id", id)
        .eq("active", true)
        .order("generated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin.from("pilot_integrations").select("kind, provider, status, connected_at").eq("pilot_id", id),
    ]);
  if (crewResult.error) throw new Error(crewResult.error.message);
  if (todosResult.error) throw new Error(todosResult.error.message);
  if (nudgesResult.error) throw new Error(nudgesResult.error.message);
  if (layoutResult.error) throw new Error(layoutResult.error.message);
  if (integrationsResult.error) throw new Error(integrationsResult.error.message);

  const crewRows = (crewResult.data ?? []) as Record<string, unknown>[];
  const crewIds = crewRows.map((row) => row.id as string);

  const [syncsResult, schoolLinksResult, syncCountsResult] = await Promise.all([
    crewIds.length > 0
      ? admin
          .from("crew_grade_syncs")
          .select("*")
          .in("crew_member_id", crewIds)
          .order("synced_at", { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    crewIds.length > 0
      ? admin.from("crew_school_links").select("*").in("crew_member_id", crewIds)
      : Promise.resolve({ data: [], error: null }),
    crewIds.length > 0
      ? admin.from("crew_grade_syncs").select("crew_member_id").in("crew_member_id", crewIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (syncsResult.error) throw new Error(syncsResult.error.message);
  if (schoolLinksResult.error) throw new Error(schoolLinksResult.error.message);
  if (syncCountsResult.error) throw new Error(syncCountsResult.error.message);

  // Latest sync per crew member (rows arrive synced_at desc, first wins).
  const latestSync = new Map<string, Record<string, unknown>>();
  for (const row of (syncsResult.data ?? []) as Record<string, unknown>[]) {
    const crewId = row.crew_member_id as string;
    if (!latestSync.has(crewId)) latestSync.set(crewId, row);
  }
  const syncCounts = new Map<string, number>();
  for (const row of (syncCountsResult.data ?? []) as { crew_member_id: string }[]) {
    syncCounts.set(row.crew_member_id, (syncCounts.get(row.crew_member_id) ?? 0) + 1);
  }
  const schoolLinks = new Map<string, Record<string, unknown>>();
  for (const row of (schoolLinksResult.data ?? []) as Record<string, unknown>[]) {
    const { username_ref: _usernameRef, ...safe } = row;
    schoolLinks.set(row.crew_member_id as string, safe);
  }

  const crew = crewRows.map((row) => ({
    ...row,
    school_link: schoolLinks.get(row.id as string) ?? null,
    latest_sync: latestSync.get(row.id as string) ?? null,
    sync_count: syncCounts.get(row.id as string) ?? 0,
  }));

  await logAdminAction(admin, {
    actorEmail: adminEmail,
    action: "admin.impersonate_view",
    targetType: "pilot",
    targetId: id,
    metadata: { email, read_only: true },
  });

  return NextResponse.json({
    pilot: {
      id: pilot.id,
      email,
      display_name: pilot.display_name,
      timezone: pilot.timezone,
      created_at: pilot.created_at,
      suspended: pilot.suspended ?? false,
    },
    crew,
    todos: todosResult.data ?? [],
    nudges: nudgesResult.data ?? [],
    layout: layoutResult.data ?? null,
    integrations: integrationsResult.data ?? [],
  });
});
