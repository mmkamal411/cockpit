import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Plain-English translations of every redeem_link_code failure reason. */
const REASON_COPY: Record<string, { message: string; status: number }> = {
  not_signed_in: { message: "Sign in first, then try the code again.", status: 401 },
  no_pilot: {
    message: "Your account isn't set up yet — sign out and sign in again, then retry the code.",
    status: 409,
  },
  already_linked: {
    message: "This account is already linked to a school profile. Head to your cockpit — you're all set.",
    status: 409,
  },
  invalid: {
    message: "That code doesn't look right. Check the 6 digits on your parent's screen and try again.",
    status: 404,
  },
  expired: {
    message: "That code expired — codes only last 15 minutes. Ask your parent to make a fresh one.",
    status: 410,
  },
  under13: {
    message: "Cockpit accounts start at 13. Until then, your parent manages everything for you.",
    status: 403,
  },
  need_birthdate: {
    message: "We need your birthdate to set up the right sharing for your age — add it and try again.",
    status: 422,
  },
};

interface ClaimBody {
  code?: unknown;
  birthdate?: unknown;
}

/**
 * POST /api/claim — redeem a 6-digit link code and grant consent.
 * Body: { code: "123456", birthdate?: "2011-07-23" }
 *
 * All the real work happens atomically inside redeem_link_code() —
 * this route just authenticates, validates the shape, and translates
 * failure reasons into plain English.
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: REASON_COPY.not_signed_in.message }, { status: 401 });
  }

  let body: ClaimBody | null = null;
  try {
    body = (await req.json()) as ClaimBody;
  } catch {
    body = null;
  }
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!/^[0-9]{6}$/.test(code)) {
    return NextResponse.json({ error: REASON_COPY.invalid.message }, { status: 400 });
  }
  const birthdate =
    typeof body?.birthdate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.birthdate)
      ? body.birthdate
      : null;

  const { data, error } = await supabase.rpc("redeem_link_code", {
    p_code: code,
    p_birthdate: birthdate,
  });
  if (error) {
    return NextResponse.json(
      { error: "Something hiccuped on our end. Try the code again in a moment." },
      { status: 500 },
    );
  }

  const result = (data ?? { ok: false, reason: "invalid" }) as {
    ok: boolean;
    reason?: string;
    crew_member_id?: string;
    crew_member_name?: string;
    age?: number;
    birthdate_mismatch?: boolean;
  };

  if (!result.ok) {
    const mapped = REASON_COPY[result.reason ?? "invalid"] ?? {
      message: REASON_COPY.invalid.message,
      status: 400,
    };
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }

  return NextResponse.json(
    {
      ok: true,
      crew_member_id: result.crew_member_id,
      crew_member_name: result.crew_member_name,
      age: result.age,
    },
    { status: 201 },
  );
}
