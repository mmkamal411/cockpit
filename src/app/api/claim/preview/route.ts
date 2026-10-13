import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const INVALID = { valid: false, reason: "invalid" } as const;

/**
 * GET /api/claim/preview?code=123456
 * Validates a 6-digit link code WITHOUT consuming it. Safe to call before
 * sign-in: the RPC returns names + tier info only, never the code.
 */
export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("code") ?? "";
  if (!/^[0-9]{6}$/.test(code)) {
    return NextResponse.json(INVALID, { status: 400 });
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("preview_link_code", {
    p_code: code,
  });
  if (error) {
    return NextResponse.json(
      { valid: false, reason: "unavailable" },
      { status: 503 },
    );
  }
  const preview = (data ?? INVALID) as {
    valid: boolean;
    reason?: string;
    crew_member_name?: string;
    steward_name?: string;
    birthdate?: string | null;
    expires_at?: string;
  };
  if (!preview.valid) {
    const status = preview.reason === "expired" ? 410 : 404;
    return NextResponse.json(preview, { status });
  }
  return NextResponse.json(preview);
}
