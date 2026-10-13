import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPilotId, unauthorized } from "@/lib/crew/auth";
import { ageTier, type AgeTier } from "@/lib/child/age-tier";

export const dynamic = "force-dynamic";

const SCOPE_KEYS = ["grades", "attendance", "checkins", "health"] as const;
type ScopeKey = (typeof SCOPE_KEYS)[number];

interface GrantRow {
  id: string;
  crew_member_id: string;
  granted_by: string;
  grantee_pilot_id: string;
  scope: Record<string, boolean>;
  granted_at: string;
  revoked_at: string | null;
  revoke_requested_at: string | null;
  cooling_off_until: string | null;
  revoked_by: string | null;
}

interface TimelineRow {
  id: string;
  event: string;
  detail: Record<string, unknown>;
  created_at: string;
  actor_pilot_id: string | null;
}

/** The linked child behind the current pilot, or null. */
async function childContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  pilotId: string,
): Promise<{ memberId: string; name: string; birthdate: string | null; tier: AgeTier } | null> {
  const { data: pilot } = await supabase
    .from("pilots")
    .select("child_crew_member_id")
    .eq("id", pilotId)
    .single();
  const memberId = pilot?.child_crew_member_id as string | null;
  if (!memberId) return null;
  const { data: member } = await supabase
    .from("crew_members")
    .select("id, name, birthdate, pilot_id")
    .eq("id", memberId)
    .single();
  if (!member) return null;
  return {
    memberId: member.id as string,
    name: (member.name as string) ?? "you",
    birthdate: (member.birthdate as string | null) ?? null,
    tier: ageTier((member.birthdate as string | null) ?? null),
  };
}

/** Lazily finalize cooling-offs that have run their course. */
async function finalizeCoolingOffs(
  supabase: Awaited<ReturnType<typeof createClient>>,
  memberId: string,
) {
  try {
    const { data: due } = await supabase
      .from("crew_access_grants")
      .select("id")
      .eq("crew_member_id", memberId)
      .is("revoked_at", null)
      .not("revoke_requested_at", "is", null)
      .lt("cooling_off_until", new Date().toISOString());
    for (const row of (due ?? []) as { id: string }[]) {
      await supabase
        .from("crew_access_grants")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", row.id);
      await supabase.from("consent_events").insert({
        crew_member_id: memberId,
        actor_pilot_id: null,
        event: "access_revoked",
        detail: { grant_id: row.id, via: "cooling_off_elapsed" },
      });
    }
  } catch {
    /* finalize is best-effort */
  }
}

function cleanScope(value: unknown): Record<ScopeKey, boolean> | null {
  if (typeof value !== "object" || value === null) return null;
  const out = {} as Record<ScopeKey, boolean>;
  for (const key of SCOPE_KEYS) {
    const v = (value as Record<string, unknown>)[key];
    if (typeof v !== "boolean") return null;
    out[key] = v;
  }
  return out;
}

/**
 * GET /api/sharing — the linked child's "who can see my school life".
 * Returns the member, their tier, active viewers (grants), and the consent
 * timeline. 404 when this pilot isn't a linked child.
 */
export async function GET() {
  const pilotId = await getPilotId();
  if (!pilotId) return NextResponse.json(unauthorized(), { status: 401 });
  const supabase = await createClient();

  const ctx = await childContext(supabase, pilotId);
  if (!ctx) {
    return NextResponse.json(
      { error: "This screen is for linked child accounts." },
      { status: 404 },
    );
  }

  await finalizeCoolingOffs(supabase, ctx.memberId);

  const [{ data: grants }, { data: events }] = await Promise.all([
    supabase
      .from("crew_access_grants")
      .select(
        "id, crew_member_id, granted_by, grantee_pilot_id, scope, granted_at, revoked_at, revoke_requested_at, cooling_off_until, revoked_by",
      )
      .eq("crew_member_id", ctx.memberId)
      .is("revoked_at", null)
      .order("granted_at", { ascending: false }),
    supabase
      .from("consent_events")
      .select("id, event, detail, created_at, actor_pilot_id")
      .eq("crew_member_id", ctx.memberId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  // Display names for viewers: pilots rows are self-readable only, so this
  // usually falls back to "Parent" — honest, never invented.
  const viewerIds = [...new Set(((grants ?? []) as GrantRow[]).map((g) => g.grantee_pilot_id))];
  let viewerNames: Record<string, string> = {};
  if (viewerIds.length > 0) {
    const { data: pilots } = await supabase
      .from("pilots")
      .select("id, display_name")
      .in("id", viewerIds);
    viewerNames = Object.fromEntries(
      (pilots ?? []).map((p) => [p.id as string, ((p.display_name as string) || "").trim()]),
    );
  }

  const viewers = ((grants ?? []) as GrantRow[]).map((g) => ({
    id: g.id,
    name: viewerNames[g.grantee_pilot_id] || "Parent",
    granted_by: g.granted_by,
    scope: g.scope,
    granted_at: g.granted_at,
    cooling_off: g.revoke_requested_at
      ? { requested_at: g.revoke_requested_at, effective_at: g.cooling_off_until }
      : null,
  }));

  // birthdate_mismatch is an internal integrity note — not the child's timeline.
  const timeline = ((events ?? []) as TimelineRow[])
    .filter((e) => e.event !== "birthdate_mismatch")
    .map((e) => ({
      id: e.id,
      event: e.event,
      detail: e.detail,
      created_at: e.created_at,
      mine: e.actor_pilot_id === pilotId,
    }));

  return NextResponse.json({
    member: { id: ctx.memberId, name: ctx.name, tier: ctx.tier },
    viewers,
    timeline,
  });
}

interface PatchBody {
  grant_id?: unknown;
  scope?: unknown;
}

/**
 * PATCH /api/sharing — the child changes what a viewer may see.
 * Body: { grant_id, scope: { grades, attendance, checkins, health } }.
 * Only grants the child themselves made (granted_by='crew_member') —
 * RLS enforces this too. Health can never be turned on here.
 */
export async function PATCH(req: Request) {
  const pilotId = await getPilotId();
  if (!pilotId) return NextResponse.json(unauthorized(), { status: 401 });

  let body: PatchBody | null = null;
  try {
    body = (await req.json()) as PatchBody;
  } catch {
    body = null;
  }
  const grantId = typeof body?.grant_id === "string" ? body.grant_id : "";
  const scope = cleanScope(body?.scope);
  if (!grantId || !scope) {
    return NextResponse.json(
      { error: "Tell us which sharing entry and what they may see." },
      { status: 400 },
    );
  }
  if (scope.health) {
    return NextResponse.json(
      { error: "Health stays private — it can't be shared from here." },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const ctx = await childContext(supabase, pilotId);
  if (!ctx) {
    return NextResponse.json(
      { error: "This screen is for linked child accounts." },
      { status: 404 },
    );
  }

  const { data: grant } = await supabase
    .from("crew_access_grants")
    .select("id, crew_member_id, granted_by, revoked_at")
    .eq("id", grantId)
    .eq("crew_member_id", ctx.memberId)
    .maybeSingle();
  if (!grant || (grant.granted_by as string) !== "crew_member" || grant.revoked_at) {
    return NextResponse.json(
      { error: "Couldn't find that sharing entry." },
      { status: 404 },
    );
  }

  const { error } = await supabase
    .from("crew_access_grants")
    .update({ scope })
    .eq("id", grantId);
  if (error) {
    return NextResponse.json(
      { error: "Couldn't save that change. Try again." },
      { status: 500 },
    );
  }

  try {
    await supabase.from("consent_events").insert({
      crew_member_id: ctx.memberId,
      actor_pilot_id: pilotId,
      event: "scope_changed",
      detail: { grant_id: grantId, scope },
    });
  } catch {
    /* audit is best-effort */
  }

  return NextResponse.json({ ok: true, scope });
}

interface PostBody {
  grant_id?: unknown;
  action?: unknown;
}

/**
 * POST /api/sharing
 * - { action: "revoke", grant_id } — the child stops one viewer's access.
 *   Instant at every tier: it's their right, no cooling-off.
 * - { action: "go_independent" } — graduation: revoke every active
 *   child-granted grant at once. The UI celebrates with confetti.
 */
export async function POST(req: Request) {
  const pilotId = await getPilotId();
  if (!pilotId) return NextResponse.json(unauthorized(), { status: 401 });

  let body: PostBody | null = null;
  try {
    body = (await req.json()) as PostBody;
  } catch {
    body = null;
  }
  const action = body?.action;

  const supabase = await createClient();
  const ctx = await childContext(supabase, pilotId);
  if (!ctx) {
    return NextResponse.json(
      { error: "This screen is for linked child accounts." },
      { status: 404 },
    );
  }

  async function revokeGrant(grantId: string): Promise<boolean> {
    const { data: grant } = await supabase
      .from("crew_access_grants")
      .select("id, granted_by, revoked_at")
      .eq("id", grantId)
      .eq("crew_member_id", ctx!.memberId)
      .maybeSingle();
    if (!grant || (grant.granted_by as string) !== "crew_member" || grant.revoked_at) {
      return false;
    }
    const { error } = await supabase
      .from("crew_access_grants")
      .update({
        revoked_at: new Date().toISOString(),
        revoked_by: "crew_member",
        revoke_requested_at: null,
        cooling_off_until: null,
      })
      .eq("id", grantId);
    if (error) return false;
    try {
      await supabase.from("consent_events").insert({
        crew_member_id: ctx!.memberId,
        actor_pilot_id: pilotId,
        event: "access_revoked",
        detail: { grant_id: grantId, by: "child" },
      });
    } catch {
      /* audit is best-effort */
    }
    return true;
  }

  if (action === "revoke") {
    const grantId = typeof body?.grant_id === "string" ? body.grant_id : "";
    if (!grantId) {
      return NextResponse.json(
        { error: "Tell us which sharing entry to stop." },
        { status: 400 },
      );
    }
    const ok = await revokeGrant(grantId);
    if (!ok) {
      return NextResponse.json(
        { error: "Couldn't find that sharing entry." },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true });
  }

  if (action === "go_independent") {
    const { data: grants } = await supabase
      .from("crew_access_grants")
      .select("id")
      .eq("crew_member_id", ctx.memberId)
      .eq("granted_by", "crew_member")
      .is("revoked_at", null);
    let revoked = 0;
    for (const g of ((grants ?? []) as { id: string }[])) {
      if (await revokeGrant(g.id)) revoked += 1;
    }
    return NextResponse.json({ ok: true, revoked });
  }

  return NextResponse.json(
    { error: "Tell us what you'd like to do with sharing." },
    { status: 400 },
  );
}
