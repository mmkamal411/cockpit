import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPilotId, unauthorized } from "@/lib/crew/auth";
import { ageTier, revokeCoolingOffDays } from "@/lib/child/age-tier";

const COOLING_OFF_MS = 7 * 24 * 60 * 60 * 1000;

function logError(route: string, operation: string, error: unknown) {
  console.error(
    JSON.stringify({
      route,
      operation,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
}

async function audit(
  supabase: Awaited<ReturnType<typeof createClient>>,
  crewMemberId: string,
  actorPilotId: string,
  event: "access_paused" | "access_revoked" | "revoke_undone",
  detail: Record<string, unknown>,
) {
  try {
    await supabase.from("consent_events").insert({
      crew_member_id: crewMemberId,
      actor_pilot_id: actorPilotId,
      event,
      detail,
    });
  } catch {
    /* audit is best-effort */
  }
}

/**
 * DELETE /api/crew/access-grants/[id]
 * Revoke an access grant. Sets revoked_at instead of deleting — the audit
 * timeline keeps the full history. Only the steward (the pilot who owns the
 * crew member) can revoke; RLS enforces this.
 *
 * Phase C (age tiers): when the steward ends a 13–15 child's consent grant,
 * the revoke waits 7 days (cooling_off_until) instead of taking effect
 * immediately — the child is notified and the steward can undo. 16+ revokes
 * are instant. The child revoking their own grant is always instant
 * (handled in /api/sharing — it's their right).
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
      .select("id, birthdate")
      .eq("pilot_id", pilotId);
    const memberIds = (members ?? []).map((m) => m.id as string);

    const { data: grant } = await supabase
      .from("crew_access_grants")
      .select("id, crew_member_id, granted_by, revoked_at, revoke_requested_at")
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

    const member = (members ?? []).find((m) => m.id === grant.crew_member_id);
    const tier = ageTier((member?.birthdate as string | null) ?? null);
    const coolingOff = revokeCoolingOffDays(tier);
    const isConsentGrant = grant.granted_by === "crew_member";

    // 13–15 consent grant, steward-initiated: cooling-off, not instant.
    if (isConsentGrant && coolingOff > 0 && !grant.revoke_requested_at) {
      const until = new Date(Date.now() + COOLING_OFF_MS).toISOString();
      const { error } = await supabase
        .from("crew_access_grants")
        .update({
          revoke_requested_at: new Date().toISOString(),
          cooling_off_until: until,
          revoked_by: "steward",
        })
        .eq("id", id);
      if (error) throw error;
      await audit(supabase, grant.crew_member_id as string, pilotId, "access_paused", {
        grant_id: id,
        cooling_off_until: until,
        tier,
      });
      return NextResponse.json({ ok: true, cooling_off_until: until });
    }

    const { error } = await supabase
      .from("crew_access_grants")
      .update({
        revoked_at: new Date().toISOString(),
        revoked_by: "steward",
        revoke_requested_at: null,
        cooling_off_until: null,
      })
      .eq("id", id);
    if (error) throw error;
    await audit(supabase, grant.crew_member_id as string, pilotId, "access_revoked", {
      grant_id: id,
      tier,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    logError("DELETE /api/crew/access-grants/[id]", "revoke grant", e);
    return NextResponse.json(
      { error: "Couldn't stop that sharing right now. Try again." },
      { status: 500 },
    );
  }
}

/**
 * POST /api/crew/access-grants/[id] — undo a pending cooling-off revoke.
 * Body: { action: "undo_revoke" }. Clears the request; sharing continues.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const pilotId = await getPilotId();
    if (!pilotId) return NextResponse.json(unauthorized(), { status: 401 });

    let body: { action?: unknown } | null = null;
    try {
      body = (await request.json()) as { action?: unknown };
    } catch {
      body = null;
    }
    if (body?.action !== "undo_revoke") {
      return NextResponse.json(
        { error: "Tell us what you'd like to do with that sharing entry." },
        { status: 400 },
      );
    }

    const { id } = await params;
    const supabase = await createClient();

    const { data: members } = await supabase
      .from("crew_members")
      .select("id")
      .eq("pilot_id", pilotId);
    const memberIds = (members ?? []).map((m) => m.id as string);

    const { data: grant } = await supabase
      .from("crew_access_grants")
      .select("id, crew_member_id, revoked_at, revoke_requested_at")
      .eq("id", id)
      .maybeSingle();
    if (!grant || !memberIds.includes(grant.crew_member_id as string)) {
      return NextResponse.json(
        { error: "Couldn't find that sharing entry." },
        { status: 404 },
      );
    }
    if (grant.revoked_at || !grant.revoke_requested_at) {
      return NextResponse.json({ ok: true, nothing_to_undo: true });
    }

    const { error } = await supabase
      .from("crew_access_grants")
      .update({
        revoke_requested_at: null,
        cooling_off_until: null,
        revoked_by: null,
      })
      .eq("id", id);
    if (error) throw error;
    await audit(supabase, grant.crew_member_id as string, pilotId, "revoke_undone", {
      grant_id: id,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    logError("POST /api/crew/access-grants/[id]", "undo revoke", e);
    return NextResponse.json(
      { error: "Couldn't undo that right now. Try again." },
      { status: 500 },
    );
  }
}
