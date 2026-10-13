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

export interface ParsedTodo {
  text: string;
  dueAt?: number;
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
  const base = new Date(now);

  // Remove the match and collapse leftover whitespace.
  const eat = (match: RegExpMatchArray) => {
    text = (text.slice(0, match.index) + text.slice(match.index! + match[0].length))
      .replace(/\s{2,}/g, " ")
      .trim();
  };
  const find = (re: RegExp) => text.match(re);

  // --- Time of day: "at 3pm", "at 3:30pm", "at 15:00", "at noon", "at midnight" ---
  let m =
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
      eat(m);
    }
  } else if ((m = find(/\bat\s+noon\b/i))) {
    hour = 12;
    eat(m);
  } else if ((m = find(/\bat\s+midnight\b/i))) {
    hour = 0;
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

  if (day === null && hour === null) return { text };

  // A bare time ("at 3pm") means today — or tomorrow if it already passed.
  const due = day ?? new Date(base);
  if (hour !== null) {
    const withTime = atTime(due, hour, minute);
    day = withTime.getTime() <= now && day === null ? atTime(new Date(base.getTime() + 86_400_000), hour, minute) : withTime;
  } else {
    day = atTime(due, 9, 0); // Date without a time defaults to 9am.
  }
  return { text, dueAt: day.getTime() };
}
