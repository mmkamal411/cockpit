import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { supabasePublicConfig } from "@/lib/supabase/config";

/**
 * Sign out the current user. Clears the Supabase session cookies and
 * redirects to /login. Follows the Cloudflare Workers cookie rule:
 * cookies are captured from the SSR client and explicitly set on the
 * response — never relying on next/headers propagation.
 */
export async function POST(request: NextRequest) {
  const pendingCookies: { name: string; value: string; options?: object }[] = [];
  const { url, key } = supabasePublicConfig();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        pendingCookies.push(...cookiesToSet);
      },
    },
  });

  await supabase.auth.signOut();

  const response = NextResponse.json({ ok: true });
  for (const cookie of pendingCookies) {
    response.cookies.set(cookie.name, cookie.value, cookie.options as never);
  }
  return response;
}
