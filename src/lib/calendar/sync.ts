/**
 * Calendar sync engine — pulls events from every connected provider into
 * the Supabase cache (calendars + calendar_events).
 *
 * Provider-agnostic: Google, Outlook, and iCloud all flow through the
 * CalendarSyncProvider interface. The UI reads only from the cache, so all
 * providers appear in one unified agenda automatically.
 *
 * Sync window: 7 days back, 60 days forward.
 */

import { createClient } from "@/lib/supabase/server";
import { decryptToken } from "@/lib/token-crypto";
import type { CalendarProvider, CalendarSyncProvider, ProviderCredential } from "./providers/types";
import { googleProvider } from "./providers/google";
import { outlookProvider } from "./providers/outlook";
import { icloudProvider } from "./providers/icloud";

const PROVIDERS: Record<CalendarProvider, CalendarSyncProvider> = {
  google: googleProvider,
  outlook: outlookProvider,
  icloud: icloudProvider,
};

const BACK_DAYS = 7;
const FORWARD_DAYS = 60;

export interface SyncResult {
  provider: CalendarProvider;
  email: string | null;
  calendars: number;
  events: number;
  error?: string;
}

/** Sync every active connection for a pilot. Returns per-connection results. */
export async function syncPilotCalendars(pilotId: string): Promise<SyncResult[]> {
  const supabase = await createClient();
  const { data: connections, error } = await supabase
    .from("calendar_connections")
    .select("id, provider, provider_account_email, refresh_token_enc")
    .eq("pilot_id", pilotId)
    .eq("status", "active");
  if (error) throw error;

  const results: SyncResult[] = [];
  for (const conn of connections ?? []) {
    const provider = conn.provider as CalendarProvider;
    const impl = PROVIDERS[provider];
    const base: SyncResult = {
      provider,
      email: conn.provider_account_email as string | null,
      calendars: 0,
      events: 0,
    };
    if (!impl) {
      results.push({ ...base, error: `Unknown provider "${provider}".` });
      continue;
    }
    try {
      if (!conn.refresh_token_enc) throw new Error("No stored credential.");
      const secret = await decryptToken(conn.refresh_token_enc as string);
      const cred: ProviderCredential = {
        provider,
        secret,
        accountEmail: conn.provider_account_email as string | null,
      };

      // 1. Refresh the calendar list.
      const remoteCalendars = await impl.listCalendars(cred);
      base.calendars = remoteCalendars.length;
      const from = new Date(Date.now() - BACK_DAYS * 86400000).toISOString();
      const to = new Date(Date.now() + FORWARD_DAYS * 86400000).toISOString();

      for (const rc of remoteCalendars) {
        const { data: cal, error: calErr } = await supabase
          .from("calendars")
          .upsert(
            {
              connection_id: conn.id,
              provider_calendar_id: rc.id,
              name: rc.name,
              color: rc.color,
            },
            { onConflict: "connection_id,provider_calendar_id" },
          )
          .select("id")
          .single();
        if (calErr) throw calErr;

        // 2. Pull events for this calendar.
        const events = await impl.fetchEvents(cred, rc.id, from, to);
        if (events.length > 0) {
          const rows = events.map((e) => ({
            calendar_id: cal.id,
            provider_event_id: e.id,
            title: e.title,
            starts_at: e.startsAt,
            ends_at: e.endsAt,
            all_day: e.allDay,
            location: e.location,
            description: e.description,
            attendees: e.attendees,
            status: e.status,
          }));
          const { error: evErr } = await supabase
            .from("calendar_events")
            .upsert(rows, { onConflict: "calendar_id,provider_event_id" });
          if (evErr) throw evErr;
        }
        base.events += events.length;
      }

      await supabase
        .from("calendar_connections")
        .update({ last_synced_at: new Date().toISOString(), status: "active" })
        .eq("id", conn.id);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Sync failed.";
      base.error = message;
      await supabase
        .from("calendar_connections")
        .update({ status: "error" })
        .eq("id", conn.id);
    }
    results.push(base);
  }
  return results;
}
