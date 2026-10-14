import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPilotId, unauthorized } from "@/lib/crew/auth";

/**
 * POST /api/crew/link-codes/claim — claim a 6-digit same-room link code.
 *
 * This is the family member's half of the link-code flow: the steward mints
 * the code from a crew member's profile, the family member enters it here,
 * and the server (via the redeem_link_code SECURITY DEFINER RPC, migration
 * 036) burns the code and creates the child's own access grant. The caller
 * can never insert a grant under their own RLS, so the RPC does it.
 *
 * Contract: request { code }; response { member: { id } } on success or
 * { error }. Every failure is plain English with a next step — never a
 * 500, never a stack trace, and never a signal that distinguishes an
 * invalid / expired / used code (the code is a bearer token).
 */
export async function POST(request: Request) {
  const pilotId = await getPilotId();
  if (!pilotId) {
    return NextResponse.json(unauthorized(), { status: 401 });
  }

  let body: { code?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "We couldn't read that request. Try again." },
      { status: 400 },
    );
  }

  // Normalize: digits only, must be exactly 6.
  const digits = String(body.code ?? "").replace(/[^0-9]/g, "");
  if (digits.length !== 6) {
    return NextResponse.json(
      {
        error:
          "That code doesn't look right — it should be 6 digits. Check the code and try again.",
      },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  let data: unknown;
  try {
    const { data: rpcData, error } = await supabase.rpc("redeem_link_code", {
      p_code: digits,
    });
    if (error) throw error;
    data = rpcData;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      JSON.stringify({
        route: "POST /api/crew/link-codes/claim",
        operation: "rpc redeem_link_code",
        error: message,
      }),
    );
    // Migration 036 never applied: the function doesn't exist on the DB.
    // Supabase reports this as 42883 (undefined_function) or PostgREST's
    // "could not find the function" 404 — either way it's a server-setup
    // problem, not a bad code.
    if (
      message.includes("42883") ||
      message.toLowerCase().includes("does not exist") ||
      message.toLowerCase().includes("could not find the function")
    ) {
      return NextResponse.json(
        {
          error:
            "Linking isn't set up on the server yet. We're working on it — try again later.",
        },
        { status: 503 },
      );
    }
    return NextResponse.json(
      {
        error:
          "We couldn't check that code right now. Try again in a few minutes.",
      },
      { status: 503 },
    );
  }

  const result = (data ?? {}) as {
    ok?: unknown;
    reason?: unknown;
    crew_member_id?: unknown;
    already?: unknown;
  };

  if (result.ok !== true) {
    if (result.reason === "already_steward") {
      return NextResponse.json(
        {
          error:
            "That's your own crew member — you're already linked, so there's nothing to claim.",
        },
        { status: 400 },
      );
    }
    // Never distinguish invalid / expired / used: an oracle here would
    // leak whether a given code is live.
    return NextResponse.json(
      {
        error:
          "That code didn't work — check the 6 digits and try again. Codes expire after 15 minutes, so you may need a fresh one.",
      },
      { status: 400 },
    );
  }

  const crewMemberId =
    typeof result.crew_member_id === "string" ? result.crew_member_id : null;
  if (!crewMemberId) {
    // Shouldn't happen (ok:true always carries crew_member_id), but if the
    // RPC shape ever changes we must not send the UI a broken success.
    console.error(
      JSON.stringify({
        route: "POST /api/crew/link-codes/claim",
        operation: "rpc result shape",
        error: "ok:true without crew_member_id",
      }),
    );
    return NextResponse.json(
      {
        error:
          "We couldn't confirm that link right now. Try the code again in a few minutes.",
      },
      { status: 503 },
    );
  }

  return NextResponse.json({ member: { id: crewMemberId } }, { status: 200 });
}
