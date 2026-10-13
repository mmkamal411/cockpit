import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/admin/serviceClient";
import { adminRoute, ADMIN_TABLES } from "@/lib/admin/routeHandler";

/** Admin data must never be statically cached. */

/**
 * GET /api/admin/tables
 * Returns [{ name, row_count }] for every admin-visible table.
 * Uses the admin_table_stats() RPC when available (migration
 * 005_admin_helpers.sql), falling back to per-table head counts.
 */
export const GET = adminRoute(async () => {
  const admin = createAdminClient();

  try {
    const { data, error } = await admin.rpc("admin_table_stats");
    if (error) throw error;
    return NextResponse.json({ tables: (data ?? []) as { name: string; row_count: number }[] });
  } catch (rpcError) {
    console.error("[admin] admin_table_stats RPC failed, falling back to head counts", rpcError);
    const tables = await Promise.all(
      ADMIN_TABLES.map(async (name) => {
        const { count, error } = await admin
          .from(name)
          .select("*", { count: "exact", head: true });
        if (error) throw new Error(`count failed for ${name}: ${error.message}`);
        return { name, row_count: count ?? 0 };
      }),
    );
    return NextResponse.json({ tables });
  }
});
