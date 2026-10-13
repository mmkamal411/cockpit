/**
 * Google Calendar provider — raw REST (no googleapis dependency).
 *
 * Uses the stored OAuth refresh token to mint access tokens, then reads
 * the calendar list and events. All network calls are plain fetch.
 */

import type {
  CalendarSyncProvider,
  ProviderCalendar,
  ProviderCredential,
  ProviderEvent,
} from "./types";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/calendar/v3";

async function accessToken(refreshToken: string): Promise<string> {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Google Calendar is not configured.");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`Google token refresh failed (${res.status})`);
  const data = await res.json();
  return data.access_token as string;
}

function toEvent(e: Record<string, unknown>): ProviderEvent {
  const start = e["start"] as Record<string, string>;
  const end = e["end"] as Record<string, string>;
  const allDay = Boolean(start["date"] && !start["dateTime"]);
  return {
    id: e["id"] as string,
    title: (e["summary"] as string) || "(no title)",
    startsAt: allDay
      ? new Date(`${start["date"]}T00:00:00`).toISOString()
      : new Date(start["dateTime"]).toISOString(),
    endsAt: allDay
      ? new Date(`${end["date"]}T00:00:00`).toISOString()
      : new Date(end["dateTime"]).toISOString(),
    allDay,
    location: (e["location"] as string) ?? null,
    description: (e["description"] as string) ?? null,
    attendees: (((e["attendees"] as Array<Record<string, string>>) ?? []).map((a) => ({
      email: a["email"],
      name: a["displayName"],
    })) as ProviderEvent["attendees"]),
    status: e["status"] === "cancelled" ? "cancelled" : "confirmed",
  };
}

export const googleProvider: CalendarSyncProvider = {
  provider: "google",

  async listCalendars(cred: ProviderCredential): Promise<ProviderCalendar[]> {
    const token = await accessToken(cred.secret);
    const res = await fetch(`${API}/users/me/calendarList`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Google calendar list failed (${res.status})`);
    const data = await res.json();
    return ((data.items ?? []) as Array<Record<string, string>>).map((c) => ({
      id: c["id"],
      name: c["summaryOverride"] || c["summary"] || "Calendar",
      color: c["backgroundColor"] ?? null,
    }));
  },

  async fetchEvents(
    cred: ProviderCredential,
    calendarId: string,
    from: string,
    to: string,
  ): Promise<ProviderEvent[]> {
    const token = await accessToken(cred.secret);
    const params = new URLSearchParams({
      timeMin: from,
      timeMax: to,
      singleEvents: "true",
      orderBy: "startTime",
      maxResults: "250",
    });
    const res = await fetch(
      `${API}/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new Error(`Google events failed (${res.status})`);
    const data = await res.json();
    return ((data.items ?? []) as Array<Record<string, unknown>>).map(toEvent);
  },
};
