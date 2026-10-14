import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/admin/serviceClient";
import { adminRoute, jsonError } from "@/lib/admin/routeHandler";

/** Admin data must never be statically cached. */

const MAX_QUERY_ROWS = 500;

/** Strip SQL comments so the statement check sees the real first keyword. */
function stripComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/--[^\n]*/g, " ")
    .trim()
    .replace(/;+\s*$/, "");
}

function validateReadOnly(sql: string): string | null {
  const cleaned = stripComments(sql);
  if (!cleaned) return "sql is required.";
  if (!/^(select|with)\b/i.test(cleaned)) {
    return "Only SELECT or WITH statements are allowed.";
  }
  // After stripping the single trailing semicolon, any remaining semicolon
  // means stacked statements — reject.
  if (cleaned.includes(";")) {
    return "Multiple statements are not allowed. Send one SELECT or WITH query.";
  }
  return null;
}

/**
 * POST /api/admin/query
 * Body: { sql: string }. Read-only: only SELECT/WITH statements, 5-second
 * statement timeout, max 500 rows. Validation happens here AND inside the
 * admin_run_select() RPC (migration 005_admin_helpers.sql, defense in depth).
 * Returns { columns, rows, row_count }. Both-layer admin guard.
 */
export const POST = adminRoute(
  async (_adminEmail, req: NextRequest) => {
    let body: { sql?: unknown };
    try {
      body = (await req.json()) as { sql?: unknown };
    } catch {
      return jsonError("Request body must be JSON: { sql: \"...\" }.", 400);
    }
    if (typeof body.sql !== "string") {
      return jsonError("sql must be a string.", 400);
    }

    const validationError = validateReadOnly(body.sql);
    if (validationError) return jsonError(validationError, 400);

    const admin = createAdminClient();
    const { data, error } = await admin.rpc("admin_run_select", { p_sql: body.sql });
    if (error) {
      // Surface the DB/RPC message — it is either our validation message
      // or a SQL error the admin needs to see to fix their query.
      const message = error.message.replace(/^admin_run_select failed: /, "");
      return jsonError(message, 400);
    }

    const result = (data ?? {}) as {
      columns?: string[];
      rows?: Record<string, unknown>[];
      row_count?: number;
    };
    return NextResponse.json({
      columns: result.columns ?? [],
      rows: (result.rows ?? []).slice(0, MAX_QUERY_ROWS),
      row_count: result.row_count ?? 0,
    });
  },
  { bothLayers: true },
);
