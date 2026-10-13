import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPilotId, unauthorized } from "@/lib/crew/auth";
import { ageTier } from "@/lib/child/age-tier";

const CODE_TTL_MINUTES = 15;

function randomCode(): string {
  // 6 digits, zero-padded. crypto.getRandomValues is available on Workers.
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(bytes[0] % 1_000_000).padStart(6, "0");
}

/**
 * POST /api/crew/members/[id]/link-code
 * Generate a 6-digit same-room link code (15-minute expiry, single use).
 * Only the steward pilot may mint codes for their crew member.
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const pilotId = await getPilotId();
  if (!pilotId) return NextResponse.json(unauthorized(), { status: 401 });
  const { id: crewMemberId } = await params;

  const supabase = await createClient();

  const { data: member } = await supabase
    .from("crew_members")
    .select("id, pilot_id, name, birthdate")
    .eq("id", crewMemberId)
    .single();
  if (member?.pilot_id !== pilotId) {
    return NextResponse.json(
      { error: "Couldn't find that crew member." },
      { status: 404 },
    );
  }

  // Under-13 gate (COPPA): no accounts, stewardship only. The invite UI
  // already hides the button; this is the server-side enforcement.
  if (ageTier((member.birthdate as string | null) ?? null) === "under13") {
    const firstName = ((member.name as string) ?? "your child").split(" ")[0];
    return NextResponse.json(
      {
        error: `Cockpit accounts start at 13 — for now, you manage everything about ${firstName}'s school right here.`,
      },
      { status: 403 },
    );
  }

  // Invalidate any outstanding unused codes first (one live code at a time).
  await supabase
    .from("link_codes")
    .update({ used_at: new Date().toISOString() })
    .eq("crew_member_id", crewMemberId)
    .is("used_at", null);

  const code = randomCode();
  const expiresAt = new Date(
    Date.now() + CODE_TTL_MINUTES * 60 * 1000,
  ).toISOString();

  const { data: inserted, error } = await supabase
    .from("link_codes")
    .insert({
      crew_member_id: crewMemberId,
      code,
      expires_at: expiresAt,
      created_by: pilotId,
    })
    .select("id")
    .single();

  if (error) {
    console.error(
      JSON.stringify({
        route: "POST /api/crew/members/[id]/link-code",
        operation: "insert link_codes",
        error: error.message,
      }),
    );
    return NextResponse.json(
      { error: "Couldn't create a code right now. Try again." },
      { status: 500 },
    );
  }

  // Audit: the consent timeline starts when the code is minted.
  try {
    await supabase.from("consent_events").insert({
      crew_member_id: crewMemberId,
      actor_pilot_id: pilotId,
      event: "code_generated",
      detail: { code_id: (inserted?.id as string) ?? null },
    });
  } catch {
    /* audit is best-effort; the code itself was minted */
  }

  return NextResponse.json(
    { code, expires_at: expiresAt, ttl_minutes: CODE_TTL_MINUTES },
    { status: 201 },
  );
}
