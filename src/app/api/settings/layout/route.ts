import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPilotId, unauthorized } from "@/lib/crew/auth";
import { DEFAULT_SETTINGS, NeonAccent, OrbBehavior } from "@/lib/pilot-settings";

const STATION_IDS = new Set(DEFAULT_SETTINGS.cockpit.home_stations);
const WIDGET_IDS = new Set(["weather", "calendar", "todos", "progress", "school", "mail"]);
const ACCENTS: NeonAccent[] = ["teal", "green", "cyan", "amber", "purple"];
const ORBS: OrbBehavior[] = ["calm", "lively"];

function cleanLayout(body: Record<string, unknown>) {
  const stations = Array.isArray(body.home_stations)
    ? (body.home_stations as unknown[]).filter((s): s is string => typeof s === "string")
    : [];
  // Keep only known stations, dedupe, preserve order; re-append any missing
  // known stations so nothing silently vanishes from the home deck.
  const seen = new Set<string>();
  const ordered = stations.filter((s) => STATION_IDS.has(s) && !seen.has(s) && (seen.add(s), true));
  for (const s of DEFAULT_SETTINGS.cockpit.home_stations) {
    if (!seen.has(s)) ordered.push(s);
  }
  const widgets = Array.isArray(body.hero_widgets)
    ? (body.hero_widgets as unknown[]).filter((w): w is string => typeof w === "string" && WIDGET_IDS.has(w))
    : DEFAULT_SETTINGS.cockpit.hero_widgets;
  return {
    home_stations: ordered,
    hero_widgets: widgets,
    neon_accent: ACCENTS.includes(body.neon_accent as NeonAccent)
      ? (body.neon_accent as NeonAccent)
      : DEFAULT_SETTINGS.cockpit.neon_accent,
    reduce_motion: body.reduce_motion === true,
    celebrations: body.celebrations !== false,
    orb_behavior: ORBS.includes(body.orb_behavior as OrbBehavior)
      ? (body.orb_behavior as OrbBehavior)
      : DEFAULT_SETTINGS.cockpit.orb_behavior,
  };
}

/**
 * GET /api/settings/layout
 * The active cockpit layout — the home-station order the ship arranges.
 * Absent rows return the out-of-the-box layout, never a blank.
 */
export async function GET() {
  try {
    const pilotId = await getPilotId();
    if (!pilotId) return NextResponse.json(unauthorized(), { status: 401 });

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("cockpit_layouts")
      .select("layout")
      .eq("pilot_id", pilotId)
      .eq("active", true)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;

    const layout = data?.layout
      ? cleanLayout(data.layout as Record<string, unknown>)
      : cleanLayout({});
    return NextResponse.json({ layout });
  } catch {
    return NextResponse.json(
      { error: "Couldn't load your cockpit layout right now." },
      { status: 500 },
    );
  }
}

/**
 * PUT /api/settings/layout
 * Saves the pilot-arranged layout as the active row. This is what fills the
 * layer-2 personalization gap: the ship now remembers how you arranged it.
 */
export async function PUT(req: Request) {
  try {
    const pilotId = await getPilotId();
    if (!pilotId) return NextResponse.json(unauthorized(), { status: 401 });

    const body = await req.json().catch(() => ({}));
    const layout = cleanLayout(body);
    const supabase = await createClient();

    // Retire the old active row, then insert the new one — one active at a time.
    await supabase
      .from("cockpit_layouts")
      .update({ active: false })
      .eq("pilot_id", pilotId)
      .eq("active", true);

    const { error } = await supabase.from("cockpit_layouts").insert({
      pilot_id: pilotId,
      layout,
      active: true,
      generated_at: new Date().toISOString(),
    });
    if (error) throw error;
    return NextResponse.json({ ok: true, layout });
  } catch {
    return NextResponse.json(
      { error: "Couldn't save your layout right now. Try again." },
      { status: 500 },
    );
  }
}
