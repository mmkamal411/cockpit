/**
 * calendar-google.ts — Google Calendar provider adapter (server only).
 *
 * Implements the `CalendarProvider` interface from ./calendar-sync and
 * registers itself at module load. The shared framework in calendar-sync.ts
 * does the orchestration (upserts, pruning, stamping); this module only
 * knows Google: OAuth refresh, calendarList, events.list, and the row
 * mapping.
 *
 * Flow: refresh token (fail-closed decrypt) -> calendarList.list ->
 * events.list per calendar (singleEvents=true, expanded occurrences) ->
 * normalized SyncEvent rows -> framework upserts/prunes.
 *
 * Security: tokens are decrypted with decryptToken() and never logged.
 * Crypto failures fail closed — the sync aborts before any Google call.
 * Rotated refresh tokens are re-encrypted before storage.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { googleCalendarClientId } from "@/lib/env-fallbacks";
import { decryptToken, encryptToken } from "@/lib/token-crypto";
import {
  registerCalendarProvider,
  syncConnection,
  type CalendarConnectionRow,
  type CalendarProvider,
  type SyncCalendar,
  type SyncEvent,
  type SyncError,
  type SyncResult,
} from "@/lib/calendar-sync";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const CALENDAR_BASE = "https://www.googleapis.com/calendar/v3";

// ---------------------------------------------------------------------------
// Pure mapping: Google API payloads -> shared row shapes.
// Zero imports beyond types — unit-testable with plain node.
// ---------------------------------------------------------------------------

interface GoogleDateTime {
  dateTime?: string;
  date?: string;
}

interface GoogleEvent {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleDateTime;
  end?: GoogleDateTime;
  attendees?: Array<{ email?: string; displayName?: string; self?: boolean }>;
  status?: string;
}

interface GoogleCalendarListEntry {
  id?: string;
  summary?: string;
  backgroundColor?: string;
}

/** Google event status -> the shared enum (Google already uses these values). */
export function mapGoogleStatus(status: string | undefined): SyncEvent["status"] {
  if (status === "cancelled") return "cancelled";
  if (status === "tentative") return "tentative";
  return "confirmed";
}

/**
 * Map one Google event to the shared row shape. All-day events use
 * date (not dateTime). Throws on a missing/unparseable start or end —
 * the caller skips such events rather than writing bad rows.
 */
export function mapGoogleEvent(ev: GoogleEvent): SyncEvent {
  const id = (ev.id ?? "").trim();
  if (!id) throw new Error("google event missing id");

  const allDay = !!ev.start?.date && !ev.start?.dateTime;
  const startRaw = allDay ? ev.start!.date! : ev.start?.dateTime;
  const endRaw = allDay ? ev.end?.date : ev.end?.dateTime;
  if (!startRaw || !endRaw) throw new Error("google event missing start or end");

  const starts_at = allDay
    ? new Date(`${startRaw}T00:00:00Z`).toISOString()
    : new Date(startRaw).toISOString();
  const ends_at = allDay
    ? new Date(`${endRaw}T00:00:00Z`).toISOString()
    : new Date(endRaw).toISOString();
  if (Number.isNaN(Date.parse(starts_at)) || Number.isNaN(Date.parse(ends_at))) {
    throw new Error("google event has unparseable start or end");
  }

  return {
    provider_event_id: id,
    title: (ev.summary ?? "").trim() || "(no title)",
    starts_at,
    ends_at,
    all_day: allDay,
    location: (ev.location ?? "").trim() || null,
    description: (ev.description ?? "").trim() || null,
    attendees: (ev.attendees ?? [])
      .map((a) => ({ email: a.email, name: a.displayName }))
      .filter((a) => a.email || a.name),
    status: mapGoogleStatus(ev.status),
  };
}

/** Map one calendarList entry to the shared calendar shape. */
export function mapGoogleCalendar(entry: GoogleCalendarListEntry): SyncCalendar {
  if (!entry.id) throw new Error("google calendar missing id");
  return {
    provider_calendar_id: entry.id,
    name: (entry.summary ?? "").trim() || "Calendar",
    color: entry.backgroundColor ?? null,
  };
}

// ---------------------------------------------------------------------------
// Google API calls
// ---------------------------------------------------------------------------

function googleConfig(): { clientId: string; clientSecret: string } {
  const clientId = googleCalendarClientId();
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error(
      "Google Calendar isn't configured yet — the Google OAuth client is missing. " +
        "Ask your admin to add it, then reconnect.",
    );
  }
  return { clientId, clientSecret };
}

async function getDb(client?: SupabaseClient): Promise<SupabaseClient> {
  return client ?? (await createClient());
}

/** Follow pageToken pages and collect items. Throws on Google errors. */
async function googlePaged<T>(url: string, accessToken: string): Promise<T[]> {
  const out: T[] = [];
  let pageToken: string | undefined;
  do {
    const u = new URL(url);
    if (pageToken) u.searchParams.set("pageToken", pageToken);
    const res = await fetch(u.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const msg = (body as { error?: { message?: string } }).error?.message;
      throw new Error(
        msg ? `Google request failed: ${msg}` : `Google request failed (${res.status}).`,
      );
    }
    const page = (await res.json()) as { items?: T[]; nextPageToken?: string };
    out.push(...(page.items ?? []));
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out;
}

/**
 * Refresh the connection's access token. Decrypts the stored refresh token
 * (throws = fail closed, sync aborts), calls Google's token endpoint, and
 * stores a rotated refresh token re-encrypted. Never logs token values.
 */
export async function refreshGoogleAccessToken(
  connection: CalendarConnectionRow,
  supabase?: SupabaseClient,
): Promise<string> {
  const db = await getDb(supabase);
  if (!connection.refresh_token_enc) {
    throw new Error(
      "This Google connection lost its saved sign-in — reconnect the account to keep syncing.",
    );
  }
  const refreshToken = await decryptToken(connection.refresh_token_enc);
  const { clientId, clientSecret } = googleConfig();

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const code = (body as { error?: string }).error ?? `http_${res.status}`;
    // invalid_grant = refresh token revoked/expired: user must reconnect.
    await db
      .from("calendar_connections")
      .update({ status: code === "invalid_grant" ? "revoked" : "error" })
      .eq("id", connection.id);
    throw new Error(
      code === "invalid_grant"
        ? "Google access expired — reconnect the account to keep syncing."
        : "Couldn't refresh the Google connection. It will retry on the next sync.",
    );
  }

  const tokens = (await res.json()) as { access_token?: string; refresh_token?: string };
  if (!tokens.access_token) throw new Error("Google token refresh returned no access token.");

  // Google sometimes rotates refresh tokens — store the new one (encrypted).
  if (tokens.refresh_token && tokens.refresh_token !== refreshToken) {
    const enc = await encryptToken(tokens.refresh_token);
    await db
      .from("calendar_connections")
      .update({ refresh_token_enc: enc, status: "active" })
      .eq("id", connection.id);
  } else {
    await db.from("calendar_connections").update({ status: "active" }).eq("id", connection.id);
  }
  return tokens.access_token;
}

const googleProvider: CalendarProvider = {
  name: "google",

  refreshAccessToken: refreshGoogleAccessToken,

  async listCalendars(accessToken: string): Promise<SyncCalendar[]> {
    const url =
      `${CALENDAR_BASE}/users/me/calendarList?` +
      new URLSearchParams({
        fields: "items(id,summary,backgroundColor)",
        maxResults: "250",
      }).toString();
    const entries = await googlePaged<GoogleCalendarListEntry>(url, accessToken);
    const out: SyncCalendar[] = [];
    for (const e of entries) {
      try {
        out.push(mapGoogleCalendar(e));
      } catch {
        continue; // skip malformed entries rather than breaking the sync
      }
    }
    return out;
  },

  async listEvents(
    accessToken: string,
    providerCalendarId: string,
    windowStartISO: string,
    windowEndISO: string,
  ): Promise<SyncEvent[]> {
    const url =
      `${CALENDAR_BASE}/calendars/${encodeURIComponent(providerCalendarId)}/events?` +
      new URLSearchParams({
        singleEvents: "true",
        timeMin: windowStartISO,
        timeMax: windowEndISO,
        maxResults: "2500",
        orderBy: "startTime",
        fields:
          "items(id,summary,description,location,start,end,attendees,status),nextPageToken",
      }).toString();
    const events = await googlePaged<GoogleEvent>(url, accessToken);
    const out: SyncEvent[] = [];
    for (const ev of events) {
      try {
        out.push(mapGoogleEvent(ev));
      } catch {
        continue; // skip malformed events rather than writing bad rows
      }
    }
    return out;
  },
};

// Register at module load so the shared framework can dispatch "google"
// connections. Importing this module is what wires it up (e.g. a sync route
// imports ./calendar-google alongside ./calendar-sync).
registerCalendarProvider(googleProvider);

// ---------------------------------------------------------------------------
// Convenience wrappers (same shape as the Outlook engine's exports, so the
// shared sync route treats both providers identically).
// ---------------------------------------------------------------------------

export async function syncGoogleCalendar(
  connectionId: string,
  supabase?: SupabaseClient,
): Promise<SyncResult> {
  return syncConnection(connectionId, supabase);
}

export async function syncAllGoogleCalendars(
  pilotId: string,
  supabase?: SupabaseClient,
): Promise<{ results: SyncResult[]; errors: SyncError[] }> {
  const db = await getDb(supabase);
  const { data: connections, error } = await db
    .from("calendar_connections")
    .select("id")
    .eq("pilot_id", pilotId)
    .eq("provider", "google")
    .eq("status", "active");
  if (error) throw error;
  const results: SyncResult[] = [];
  const errors: SyncError[] = [];
  for (const conn of (connections ?? []) as Array<{ id: string }>) {
    try {
      results.push(await syncConnection(conn.id, db));
    } catch (e) {
      errors.push({
        connectionId: conn.id,
        provider: "google",
        message: e instanceof Error ? e.message : "Sync failed.",
      });
    }
  }
  return { results, errors };
}
