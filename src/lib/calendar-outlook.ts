/**
 * calendar-outlook.ts — Microsoft Graph calendar provider adapter (server only).
 *
 * Implements the `CalendarProvider` interface from ./calendar-sync and
 * registers itself at module load. The shared framework in calendar-sync.ts
 * does the orchestration (upserts, pruning, stamping); this module only
 * knows Microsoft: OAuth refresh, /me/calendars, calendarView, and the row
 * mapping (in ./graph-event-map).
 *
 * Flow: refresh token (fail-closed decrypt) -> /me/calendars ->
 * calendarView per calendar (expanded occurrences) -> normalized SyncEvent
 * rows -> framework upserts/prunes.
 *
 * Security: tokens are decrypted with decryptToken() and never logged.
 * Crypto failures fail closed — the sync aborts before any Graph call.
 * Rotated refresh tokens are re-encrypted before storage.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { decryptToken, encryptToken } from "@/lib/token-crypto";
import {
  registerCalendarProvider,
  type CalendarConnectionRow,
  type CalendarProvider,
  type SyncCalendar,
  type SyncEvent,
  type SyncError,
  type SyncResult,
} from "@/lib/calendar-sync";
import {
  mapGraphCalendarColor,
  mapGraphEvent,
  type GraphEvent,
} from "@/lib/graph-event-map";

const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";
const TOKEN_SCOPE = "Calendars.ReadWrite Mail.Read offline_access openid profile email";

const GRAPH_FETCH_HEADERS = {
  Prefer: 'outlook.timezone="UTC"',
};

interface GraphCalendar {
  id?: string;
  name?: string;
  color?: string;
  hexColor?: string;
  isDefaultCalendar?: boolean;
}

async function getDb(client?: SupabaseClient): Promise<SupabaseClient> {
  return client ?? (await createClient());
}

// ---------------------------------------------------------------------------
// Microsoft OAuth + Graph API calls
// ---------------------------------------------------------------------------

/**
 * Refresh the connection's access token. Decrypts the stored refresh token
 * (throws = fail closed, sync aborts), calls the Microsoft token endpoint,
 * and stores the rotated refresh token re-encrypted. Marks the connection
 * revoked on invalid_grant, error otherwise. Never logs token values.
 */
export async function refreshOutlookAccessToken(
  connection: CalendarConnectionRow,
  db: SupabaseClient,
): Promise<string> {
  if (!connection.refresh_token_enc) {
    throw new Error("Outlook connection has no stored refresh token — reconnect the account.");
  }
  const refreshToken = await decryptToken(connection.refresh_token_enc);
  const clientId = process.env.OUTLOOK_CLIENT_ID;
  const clientSecret = process.env.OUTLOOK_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Outlook calendar isn't configured yet (missing OAuth client).");
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      scope: TOKEN_SCOPE,
    }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const code = (body as { error?: string }).error ?? `http_${res.status}`;
    await db
      .from("calendar_connections")
      .update({ status: code === "invalid_grant" ? "revoked" : "error" })
      .eq("id", connection.id);
    throw new Error(
      code === "invalid_grant"
        ? "Outlook access expired — reconnect the account to keep syncing."
        : "Couldn't refresh the Outlook connection. It will retry on the next sync.",
    );
  }

  const tokens = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
  };
  if (!tokens.access_token) throw new Error("Outlook token refresh returned no access token.");

  // Microsoft rotates refresh tokens — store the new one (encrypted), or the
  // old value is silently invalidated on next use.
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

/** Follow @odata.nextLink pages and collect values. Throws on Graph errors. */
async function graphPaged<T>(url: string, accessToken: string): Promise<T[]> {
  const out: T[] = [];
  let next: string | null = url;
  while (next) {
    const res = await fetch(next, {
      headers: { Authorization: `Bearer ${accessToken}`, ...GRAPH_FETCH_HEADERS },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const msg = (body as { error?: { message?: string } }).error?.message;
      throw new Error(
        msg ? `Outlook request failed: ${msg}` : `Outlook request failed (${res.status}).`,
      );
    }
    const page = (await res.json()) as { value?: T[]; "@odata.nextLink"?: string };
    out.push(...(page.value ?? []));
    next = page["@odata.nextLink"] ?? null;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Provider adapter
// ---------------------------------------------------------------------------

const outlookProvider: CalendarProvider = {
  name: "outlook",

  refreshAccessToken: refreshOutlookAccessToken,

  listCalendars: async (accessToken: string): Promise<SyncCalendar[]> => {
    const remote = await graphPaged<GraphCalendar>(
      `${GRAPH_BASE}/me/calendars?$select=id,name,color,hexColor,isDefaultCalendar`,
      accessToken,
    );
    return remote
      .filter((c) => c.id)
      .map((c) => ({
        provider_calendar_id: c.id as string,
        name: (c.name ?? "").trim() || "Calendar",
        color: mapGraphCalendarColor(c.color, c.hexColor),
      }));
  },

  listEvents: async (
    accessToken: string,
    providerCalendarId: string,
    windowStartISO: string,
    windowEndISO: string,
  ): Promise<SyncEvent[]> => {
    const params = new URLSearchParams({
      startDateTime: windowStartISO,
      endDateTime: windowEndISO,
      $top: "500",
      $select:
        "id,subject,bodyPreview,isAllDay,isCancelled,showAs,start,end,location,attendees,type,seriesMasterId",
    });
    const events = await graphPaged<GraphEvent>(
      `${GRAPH_BASE}/me/calendars/${encodeURIComponent(providerCalendarId)}/calendarView?${params}`,
      accessToken,
    );
    const out: SyncEvent[] = [];
    for (const ev of events) {
      try {
        out.push(mapGraphEvent(ev));
      } catch {
        continue; // skip malformed events rather than writing bad rows
      }
    }
    return out;
  },
};

// Register at module load so the shared framework can dispatch "outlook"
// connections. Importing this module is what wires it up (e.g. a sync route
// imports ./calendar-outlook alongside ./calendar-sync).
registerCalendarProvider(outlookProvider);

// ---------------------------------------------------------------------------
// Convenience wrappers (same shape as the Google engine's exports, so the
// shared sync route treats both providers identically).
// ---------------------------------------------------------------------------

export async function syncOutlookCalendar(
  connectionId: string,
  supabase?: SupabaseClient,
): Promise<SyncResult> {
  const db = await getDb(supabase);
  const { data: conn } = await db
    .from("calendar_connections")
    .select("provider")
    .eq("id", connectionId)
    .single<{ provider: string }>();
  if (!conn || conn.provider !== "outlook") {
    throw new Error("This connection isn't an Outlook account.");
  }
  const { syncConnection } = await import("@/lib/calendar-sync");
  return syncConnection(connectionId, db);
}

export async function syncAllOutlookCalendars(
  pilotId: string,
  supabase?: SupabaseClient,
): Promise<{ results: SyncResult[]; errors: SyncError[] }> {
  const db = await getDb(supabase);
  const { data: connections, error } = await db
    .from("calendar_connections")
    .select("id")
    .eq("pilot_id", pilotId)
    .eq("provider", "outlook")
    .eq("status", "active");
  if (error) throw error;
  const { syncConnection: run } = await import("@/lib/calendar-sync");
  const results: SyncResult[] = [];
  const errors: SyncError[] = [];
  for (const conn of (connections ?? []) as Array<{ id: string }>) {
    try {
      results.push(await run(conn.id, db));
    } catch (e) {
      errors.push({
        connectionId: conn.id,
        provider: "outlook",
        message: e instanceof Error ? e.message : "Sync failed.",
      });
    }
  }
  return { results, errors };
}
