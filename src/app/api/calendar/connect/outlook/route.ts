import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const MICROSOFT_AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const SCOPE = "Calendars.ReadWrite Mail.Read offline_access openid profile email";
// Azure app registrations require an exact redirect-URI match, so the
// default is the canonical production URL (not the request origin).
const DEFAULT_REDIRECT_URI = "https://cockpit-10c.pages.dev/api/calendar/callback/outlook";

/**
 * GET /api/calendar/connect/outlook
 * Starts the Microsoft 365 OAuth flow for Outlook calendar access.
 * Requires OUTLOOK_CLIENT_ID env var (Azure app registration "Cockpit").
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first, then connect your calendar." }, { status: 401 });
  }

  const clientId = process.env.OUTLOOK_CLIENT_ID;
  const redirectUri = process.env.OUTLOOK_REDIRECT_URI ?? DEFAULT_REDIRECT_URI;
  if (!clientId) {
    return NextResponse.json(
      { error: "Outlook calendar isn't configured yet. Your admin needs to add the Microsoft OAuth client ID." },
      { status: 503 },
    );
  }

  const state = Buffer.from(
    JSON.stringify({ p: user.id, n: crypto.randomUUID() }),
  ).toString("base64url");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPE,
    prompt: "consent",
    state,
  });
  return NextResponse.redirect(`${MICROSOFT_AUTH_URL}?${params.toString()}`);
}
