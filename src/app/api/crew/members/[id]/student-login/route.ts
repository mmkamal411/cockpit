import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPilotId, unauthorized } from "@/lib/crew/auth";
import { encryptToken } from "@/lib/token-crypto";

/**
 * POST /api/crew/members/[id]/student-login — save the student's school login.
 *
 * Body: { username, password } — the student's school Microsoft/SSO login
 * (used for StudentVUE, Outlook, and CTLS Learn by the laptop sync workers).
 *
 * Flow:
 * 1. Verify the pilot owns the crew member.
 * 2. Attempt to validate against the StudentVUE mobile API with a SINGLE
 *    AttemptLogin call. Auth failures are never retried (Cobb logs failures;
 *    repeated bad logins risk locking the school account).
 * 3. If the StudentVUE API is unreachable or doesn't accept native login
 *    (Cobb students authenticate via Microsoft SSO — the mobile API path is
 *    UNVERIFIED), we still save the credentials: the laptop sync worker
 *    validates them on its next run via the browser/SSO path.
 * 4. On any path where credentials are saved: encrypt the pair (AES-256-GCM)
 *    and queue it in crew_credential_pending with credential_type='student'
 *    for the privileged vault-sync process. The web app never reads it back.
 *
 * Security notes:
 * - The password lives in memory only for the duration of this request.
 *   It is never logged, never written to the DB in plaintext, and never
 *   echoed back in any response.
 * - The encrypted pending row can only be decrypted by the vault-sync
 *   process holding the key. The web app never reads it back.
 */

const STUDENTVUE_HOST = "studentvue.cobbk12.org";
const LOGIN_URL = `https://${STUDENTVUE_HOST}/api/v1/mobile/PXPWebServices/AttemptLogin`;

interface AttemptLoginResult {
  ok: boolean;
  authFailed: boolean;
  unreachable: boolean;
}

async function testStudentVue(username: string, password: string): Promise<AttemptLoginResult> {
  const creds = Buffer.from(`${username}:${password}`, "utf-8").toString("base64");
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25000);
  try {
    const res = await fetch(LOGIN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${creds}`,
        "Content-Type": "application/json",
        "User-Agent": "Cockpit/1.0",
      },
      body: JSON.stringify({ arguments: { request: JSON.stringify({ userID: null }) } }),
      signal: controller.signal,
    });
    if (res.status === 401) return { ok: false, authFailed: true, unreachable: false };
    if (!res.ok) return { ok: false, authFailed: false, unreachable: true };
    const parsed = (await res.json()) as Record<string, unknown>;
    if (parsed && typeof parsed === "object" && parsed.error) {
      return { ok: false, authFailed: true, unreachable: false };
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
    const found = hasToken(parsed);
    return { ok: found, authFailed: !found, unreachable: false };
  } catch {
    return { ok: false, authFailed: false, unreachable: true };
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
      { error: "Enter both the student's school email and password." },
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
  const result = await testStudentVue(username, password);

  if (result.authFailed) {
    return NextResponse.json(
      {
        error:
          "That student login didn't work — the email or password didn't match. Check for typos (capital letters matter), or use the school's \"Forgot password\" link, then try again.",
      },
      { status: 401 },
    );
  }

  // Credentials are good, OR the API couldn't verify them (Cobb students
  // use Microsoft SSO — the mobile API may not accept native login).
  // Either way, encrypt and queue for the vault-sync process. The laptop
  // sync worker does the definitive check on its next run.
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

  // Replace any existing unprocessed student pending row for this member.
  await supabase
    .from("crew_credential_pending")
    .delete()
    .eq("crew_member_id", crewMemberId)
    .eq("credential_type", "student")
    .is("processed_at", null);

  const { error: pendingError } = await supabase.from("crew_credential_pending").insert({
    crew_member_id: crewMemberId,
    pilot_id: pilotId,
    credential_type: "student",
    username_enc: usernameEnc,
    password_enc: passwordEnc,
  });

  if (pendingError) {
    return NextResponse.json(
      { error: "That login looks good, but we couldn't save it. Try again." },
      { status: 500 },
    );
  }

  // If we positively validated, clear any auth_error on the school link.
  // If validation was inconclusive (SSO), leave the link as-is — the
  // worker's first sync will set the real status.
  if (result.ok) {
    await supabase
      .from("crew_school_links")
      .update({ sync_status: "idle" })
      .eq("crew_member_id", crewMemberId);
  }

  return NextResponse.json({
    ok: true,
    verified: result.ok,
    message: result.ok
      ? "That student login works. The sync workers will pick it up shortly — new grades should start arriving within the hour."
      : "Saved. We couldn't verify it automatically (the school uses Microsoft sign-in), so the sync worker will test it on its next run and let you know.",
  });
}
