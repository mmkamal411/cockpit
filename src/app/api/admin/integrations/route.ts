import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/admin/serviceClient";
import { adminRoute } from "@/lib/admin/routeHandler";

/** Admin data must never be statically cached. */

export type IntegrationStatusValue = "ok" | "error" | "unknown";

export interface IntegrationHealth {
  id: string;
  name: string;
  status: IntegrationStatusValue;
  detail: string;
  last_checked: string;
}

/** Server-side only. The worker's /health endpoint requires the shared
 *  secret (Phase 0) — this check attaches it like every other server
 *  caller. The URL has a server-side default; CRYSTAL_URL is NOT a
 *  NEXT_PUBLIC_ var, so the browser never learns the worker URL. */
const CRYSTAL_HEALTH_URL = (
  process.env.CRYSTAL_URL || "https://crystal.mehedikamal.workers.dev"
).replace(/\/$/, "") + "/health";

/** Shared secret for the crystal worker (server-side only). */
const CRYSTAL_SECRET = process.env.CRYSTAL_WORKER_SECRET ?? "";

function withTimeout(ms: number): { signal: AbortSignal; cancel: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

/** Supabase: can the admin client actually query the database? */
export async function checkSupabase(): Promise<IntegrationHealth> {
  const lastChecked = new Date().toISOString();
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("pilots").select("id", { count: "exact", head: true });
    if (error) {
      return {
        id: "supabase",
        name: "Supabase",
        status: "error",
        detail: `Query failed: ${error.message}`,
        last_checked: lastChecked,
      };
    }
    return {
      id: "supabase",
      name: "Supabase",
      status: "ok",
      detail: "Service-role query succeeded.",
      last_checked: lastChecked,
    };
  } catch (err) {
    return {
      id: "supabase",
      name: "Supabase",
      status: "error",
      detail: err instanceof Error ? err.message : "Unknown error",
      last_checked: lastChecked,
    };
  }
}

/** Crystal worker: does the /health endpoint answer? */
export async function checkCrystal(): Promise<IntegrationHealth> {
  const lastChecked = new Date().toISOString();
  const { signal, cancel } = withTimeout(8000);
  try {
    const headers: Record<string, string> = {};
    if (CRYSTAL_SECRET) headers["Authorization"] = `Bearer ${CRYSTAL_SECRET}`;
    const res = await fetch(CRYSTAL_HEALTH_URL, { signal, headers });
    cancel();
    if (res.ok) {
      return {
        id: "crystal",
        name: "Crystal worker",
        status: "ok",
        detail: `Health endpoint answered HTTP ${res.status}.`,
        last_checked: lastChecked,
      };
    }
    if (res.status === 401) {
      return {
        id: "crystal",
        name: "Crystal worker",
        status: "error",
        detail:
          "Health endpoint denied the request (unauthorized) — the CRYSTAL_WORKER_SECRET is missing or wrong.",
        last_checked: lastChecked,
      };
    }
    return {
      id: "crystal",
      name: "Crystal worker",
      status: "error",
      detail: `Health endpoint answered HTTP ${res.status}.`,
      last_checked: lastChecked,
    };
  } catch (err) {
    cancel();
    const reason = err instanceof Error ? err.message : "Unknown error";
    return {
      id: "crystal",
      name: "Crystal worker",
      status: "error",
      detail: `Unreachable: ${reason.slice(0, 160)}`,
      last_checked: lastChecked,
    };
  }
}

/**
 * Google OAuth: env presence only — never secret values. "unknown" (not
 * "error") when unconfigured, because absence of env vars is a setup state,
 * not necessarily an outage.
 */
export function checkGoogleOAuth(): IntegrationHealth {
  const lastChecked = new Date().toISOString();
  const hasId = Boolean(
    process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID,
  );
  const hasSecret = Boolean(process.env.GOOGLE_CLIENT_SECRET);
  const present = [hasId, hasSecret].filter(Boolean).length;
  return {
    id: "google-oauth",
    name: "Google OAuth",
    status: present === 2 ? "ok" : "unknown",
    detail:
      present === 2
        ? "Client ID and secret are configured (values never shown)."
        : `Not fully configured (${present}/2 env vars present).`,
    last_checked: lastChecked,
  };
}

/** Cloudflare: env presence only — never secret values. */
export function checkCloudflare(): IntegrationHealth {
  const lastChecked = new Date().toISOString();
  const hasToken = Boolean(process.env.CLOUDFLARE_API_TOKEN);
  const hasAccount = Boolean(process.env.CLOUDFLARE_ACCOUNT_ID);
  return {
    id: "cloudflare",
    name: "Cloudflare",
    status: hasToken ? "ok" : "unknown",
    detail: hasToken
      ? "API token is configured (value never shown)."
      : `Not configured (token ${hasToken ? "present" : "missing"}, account ${hasAccount ? "present" : "missing"}).`,
    last_checked: lastChecked,
  };
}

/**
 * GET /api/admin/integrations
 * Returns { integrations: [{ id, name, status, detail, last_checked }] }.
 * Never includes secret values — only presence/detail strings.
 */
export const GET = adminRoute(async () => {
  const [supabase, crystal] = await Promise.all([checkSupabase(), checkCrystal()]);
  const integrations: IntegrationHealth[] = [
    supabase,
    crystal,
    checkGoogleOAuth(),
    checkCloudflare(),
  ];
  return NextResponse.json({ integrations });
});
