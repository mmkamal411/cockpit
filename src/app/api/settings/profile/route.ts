import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPilotId, unauthorized } from "@/lib/crew/auth";

// A short, friendly list of common timezones. The full IANA list is huge;
// these cover nearly every US pilot. Anything else stays as-is on the row.
const COMMON_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
];

const MAX_AVATAR_BYTES = 600_000;

/**
 * GET /api/settings/profile
 * Profile basics: name, email (read-only, from auth), photo, timezone,
 * coarse home location, temperature units.
 */
export async function GET() {
  try {
    const pilotId = await getPilotId();
    if (!pilotId) return NextResponse.json(unauthorized(), { status: 401 });

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const { data, error } = await supabase
      .from("pilots")
      .select("display_name, avatar_url, timezone, home_location, weather_units")
      .eq("id", pilotId)
      .maybeSingle();
    if (error) throw error;

    // Fall back to the auth metadata name when the pilot never set one.
    const metaName =
      (user?.user_metadata?.full_name as string | undefined) ??
      (user?.user_metadata?.name as string | undefined) ??
      null;

    return NextResponse.json({
      profile: {
        display_name: data?.display_name ?? metaName ?? "",
        email: user?.email ?? "",
        avatar_url: data?.avatar_url ?? null,
        timezone: data?.timezone ?? "America/New_York",
        home_location: data?.home_location ?? null,
        weather_units: data?.weather_units ?? "F",
      },
      timezone_options: COMMON_TIMEZONES,
    });
  } catch {
    return NextResponse.json(
      { error: "Couldn't load your profile right now." },
      { status: 500 },
    );
  }
}

/**
 * PATCH /api/settings/profile
 * Body: { display_name?, avatar_url?, timezone?, home_location?, weather_units? }
 * Email is read-only — it comes from the sign-in provider.
 */
export async function PATCH(req: Request) {
  try {
    const pilotId = await getPilotId();
    if (!pilotId) return NextResponse.json(unauthorized(), { status: 401 });

    const body = await req.json().catch(() => ({}));
    const patch: Record<string, unknown> = {};

    if (typeof body.display_name === "string") {
      const name = body.display_name.trim().slice(0, 80);
      if (!name) {
        return NextResponse.json(
          { error: "Give yourself a name — even a nickname works." },
          { status: 400 },
        );
      }
      patch.display_name = name;
    }
    if (typeof body.avatar_url === "string") {
      const url = body.avatar_url.trim();
      if (url.length > MAX_AVATAR_BYTES) {
        return NextResponse.json(
          { error: "That photo is too large. Try a smaller one." },
          { status: 400 },
        );
      }
      patch.avatar_url = url.slice(0, MAX_AVATAR_BYTES);
    }
    if (body.avatar_url === null) patch.avatar_url = null;
    if (typeof body.timezone === "string" && body.timezone.trim()) {
      patch.timezone = body.timezone.trim().slice(0, 60);
    }
    if (typeof body.home_location === "string") {
      // Coarse only (city or ZIP) — per the privacy rule, never precise GPS.
      patch.home_location = body.home_location.trim().slice(0, 120) || null;
    }
    if (body.weather_units === "F" || body.weather_units === "C") {
      patch.weather_units = body.weather_units;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    }

    const supabase = await createClient();
    const { error } = await supabase.from("pilots").update(patch).eq("id", pilotId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Couldn't save your profile right now. Try again." },
      { status: 500 },
    );
  }
}
