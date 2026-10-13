import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

export interface SessionRefresh {
  response: NextResponse;
  user: User | null;
}

/** Refreshes the auth session on every request; also reports the user. */
export async function updateSession(request: NextRequest): Promise<SessionRefresh> {
  let supabaseResponse = NextResponse.next({ request });

  // Public values (also in client bundle). Hardcoded as fallback because
  // Cloudflare Pages direct-upload deployments don't inherit project env vars
  // into the worker runtime's process.env.
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "https://hwnesewathbnfvoxtbqh.supabase.co";
  const supabaseKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    "sb_publishable_-gpFmkywUHJ9G3Yg2tPueQ_0J4DjqL0";

  const supabase = createServerClient(supabaseUrl, supabaseKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { response: supabaseResponse, user };
}
