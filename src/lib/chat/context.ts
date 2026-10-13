import type { SupabaseClient } from "@supabase/supabase-js";
import { getEventsInRange } from "@/lib/calendar";
import { getWeatherCurrent } from "@/lib/weather";
import { CONTRACT_VERSION, type ChatContextBundle } from "./contract";

export type { ChatContextBundle } from "./contract";

/**
 * Crystal Chat context bundle — assembled server-side, one optional source
 * at a time. Every source degrades silently: if the data isn't there (table
 * missing, integration not connected, fetch failed), it's skipped and chat
 * still works.
 *
 * Privacy: the bundle carries the PILOT's own situational context only.
 * Crew/child signals are NEVER included (locked founder decision 2026-10-13).
 * Field-level caps keep the bundle compact (agenda ≤12, todos ≤12, nudges ≤8);
 * token counting is a Phase 3 item, so no token budget is enforced here.
 */

interface PilotRow {
  display_name: string | null;
  timezone: string | null;
  home_location: string | null;
  home_lat: number | null;
  home_lon: number | null;
  weather_units: "F" | "C" | null;
}

function fmtTime(iso: string, timeZone: string | null): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: timeZone ?? "America/New_York",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function dayBounds(timeZone: string | null): { from: string; to: string } {
  let day = new Date().toISOString().slice(0, 10);
  try {
    day = new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone ?? "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    /* UTC fallback */
  }
  return { from: `${day}T00:00:00Z`, to: `${day}T23:59:59Z` };
}

async function pilotSection(
  supabase: SupabaseClient,
  pilotId: string,
): Promise<{ pilot: ChatContextBundle["pilot"]; row: PilotRow | null }> {
  try {
    const { data, error } = await supabase
      .from("pilots")
      .select("display_name, timezone, home_location, home_lat, home_lon, weather_units")
      .eq("id", pilotId)
      .maybeSingle();
    if (error || !data) return { pilot: { name: null, timezone: null }, row: null };
    const row = data as PilotRow;
    return {
      pilot: { name: row.display_name, timezone: row.timezone },
      row,
    };
  } catch {
    return { pilot: { name: null, timezone: null }, row: null };
  }
}

async function weatherSection(row: PilotRow | null): Promise<string | undefined> {
  if (!row || row.home_lat == null || row.home_lon == null) return undefined;
  try {
    const units = row.weather_units === "C" ? "C" : "F";
    const w = await getWeatherCurrent(row.home_lat, row.home_lon, units);
    const place = row.home_location ? ` in ${row.home_location}` : "";
    return `${Math.round(w.temp)}°${units}, ${w.words}${place} (high ${Math.round(w.high)}°, low ${Math.round(w.low)}°)`;
  } catch {
    return undefined;
  }
}

async function agendaSection(
  pilotId: string,
  timeZone: string | null,
): Promise<string[] | undefined> {
  try {
    const { from, to } = dayBounds(timeZone);
    const events = await getEventsInRange(pilotId, from, to);
    if (events.length === 0) return undefined;
    return events.slice(0, 12).map((e) => {
      const time = e.all_day ? "all day" : `${fmtTime(e.starts_at, timeZone)}`;
      const loc = e.location ? ` @ ${e.location}` : "";
      return `${time} — ${e.title}${loc}`;
    });
  } catch {
    // Calendar migration not run yet, or no calendars connected — skip.
    return undefined;
  }
}

async function todosSection(supabase: SupabaseClient, pilotId: string): Promise<string[] | undefined> {
  try {
    const { data, error } = await supabase
      .from("todos")
      .select("title, due_at")
      .eq("pilot_id", pilotId)
      .eq("done", false)
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(12);
    if (error || !data || data.length === 0) return undefined;
    return (data as { title: string; due_at: string | null }[]).map((t) => {
      const due = t.due_at ? ` (due ${t.due_at.slice(0, 10)})` : "";
      return `${t.title}${due}`;
    });
  } catch {
    return undefined;
  }
}

async function nudgesSection(supabase: SupabaseClient, pilotId: string): Promise<string[] | undefined> {
  try {
    const { data, error } = await supabase
      .from("nudges")
      .select("kind, priority, title, detail")
      .eq("pilot_id", pilotId)
      .is("dismissed_at", null)
      .order("scheduled_for", { ascending: true, nullsFirst: true })
      .limit(8);
    if (error || !data || data.length === 0) return undefined;
    return (data as { kind: string; priority: string; title: string; detail: string | null }[]).map(
      (n) => `${n.kind}/${n.priority}: ${n.title}${n.detail ? ` — ${n.detail.slice(0, 120)}` : ""}`,
    );
  } catch {
    return undefined;
  }
}

/** Assemble the compact context bundle. Never throws — worst case it returns just pilot + now. */
export async function buildContextBundle(
  supabase: SupabaseClient,
  pilotId: string,
): Promise<ChatContextBundle> {
  const { pilot, row } = await pilotSection(supabase, pilotId);
  const [weather, agenda, todos, nudges] = await Promise.all([
    weatherSection(row),
    agendaSection(pilotId, pilot.timezone),
    todosSection(supabase, pilotId),
    nudgesSection(supabase, pilotId),
  ]);

  const bundle: ChatContextBundle = {
    context_version: CONTRACT_VERSION,
    pilot,
    now: new Date().toISOString(),
  };
  if (weather) bundle.weather = weather;
  if (agenda) bundle.agenda = agenda;
  if (todos) bundle.todos = todos;
  if (nudges) bundle.nudges = nudges;
  return bundle;
}
