/**
 * parseTodo — tiny natural-language date/time parser for quick-add.
 *
 * Input:  "Call the dentist tomorrow at 3pm"
 * Output: { text: "Call the dentist", dueAt: <epoch ms> }
 *
 * Handles "today", "tomorrow", "next Monday" (all weekdays), "in 3 days",
 * "at 3pm" / "at 15:00", "at noon", and combos like "on Friday at noon".
 * Date/time words are stripped from the returned text. Plain regexes only —
 * no dependencies, no timezone database (uses the pilot's local time).
 */

import { nextOccurrence } from "./recurrence.ts";

export interface ParsedTodo {
  text: string;
  dueAt?: number;
  /** True when the pilot typed an explicit time ("at 3pm") — drives the
   *  default reminder policy (30 min before); date-only todos get a
   *  morning reminder instead. */
  hasTime?: boolean;
  priority?: "p1" | "p2" | "p3" | "p4";
  /** "#Project" — matched against list names by the caller. */
  project?: string;
  /** "+name" — matched against known people by the caller. */
  assignee?: string;
  /** "every Monday" — validated by the caller with parseRecurrence. */
  recurrence?: string;
}

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

function atTime(base: Date, hour: number, minute: number): Date {
  const d = new Date(base);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function upcomingWeekday(from: Date, target: number, weeksAhead: number): Date {
  const d = new Date(from);
  const delta = (target - d.getDay() + 7) % 7;
  d.setDate(d.getDate() + delta + weeksAhead * 7);
  return d;
}

export function parseTodo(input: string, now: number = Date.now()): ParsedTodo {
  let text = input.trim();
  let day: Date | null = null;
  let hour: number | null = null;
  let minute = 0;
  let hasTime = false;
  const base = new Date(now);
  const out: ParsedTodo = { text };

  // Remove the match and collapse leftover whitespace.
  const eat = (match: RegExpMatchArray) => {
    text = (text.slice(0, match.index) + text.slice(match.index! + match[0].length))
      .replace(/\s{2,}/g, " ")
      .trim();
  };
  const find = (re: RegExp) => text.match(re);

  // --- Priority: "p1".."p4" (Todoist-style) ---
  let m = find(/\bp([1-4])\b/i);
  if (m) {
    out.priority = `p${m[1]}` as ParsedTodo["priority"];
    eat(m);
  }

  // --- Recurrence: "every Monday", "every 2 weeks", "every day" ---
  m = find(/\bevery\s+(day|daily|weekday|weekdays|weekend|weekends|week|weekly|month|monthly|year|yearly|sunday|monday|tuesday|wednesday|thursday|friday|saturday|\d+\s+(?:days?|weeks?|months?|years?))\b/i);
  if (m) {
    out.recurrence = m[0].toLowerCase().replace(/\s+/g, " ").trim();
    eat(m);
  }

  // --- Project: "#Family" (matched to a list name by the caller) ---
  m = find(/#([\p{L}\p{N}_-]+)/u);
  if (m) {
    out.project = m[1];
    eat(m);
  }

  // --- Assignee: "+Dawson" (matched to a known person by the caller) ---
  m = find(/\+([\p{L}\p{N}_-]+)/u);
  if (m) {
    out.assignee = m[1];
    eat(m);
  }

  // --- Time of day: "at 3pm", "at 3:30pm", "at 15:00", "at noon", "at midnight" ---
  m =
    find(/\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i) ??
    find(/\bat\s+(\d{1,2}):(\d{2})\b/);
  if (m) {
    let h = Number(m[1]);
    minute = Number(m[2] ?? 0);
    const meridiem = m[3]?.toLowerCase();
    if (meridiem === "pm" && h < 12) h += 12;
    if (meridiem === "am" && h === 12) h = 0;
    if (h >= 0 && h < 24 && minute < 60) {
      hour = h;
      hasTime = true;
      eat(m);
    }
  } else if ((m = find(/\bat\s+noon\b/i))) {
    hour = 12;
    hasTime = true;
    eat(m);
  } else if ((m = find(/\bat\s+midnight\b/i))) {
    hour = 0;
    hasTime = true;
    eat(m);
  }

  // --- Relative days: "tomorrow", "today", "in 3 days", "in 2 weeks" ---
  if ((m = find(/\btomorrow\b/i))) {
    day = new Date(base);
    day.setDate(day.getDate() + 1);
    eat(m);
  } else if ((m = find(/\btoday\b/i))) {
    day = new Date(base);
    eat(m);
  } else if ((m = find(/\bin\s+(\d+)\s+days?\b/i))) {
    day = new Date(base);
    day.setDate(day.getDate() + Number(m[1]));
    eat(m);
  } else if ((m = find(/\bin\s+(\d+)\s+weeks?\b/i))) {
    day = new Date(base);
    day.setDate(day.getDate() + Number(m[1]) * 7);
    eat(m);
  } else if ((m = find(/\bnext\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i))) {
    day = upcomingWeekday(base, WEEKDAYS.indexOf(m[1].toLowerCase()), 1);
    eat(m);
  } else if ((m = find(/\b(?:on\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i))) {
    day = upcomingWeekday(base, WEEKDAYS.indexOf(m[1].toLowerCase()), 0);
    eat(m);
  }

  // A recurring todo also seeds its first due date from the rule
  // ("water the plants every Monday" is due next Monday). An explicit time
  // ("every Friday at 6pm") lands on that occurrence's date.
  if (out.recurrence && day === null) {
    const first = nextOccurrence(out.recurrence, now);
    if (first !== null) {
      const d = new Date(first);
      d.setHours(hour ?? 9, hour === null ? 0 : minute, 0, 0);
      day = d;
    }
  }

  if (day === null && hour === null) {
    out.text = text;
    return out;
  }

  // A bare time ("at 3pm") means today — or tomorrow if it already passed.
  const due = day ?? new Date(base);
  if (hour !== null) {
    const withTime = atTime(due, hour, minute);
    day = withTime.getTime() <= now && day === null ? atTime(new Date(base.getTime() + 86_400_000), hour, minute) : withTime;
  } else {
    day = atTime(due, 9, 0); // Date without a time defaults to 9am.
  }
  out.text = text;
  out.dueAt = day.getTime();
  out.hasTime = hasTime;
  return out;
}
