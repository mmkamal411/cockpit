import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/admin/serviceClient";
import { logAdminAction } from "@/lib/admin/audit";
import { adminRoute, jsonError, redactSecrets } from "@/lib/admin/routeHandler";
import { getPilot } from "@/lib/admin/pilots";

/** Admin data must never be statically cached. */

/**
 * GET /api/admin/users/[id]
 * Full detail: pilot row, auth user info, integrations (config stripped),
 * crew members with grade-sync counts and school-link status, todos/nudges
 * counts, and the 20 most recent audit entries for this user.
 */
export const GET = adminRoute<{ id: string }>(async (_adminEmail, _req, ctx) => {
  const { id } = await ctx.params;
  const admin = createAdminClient();

  const pilot = await getPilot(admin, id);
  if (!pilot) return jsonError("User not found", 404);

  const { data: authData, error: authError } = await admin.auth.admin.getUserById(id);
  if (authError || !authData?.user) return jsonError("Auth user not found", 404);
  const authUser = authData.user;

  const [
    integrationsResult,
    crewResult,
    todosResult,
    nudgesResult,
    auditResult,
  ] = await Promise.all([
    admin.from("pilot_integrations").select("*").eq("pilot_id", id),
    admin.from("crew_members").select("*").eq("pilot_id", id),
    admin.from("todos").select("id, done").eq("pilot_id", id),
    admin
      .from("nudges")
      .select("id, dismissed_at")
      .eq("pilot_id", id),
    admin
      .from("admin_audit_log")
      .select("*")
      .eq("target_type", "pilot")
      .eq("target_id", id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  if (integrationsResult.error) throw new Error(integrationsResult.error.message);
  if (crewResult.error) throw new Error(crewResult.error.message);
  if (todosResult.error) throw new Error(todosResult.error.message);
  if (nudgesResult.error) throw new Error(nudgesResult.error.message);

  const crewRows = (crewResult.data ?? []) as Record<string, unknown>[];
  const crewIds = crewRows.map((row) => row.id as string);

  // Per-crew grade-sync counts + school links (username_ref stripped — it is
  // a vault reference, never shown in the admin UI).
  const [syncCountsResult, schoolLinksResult] = await Promise.all([
    crewIds.length > 0
      ? admin.from("crew_grade_syncs").select("crew_member_id").in("crew_member_id", crewIds)
      : Promise.resolve({ data: [], error: null }),
    crewIds.length > 0
      ? admin.from("crew_school_links").select("*").in("crew_member_id", crewIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (syncCountsResult.error) throw new Error(syncCountsResult.error.message);
  if (schoolLinksResult.error) throw new Error(schoolLinksResult.error.message);

  const syncCounts = new Map<string, number>();
  for (const row of (syncCountsResult.data ?? []) as { crew_member_id: string }[]) {
    syncCounts.set(row.crew_member_id, (syncCounts.get(row.crew_member_id) ?? 0) + 1);
  }
  const schoolLinks = new Map<string, Record<string, unknown>>();
  for (const row of (schoolLinksResult.data ?? []) as Record<string, unknown>[]) {
    const { username_ref: _usernameRef, ...safe } = row;
    schoolLinks.set(row.crew_member_id as string, safe);
  }

  const integrations = ((integrationsResult.data ?? []) as Record<string, unknown>[]).map(
    (row) => {
      const { config: _config, ...safe } = row;
      return safe;
    },
  );
  const crew = crewRows.map((row) => ({
    ...row,
    grade_sync_count: syncCounts.get(row.id as string) ?? 0,
    school_link: schoolLinks.get(row.id as string) ?? null,
  }));

  const todos = (todosResult.data ?? []) as { id: string; done: boolean }[];
  const nudges = (nudgesResult.data ?? []) as { id: string; dismissed_at: string | null }[];

  return NextResponse.json({
    pilot: { ...pilot, suspended: pilot.suspended ?? false },
    auth: {
      email: authUser.email ?? "",
      last_sign_in_at: authUser.last_sign_in_at ?? null,
      confirmed: Boolean(authUser.email_confirmed_at),
      created_at: authUser.created_at,
    },
    integrations,
    crew,
    counts: {
      integrations: integrations.length,
      crew_members: crew.length,
      todos_total: todos.length,
      todos_open: todos.filter((todo) => !todo.done).length,
      nudges_total: nudges.length,
      nudges_pending: nudges.filter((nudge) => !nudge.dismissed_at).length,
    },
    // The audit table may not exist yet if 003 was never applied.
    recent_audit: auditResult.error ? [] : (auditResult.data ?? []),
  });
});

interface DeleteCounts {
  pilots: number;
  crew_members: number;
  crew_grade_syncs: number;
  crew_access_grants: number;
  crew_school_links: number;
  pilot_integrations: number;
  todos: number;
  nudges: number;
  cockpit_layouts: number;
}

async function countDeletions(
  admin: ReturnType<typeof createAdminClient>,
  pilotId: string,
  pilotExists: boolean,
): Promise<DeleteCounts> {
  const counts: DeleteCounts = {
    pilots: pilotExists ? 1 : 0,
    crew_members: 0,
    crew_grade_syncs: 0,
    crew_access_grants: 0,
    crew_school_links: 0,
    pilot_integrations: 0,
    todos: 0,
    nudges: 0,
    cockpit_layouts: 0,
  };

  const crewResult = await admin.from("crew_members").select("id").eq("pilot_id", pilotId);
  if (crewResult.error) throw new Error(crewResult.error.message);
  const crewIds = ((crewResult.data ?? []) as { id: string }[]).map((row) => row.id);
  counts.crew_members = crewIds.length;

  const [syncs, grants, schoolLinks, integrations, todos, nudges, layouts] = await Promise.all([
    crewIds.length > 0
      ? admin.from("crew_grade_syncs").select("id", { count: "exact", head: true }).in("crew_member_id", crewIds)
      : Promise.resolve({ count: 0, error: null }),
    crewIds.length > 0
      ? admin.from("crew_access_grants").select("id", { count: "exact", head: true }).in("crew_member_id", crewIds)
      : Promise.resolve({ count: 0, error: null }),
    crewIds.length > 0
      ? admin.from("crew_school_links").select("id", { count: "exact", head: true }).in("crew_member_id", crewIds)
      : Promise.resolve({ count: 0, error: null }),
    admin.from("pilot_integrations").select("id", { count: "exact", head: true }).eq("pilot_id", pilotId),
    admin.from("todos").select("id", { count: "exact", head: true }).eq("pilot_id", pilotId),
    admin.from("nudges").select("id", { count: "exact", head: true }).eq("pilot_id", pilotId),
    admin.from("cockpit_layouts").select("id", { count: "exact", head: true }).eq("pilot_id", pilotId),
  ]);
  for (const result of [syncs, grants, schoolLinks, integrations, todos, nudges, layouts]) {
    if (result.error) throw new Error(result.error.message);
  }
  counts.crew_grade_syncs = syncs.count ?? 0;
  counts.crew_access_grants = grants.count ?? 0;
  counts.crew_school_links = schoolLinks.count ?? 0;
  counts.pilot_integrations = integrations.count ?? 0;
  counts.todos = todos.count ?? 0;
  counts.nudges = nudges.count ?? 0;
  counts.cockpit_layouts = layouts.count ?? 0;
  return counts;
}

async function must(promise: PromiseLike<{ error: unknown }>, label: string): Promise<void> {
  const { error } = await promise;
  if (error) {
    const message = error instanceof Error ? error.message : JSON.stringify(error);
    throw new Error(`Delete failed at ${label}: ${message}`);
  }
}

/**
 * DELETE /api/admin/users/[id]
 *   ?preview=true  -> { would_delete: {...}, user: {id, email} }, no deletion.
 *   otherwise      -> requires JSON body { confirm: "<typed email>" } matching
 *                     the user's email exactly (case-insensitive). Deletes the
 *                     auth user plus every cascaded row, then audit-logs.
 * Both-layer admin guard (env allowlist + admin_users DB row).
 */
export const DELETE = adminRoute<{ id: string }>(
  async (adminEmail, req: NextRequest, ctx) => {
    const { id } = await ctx.params;
    const admin = createAdminClient();

    const { data: authData, error: authError } = await admin.auth.admin.getUserById(id);
    if (authError || !authData?.user) return jsonError("User not found", 404);
    const authUser = authData.user;
    const email = (authUser.email ?? "").trim();

    const pilot = await getPilot(admin, id);
    const wouldDelete = await countDeletions(admin, id, pilot !== null);

    if (req.nextUrl.searchParams.get("preview") === "true") {
      return NextResponse.json({ would_delete: wouldDelete, user: { id, email } });
    }

    let body: { confirm?: unknown };
    try {
      body = (await req.json()) as { confirm?: unknown };
    } catch {
      return jsonError("Request body must be JSON: { confirm: \"<email>\" }.", 400);
    }
    const confirm = typeof body.confirm === "string" ? body.confirm.trim().toLowerCase() : "";
    if (!confirm || confirm !== email.toLowerCase()) {
      return jsonError(
        "Confirmation email does not match. Type the user's exact email to confirm deletion.",
        400,
      );
    }

    const before = redactSecrets({
      pilot,
      auth: { email, last_sign_in_at: authUser.last_sign_in_at },
      would_delete: wouldDelete,
    });

    // Delete leaf tables first, then the pilot row, then the auth user.
    // (FK cascades would also clean up, but explicit order keeps the audit
    // trail honest and survives any cascade drift.)
    const crewResult = await admin.from("crew_members").select("id").eq("pilot_id", id);
    if (crewResult.error) throw new Error(crewResult.error.message);
    const crewIds = ((crewResult.data ?? []) as { id: string }[]).map((row) => row.id);

    if (crewIds.length > 0) {
      await must(admin.from("crew_grade_syncs").delete().in("crew_member_id", crewIds), "crew_grade_syncs");
      await must(admin.from("crew_access_grants").delete().in("crew_member_id", crewIds), "crew_access_grants");
      await must(admin.from("crew_school_links").delete().in("crew_member_id", crewIds), "crew_school_links");
    }
    await must(admin.from("crew_members").delete().eq("pilot_id", id), "crew_members");
    await must(admin.from("crew_access_grants").delete().eq("grantee_pilot_id", id), "crew_access_grants (as grantee)");
    await must(admin.from("pilot_integrations").delete().eq("pilot_id", id), "pilot_integrations");
    await must(admin.from("todos").delete().eq("pilot_id", id), "todos");
    await must(admin.from("nudges").delete().eq("pilot_id", id), "nudges");
    await must(admin.from("cockpit_layouts").delete().eq("pilot_id", id), "cockpit_layouts");
    if (pilot) {
      await must(admin.from("pilots").delete().eq("id", id), "pilots");
    }

    const { error: deleteAuthError } = await admin.auth.admin.deleteUser(id);
    if (deleteAuthError) {
      // App data is gone but the auth user survived — surface loudly so an
      // admin can retry; the user can no longer sign in to anything anyway.
      await logAdminAction(admin, {
        actorEmail: adminEmail,
        action: "user.delete",
        targetType: "pilot",
        targetId: id,
        before,
        after: { deleted: "partial", auth_user_remaining: true },
        metadata: { email, error: deleteAuthError.message },
      });
      return jsonError(
        `App data deleted, but the auth user could not be removed: ${deleteAuthError.message}. Retry the delete.`,
        500,
      );
    }

    await logAdminAction(admin, {
      actorEmail: adminEmail,
      action: "user.delete",
      targetType: "pilot",
      targetId: id,
      before,
      after: { deleted: true, email },
      metadata: { email, would_delete: wouldDelete },
    });

    return NextResponse.json({ deleted: true, id, email, would_delete: wouldDelete });
  },
  { bothLayers: true },
);
