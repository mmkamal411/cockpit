import { NextResponse } from "next/server";

/**
 * TEMPORARY deploy-method verification route.
 *
 * Returns only presence booleans for env vars — NEVER secret values.
 * Used to prove that git-connected Cloudflare Pages deploys inject the
 * project-configured env vars into the worker runtime (the thing
 * direct-upload deploys failed to do).
 *
 * DELETE THIS FILE once the deploy-method verification is complete.
 * It must not ship to production.
 */
const CHECKS = [
  "ADMIN_EMAILS",
  "GOOGLE_CALENDAR_CLIENT_ID",
  "GOOGLE_CALENDAR_CLIENT_SECRET",
  "CALENDAR_TOKEN_KEY",
  "CRYSTAL_WORKER_SECRET",
  "OUTLOOK_CLIENT_ID",
  "OUTLOOK_CLIENT_SECRET",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
] as const;

export const dynamic = "force-dynamic";

export async function GET() {
  const present: Record<string, boolean> = {};
  for (const key of CHECKS) {
    present[key] = Boolean(process.env[key]);
  }
  return NextResponse.json({ deploy_method_check: true, present });
}
