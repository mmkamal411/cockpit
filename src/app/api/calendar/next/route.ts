import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getNextEvent, hasConnection } from "@/lib/calendar";

/**
 * GET /api/calendar/next
 * "Next event" summary for the glass pane.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ connected: false, next: null });
    const connected = await hasConnection(user.id);
    if (!connected) return NextResponse.json({ connected: false, next: null });
    const next = await getNextEvent(user.id);
    return NextResponse.json({ connected: true, next });
  } catch {
    return NextResponse.json({ connected: false, next: null });
  }
}
