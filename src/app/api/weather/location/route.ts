import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/weather/location
 * Returns the pilot's saved weather prefs. 401 when signed out —
 * callers fall back to a default location rather than a blank card.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json(
        { error: "Sign in to load your saved location." },
        { status: 401 },
      );
    }
    const { data, error } = await supabase
      .from("pilots")
      .select("home_location, home_lat, home_lon, weather_units")
      .eq("id", user.id)
      .single();
    if (error) throw error;
    return NextResponse.json({ prefs: data ?? null });
  } catch {
    return NextResponse.json(
      { error: "Couldn't load your saved location right now." },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/weather/location
 * Body: { home_location?: string, home_lat?: number, home_lon?: number, weather_units?: "F"|"C" }
 * Persists the pilot's weather preferences. Requires auth.
 */
export async function PATCH(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Sign in to save your location." }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const patch: Record<string, unknown> = {};
    if (typeof body.home_location === "string" && body.home_location.trim()) {
      patch.home_location = body.home_location.trim().slice(0, 120);
    }
    if (Number.isFinite(body.home_lat) && Number.isFinite(body.home_lon)) {
      // Round to ~0.1° (coarse per directive D7 — never precise GPS).
      patch.home_lat = Math.round(Number(body.home_lat) * 10) / 10;
      patch.home_lon = Math.round(Number(body.home_lon) * 10) / 10;
    }
    if (body.weather_units === "F" || body.weather_units === "C") {
      patch.weather_units = body.weather_units;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    }

    const { error } = await supabase.from("pilots").update(patch).eq("id", user.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Couldn't save your location right now." },
      { status: 500 },
    );
  }
}
