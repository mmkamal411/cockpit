import { NextResponse } from "next/server";
import { adminRoute, jsonError } from "@/lib/admin/routeHandler";
import {
  checkCloudflare,
  checkCrystal,
  checkGoogleOAuth,
  checkSupabase,
  type IntegrationHealth,
} from "../../route";

/** Admin data must never be statically cached. */

const CHECKS: Record<string, () => Promise<IntegrationHealth> | IntegrationHealth> = {
  supabase: checkSupabase,
  crystal: checkCrystal,
  "google-oauth": checkGoogleOAuth,
  cloudflare: checkCloudflare,
};

/**
 * POST /api/admin/integrations/[id]/test
 * Re-runs the health check for one integration.
 * ids: supabase | crystal | google-oauth | cloudflare.
 * Returns { integration: { id, name, status, detail, last_checked } }.
 */
export const POST = adminRoute<{ id: string }>(async (_adminEmail, _req, ctx) => {
  const { id } = await ctx.params;
  const check = CHECKS[id];
  if (!check) {
    return jsonError(
      `Unknown integration "${id}". Valid ids: ${Object.keys(CHECKS).join(", ")}.`,
      400,
    );
  }
  const integration = await check();
  return NextResponse.json({ integration });
});
