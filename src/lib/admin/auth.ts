import { createClient } from "../supabase/server";
import { createAdminClient } from "./serviceClient";

/**
 * Layer 1 of the admin gate: check the signed-in user's email against the
 * ADMIN_EMAILS env var (comma-separated, case-insensitive).
 *
 * Layer 2 lives in the database: public.is_admin(email) checks the
 * admin_users table. Use isAdminInDb() when a route needs both layers.
 */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const allowlist = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  return allowlist.includes(email.trim().toLowerCase());
}

/**
 * Layer 2 check: ask the database whether this email is an admin.
 * Uses the service-role client so the check works even for callers whose
 * JWT has no rights on admin_users. Never throws on DB failure — a failed
 * check denies access.
 */
export async function isAdminInDb(email: string): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("is_admin", { p_email: email });
    if (error) {
      console.error("[admin] is_admin RPC failed", error);
      return false;
    }
    return data === true;
  } catch (err) {
    console.error("[admin] is_admin RPC threw", err);
    return false;
  }
}

/**
 * Fail-closed denial for every admin auth layer. Plain-English message per
 * the product error standard — no jargon, no HTTP status codes to the user.
 */
function denyAdminAccess(): never {
  throw new Response(
    JSON.stringify({ error: "You don't have access to this." }),
    { status: 403, headers: { "Content-Type": "application/json" } },
  );
}

/**
 * Guard for admin route handlers (App Router). Resolves the caller from the
 * session cookie and checks the ADMIN_EMAILS allowlist.
 *
 * Returns the admin's email on success. Throws a 403 Response on failure.
 * Handlers should catch it and return it:
 *
 *   export async function GET(request: Request) {
 *     let adminEmail: string;
 *     try {
 *       adminEmail = await requireAdmin(request);
 *     } catch (response) {
 *       return response as Response;
 *     }
 *     // ... privileged work, audited via logAdminAction() ...
 *   }
 */
export async function requireAdmin(request?: Request): Promise<string> {
  void request;
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();
  const email = data?.user?.email ?? null;

  if (error || !email || !isAdminEmail(email)) {
    denyAdminAccess();
  }

  return email;
}

/**
 * Both-layer guard for the most sensitive routes (user delete, exports,
 * view-as). Throws the same plain-English 403 Response when EITHER layer
 * denies access — a single passing layer is never enough.
 */
export async function requireAdminBothLayers(
  request?: Request,
): Promise<string> {
  const email = await requireAdmin(request);
  if (!(await isAdminInDb(email))) {
    denyAdminAccess();
  }
  return email;
}
