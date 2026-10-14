/**
 * Calendar — shared server helpers.
 *
 * Reads the Supabase event cache. Google is the source of truth;
 * these helpers never call Google directly (the sync engine does).
 */

import { createClient } from "@/lib/supabase/server";

export interface CalendarEvent {
  id: string;
  calendar_id: string;
  calendar_name: string;
  title: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  location: string | null;
  description: string | null;
  attendees: Array<{ email?: string; name?: string }>;
  status: string;
}

export interface AgendaSection {
  label: string;
  events: CalendarEvent[];
}

export interface Agenda {
  date: string;
  nextUp: CalendarEvent | null;
  sections: AgendaSection[];
  freeWindows: Array<{ from: string; to: string; minutes: number }>;
  summary: string;
}

/** Events in a range, from the cache, visible calendars only. */
export async function getEventsInRange(
  pilotId: string,
  from: string,
  to: string,
): Promise<CalendarEvent[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("calendar_events")
    .select(
      "id, calendar_id, title, starts_at, ends_at, all_day, location, description, attendees, status, calendars!inner(name, visible, calendar_connections!inner(pilot_id))",
    )
    .eq("calendars.calendar_connections.pilot_id", pilotId)
    .eq("calendars.visible", true)
    .neq("status", "cancelled")
    .gte("starts_at", from)
    .lt("starts_at", to)
    .order("starts_at", { ascending: true })
    .limit(500);
  if (error) throw error;
  return (data ?? []).map((r: Record<string, unknown>) => ({
    id: r["id"] as string,
    calendar_id: r["calendar_id"] as string,
    calendar_name: ((r["calendars"] as Record<string, unknown>)?.["name"] as string) ?? "",
    title: r["title"] as string,
    starts_at: r["starts_at"] as string,
    ends_at: r["ends_at"] as string,
    all_day: (r["all_day"] as boolean) ?? false,
    location: (r["location"] as string) ?? null,
    description: (r["description"] as string) ?? null,
    attendees: (r["attendees"] as CalendarEvent["attendees"]) ?? [],
    status: r["status"] as string,
  }));
}

/** "Next event" summary for the glass pane. */
export async function getNextEvent(pilotId: string): Promise<CalendarEvent | null> {
  const now = new Date().toISOString();
  const end = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const events = await getEventsInRange(pilotId, now, end);
  return events.find((e) => !e.all_day) ?? events[0] ?? null;
}

function minutesBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000);
}

/** AI-organized agenda: next up, grouped sections, free windows, plain summary. */
export function buildAgenda(dateISO: string, events: CalendarEvent[]): Agenda {
  const now = Date.now();
  const upcoming = events.filter((e) => new Date(e.ends_at).getTime() > now);
  const nextUp = upcoming[0] ?? null;

  const sections: AgendaSection[] = [];
  const byPart: Record<string, CalendarEvent[]> = { Morning: [], Afternoon: [], Evening: [] };
  for (const e of upcoming) {
    const h = new Date(e.starts_at).getHours();
    const part = h < 12 ? "Morning" : h < 17 ? "Afternoon" : "Evening";
    byPart[part].push(e);
  }
  for (const [label, list] of Object.entries(byPart)) {
    if (list.length > 0) sections.push({ label, events: list });
  }

  const freeWindows: Agenda["freeWindows"] = [];
  const sorted = [...upcoming].sort(
    (a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime(),
  );
  for (let i = 0; i < sorted.length - 1; i++) {
    const gap = minutesBetween(sorted[i].ends_at, sorted[i + 1].starts_at);
    if (gap >= 60) {
      freeWindows.push({ from: sorted[i].ends_at, to: sorted[i + 1].starts_at, minutes: gap });
    }
  }

  let summary: string;
  if (upcoming.length === 0) {
    summary = "Nothing scheduled — the day is yours.";
  } else if (nextUp) {
    const mins = Math.max(0, Math.round((new Date(nextUp.starts_at).getTime() - now) / 60000));
    const when = mins < 60 ? `in ${mins} min` : `at ${new Date(nextUp.starts_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
    summary =
      `${upcoming.length} event${upcoming.length === 1 ? "" : "s"} today. ` +
      `Next up: ${nextUp.title} ${when}.` +
      (freeWindows.length > 0 ? ` Free ${freeWindows[0].minutes} min after.` : "");
  } else {
    summary = `${upcoming.length} events today.`;
  }

  return { date: dateISO, nextUp, sections, freeWindows, summary };
}

/** Whether the pilot has any connected calendar. */
export async function hasConnection(pilotId: string): Promise<boolean> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("calendar_connections")
    .select("id", { count: "exact", head: true })
    .eq("pilot_id", pilotId)
    .eq("status", "active");
  return (count ?? 0) > 0;
}
