import { createBrowserClient } from "@supabase/ssr";

/**
 * Browser Supabase client — SINGLETON.
 *
 * One shared client for the whole app. Creating a new client per call
 * breaks auth (the session lives in one instance while another checks
 * it, so login "goes nowhere"). Never refactor into a per-call factory.
 */
let browserClient: ReturnType<typeof createBrowserClient> | undefined;

export function createClient() {
  if (browserClient) return browserClient;
  // Hardcoded fallback: Cloudflare Pages direct-upload deployments don't
  // inherit project env vars into the worker runtime's process.env.
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "https://hwnesewathbnfvoxtbqh.supabase.co";
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    "sb_publishable_-gpFmkywUHJ9G3Yg2tPueQ_0J4DjqL0";
  browserClient = createBrowserClient(supabaseUrl, supabaseKey);
  return browserClient;
}
