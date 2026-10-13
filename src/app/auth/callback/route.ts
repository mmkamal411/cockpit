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
        // Ensure the pilot row exists. Migration 034's auth.users trigger
        // provisions it at signup; this upsert is the email backfill plus
        // the repair path for pre-trigger users. A missing pilots row breaks
        // every pilot_id-keyed write (FK violation), so a failure here is
        // FAIL-LOUD: the pilot goes back to /login with a plain-English
        // retry path instead of into an app that silently can't save
        // anything.
        let provisioned = false;
        try {
          const uid = data.user?.id;
          const email = data.user?.email?.trim().toLowerCase() || null;
          if (uid) {
            const row: { id: string; email?: string | null } = { id: uid };
            if (email) row.email = email;
            const { error: upsertErr } = await supabase
              .from("pilots")
              .upsert(row, { onConflict: "id" });
            if (upsertErr) throw upsertErr;
            const { data: check } = await supabase
              .from("pilots")
              .select("id")
              .eq("id", uid)
              .maybeSingle();
            provisioned = !!check?.id;
            if (email) {
              // Claim pending shares: best-effort, never blocks sign-in.
              try {
                await supabase
                  .from("shopping_list_shares")
                  .update({ shared_with_pilot_id: uid })
                  .is("shared_with_pilot_id", null)
                  .eq("shared_with_email", email);
              } catch {
                /* invite redemption retries on the next sign-in */
              }
              // Same for to-do list shares (037).
              try {
                await supabase
                  .from("todo_list_shares")
                  .update({ shared_with_pilot_id: uid })
                  .is("shared_with_pilot_id", null)
                  .eq("shared_with_email", email);
              } catch {
                /* invite redemption retries on the next sign-in */
              }
            }
          }
        } catch (e) {
          // Loud server-side log — the pilot-facing copy lives on /login.
          console.error(
            JSON.stringify({
              route: "/auth/callback",
              operation: "provisionPilot",
              error: e instanceof Error ? e.message : String(e),
              timestamp: new Date().toISOString(),
            }),
          );
        }
        const dest =
          data.user?.id && !provisioned ? `${origin}/login?error=provision` : `${origin}${next}`;
        const response = NextResponse.redirect(dest);
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
