import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getEventsInRange, buildAgenda, hasConnection } from "@/lib/calendar";

/**
 * GET /api/calendar/agenda?date=YYYY-MM-DD
 * AI-organized agenda for a day: next up, sections, free windows, summary.
 */
export async function GET(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Sign in to see your agenda." }, { status: 401 });
    }
    const connected = await hasConnection(user.id);
    if (!connected) {
      return NextResponse.json({ connected: false, agenda: null });
    }
    const { searchParams } = new URL(req.url);
    const dateParam = searchParams.get("date");
    const day = dateParam ? new Date(dateParam + "T12:00:00") : new Date();
    const from = new Date(day);
    from.setHours(0, 0, 0, 0);
    const to = new Date(day);
    to.setHours(23, 59, 59, 999);
    const events = await getEventsInRange(user.id, from.toISOString(), to.toISOString());
    const agenda = buildAgenda(from.toISOString().slice(0, 10), events);
    return NextResponse.json({ connected: true, agenda });
  } catch {
    return NextResponse.json(
      { error: "Couldn't build your agenda right now." },
      { status: 500 },
    );
  }
}
