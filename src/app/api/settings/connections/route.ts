import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPilotId, unauthorized } from "@/lib/crew/auth";

/**
 * GET /api/settings/connections
 * One honest roll-call of everything the pilot has (or hasn't) connected:
 * calendars, per-child school logins, and the generic integration catalog.
 * Every row carries status + freshness — never just a name.
 */

const CATALOG: { kind: string; label: string; blurb: string }[] = [
  { kind: "mail", label: "Email", blurb: "Gmail and Outlook, triaged by Crystal." },
  { kind: "health", label: "Health", blurb: "Sleep, movement, and how your body is really doing." },
  { kind: "bank", label: "Bank", blurb: "Balances and the quiet leaks in your budget." },
  { kind: "shopping", label: "Shopping", blurb: "Order tracking from your real inboxes." },
  { kind: "travel", label: "Travel", blurb: "Flights, stays, and trips that plan themselves." },
];

export async function GET() {
  try {
    const pilotId = await getPilotId();
    if (!pilotId) return NextResponse.json(unauthorized(), { status: 401 });

    const supabase = await createClient();

    const [calRes, schoolRes, integRes] = await Promise.all([
      supabase
        .from("calendar_connections")
        .select("id, provider, provider_account_email, status, last_synced_at, last_sync_error")
        .eq("pilot_id", pilotId)
        .order("created_at", { ascending: true }),
      supabase
        .from("crew_members")
        .select(
          "id, name, crew_school_links (district, sync_status, last_synced_at)",
        )
        .eq("pilot_id", pilotId)
        .order("created_at", { ascending: true }),
      supabase
        .from("pilot_integrations")
        .select("id, kind, provider, status, connected_at")
        .eq("pilot_id", pilotId)
        .order("connected_at", { ascending: true }),
    ]);

    if (calRes.error) throw calRes.error;
    if (schoolRes.error) throw schoolRes.error;
    if (integRes.error) throw integRes.error;

    type SchoolLink = { district: string | null; sync_status: string; last_synced_at: string | null };
    const school = (schoolRes.data ?? []).map((m) => {
      const links = (m.crew_school_links ?? []) as SchoolLink[];
      const link = links[0] ?? null;
      return {
        crew_member_id: m.id as string,
        name: m.name as string,
        district: link?.district ?? null,
        sync_status: link?.sync_status ?? "idle",
        last_synced_at: link?.last_synced_at ?? null,
      };
    });

    const connectedKinds = new Set(
      (integRes.data ?? []).map((r) => r.kind as string),
    );
    const catalog = CATALOG.map((c) => ({
      ...c,
      connected: connectedKinds.has(c.kind),
    }));

    return NextResponse.json({
      calendars: calRes.data ?? [],
      school,
      integrations: integRes.data ?? [],
      catalog,
    });
  } catch (e) {
    console.error(
      JSON.stringify({
        route: "GET /api/settings/connections",
        operation: "list connections",
        error: e instanceof Error ? e.message : String(e),
      }),
    );
    return NextResponse.json(
      { error: "Couldn't load your connections right now." },
      { status: 500 },
    );
  }
}
