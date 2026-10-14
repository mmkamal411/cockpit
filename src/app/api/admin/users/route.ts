import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/admin/serviceClient";
import { adminRoute, pageParams } from "@/lib/admin/routeHandler";
import { listAllAuthUsers, listPilots, type PilotRow } from "@/lib/admin/pilots";

/** Admin data must never be statically cached. */

type UserSort = "created_at" | "email" | "display_name";

interface AdminUserShape {
  id: string;
  email: string;
  display_name: string | null;
  created_at: string;
  crew_count: number;
  integration_count: number;
  suspended: boolean;
  last_sign_in_at: string | null;
}

/**
 * GET /api/admin/users
 * Query: q (search email or display name), sort (created_at|email|display_name),
 *        order (asc|desc), page, limit.
 * Returns { users: [...], total, page, limit }.
 */
export const GET = adminRoute(async (_adminEmail, req) => {
  const admin = createAdminClient();
  const searchParams = req.nextUrl.searchParams;
  const q = (searchParams.get("q") ?? "").trim().toLowerCase();
  const sortParam = searchParams.get("sort") ?? "created_at";
  const ascending = (searchParams.get("order") ?? "desc") === "asc";
  const { page, limit, from, to } = pageParams(searchParams, 25, 200);

  const sort: UserSort =
    sortParam === "email" ? "email" : sortParam === "display_name" ? "display_name" : "created_at";

  const authUsers = await listAllAuthUsers(admin);
  const authById = new Map(authUsers.map((user) => [user.id, user]));

  // Email lives in auth.users, not pilots — so any email search/sort runs
  // through the JS path (admin-scale table, this is fine).
  const needsJsPath = q.length > 0 || sort === "email";

  let pilots: PilotRow[];
  let total: number;

  if (needsJsPath) {
    let filtered = await listPilots(admin);
    if (q) {
      filtered = filtered.filter((pilot) => {
        const email = (authById.get(pilot.id)?.email ?? "").toLowerCase();
        return (
          email.includes(q) || (pilot.display_name ?? "").toLowerCase().includes(q)
        );
      });
    }
    const sortKey = (pilot: PilotRow): string => {
      if (sort === "email") return (authById.get(pilot.id)?.email ?? "").toLowerCase();
      if (sort === "display_name") return (pilot.display_name ?? "").toLowerCase();
      return pilot.created_at;
    };
    filtered.sort((a, b) => {
      const keyA = sortKey(a);
      const keyB = sortKey(b);
      const cmp = keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
      return ascending ? cmp : -cmp;
    });
    total = filtered.length;
    pilots = filtered.slice(from, to + 1);
  } else {
    const orderColumn = sort === "display_name" ? "display_name" : "created_at";
    const { data, error, count } = await admin
      .from("pilots")
      .select("id, display_name, timezone, created_at, suspended", { count: "exact" })
      .order(orderColumn, { ascending })
      .range(from, to);
    if (error) throw new Error(error.message);
    pilots = (data ?? []) as PilotRow[];
    total = count ?? 0;
  }

  const pilotIds = pilots.map((pilot) => pilot.id);
  const crewCounts = new Map<string, number>();
  const integrationCounts = new Map<string, number>();
  if (pilotIds.length > 0) {
    const [crewResult, integrationResult] = await Promise.all([
      admin.from("crew_members").select("pilot_id").in("pilot_id", pilotIds),
      admin.from("pilot_integrations").select("pilot_id").in("pilot_id", pilotIds),
    ]);
    if (crewResult.error) throw new Error(crewResult.error.message);
    if (integrationResult.error) throw new Error(integrationResult.error.message);
    for (const row of (crewResult.data ?? []) as { pilot_id: string }[]) {
      crewCounts.set(row.pilot_id, (crewCounts.get(row.pilot_id) ?? 0) + 1);
    }
    for (const row of (integrationResult.data ?? []) as { pilot_id: string }[]) {
      integrationCounts.set(row.pilot_id, (integrationCounts.get(row.pilot_id) ?? 0) + 1);
    }
  }

  const users: AdminUserShape[] = pilots.map((pilot) => {
    const authUser = authById.get(pilot.id);
    return {
      id: pilot.id,
      email: authUser?.email ?? "",
      display_name: pilot.display_name,
      created_at: pilot.created_at,
      crew_count: crewCounts.get(pilot.id) ?? 0,
      integration_count: integrationCounts.get(pilot.id) ?? 0,
      // suspended is null when 004_admin_suspend.sql has not been applied yet.
      suspended: pilot.suspended ?? false,
      last_sign_in_at: authUser?.last_sign_in_at ?? null,
    };
  });

  return NextResponse.json({ users, total, page, limit });
});
