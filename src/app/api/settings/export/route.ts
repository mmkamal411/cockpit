import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPilotId, unauthorized } from "@/lib/crew/auth";

/**
 * GET /api/settings/export
 * "Download my data" — a plain-English JSON bundle of everything Cockpit
 * holds about the pilot. Never includes raw credentials; the bundle is
 * exactly what the pilot could see on screen, in a file they can keep.
 */
export async function GET() {
  try {
    const pilotId = await getPilotId();
    if (!pilotId) return NextResponse.json(unauthorized(), { status: 401 });

    const supabase = await createClient();

    const [pilotRes, settingsRes, crewRes, layoutRes, integRes, todosRes] =
      await Promise.all([
        supabase
          .from("pilots")
          .select("display_name, timezone, home_location, weather_units, created_at")
          .eq("id", pilotId)
          .maybeSingle(),
        supabase
          .from("pilot_settings")
          .select("namespace, settings, updated_at")
          .eq("pilot_id", pilotId),
        supabase
          .from("crew_members")
          .select("id, name, relationship, birthdate, created_at")
          .eq("pilot_id", pilotId),
        supabase
          .from("cockpit_layouts")
          .select("layout, generated_at, active")
          .eq("pilot_id", pilotId)
          .order("generated_at", { ascending: false })
          .limit(5),
        supabase
          .from("pilot_integrations")
          .select("kind, provider, status, connected_at")
          .eq("pilot_id", pilotId),
        supabase
          .from("todos")
          .select("id, title, done, due_at, created_at", { count: "exact" })
          .eq("pilot_id", pilotId)
          .limit(200),
      ]);

    const errors = [pilotRes, settingsRes, crewRes, layoutRes, integRes, todosRes]
      .map((r) => r.error)
      .filter(Boolean);
    if (errors.length > 0) throw errors[0];

    const bundle = {
      exported_at: new Date().toISOString(),
      what_this_is:
        "Everything Cockpit holds about you, in one file. Names, settings, your layout, your crew's names, and your to-dos. Passwords and login tokens are never stored by Cockpit, so they are not here either.",
      profile: pilotRes.data ?? null,
      settings: (settingsRes.data ?? []).reduce<Record<string, unknown>>((acc, r) => {
        acc[r.namespace as string] = r.settings;
        return acc;
      }, {}),
      crew: crewRes.data ?? [],
      layouts: layoutRes.data ?? [],
      integrations: integRes.data ?? [],
      todos: todosRes.data ?? [],
    };

    return new NextResponse(JSON.stringify(bundle, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="cockpit-my-data-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  } catch (e) {
    console.error(
      JSON.stringify({
        route: "GET /api/settings/export",
        operation: "export data",
        error: e instanceof Error ? e.message : String(e),
      }),
    );
    return NextResponse.json(
      { error: "Couldn't prepare your download right now. Try again." },
      { status: 500 },
    );
  }
}
