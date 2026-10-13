/**
 * graph-event-map.ts — pure mapping from Microsoft Graph event payloads
 * to the calendar_events row shape used by the read endpoints.
 *
 * Zero imports: this module is deliberately dependency-free so the mapping
 * can be unit-tested with plain node (see /tmp test in the build report).
 */

export interface GraphDateTime {
  dateTime: string;
  timeZone: string;
}

export interface GraphAttendee {
  emailAddress?: { address?: string; name?: string };
  type?: string;
}

export interface GraphEvent {
  id: string;
  subject?: string;
  bodyPreview?: string;
  isAllDay?: boolean;
  isCancelled?: boolean;
  showAs?: string;
  start?: GraphDateTime;
  end?: GraphDateTime;
  location?: { displayName?: string };
  attendees?: GraphAttendee[];
  type?: string;
  seriesMasterId?: string;
}

export interface CalendarEventRow {
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

/**
 * Convert a Graph dateTimeZone to an ISO instant.
 * The sync engine requests `Prefer: outlook.timezone="UTC"`, so the normal
 * path is a UTC timestamp. The non-UTC branch is a best-effort fallback.
 */
export function graphDateTimeToISO(dt: GraphDateTime): string {
  const raw = dt.dateTime;
  const withZone =
    dt.timeZone === "UTC" && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(raw) ? `${raw}Z` : raw;
  const parsed = new Date(withZone);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`unparseable graph dateTime: ${raw}`);
  }
  return parsed.toISOString();
}

export function mapGraphStatus(ev: GraphEvent): CalendarEventRow["status"] {
  if (ev.isCancelled) return "cancelled";
  if (ev.showAs === "tentative") return "tentative";
  return "confirmed";
}

export function mapGraphAttendees(ev: GraphEvent): CalendarEventRow["attendees"] {
  return (ev.attendees ?? [])
    .map((a) => ({
      email: a.emailAddress?.address,
      name: a.emailAddress?.name,
    }))
    .filter((a) => a.email || a.name);
}

/**
 * Map one Graph event (from calendarView, occurrences already expanded)
 * to a calendar_events row. Throws on a missing/unparseable start or end —
 * the sync engine skips such events rather than writing bad rows.
 */
export function mapGraphEvent(ev: GraphEvent): CalendarEventRow {
  if (!ev.id) throw new Error("graph event missing id");
  if (!ev.start?.dateTime || !ev.end?.dateTime) {
    throw new Error("graph event missing start or end");
  }
  const starts_at = graphDateTimeToISO(ev.start);
  const ends_at = graphDateTimeToISO(ev.end);
  const title = (ev.subject ?? "").trim() || "(no title)";
  return {
    provider_event_id: ev.id,
    title,
    starts_at,
    ends_at,
    all_day: ev.isAllDay ?? false,
    location: ev.location?.displayName?.trim() || null,
    description: ev.bodyPreview?.trim() || null,
    attendees: mapGraphAttendees(ev),
    status: mapGraphStatus(ev),
  };
}

const GRAPH_NAMED_COLORS: Record<string, string> = {
  lightBlue: "#3a9bdc",
  lightGreen: "#5fb56a",
  lightOrange: "#e8912d",
  lightGray: "#8e8e93",
  lightYellow: "#e5c53b",
  lightTeal: "#4db6ac",
  lightPink: "#e57fa0",
  lightBrown: "#a67c52",
  lightRed: "#e0655a",
  red: "#d8453c",
  orange: "#e8912d",
  brown: "#a67c52",
  yellow: "#e5c53b",
  green: "#5fb56a",
  teal: "#4db6ac",
  blue: "#3a9bdc",
  pink: "#e57fa0",
  purple: "#9b7ed9",
  gray: "#8e8e93",
  darkBlue: "#2c6fa8",
  darkGreen: "#3f8f4f",
  darkOrange: "#c47a1f",
  darkGray: "#5a5a5e",
  darkYellow: "#b89a2a",
  darkTeal: "#3a8f86",
  darkPink: "#b85a7d",
  darkBrown: "#7d5a3c",
  darkRed: "#a83a32",
};

/** Map a Graph calendar color to a hex string for the calendars.color column. */
export function mapGraphCalendarColor(color?: string, hexColor?: string): string | null {
  if (hexColor) return hexColor;
  if (!color || color === "auto") return null;
  return GRAPH_NAMED_COLORS[color] ?? null;
}
