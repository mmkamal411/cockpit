import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/admin/serviceClient";
import {
  adminRoute,
  escapeIlike,
  isAdminTable,
  jsonError,
  pageParams,
} from "@/lib/admin/routeHandler";

/** Admin data must never be statically cached. */

const TEXT_TYPES = new Set([
  "text",
  "character varying",
  "character",
  "name",
  "uuid",
]);

interface ColumnInfo {
  name: string;
  data_type: string;
}

/** Column names + types, via RPC when available, else inferred from one row. */
async function getColumns(
  admin: ReturnType<typeof createAdminClient>,
  table: string,
): Promise<ColumnInfo[]> {
  try {
    const { data, error } = await admin.rpc("admin_table_columns", { p_table: table });
    if (error) throw error;
    return (data ?? []) as ColumnInfo[];
  } catch (rpcError) {
    console.error("[admin] admin_table_columns RPC failed, inferring from sample row", rpcError);
    const { data, error } = await admin.from(table).select("*").limit(1);
    if (error) throw new Error(error.message);
    const row = (data ?? [])[0] as Record<string, unknown> | undefined;
    return Object.keys(row ?? {}).map((name) => ({ name, data_type: "unknown" }));
  }
}

/**
 * GET /api/admin/tables/[name]
 * Query: q (search across text columns), sort, order, page, limit.
 * Returns { columns: string[], column_types: {...}, rows: [...], total, page, limit }.
 * Unknown table names are rejected with 400.
 */
export const GET = adminRoute<{ name: string }>(async (_adminEmail, req, ctx) => {
  const { name } = await ctx.params;
  if (!isAdminTable(name)) {
    return jsonError(
      `Unknown table "${name}". Admin browsing is limited to the known tables.`,
      400,
    );
  }

  const admin = createAdminClient();
  const searchParams = req.nextUrl.searchParams;
  const q = (searchParams.get("q") ?? "").trim();
  const { page, limit, from, to } = pageParams(searchParams, 25, 200);

  const columns = await getColumns(admin, name);
  const columnNames = columns.map((column) => column.name);
  if (columnNames.length === 0) {
    return NextResponse.json({
      columns: [],
      column_types: {},
      rows: [],
      total: 0,
      page,
      limit,
    });
  }

  const sortParam = searchParams.get("sort");
  const sort = sortParam && columnNames.includes(sortParam)
    ? sortParam
    : columnNames.includes("created_at")
      ? "created_at"
      : columnNames[0];
  const ascending = (searchParams.get("order") ?? "desc") === "asc";

  let query = admin.from(name).select("*", { count: "exact" });

  if (q) {
    const textColumns = columns
      .filter((column) => TEXT_TYPES.has(column.data_type))
      .map((column) => column.name);
    if (textColumns.length === 0) {
      return jsonError(
        `Table "${name}" has no searchable text columns.`,
        400,
      );
    }
    const pattern = `%${escapeIlike(q)}%`;
    query = query.or(textColumns.map((column) => `${column}.ilike.${pattern}`).join(","));
  }

  const { data, error, count } = await query.order(sort, { ascending }).range(from, to);
  if (error) throw new Error(error.message);

  return NextResponse.json({
    columns: columnNames,
    column_types: Object.fromEntries(columns.map((column) => [column.name, column.data_type])),
    rows: (data ?? []) as Record<string, unknown>[],
    total: count ?? 0,
    page,
    limit,
  });
});
