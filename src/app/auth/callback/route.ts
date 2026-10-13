import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { authFailureCode, safePostAuthNext } from "@/lib/auth/callback-helpers";

/**
 * OAuth / magic-link callback. Supabase redirects here after the pilot
 * authenticates; we exchange the code for a session and hand off to /.
 *
 * Cloudflare Workers cookie rule: session cookies set during the code
 * exchange are captured in a local array and explicitly attached to the
 * redirect response. We do NOT rely on next/headers cookies().set()
 * propagation to a freshly-created NextResponse — that is silently
 * dropped on Workers (OpenNext), losing the session.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = safePostAuthNext(searchParams.get("next"));

  if (code) {
    const pendingCookies: { name: string; value: string; options?: object }[] = [];
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            pendingCookies.push(...cookiesToSet);
          },
        },
      },
    );
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const response = NextResponse.redirect(`${origin}${next}`);
      for (const { name, value, options } of pendingCookies) {
        response.cookies.set(name, value, options);
      }
      return response;
    }
    return NextResponse.redirect(`${origin}/login?error=${authFailureCode(error.message)}`);
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
