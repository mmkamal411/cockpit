import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { syncPilotCalendars } from "@/lib/calendar/sync";

/**
 * POST /api/calendar/sync
 * Syncs all of the signed-in pilot's calendar connections (Google, Outlook,
 * iCloud) into the local cache. Called after connecting a new provider and
 * by the scheduled sync job.
 */
export async function POST() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Sign in first." }, { status: 401 });
    }
    const results = await syncPilotCalendars(user.id);
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json(
      { error: "Couldn't sync your calendars right now." },
      { status: 500 },
    );
  }
}
