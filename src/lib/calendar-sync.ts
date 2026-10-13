/**
 * calendar-sync.ts — provider-agnostic calendar sync engine (server only).
 *
 * One shared orchestration for every calendar provider (Google, Outlook,
 * future iCloud/CalDAV…). Each provider implements the `CalendarProvider`
 * interface and registers itself; the framework handles the rest:
 *   1. load the connection row
 *   2. refresh the OAuth access token (provider does this, fail-closed crypto)
 *   3. pull the calendar list, upsert into `calendars`
 *      (existing `visible` / `kind` choices are PRESERVED — a sync never
 *      clobbers what the pilot picked in the UI)
 *   4. pull events per calendar inside the sync window, upsert
 *      into `calendar_events`
 *   5. prune cached rows the provider no longer returns (deleted/moved events)
 *   6. stamp last_synced_at, clear last_sync_error
 *
 * Per-connection failures are captured into `last_sync_error` on the
 * connection row (plain-English, shown in the UI) and never thrown through
 * `syncAllConnections` — one bad account can't block the rest.
 *
 * How a new provider plugs in (Outlook example):
 *   import { registerCalendarProvider } from "@/lib/calendar-sync";
 *   registerCalendarProvider({
 *     name: "outlook",
 *     refreshAccessToken,   // (connection, db) => access token
 *     listCalendars,        // (accessToken) => SyncCalendar[]
 *     listEvents,           // (accessToken, providerCalendarId, from, to) => SyncEvent[]
 *   });
 * The read endpoints (events/agenda/next) are provider-blind — they read the
 * shared cache, so no provider-specific UI work is needed.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/** Sync window: 30 days back, 90 days forward. */
export const SYNC_WINDOW_BACK_DAYS = 30;
export const SYNC_WINDOW_FORWARD_DAYS = 90;

export interface CalendarConnectionRow {
  id: string;
  pilot_id: string;
  provider: string;
  provider_account_email: string | null;
  refresh_token_enc: string | null;
  status: string;
}

/** Normalized calendar row every provider maps into. */
export interface SyncCalendar {
  provider_calendar_id: string;
  name: string;
  color: string | null;
}

/** Normalized event row every provider maps into. Mirrors the
 *  calendar_events table contract shared by all providers. */
export interface SyncEvent {
  provider_event_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  location: string | null;
  description: string | null;
  attendees: Array<{ email?: string; name?: string }>;
  status: "confirmed" | "tentative" | "cancelled";
}

/** The contract a provider adapter must satisfy. */
export interface CalendarProvider {
  /** Matches calendar_connections.provider ("google", "outlook", …). */
  name: string;
  /** Refresh OAuth; returns a fresh access token. Throws on failure.
   *  Must mark revoked/error status on the connection row itself. */
  refreshAccessToken(
    connection: CalendarConnectionRow,
    db: SupabaseClient,
  ): Promise<string>;
  /** List the provider account's calendars. */
  listCalendars(accessToken: string): Promise<SyncCalendar[]>;
  /** List events (expanded occurrences) on one provider calendar
   *  inside [windowStartISO, windowEndISO). */
  listEvents(
    accessToken: string,
    providerCalendarId: string,
    windowStartISO: string,
    windowEndISO: string,
  ): Promise<SyncEvent[]>;
}

export interface SyncResult {
  connectionId: string;
  provider: string;
  calendars: number;
  eventsUpserted: number;
  eventsRemoved: number;
  syncedAt: string;
}

export interface SyncError {
  connectionId: string;
  provider: string;
  message: string;
}

const providers = new Map<string, CalendarProvider>();

/** Adapters call this at module load (see module docstring). */
export function registerCalendarProvider(provider: CalendarProvider): void {
  providers.set(provider.name, provider);
}

export function getCalendarProvider(name: string): CalendarProvider | undefined {
  return providers.get(name);
}

async function getDb(client?: SupabaseClient): Promise<SupabaseClient> {
  return client ?? (await createClient());
}

/**
 * Upsert the provider's calendar list. Rows are keyed by
 * (connection_id, provider_calendar_id). Existing `visible`/`kind`
 * choices survive the sync — only new calendars get the defaults.
 */
async function upsertCalendars(
  db: SupabaseClient,
  connectionId: string,
  remote: SyncCalendar[],
): Promise<Array<{ id: string; provider_calendar_id: string }>> {
  if (remote.length === 0) return [];

  const { data: existing } = await db
    .from("calendars")
    .select("provider_calendar_id, visible, kind")
    .eq("connection_id", connectionId);
  const prefs = new Map((existing ?? []).map((c) => [c.provider_calendar_id as string, c]));

  const rows = remote.map((c) => {
    const prev = prefs.get(c.provider_calendar_id);
    return {
      connection_id: connectionId,
      provider_calendar_id: c.provider_calendar_id,
      name: c.name,
      color: c.color,
      visible: (prev?.visible as boolean | undefined) ?? true,
      kind: (prev?.kind as string | undefined) ?? "personal",
    };
  });

  const { data, error } = await db
    .from("calendars")
    .upsert(rows, { onConflict: "connection_id,provider_calendar_id" })
    .select("id, provider_calendar_id");
  if (error) throw error;
  return data ?? [];
}

/**
 * Upsert a calendar's pulled events, then prune cached rows the provider no
 * longer returns (deleted or moved events). The prune only runs after a
 * successful full pull, inside the sync window — nothing outside the window
 * is ever touched.
 */
async function syncEventsForCalendar(
  db: SupabaseClient,
  calendarId: string,
  events: SyncEvent[],
  windowStartISO: string,
  windowEndISO: string,
): Promise<{ upserted: number; removed: number }> {
  const rows = events.map((e) => ({ calendar_id: calendarId, ...e }));
  if (rows.length > 0) {
    const { error } = await db
      .from("calendar_events")
      .upsert(rows, { onConflict: "calendar_id,provider_event_id" });
    if (error) throw error;
  }

  const pulledIds = new Set(rows.map((r) => r.provider_event_id));
  const { data: cached } = await db
    .from("calendar_events")
    .select("id, provider_event_id")
    .eq("calendar_id", calendarId)
    .gte("starts_at", windowStartISO)
    .lt("starts_at", windowEndISO);
  const staleIds = (cached ?? [])
    .filter((c) => !pulledIds.has(c.provider_event_id))
    .map((c) => c.id);

  let removed = 0;
  const CHUNK = 100;
  for (let i = 0; i < staleIds.length; i += CHUNK) {
    const { error } = await db
      .from("calendar_events")
      .delete()
      .in("id", staleIds.slice(i, i + CHUNK));
    if (error) throw error;
    removed += Math.min(CHUNK, staleIds.length - i);
  }
  return { upserted: rows.length, removed };
}

/** Record a sync failure on the connection row (plain-English message). */
async function recordSyncFailure(
  db: SupabaseClient,
  connectionId: string,
  message: string,
): Promise<void> {
  await db
    .from("calendar_connections")
    .update({ last_sync_error: message })
    .eq("id", connectionId);
}

/**
 * Full sync for one connection: refresh → calendars → events → prune →
 * stamp. Provider-agnostic — dispatches on calendar_connections.provider.
 */
export async function syncConnection(
  connectionId: string,
  supabase?: SupabaseClient,
): Promise<SyncResult> {
  const db = await getDb(supabase);

  const { data: connection, error: connErr } = await db
    .from("calendar_connections")
    .select("id, pilot_id, provider, provider_account_email, refresh_token_enc, status")
    .eq("id", connectionId)
    .single<CalendarConnectionRow>();
  if (connErr || !connection) throw new Error("That calendar connection wasn't found.");
  if (connection.status !== "active") {
    throw new Error("That calendar account needs attention before it can sync — reconnect it below.");
  }

  const provider = getCalendarProvider(connection.provider);
  if (!provider) {
    // Another provider team's adapter isn't registered in this build yet —
    // skip quietly; it will sync once its adapter lands.
    throw new Error(
      `Sync for ${connection.provider} calendars isn't wired up in this build yet.`,
    );
  }

  try {
    const accessToken = await provider.refreshAccessToken(connection, db);
    const remoteCalendars = await provider.listCalendars(accessToken);
    const calendars = await upsertCalendars(db, connection.id, remoteCalendars);

    const now = Date.now();
    const windowStartISO = new Date(now - SYNC_WINDOW_BACK_DAYS * 86400000).toISOString();
    const windowEndISO = new Date(now + SYNC_WINDOW_FORWARD_DAYS * 86400000).toISOString();

    let eventsUpserted = 0;
    let eventsRemoved = 0;
    for (const cal of calendars) {
      const events = await provider.listEvents(
        accessToken,
        cal.provider_calendar_id,
        windowStartISO,
        windowEndISO,
      );
      const { upserted, removed } = await syncEventsForCalendar(
        db,
        cal.id,
        events,
        windowStartISO,
        windowEndISO,
      );
      eventsUpserted += upserted;
      eventsRemoved += removed;
    }

    const syncedAt = new Date().toISOString();
    await db
      .from("calendar_connections")
      .update({ last_synced_at: syncedAt, status: "active", last_sync_error: null })
      .eq("id", connection.id);

    return {
      connectionId: connection.id,
      provider: connection.provider,
      calendars: calendars.length,
      eventsUpserted,
      eventsRemoved,
      syncedAt,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Sync failed.";
    await recordSyncFailure(db, connection.id, message);
    throw e;
  }
}

/**
 * Sync every active calendar connection for a pilot, across all registered
 * providers. Per-connection failures are captured, not thrown, so one bad
 * account can't block the rest. Connections whose provider adapter isn't
 * registered in this build are skipped silently (another team's work).
 */
export async function syncAllConnections(
  pilotId: string,
  supabase?: SupabaseClient,
): Promise<{ results: SyncResult[]; errors: SyncError[] }> {
  const db = await getDb(supabase);
  const { data: connections, error } = await db
    .from("calendar_connections")
    .select("id, provider")
    .eq("pilot_id", pilotId)
    .eq("status", "active");
  if (error) throw error;

  const results: SyncResult[] = [];
  const errors: SyncError[] = [];
  for (const conn of (connections ?? []) as Array<{ id: string; provider: string }>) {
    if (!getCalendarProvider(conn.provider)) continue; // not wired up in this build
    try {
      results.push(await syncConnection(conn.id, db));
    } catch (e) {
      errors.push({
        connectionId: conn.id,
        provider: conn.provider,
        message: e instanceof Error ? e.message : "Sync failed.",
      });
    }
  }
  return { results, errors };
}
