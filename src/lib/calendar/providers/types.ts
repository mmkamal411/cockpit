/**
 * Calendar providers — shared types.
 *
 * Each provider implements `fetchEvents` returning normalized events.
 * The sync engine (../sync.ts) writes them into the calendar_events cache.
 * The UI reads only from the cache, so it's provider-agnostic.
 */

export type CalendarProvider = "google" | "outlook" | "icloud";

export interface ProviderCalendar {
  /** Provider-native calendar ID. */
  id: string;
  name: string;
  color: string | null;
}

export interface ProviderEvent {
  /** Provider-native event ID (stable across syncs). */
  id: string;
  title: string;
  startsAt: string; // ISO
  endsAt: string; // ISO
  allDay: boolean;
  location: string | null;
  description: string | null;
  attendees: Array<{ email?: string; name?: string }>;
  status: "confirmed" | "tentative" | "cancelled";
}

/** Decrypted credential for a connection. google/outlook = refresh token, icloud = app-specific password. */
export interface ProviderCredential {
  provider: CalendarProvider;
  /** For OAuth providers: the refresh token. For iCloud: the app-specific password. */
  secret: string;
  /** Account identifier (email / Apple ID). Used by some providers. */
  accountEmail: string | null;
}

export interface CalendarSyncProvider {
  readonly provider: CalendarProvider;
  /** List the user's calendars. */
  listCalendars(cred: ProviderCredential): Promise<ProviderCalendar[]>;
  /** Events in a time range for one calendar. */
  fetchEvents(
    cred: ProviderCredential,
    calendarId: string,
    from: string,
    to: string,
  ): Promise<ProviderEvent[]>;
}
