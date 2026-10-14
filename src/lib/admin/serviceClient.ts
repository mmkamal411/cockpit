import { createClient } from "@supabase/supabase-js";
import { supabasePublicConfig, fetchWithTimeout } from "@/lib/supabase/config";

/**
 * Server-only Supabase client with the SERVICE-ROLE key.
 *
 * This client BYPASSES Row Level Security. Use it ONLY in server code
 * (route handlers, server actions, cron workers) and ONLY behind the
 * admin gate (requireAdmin in ./auth.ts). Never import this module from
 * client components, never bundle it for the browser.
 *
 * Throws if called in the browser or if SUPABASE_SERVICE_ROLE_KEY is missing,
 * so a misconfigured deploy fails loudly instead of silently falling back
 * to a weaker client.
 */
export function createAdminClient() {
  if (typeof window !== "undefined") {
    throw new Error(
      "createAdminClient() must never run in the browser. " +
        "It holds the service-role key and bypasses RLS.",
    );
  }

  const { url } = supabasePublicConfig();
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceRoleKey) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. " +
        "The admin client cannot fall back to the publishable key.",
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: fetchWithTimeout() },
  });
}
