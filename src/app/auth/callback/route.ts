import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { authFailureCode, safePostAuthNext } from "@/lib/auth/callback-helpers";
import { supabasePublicConfig } from "@/lib/supabase/config";

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
    try {
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
      const { error, data } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) {
        // Ensure the pilot row exists (no DB trigger creates it). Idempotent.
        // Also backfills the sign-in email (powers share-by-email lookup) and
        // claims any list shares addressed to this email (invite redemption).
        try {
          const uid = data.user?.id;
          const email = data.user?.email?.trim().toLowerCase() || null;
          if (uid) {
            const row: { id: string; email?: string | null } = { id: uid };
            if (email) row.email = email;
            await supabase.from("pilots").upsert(row, { onConflict: "id" });
            if (email) {
              // Claim pending shares: RLS `shares_claim` policy lets the
              // pilot set shared_with_pilot_id only on rows addressed to
              // their own sign-in email that nobody has claimed yet.
              await supabase
                .from("shopping_list_shares")
                .update({ shared_with_pilot_id: uid })
                .is("shared_with_pilot_id", null)
                .eq("shared_with_email", email);
            }
          }
        } catch {
          // Non-fatal: the pilot can still use the app; crew features
          // degrade gracefully until the row exists.
        }
        const response = NextResponse.redirect(`${origin}${next}`);
        for (const { name, value, options } of pendingCookies) {
          response.cookies.set(name, value, options);
        }
        return response;
      }
      return NextResponse.redirect(`${origin}/login?error=${authFailureCode(error.message)}`);
    } catch (e) {
      // Never 500 mid-sign-in: log it, send the pilot back to login with a
      // plain-English error they can act on.
      console.error(JSON.stringify({
        route: "/auth/callback",
        operation: "exchangeCodeForSession",
        error: e instanceof Error ? e.message : String(e),
        timestamp: new Date().toISOString(),
      }));
      return NextResponse.redirect(`${origin}/login?error=auth`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth`);
}
