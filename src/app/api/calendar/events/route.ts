import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getEventsInRange } from "@/lib/calendar";

/**
 * GET /api/calendar/events?from=&to=
 * Raw cached events in a range. 401 when signed out, empty list when unconnected.
 */
export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Sign in to see your calendar." }, { status: 401 });
    }
    const { searchParams } = new URL(req.url);
    const from = searchParams.get("from") ?? new Date().toISOString();
    const to =
      searchParams.get("to") ??
      new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const events = await getEventsInRange(user.id, from, to);
    return NextResponse.json({ events });
  } catch {
    return NextResponse.json(
      { error: "Couldn't load your calendar right now." },
      { status: 500 },
    );
  }
}
