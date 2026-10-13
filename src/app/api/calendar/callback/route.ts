import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { encryptToken } from "@/lib/token-crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";

/**
 * GET /api/calendar/callback?code=&state=
 * Google OAuth callback: exchanges the code, stores the connection.
 */
export async function GET(req: Request) {
  const { searchParams, origin } = new URL(req.url);
  const code = searchParams.get("code");
  const stateRaw = searchParams.get("state");
  const appUrl = origin;

  if (!code || !stateRaw) {
    return NextResponse.redirect(`${appUrl}/?cal=error`);
  }

  let pilotId: string | null = null;
  try {
    const state = JSON.parse(Buffer.from(stateRaw, "base64url").toString());
    pilotId = state.p as string;
  } catch {
    return NextResponse.redirect(`${appUrl}/?cal=error`);
  }

  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_CALENDAR_REDIRECT_URI ?? `${origin}/api/calendar/callback`;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(`${appUrl}/?cal=error`);
  }

  try {
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
      return NextResponse.redirect(`${appUrl}/?cal=reconsent`);
    }

    // Persist the scopes Google actually granted — the UI uses this to
    // know whether the Tasks scope still needs a re-consent.
    const grantedScopes =
      typeof tokens.scope === "string"
        ? tokens.scope.split(" ").map((s: string) => s.trim()).filter(Boolean)
        : [];

    // Encrypted at rest (AES-256-GCM, key from CALENDAR_TOKEN_KEY).
    // Fail closed: a missing/misconfigured key errors the connect rather
    // than storing a plaintext refresh token.
    const refreshTokenEnc = await encryptToken(tokens.refresh_token as string);
    const supabase = await createClient();
    const meRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const me = meRes.ok ? await meRes.json() : {};
    const email = (me.email as string) ?? null;

    const { data: conn, error: connErr } = await supabase
      .from("calendar_connections")
      .upsert(
        {
          pilot_id: pilotId,
          provider: "google",
          provider_account_email: email,
          refresh_token_enc: refreshTokenEnc,
          status: "active",
          last_synced_at: null,
          granted_scopes: grantedScopes,
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

    return NextResponse.redirect(`${appUrl}/?cal=connected`);
  } catch {
    return NextResponse.redirect(`${appUrl}/?cal=error`);
  }
}
