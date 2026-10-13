import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPilotId, unauthorized } from "@/lib/crew/auth";

interface ClaimBody {
  code?: unknown;
}

interface ClaimResult {
  ok?: unknown;
  member?: {
    id?: string;
    name?: string;
    relationship?: string | null;
    birthdate?: string | null;
  } | null;
  already_owner?: unknown;
}

/**
 * POST /api/crew/link-codes/claim — claim a 6-digit same-room link code.
 * Body: { code }.
 *
 * This is the CHILD's half of the link-code flow: the steward mints the
 * code from a crew member's profile, the family member enters it here, and
 * the server (via the claim_link_code definer RPC) burns the code and
 * creates a steward-authored access grant. The caller can never insert a
 * grant under their own RLS, so the RPC does it.
 *
 * Every failure is plain English with a next step — never a raw 500.
 */
export async function POST(request: NextRequest) {
  const pilotId = await getPilotId();
  if (!pilotId) {
    return NextResponse.json(unauthorized(), { status: 401 });
  }

  let body: ClaimBody;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const digits = String(body.code ?? "").replace(/[^0-9]/g, "");
  if (digits.length !== 6) {
    return NextResponse.json(
      { error: "Enter the 6-digit code — just the numbers." },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("claim_link_code", { p_code: digits });

  if (error) {
    console.error(
      JSON.stringify({
        route: "POST /api/crew/link-codes/claim",
        operation: "rpc claim_link_code",
        error: error.message,
      }),
    );
    return NextResponse.json(
      { error: "Couldn't check that code right now. Try again." },
      { status: 500 },
    );
  }

  const result = (data ?? {}) as ClaimResult;
  if (result.ok !== true) {
    if (result.already_owner === true) {
      return NextResponse.json(
        {
          error:
            "That code belongs to a profile that's already yours. Nothing to link.",
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      {
        error:
          "That code didn't work — it may be used or expired. Ask the person who shared it to create a fresh one; they last 15 minutes.",
      },
      { status: 404 },
    );
  }

  return NextResponse.json({ member: result.member ?? null }, { status: 200 });
}
