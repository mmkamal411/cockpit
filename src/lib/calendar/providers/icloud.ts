/**
 * iCloud Calendar provider — raw CalDAV (no dependencies).
 *
 * Auth: Apple ID + app-specific password (generated at appleid.apple.com).
 * The password is stored encrypted in refresh_token_enc, exactly like an
 * OAuth refresh token. We never see or store the Apple ID password.
 *
 * Flow: PROPFIND on the principal URL to discover calendar-home-set,
 * then PROPFIND for calendars, then REPORT (calendar-query) with a
 * time-range filter per calendar. VEVENTs are parsed minimally.
 */

import type {
  CalendarSyncProvider,
  ProviderCalendar,
  ProviderCredential,
  ProviderEvent,
} from "./types";

const CALDAV_HOST = "https://caldav.icloud.com";

function basicAuth(cred: ProviderCredential): string {
  // Apple ID is the username, app-specific password is the password.
  const user = cred.accountEmail ?? "";
  return "Basic " + Buffer.from(`${user}:${cred.secret}`).toString("base64");
}

async function dav(
  url: string,
  method: string,
  cred: ProviderCredential,
  body: string,
  depth = "1",
  contentType = "application/xml; charset=utf-8",
): Promise<string> {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: basicAuth(cred),
      Depth: depth,
      "Content-Type": contentType,
    },
    body,
  });
  if (res.status === 401) throw new Error("iCloud sign-in failed. Check your Apple ID and app-specific password.");
  if (!res.ok) throw new Error(`iCloud CalDAV failed (${res.status})`);
  return res.text();
}

/** Extract the calendar-home-set URL from a principal PROPFIND. */
async function calendarHomeSet(cred: ProviderCredential): Promise<string> {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop><C:calendar-home-set/></D:prop>
</D:propfind>`;
  // Well-known principal path for iCloud.
  const xml = await dav(`${CALDAV_HOST}/`, "PROPFIND", cred, body, "0");
  const m = xml.match(/<C:calendar-home-set>[\s\S]*?<D:href>([^<]+)<\/D:href>/);
  if (!m) throw new Error("Couldn't find your iCloud calendars.");
  const href = m[1];
  return href.startsWith("http") ? href : `${CALDAV_HOST}${href}`;
}

/** Minimal VEVENT parser — just what the cache needs. */
function parseVevents(ics: string): ProviderEvent[] {
  const events: ProviderEvent[] = [];
  // Unfold continuation lines.
  const unfolded = ics.replace(/\r?\n[ \t]/g, "");
  const blocks = unfolded.split("BEGIN:VEVENT").slice(1);
  for (const b of blocks) {
    const body = b.split("END:VEVENT")[0];
    const get = (name: string): string | null => {
      const m = body.match(new RegExp(`^${name}(?:;[^:]*)?:(.*)$`, "m"));
      return m ? m[1].trim().replace(/\\n/g, "\n").replace(/\\,/g, ",") : null;
    };
    const uid = get("UID");
    const dtStart = get("DTSTART");
    const dtEnd = get("DTEND");
    if (!uid || !dtStart) continue;
    const status = (get("STATUS") ?? "").toUpperCase();
    events.push({
      id: uid,
      title: get("SUMMARY") || "(no title)",
      startsAt: icsDateToISO(dtStart),
      endsAt: dtEnd ? icsDateToISO(dtEnd) : icsDateToISO(dtStart),
      allDay: /^DTSTART;VALUE=DATE:/m.test(body),
      location: get("LOCATION"),
      description: get("DESCRIPTION"),
      attendees: [],
      status: status === "CANCELLED" ? "cancelled" : status === "TENTATIVE" ? "tentative" : "confirmed",
    });
  }
  return events;
}

/** Convert an iCalendar date value to ISO. Handles UTC (Z) and floating local times. */
function icsDateToISO(v: string): string {
  const d = v.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)/);
  if (d) {
    const iso = `${d[1]}-${d[2]}-${d[3]}T${d[4]}:${d[5]}:${d[6]}${d[7] ? "Z" : ""}`;
    return new Date(iso).toISOString();
  }
  const day = v.match(/(\d{4})(\d{2})(\d{2})/);
  if (day) return new Date(`${day[1]}-${day[2]}-${day[3]}T00:00:00`).toISOString();
  return new Date().toISOString();
}

export const icloudProvider: CalendarSyncProvider = {
  provider: "icloud",

  async listCalendars(cred: ProviderCredential): Promise<ProviderCalendar[]> {
    const home = await calendarHomeSet(cred);
    const body = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:A="http://apple.com/ns/ical/">
  <D:prop>
    <D:displayname/><C:calendar-color/><A:calendar-color/>
  </D:prop>
</D:propfind>`;
    const xml = await dav(home, "PROPFIND", cred, body, "1");
    const calendars: ProviderCalendar[] = [];
    const responses = xml.split("<D:response>").slice(1);
    for (const r of responses) {
      // Skip the home-set itself and non-calendar collections.
      if (!/<C:calendar\/>/.test(r)) continue;
      const href = r.match(/<D:href>([^<]+)<\/D:href>/)?.[1];
      const name = r.match(/<D:displayname>([^<]*)<\/D:displayname>/)?.[1];
      if (!href) continue;
      calendars.push({
        id: href.startsWith("http") ? href : `${CALDAV_HOST}${href}`,
        name: name || "Calendar",
        color: r.match(/<(?:C|A):calendar-color>([^<]+)<\/(?:C|A):calendar-color>/)?.[1] ?? null,
      });
    }
    return calendars;
  },

  async fetchEvents(
    cred: ProviderCredential,
    calendarId: string,
    from: string,
    to: string,
  ): Promise<ProviderEvent[]> {
    const fromUtc = from.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    const toUtc = to.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    const body = `<?xml version="1.0" encoding="utf-8"?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop><D:getetag/><C:calendar-data/></D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">
        <C:time-range start="${fromUtc}" end="${toUtc}"/>
      </C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>`;
    const xml = await dav(calendarId, "REPORT", cred, body, "1", "application/xml; charset=utf-8");
    const events: ProviderEvent[] = [];
    const responses = xml.split("<D:response>").slice(1);
    for (const r of responses) {
      const ics = r.match(/<C:calendar-data>([\s\S]*?)<\/C:calendar-data>/)?.[1];
      if (ics) events.push(...parseVevents(ics.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")));
    }
    return events;
  },
};

/** Validate credentials without syncing — used by the connect form. */
export async function validateIcloudCredentials(
  appleId: string,
  appPassword: string,
): Promise<void> {
  const cred: ProviderCredential = { provider: "icloud", secret: appPassword, accountEmail: appleId };
  await calendarHomeSet(cred);
}
