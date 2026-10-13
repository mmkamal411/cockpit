/**
 * Outlook Calendar provider — Microsoft Graph REST (no SDK dependency).
 *
 * OAuth via the Microsoft identity platform (v2.0). Needs an Azure app
 * registration: OUTLOOK_CLIENT_ID / OUTLOOK_CLIENT_SECRET env vars, with the
 * redirect URI registered in Azure.
 */

import type {
  CalendarSyncProvider,
  ProviderCalendar,
  ProviderCredential,
  ProviderEvent,
} from "./types";

const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const GRAPH = "https://graph.microsoft.com/v1.0";

async function accessToken(refreshToken: string): Promise<string> {
  const clientId = process.env.OUTLOOK_CLIENT_ID;
  const clientSecret = process.env.OUTLOOK_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Outlook Calendar is not configured.");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
      scope: "https://graph.microsoft.com/Calendars.Read offline_access",
    }),
  });
  if (!res.ok) throw new Error(`Outlook token refresh failed (${res.status})`);
  const data = await res.json();
  return data.access_token as string;
}

function toEvent(e: Record<string, unknown>): ProviderEvent {
  const start = e["start"] as Record<string, string>;
  const end = e["end"] as Record<string, string>;
  const allDay = Boolean(e["isAllDay"]);
  return {
    id: e["id"] as string,
    title: (e["subject"] as string) || "(no title)",
    startsAt: new Date(start["dateTime"] + (start["timeZone"] ? "" : "Z")).toISOString(),
    endsAt: new Date(end["dateTime"] + (end["timeZone"] ? "" : "Z")).toISOString(),
    allDay,
    location:
      ((e["location"] as Record<string, string> | undefined)?.["displayName"] as string) ?? null,
    description: ((e["bodyPreview"] as string) ?? null) as string | null,
    attendees: (
      ((e["attendees"] as Array<Record<string, Record<string, string>>>) ?? []).map((a) => ({
        email: a["emailAddress"]?.["address"],
        name: a["emailAddress"]?.["name"],
      })) as ProviderEvent["attendees"]
    ),
    status: e["isCancelled"] ? "cancelled" : "confirmed",
  };
}

export const outlookProvider: CalendarSyncProvider = {
  provider: "outlook",

  async listCalendars(cred: ProviderCredential): Promise<ProviderCalendar[]> {
    const token = await accessToken(cred.secret);
    const res = await fetch(`${GRAPH}/me/calendars?$select=id,name,color`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Outlook calendar list failed (${res.status})`);
    const data = await res.json();
    return ((data.value ?? []) as Array<Record<string, string>>).map((c) => ({
      id: c["id"],
      name: c["name"] || "Calendar",
      color: c["color"] ?? null,
    }));
  },

  async fetchEvents(
    cred: ProviderCredential,
    calendarId: string,
    from: string,
    to: string,
  ): Promise<ProviderEvent[]> {
    const token = await accessToken(cred.secret);
    // calendarView expands recurring events into instances.
    const params = new URLSearchParams({
      startDateTime: from,
      endDateTime: to,
      $top: "250",
      $orderby: "start/dateTime",
      $select: "id,subject,start,end,isAllDay,location,bodyPreview,attendees,isCancelled",
    });
    const res = await fetch(
      `${GRAPH}/me/calendars/${encodeURIComponent(calendarId)}/calendarView?${params}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new Error(`Outlook events failed (${res.status})`);
    const data = await res.json();
    return ((data.value ?? []) as Array<Record<string, unknown>>).map(toEvent);
  },
};
