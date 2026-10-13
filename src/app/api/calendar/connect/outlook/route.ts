import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const AUTH_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const SCOPES = [
  "openid",
  "profile",
  "email",
  "offline_access",
  "https://graph.microsoft.com/Calendars.Read",
];

/**
 * GET /api/calendar/connect/outlook
 * Starts the Microsoft OAuth flow for Outlook calendar access (read-only).
 * Requires OUTLOOK_CLIENT_ID env var (Azure app registration).
 */
export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first, then connect your calendar." }, { status: 401 });
  }

  const clientId = process.env.OUTLOOK_CLIENT_ID;
  const redirectUri =
    process.env.OUTLOOK_REDIRECT_URI ?? `${new URL(req.url).origin}/api/calendar/callback/outlook`;
  if (!clientId) {
    return NextResponse.json(
      { error: "Outlook Calendar isn't configured yet. Your admin needs to add the Outlook OAuth client ID." },
      { status: 503 },
    );
  }

  const state = Buffer.from(
    JSON.stringify({ p: user.id, n: Math.random().toString(36).slice(2) }),
  ).toString("base64url");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    response_mode: "query",
    scope: SCOPES.join(" "),
    state,
    prompt: "consent",
  });
  return NextResponse.redirect(`${AUTH_URL}?${params.toString()}`);
}
