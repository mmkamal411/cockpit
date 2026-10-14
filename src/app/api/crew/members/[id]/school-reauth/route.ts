import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPilotId, unauthorized } from "@/lib/crew/auth";
import { encryptToken } from "@/lib/token-crypto";

/**
 * POST /api/crew/members/[id]/school-reauth — re-authenticate a school connection.
 *
 * Body: { username, password } — the parent's school portal login.
 *
 * Flow:
 * 1. Verify the pilot owns the crew member.
 * 2. Test the credentials against ParentVUE with a SINGLE AttemptLogin call.
 *    Auth failures are never retried (repeated bad logins risk locking the
 *    school account — see cockpit-installer/SECURITY.md §4.3).
 * 3. On success: encrypt the pair (AES-256-GCM) and queue it in
 *    crew_credential_pending for the privileged vault-sync process. Clear
 *    any auth_error on the school link.
 * 4. On failure: 401 with a plain-English message. Nothing is stored.
 *
 * Security notes:
 * - The password lives in memory only for the duration of this request.
 *   It is never logged, never written to the DB in plaintext, and never
 *   echoed back in any response.
 * - The encrypted pending row can only be decrypted by the vault-sync
 *   process holding the key. The web app never reads it back.
 */

const PARENTVUE_HOST = "parentvue.cobbk12.org";
const LOGIN_URL = `https://${PARENTVUE_HOST}/api/v1/mobile/PXPWebServices/AttemptLogin`;

// NOTE (verified 2026-10-13): an unauthenticated probe of the mobile
// AttemptLogin endpoint returns HTTP 401 in ~1s, so the endpoint IS alive.
// Persistent "couldn't confirm" (indeterminate) results with known-good
// credentials likely mean the token ENVELOPE shape changed on the school
// side — see the shape-logging in the indeterminate branch below, which
// records only top-level keys (never values, never the password).

/**
 * Three outcomes — deliberately NOT a boolean:
 * - ok: a token was found in the response envelope. The login is valid.
 * - authFailed: the server explicitly rejected the credentials (HTTP 401,
 *   or an envelope with an explicit error field).
 * - indeterminate: anything else — 200 without a recognizable token,
 *   unexpected shape, network error, timeout. The credentials MAY be fine;
 *   we just couldn't confirm them. Never retry (account lockout risk).
 */
type AttemptLoginResult =
  | { ok: true }
  | { ok: false; kind: "auth_failed" }
  | { ok: false; kind: "indeterminate" };

interface ParsedEnvelope {
  keys: string[]; // top-level keys only — never values
}

function shapeOf(parsed: unknown): ParsedEnvelope {
  const keys =
    parsed && typeof parsed === "object"
      ? Object.keys(parsed as Record<string, unknown>)
      : [];
  return { keys };
}

async function testParentVue(username: string, password: string): Promise<AttemptLoginResult> {
  const creds = Buffer.from(`${username}:${password}`, "utf-8").toString("base64");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(LOGIN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${creds}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ arguments: { request: JSON.stringify({ userID: null }) } }),
      signal: controller.signal,
    });
    if (res.status === 401) return { ok: false, kind: "auth_failed" };
    if (!res.ok) return { ok: false, kind: "indeterminate" };
    const parsed = (await res.json()) as Record<string, unknown>;
    if (parsed && typeof parsed === "object" && parsed.error) {
      return { ok: false, kind: "auth_failed" };
    }
    // Look for a token anywhere in the envelope (top-level or nested).
    const hasToken = (o: unknown): boolean => {
      if (!o || typeof o !== "object") return false;
      const r = o as Record<string, unknown>;
      for (const k of ["token", "Token", "accessToken", "access_token", "authToken", "sessionToken"]) {
        if (typeof r[k] === "string" && (r[k] as string).length > 0) return true;
      }
      for (const k of ["d", "result", "Result"]) {
        if (hasToken(r[k])) return true;
      }
      return false;
    };
    if (hasToken(parsed)) return { ok: true };
    // 200 but no recognizable token: honest unknown, not a wrong password.
    // Log only the response SHAPE (top-level keys) so a changed envelope
    // can be diagnosed without ever storing values or credentials.
    console.error(
      JSON.stringify({
        route: "POST /api/crew/members/[id]/school-reauth",
        operation: "testParentVue indeterminate",
        envelope_shape: shapeOf(parsed),
      }),
    );
    return { ok: false, kind: "indeterminate" };
  } catch {
    return { ok: false, kind: "indeterminate" };
  } finally {
    clearTimeout(timeout);
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const pilotId = await getPilotId();
  if (!pilotId) return NextResponse.json(unauthorized(), { status: 401 });
  const { id: crewMemberId } = await params;

  let body: { username?: string; password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "We couldn't read that request. Try again." },
      { status: 400 },
    );
  }

  const username = (body.username ?? "").trim();
  const password = body.password ?? "";
  if (!username || !password) {
    return NextResponse.json(
      { error: "Enter both the username and password for the school portal." },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  // Access check: pilot must own this crew member.
  const { data: member } = await supabase
    .from("crew_members")
    .select("id, pilot_id")
    .eq("id", crewMemberId)
    .single();
  if (!member || member.pilot_id !== pilotId) {
    return NextResponse.json(unauthorized(), { status: 403 });
  }

  // Single validation attempt — never retried.
  const result = await testParentVue(username, password);

  if (!result.ok) {
    const message =
      result.kind === "auth_failed"
        ? "That login didn't work — the username or password didn't match. Check for typos (capital letters matter), or use the school's \"Forgot password\" link, then try again."
        : "We couldn't confirm that login with the school portal right now — your password may be fine. Try again in a few minutes.";
    return NextResponse.json(
      { error: message },
      { status: result.kind === "auth_failed" ? 401 : 502 },
    );
  }

  // Credentials are good. Encrypt and queue for the vault-sync process.
  let usernameEnc: string;
  let passwordEnc: string;
  try {
    usernameEnc = await encryptToken(username);
    passwordEnc = await encryptToken(password);
  } catch {
    return NextResponse.json(
      { error: "We couldn't save that securely right now. Try again in a few minutes." },
      { status: 500 },
    );
  }

  // Replace any existing unprocessed parentvue pending row for this member.
  await supabase
    .from("crew_credential_pending")
    .delete()
    .eq("crew_member_id", crewMemberId)
    .eq("credential_type", "parentvue")
    .is("processed_at", null);

  const { error: pendingError } = await supabase.from("crew_credential_pending").insert({
    crew_member_id: crewMemberId,
    pilot_id: pilotId,
    credential_type: "parentvue",
    username_enc: usernameEnc,
    password_enc: passwordEnc,
  });

  if (pendingError) {
    return NextResponse.json(
      { error: "That login works, but we couldn't save the update. Try again." },
      { status: 500 },
    );
  }

  // Clear any auth_error on the school link so the UI stops flagging it.
  // Update only — the row is created by the installer/vault-sync process
  // with the real Secure Vault reference. We never invent one here.
  await supabase
    .from("crew_school_links")
    .update({ sync_status: "idle" })
    .eq("crew_member_id", crewMemberId);

  return NextResponse.json({
    ok: true,
    message:
      "That login works. Your school connection will pick it up shortly — new grades should start arriving within the hour.",
  });
}
