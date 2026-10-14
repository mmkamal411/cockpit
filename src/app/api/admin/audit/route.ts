import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/admin/serviceClient";
import { adminRoute, escapeIlike, pageParams } from "@/lib/admin/routeHandler";

/** Admin data must never be statically cached. */

/**
 * GET /api/admin/audit
 * Query: actor (matches actor_email), action, target_type, page, limit.
 * Returns { entries: [...], total, page, limit } — newest first.
 */
export const GET = adminRoute(async (_adminEmail, req) => {
  const admin = createAdminClient();
  const searchParams = req.nextUrl.searchParams;
  const actor = (searchParams.get("actor") ?? "").trim();
  const action = (searchParams.get("action") ?? "").trim();
  const targetType = (searchParams.get("target_type") ?? "").trim();
  const { page, limit, from, to } = pageParams(searchParams, 50, 500);

  let query = admin.from("admin_audit_log").select("*", { count: "exact" });
  if (actor) query = query.ilike("actor_email", `%${escapeIlike(actor)}%`);
  if (action) query = query.ilike("action", `%${escapeIlike(action)}%`);
  if (targetType) query = query.eq("target_type", targetType);

  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) {
    // 42P01 = table does not exist: 003_admin_audit.sql was never applied.
    if (error.code === "42P01") {
      return NextResponse.json({ entries: [], total: 0, page, limit, unavailable: true });
    }
    throw new Error(error.message);
  }

  return NextResponse.json({
    entries: (data ?? []) as Record<string, unknown>[],
    total: count ?? 0,
    page,
    limit,
  });
});
