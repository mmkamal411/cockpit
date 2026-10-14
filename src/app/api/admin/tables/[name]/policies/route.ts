import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/admin/serviceClient";
import { adminRoute, isAdminTable, jsonError } from "@/lib/admin/routeHandler";

/** Admin data must never be statically cached. */

/**
 * GET /api/admin/tables/[name]/policies
 * Returns { rls_enabled, rls_forced, policies: [{ name, command, roles, using, with_check }] }
 * from pg_catalog via the admin_table_policies() RPC (migration 005_admin_helpers.sql).
 * Unknown table names are rejected with 400.
 */
export const GET = adminRoute<{ name: string }>(async (_adminEmail, _req, ctx) => {
  const { name } = await ctx.params;
  if (!isAdminTable(name)) {
    return jsonError(
      `Unknown table "${name}". Admin browsing is limited to the known tables.`,
      400,
    );
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("admin_table_policies", { p_table: name });
  if (error) {
    throw new Error(
      `Could not read RLS policies for "${name}". ` +
        `Apply supabase/migrations/005_admin_helpers.sql. (${error.message})`,
    );
  }

  return NextResponse.json(
    data as { rls_enabled: boolean; rls_forced: boolean; policies: unknown[] },
  );
});
