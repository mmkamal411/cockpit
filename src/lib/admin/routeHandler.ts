import { NextRequest, NextResponse } from "next/server";
import { requireAdmin, requireAdminBothLayers } from "./auth";

/**
 * Shared plumbing for /api/admin/* route handlers.
 *
 * Every admin route MUST call requireAdmin() first (the db expert's guard
 * throws a 403 Response when the caller is not an admin). adminRoute()
 * wraps that plus a catch that turns a thrown Response into the actual
 * HTTP response, so handlers stay focused on their own logic.
 *
 * Usage:
 *   export const GET = adminRoute(async (adminEmail, req) => { ... });
 *   export const DELETE = adminRoute(async (adminEmail, req, ctx) => {
 *     const { id } = await ctx.params;
 *     ...
 *   }, { bothLayers: true });
 */

type RouteHandler<P extends Record<string, string>> = (
  adminEmail: string,
  req: NextRequest,
  ctx: { params: Promise<P> },
) => Promise<Response>;

interface AdminRouteOptions {
  /**
   * Use the both-layer guard (ADMIN_EMAILS env + admin_users DB row).
   * For the most sensitive routes: user delete, table export, raw SQL.
   */
  bothLayers?: boolean;
}

export function adminRoute<P extends Record<string, string> = Record<string, string>>(
  handler: RouteHandler<P>,
  options?: AdminRouteOptions,
) {
  return async (req: NextRequest, ctx: { params: Promise<P> }): Promise<Response> => {
    try {
      const adminEmail = options?.bothLayers
        ? await requireAdminBothLayers()
        : await requireAdmin();
      return await handler(adminEmail, req, ctx);
    } catch (err) {
      if (err instanceof Response) return err;
      console.error("[admin] route error", err);
      return NextResponse.json(
        { error: "Something went wrong. Try again." },
        { status: 500 },
      );
    }
  };
}

export function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/** Parse page/limit query params with sane bounds. */
export function pageParams(
  searchParams: URLSearchParams,
  defaultLimit = 25,
  maxLimit = 500,
): { page: number; limit: number; from: number; to: number } {
  const page = Math.max(
    1,
    Number.parseInt(searchParams.get("page") ?? "1", 10) || 1,
  );
  const limit = Math.min(
    maxLimit,
    Math.max(1, Number.parseInt(searchParams.get("limit") ?? String(defaultLimit), 10) || defaultLimit),
  );
  return { page, limit, from: (page - 1) * limit, to: page * limit - 1 };
}

/** Tables the admin table browser / export / policies routes may touch. */
export const ADMIN_TABLES = [
  "pilots",
  "pilot_integrations",
  "crew_members",
  "crew_access_grants",
  "crew_school_links",
  "todos",
  "nudges",
  "cockpit_layouts",
  "crew_grade_syncs",
  // Admin surface itself (audit trail + allowlist). Included beyond the 9
  // app tables so admins can browse/audit them from the same UI.
  "admin_users",
  "admin_audit_log",
] as const;

export type AdminTableName = (typeof ADMIN_TABLES)[number];

export function isAdminTable(name: string): name is AdminTableName {
  return (ADMIN_TABLES as readonly string[]).includes(name);
}

const SECRET_KEY_PATTERN = /token|secret|password|api[_-]?key|private[_-]?key|cookie|session|authorization|credential/i;

/**
 * Deep-strip anything that looks like a secret before it goes into an
 * audit snapshot or an API response. Never expose service_role keys,
 * raw auth tokens, or passwords.
 */
export function redactSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map(redactSecrets) as unknown as T;
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_KEY_PATTERN.test(key) ? "[redacted]" : redactSecrets(entry);
    }
    return out as T;
  }
  return value;
}

/** Escape user input used inside a PostgREST ilike/or pattern. */
export function escapeIlike(raw: string): string {
  return raw.replace(/[\\%_*]/g, (match) => `\\${match}`);
}
