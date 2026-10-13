import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface CalendarRow {
  id: string;
  name: string;
  color: string | null;
  visible: boolean;
  kind: string;
  calendar_connections: { pilot_id: string; provider: string } | { pilot_id: string; provider: string }[];
}

/**
 * GET /api/calendar/calendars
 * Lists the signed-in pilot's calendars (with visibility + kind) so the
 * calendar manager UI can offer visible/kind toggles (PATCH [id]).
 * 401 when signed out.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Sign in to see your calendars." }, { status: 401 });
    }
    const { data, error } = await supabase
      .from("calendars")
      .select(
        "id, name, color, visible, kind, calendar_connections!inner(pilot_id, provider)",
      )
      .eq("calendar_connections.pilot_id", user.id)
      .order("name");
    if (error) throw error;
    const calendars = ((data ?? []) as unknown as CalendarRow[]).map((c) => {
      const conn = Array.isArray(c.calendar_connections)
        ? c.calendar_connections[0]
        : c.calendar_connections;
      return {
        id: c.id,
        name: c.name,
        color: c.color,
        visible: c.visible,
        kind: c.kind,
        provider: conn?.provider ?? "unknown",
      };
    });
    return NextResponse.json({ calendars });
  } catch {
    return NextResponse.json(
      { error: "Couldn't load your calendars right now." },
      { status: 500 },
    );
  }
}
