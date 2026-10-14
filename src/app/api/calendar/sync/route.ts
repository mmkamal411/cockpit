import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { syncAllConnections } from "@/lib/calendar-sync";
// Side-effect imports register the provider adapters with the framework.
import "@/lib/calendar-google";
import "@/lib/calendar-outlook";

/**
 * POST /api/calendar/sync
 * Syncs the pilot's active calendar connections (Google + Outlook) via the
 * shared provider framework. Per-connection failures are captured, not
 * thrown — one bad account can't block the rest.
 */
export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Sign in first, then sync your calendar." }, { status: 401 });
    }

    const { results, errors } = await syncAllConnections(user.id, supabase);

    if (results.length === 0 && errors.length === 0) {
      return NextResponse.json({
        ok: true,
        message: "No calendars connected yet.",
        synced: 0,
      });
    }

    return NextResponse.json({
      ok: errors.length === 0,
      synced: results.length,
      events: results.reduce((n, r) => n + r.eventsUpserted, 0),
      calendars: results.reduce((n, r) => n + r.calendars, 0),
      errors: errors.map((e) => e.message),
    });
  } catch {
    return NextResponse.json(
      { error: "Couldn't sync your calendar right now. Please try again in a bit." },
      { status: 500 },
    );
  }
}
