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
  browserClient = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
  );
  return browserClient;
}
