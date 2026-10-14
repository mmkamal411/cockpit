import { createBrowserClient } from "@supabase/ssr";
import { supabasePublicConfig, fetchWithTimeout } from "./config";

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
  const { url, key } = supabasePublicConfig();
  browserClient = createBrowserClient(url, key, {
    global: { fetch: fetchWithTimeout() },
  });
  return browserClient;
}
