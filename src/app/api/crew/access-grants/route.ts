import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPilotId, unauthorized } from "@/lib/crew/auth";

/**
 * GET /api/crew/access-grants
 * Who-can-see-what, per crew member: active grants, revoked grants
 * (kept for the audit timeline), and recently minted link codes.
 * Only the steward pilot sees this view — RLS enforces it.
 */
export async function GET() {
  try {
    const pilotId = await getPilotId();
    if (!pilotId) return NextResponse.json(unauthorized(), { status: 401 });

    const supabase = await createClient();

    const { data: members, error: mErr } = await supabase
      .from("crew_members")
      .select("id, name")
      .eq("pilot_id", pilotId)
      .order("created_at", { ascending: true });
    if (mErr) throw mErr;

    const memberIds = (members ?? []).map((m) => m.id as string);

    const [grantsRes, codesRes, namesRes] = await Promise.all([
      memberIds.length > 0
        ? supabase
            .from("crew_access_grants")
            .select("id, crew_member_id, granted_by, grantee_pilot_id, scope, granted_at, revoked_at")
            .in("crew_member_id", memberIds)
            .order("granted_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      memberIds.length > 0
        ? supabase
            .from("link_codes")
            .select("id, crew_member_id, code, expires_at, used_at, created_at")
            .in("crew_member_id", memberIds)
            .order("created_at", { ascending: false })
            .limit(20)
        : Promise.resolve({ data: [], error: null }),
      memberIds.length > 0
        ? supabase
            .from("crew_access_grants")
            .select("grantee_pilot_id")
            .in("crew_member_id", memberIds)
            .is("revoked_at", null)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (grantsRes.error) throw grantsRes.error;
    if (codesRes.error) throw codesRes.error;
    if (namesRes.error) throw namesRes.error;

    // Display names for grantees (the other parent's chosen name, or a fallback).
    const granteeIds = [
      ...new Set(
        ((grantsRes.data ?? []) as { grantee_pilot_id: string }[]).map(
          (g) => g.grantee_pilot_id,
        ),
      ),
    ];
    let granteeNames: Record<string, string> = {};
    if (granteeIds.length > 0) {
      const { data: pilots } = await supabase
        .from("pilots")
        .select("id, display_name")
        .in("id", granteeIds);
      granteeNames = Object.fromEntries(
        (pilots ?? []).map((p) => [
          p.id as string,
          ((p.display_name as string) || "Another parent").trim(),
        ]),
      );
    }

    const byMember = (members ?? []).map((m) => {
      const memberId = m.id as string;
      const grants = ((grantsRes.data ?? []) as Record<string, unknown>[]).filter(
        (g) => g.crew_member_id === memberId,
      );
      const codes = ((codesRes.data ?? []) as Record<string, unknown>[]).filter(
        (c) => c.crew_member_id === memberId,
      );
      return {
        crew_member_id: memberId,
        name: m.name as string,
        grants: grants.map((g) => ({
          id: g.id,
          granted_by: g.granted_by,
          grantee_name:
            granteeNames[g.grantee_pilot_id as string] ?? "Another parent",
          scope: g.scope ?? {},
          granted_at: g.granted_at,
          revoked_at: g.revoked_at,
        })),
        link_codes: codes.map((c) => ({
          id: c.id,
          code: c.code,
          expires_at: c.expires_at,
          used_at: c.used_at,
          created_at: c.created_at,
        })),
      };
    });

    return NextResponse.json({ members: byMember });
  } catch (e) {
    console.error(
      JSON.stringify({
        route: "GET /api/crew/access-grants",
        operation: "list grants",
        error: e instanceof Error ? e.message : String(e),
      }),
    );
    return NextResponse.json(
      { error: "Couldn't load sharing details right now." },
      { status: 500 },
    );
  }
}

/**
 * POST /api/crew/access-grants
 * Record a new access grant (steward only — RLS enforces the authority rule).
 * Body: { crew_member_id, grantee_pilot_id, scope? }
 */
export async function POST(req: Request) {
  try {
    const pilotId = await getPilotId();
    if (!pilotId) return NextResponse.json(unauthorized(), { status: 401 });

    const body = await req.json().catch(() => ({}));
    const crewMemberId = String(body.crew_member_id ?? "").trim();
    const granteePilotId = String(body.grantee_pilot_id ?? "").trim();
    if (!crewMemberId || !granteePilotId) {
      return NextResponse.json(
        { error: "Pick who this is for and who gets access." },
        { status: 400 },
      );
    }

    const supabase = await createClient();

    // The member must belong to this pilot — no cross-family grants.
    const { data: member } = await supabase
      .from("crew_members")
      .select("id, pilot_id")
      .eq("id", crewMemberId)
      .single();
    if (member?.pilot_id !== pilotId) {
      return NextResponse.json(
        { error: "Couldn't find that crew member." },
        { status: 404 },
      );
    }

    const scope =
      body.scope && typeof body.scope === "object" ? body.scope : {};
    const { data, error } = await supabase
      .from("crew_access_grants")
      .upsert(
        {
          crew_member_id: crewMemberId,
          granted_by: "steward",
          grantee_pilot_id: granteePilotId,
          scope,
          revoked_at: null,
        },
        { onConflict: "crew_member_id,grantee_pilot_id" },
      )
      .select("id")
      .single();
    if (error) throw error;
    return NextResponse.json({ ok: true, id: data?.id }, { status: 201 });
  } catch (e) {
    console.error(
      JSON.stringify({
        route: "POST /api/crew/access-grants",
        operation: "create grant",
        error: e instanceof Error ? e.message : String(e),
      }),
    );
    return NextResponse.json(
      { error: "Couldn't save that sharing change right now. Try again." },
      { status: 500 },
    );
  }
}
