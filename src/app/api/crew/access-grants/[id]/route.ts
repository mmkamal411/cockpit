import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPilotId, unauthorized } from "@/lib/crew/auth";

/**
 * DELETE /api/crew/access-grants/[id]
 * Revoke an access grant. Sets revoked_at instead of deleting — the audit
 * timeline keeps the full history. Only the steward (the pilot who owns the
 * crew member) can revoke; RLS enforces this.
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const pilotId = await getPilotId();
    if (!pilotId) return NextResponse.json(unauthorized(), { status: 401 });

    const { id } = await params;
    const supabase = await createClient();

    // Find the grant through the steward's own crew members — a grant that
    // isn't ours never appears here, so it can never be revoked by mistake.
    const { data: members } = await supabase
      .from("crew_members")
      .select("id")
      .eq("pilot_id", pilotId);
    const memberIds = (members ?? []).map((m) => m.id as string);

    const { data: grant } = await supabase
      .from("crew_access_grants")
      .select("id, crew_member_id, revoked_at")
      .eq("id", id)
      .maybeSingle();
    if (!grant || !memberIds.includes(grant.crew_member_id as string)) {
      return NextResponse.json(
        { error: "Couldn't find that sharing entry." },
        { status: 404 },
      );
    }
    if (grant.revoked_at) {
      return NextResponse.json({ ok: true, already: true });
    }

    const { error } = await supabase
      .from("crew_access_grants")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error(
      JSON.stringify({
        route: "DELETE /api/crew/access-grants/[id]",
        operation: "revoke grant",
        error: e instanceof Error ? e.message : String(e),
      }),
    );
    return NextResponse.json(
      { error: "Couldn't stop that sharing right now. Try again." },
      { status: 500 },
    );
  }
}
