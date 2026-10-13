/**
 * meeting-soon producer — "your meeting starts in 15 minutes".
 *
 * Reads the pilot's cached calendar events (visible calendars only,
 * cancelled events and all-day events excluded) and emits one candidate
 * per meeting starting within the next hour. Stable dedup key
 * `meeting:<provider_event_id>` means a re-run never double-reminds —
 * the engine dedupes against the live nudge.
 *
 * Contract (PRODUCERS.md): category "meeting", source "calendar", honest
 * deadline (the meeting start), tier normal — the engine turns a start
 * < 1h away into the 1.5× urgency multiplier. Never assume the pilot has
 * a calendar connected: no events → no candidates, silently.
 */
import type { NudgeCandidate } from "../engine";
import { newResult, tally, errMsg, type Producer, type ProducerResult } from "./types";

/** Remind for meetings starting within this window. */
export const MEETING_WINDOW_MINUTES = 60;
/** Grace: a meeting that started up to this long ago still gets a nudge. */
const ALREADY_STARTED_GRACE_MINUTES = 5;

interface MeetingRow {
  id: string;
  provider_event_id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  location: string | null;
  status: string;
  calendars: { name: string | null } | null;
}

/** Plain-English "when" for the title. */
export function meetingWhenWords(startsAt: Date, now: Date): string {
  const minutes = Math.round((startsAt.getTime() - now.getTime()) / 60000);
  if (minutes <= 1) return "starting now";
  if (minutes < 60) return `starts in ${minutes} minute${minutes === 1 ? "" : "s"}`;
  return "starting within the hour";
}

function buildCandidate(row: MeetingRow, calendarName: string | null, now: Date, pilotId: string): NudgeCandidate {
  const startsAt = new Date(row.starts_at);
  const title = `${row.title || "(no title)"} — ${meetingWhenWords(startsAt, now)}`.slice(0, 300);
  const where = [row.location?.trim(), calendarName?.trim()].filter(Boolean).join(" · ");
  return {
    pilot_id: pilotId,
    category: "meeting",
    title,
    body: where || undefined,
    dedup_key: `meeting:${row.provider_event_id}`,
    source: "calendar",
    source_ref: { calendar_event_id: row.id, provider_event_id: row.provider_event_id },
    scheduled_for: now.toISOString(),
    deadline: startsAt.toISOString(),
  };
}

export const meetingSoonProducer: Producer = async (ctx): Promise<ProducerResult> => {
  const result = newResult("meeting-soon");
  const { db, pilot, now, submit } = ctx;
  const windowStart = new Date(now.getTime() - ALREADY_STARTED_GRACE_MINUTES * 60000).toISOString();
  const windowEnd = new Date(now.getTime() + MEETING_WINDOW_MINUTES * 60000).toISOString();

  let rows: MeetingRow[];
  try {
    const { data, error } = await db
      .from("calendar_events")
      .select(
        "id,provider_event_id,title,starts_at,ends_at,all_day,location,status," +
          "calendars!inner(name,visible,calendar_connections!inner(pilot_id))",
      )
      .eq("calendars.calendar_connections.pilot_id", pilot.id)
      .eq("calendars.visible", true)
      .eq("all_day", false)
      .neq("status", "cancelled")
      .gte("starts_at", windowStart)
      .lte("starts_at", windowEnd)
      .order("starts_at", { ascending: true });
    if (error) {
      result.errors.push(`Couldn't read your calendar this run — trying again next time. (${error.message})`);
      return result;
    }
    rows = (data ?? []) as unknown as MeetingRow[];
  } catch (e) {
    result.errors.push(`Couldn't read your calendar this run — trying again next time. (${errMsg(e)})`);
    return result;
  }

  for (const row of rows) {
    try {
      const outcome = await submit(buildCandidate(row, row.calendars?.name ?? null, now, pilot.id));
      tally(result, outcome);
    } catch (e) {
      result.errors.push(`Couldn't create the reminder for "${row.title}" — skipping it this run. (${errMsg(e)})`);
    }
  }
  return result;
};
