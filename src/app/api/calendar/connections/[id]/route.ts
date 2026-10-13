import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * DELETE /api/calendar/connections/[id]
 * Disconnects a calendar account (calendars + events cascade).
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Sign in first." }, { status: 401 });
    }
    const { data: conn } = await supabase
      .from("calendar_connections")
      .select("id")
      .eq("id", id)
      .eq("pilot_id", user.id)
      .single();
    if (!conn) {
      return NextResponse.json({ error: "Connection not found." }, { status: 404 });
    }
    const { error } = await supabase
      .from("calendar_connections")
      .delete()
      .eq("id", id)
      .eq("pilot_id", user.id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Couldn't disconnect right now." }, { status: 500 });
  }
}
