import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/calendar/connections
 * Lists the pilot's calendar connections with provider info
 * (Google / Outlook) so the UI can tell them apart.
 *
 * Outlook connections also carry a `mail` block: whether school-email
 * sync is working for that account, so the UI can nudge a reconnect
 * when the grant predates Mail.Read ('needs_reconsent') or mail has
 * never synced.
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
        "id, provider, provider_account_email, status, last_synced_at, last_sync_error, created_at, granted_scopes, last_tasks_sync, last_mail_sync_at",
      )
      .eq("pilot_id", user.id)
      .order("created_at", { ascending: true });
    if (error) throw error;
    const connections = (data ?? []).map((c: Record<string, unknown>) => {
      if (c.provider !== "outlook") return c;
      const scopes = Array.isArray(c.granted_scopes) ? (c.granted_scopes as string[]) : [];
      const hasMailScope = scopes.includes("Mail.Read");
      const mailState =
        c.status === "needs_reconsent" || !hasMailScope
          ? "needs_reconsent"
          : c.last_mail_sync_at
            ? "synced"
            : "never_synced";
      return {
        ...c,
        mail: {
          state: mailState,
          last_synced_at: (c.last_mail_sync_at as string | null) ?? null,
          needs_reconnect: mailState === "needs_reconsent",
        },
      };
    });
    return NextResponse.json({ connections });
  } catch {
    return NextResponse.json(
      { error: "Couldn't load your connected accounts." },
      { status: 500 },
    );
  }
}
