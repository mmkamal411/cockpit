import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const SCOPES = ["https://www.googleapis.com/auth/calendar.readonly", "openid", "email"];

/**
 * GET /api/calendar/connect
 * Starts the Google OAuth flow for calendar access (read-only by default).
 * Requires GOOGLE_CALENDAR_CLIENT_ID env var (Google Cloud console).
 */
export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first, then connect your calendar." }, { status: 401 });
  }

  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const redirectUri =
    process.env.GOOGLE_CALENDAR_REDIRECT_URI ?? `${new URL(req.url).origin}/api/calendar/callback`;
  if (!clientId) {
    return NextResponse.json(
      { error: "Google Calendar isn't configured yet. Your admin needs to add the Google OAuth client ID." },
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
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return NextResponse.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
}
