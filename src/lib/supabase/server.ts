import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabasePublicConfig, fetchWithTimeout } from "./config";

/** Server Supabase client (Server Components, Actions, Route Handlers). */
export async function createClient() {
  const cookieStore = await cookies();
  const { url, key } = supabasePublicConfig();
  return createServerClient(url, key, {
      global: { fetch: fetchWithTimeout() },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component — middleware refreshes the session.
          }
        },
      },
    },
  );
}
