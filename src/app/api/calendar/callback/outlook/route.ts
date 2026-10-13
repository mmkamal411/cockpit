import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { supabasePublicConfig, fetchWithTimeout } from "@/lib/supabase/config";
import { encryptToken } from "@/lib/token-crypto";

const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const GRAPH_ME_URL = "https://graph.microsoft.com/v1.0/me";
const DEFAULT_REDIRECT_URI = "https://cockpit-10c.pages.dev/api/calendar/callback/outlook";

type PendingCookie = { name: string; value: string; options?: object };

/**
 * GET /api/calendar/callback/outlook?code=&state=
 * Microsoft 365 OAuth callback: exchanges the code, stores the connection.
 *
 * Cloudflare Workers cookie rule: this route builds its own Supabase client
 * with setAll() captured into a local array, then attaches any pending
 * cookies to the redirect response explicitly. We do NOT rely on
 * next/headers cookies().set() propagation — that is silently dropped on
 * Workers (OpenNext), losing the session.
 */
export async function GET(req: NextRequest) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get("code");
  const stateRaw = searchParams.get("state");
  const authError = searchParams.get("error");
  const appUrl = origin;

  const pendingCookies: PendingCookie[] = [];
  const redirect = (path: string) => {
    const res = NextResponse.redirect(`${appUrl}${path}`);
    for (const { name, value, options } of pendingCookies) {
      res.cookies.set(name, value, options);
    }
    return res;
  };

  // Microsoft redirects back with ?error= when the pilot declines or
  // something goes wrong on their side — never a blank page.
  if (authError || !code || !stateRaw) {
    return redirect("/?cal=error");
  }

  let pilotId: string | null = null;
  try {
    const state = JSON.parse(Buffer.from(stateRaw, "base64url").toString());
    pilotId = state.p as string;
  } catch {
    return redirect("/?cal=error");
  }
  if (!pilotId) {
    return redirect("/?cal=error");
  }

  const clientId = process.env.OUTLOOK_CLIENT_ID;
  const clientSecret = process.env.OUTLOOK_CLIENT_SECRET;
  const redirectUri = process.env.OUTLOOK_REDIRECT_URI ?? DEFAULT_REDIRECT_URI;
  if (!clientId || !clientSecret) {
    return redirect("/?cal=error");
  }

  try {
    const { url, key } = supabasePublicConfig();
    const supabase = createServerClient(url, key, {
      global: { fetch: fetchWithTimeout() },
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          pendingCookies.push(...cookiesToSet);
        },
      },
    });

    const tokenRes = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    if (!tokenRes.ok) throw new Error(`token ${tokenRes.status}`);
    const tokens = await tokenRes.json();
    if (!tokens.refresh_token) {
      // Microsoft only returns a refresh token with offline_access +
      // consent; without one we can't sync, so ask the pilot to reconnect.
      return redirect("/?cal=reconsent");
    }

    // Encrypted at rest (AES-256-GCM, key from CALENDAR_TOKEN_KEY).
    // Fail closed: a missing/misconfigured key errors the connect rather
    // than storing a plaintext refresh token.
    const refreshTokenEnc = await encryptToken(tokens.refresh_token as string);

    const meRes = await fetch(GRAPH_ME_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const me = meRes.ok ? await meRes.json() : {};
    const email = ((me.mail as string | null) ?? (me.userPrincipalName as string | null) ?? null);

    const { data: conn, error: connErr } = await supabase
      .from("calendar_connections")
      .upsert(
        {
          pilot_id: pilotId,
          provider: "outlook",
          provider_account_email: email,
          refresh_token_enc: refreshTokenEnc,
          status: "active",
          last_synced_at: null,
        },
        { onConflict: "pilot_id,provider,provider_account_email" },
      )
      .select("id")
      .single();
    if (connErr) throw connErr;

    await supabase
      .from("calendar_connections")
      .update({ last_synced_at: new Date(0).toISOString() })
      .eq("id", conn.id);

    return redirect("/?cal=connected");
  } catch {
    return redirect("/?cal=error");
  }
}
