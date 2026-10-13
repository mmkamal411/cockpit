import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { supabasePublicConfig, fetchWithTimeout } from "./config";

export interface SessionRefresh {
  response: NextResponse;
  user: User | null;
}

/** Refreshes the auth session on every request; also reports the user. */
export async function updateSession(request: NextRequest): Promise<SessionRefresh> {
  let supabaseResponse = NextResponse.next({ request });

  const { url, key } = supabasePublicConfig();

  const supabase = createServerClient(url, key, {
      global: { fetch: fetchWithTimeout() },
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
