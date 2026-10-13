import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/** Server Supabase client (Server Components, Actions, Route Handlers). */
export async function createClient() {
  const cookieStore = await cookies();
  // Hardcoded fallback: Cloudflare Pages direct-upload deployments don't
  // inherit project env vars into the worker runtime's process.env.
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "https://hwnesewathbnfvoxtbqh.supabase.co";
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    "sb_publishable_-gpFmkywUHJ9G3Yg2tPueQ_0J4DjqL0";
  return createServerClient(supabaseUrl, supabaseKey, {
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
