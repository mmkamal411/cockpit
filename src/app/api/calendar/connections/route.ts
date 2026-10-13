import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/calendar/connections
 * Lists the pilot's calendar connections with provider info
 * (Google / Outlook) so the UI can tell them apart.
 */
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Sign in first." }, { status: 401 });
    }
    const { data, error } = await supabase
      .from("calendar_connections")
      .select(
        "id, provider, provider_account_email, status, last_synced_at, last_sync_error, created_at, granted_scopes, last_tasks_sync",
      )
      .eq("pilot_id", user.id)
      .order("created_at", { ascending: true });
    if (error) throw error;
    return NextResponse.json({ connections: data ?? [] });
  } catch {
    return NextResponse.json(
      { error: "Couldn't load your connected accounts." },
      { status: 500 },
    );
  }
}
