/**
 * recurrence — Todoist-style `every X` recurrence with forward-roll semantics.
 *
 * Supported grammar (all lowercase, trimmed):
 *   "every day" | "every weekday" | "every weekend"
 *   "every <weekday>"            e.g. "every monday"
 *   "every <n> days|weeks|months|years"
 *
 * nextOccurrence(rule, fromMs): the first occurrence strictly after `fromMs`.
 * Forward-roll: a missed schedule never lands in the past — if the computed
 * date is not in the future it keeps stepping until it is. Time-of-day is
 * preserved from `fromMs`; date-only inputs (midnight) keep midnight.
 *
 * Invalid rules return null so callers can fall back to plain English.
 */

const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

export type WeekdayName = (typeof WEEKDAYS)[number];

export interface RecurrenceRule {
  kind: "daily" | "weekdays" | "weekends" | "weekly" | "interval";
  /** For "weekly": 0-6 (Sunday=0). For "interval": the step count. */
  value: number;
  /** For "interval": the unit. */
  unit?: "day" | "week" | "month" | "year";
}

export function parseRecurrence(raw: string): RecurrenceRule | null {
  const rule = raw.trim().toLowerCase().replace(/\s+/g, " ");
  if (!rule.startsWith("every ")) return null;
  const rest = rule.slice("every ".length).trim();

  if (rest === "day" || rest === "daily") return { kind: "daily", value: 1 };
  if (rest === "weekday" || rest === "weekdays") return { kind: "weekdays", value: 1 };
  if (rest === "weekend" || rest === "weekends") return { kind: "weekends", value: 1 };

  const weekdayIdx = (WEEKDAYS as readonly string[]).indexOf(rest);
  if (weekdayIdx >= 0) return { kind: "weekly", value: weekdayIdx };

  // Bare units: "every month", "every week", "every year" (= 1 unit).
  if (rest === "month" || rest === "monthly") return { kind: "interval", value: 1, unit: "month" };
  if (rest === "week" || rest === "weekly") return { kind: "interval", value: 1, unit: "week" };
  if (rest === "year" || rest === "yearly" || rest === "annually") {
    return { kind: "interval", value: 1, unit: "year" };
  }

  const m = rest.match(/^(\d+)\s+(days?|weeks?|months?|years?)$/);
  if (m) {
    const n = Number(m[1]);
    if (!Number.isFinite(n) || n < 1 || n > 3650) return null;
    const unitWord = m[2];
    const unit =
      unitWord.startsWith("day") ? "day"
      : unitWord.startsWith("week") ? "week"
      : unitWord.startsWith("month") ? "month"
      : "year";
    return { kind: "interval", value: n, unit };
  }
  return null;
}

function addMonths(d: Date, n: number): Date {
  const out = new Date(d);
  const day = out.getDate();
  out.setMonth(out.getMonth() + n);
  // Clamp: Jan 31 + 1 month -> Feb 28/29, not March.
  if (out.getDate() < day) out.setDate(0);
  return out;
}

function step(rule: RecurrenceRule, d: Date): Date {
  const out = new Date(d);
  switch (rule.kind) {
    case "daily":
      out.setDate(out.getDate() + 1);
      return out;
    case "weekdays":
      do {
        out.setDate(out.getDate() + 1);
      } while (out.getDay() === 0 || out.getDay() === 6);
      return out;
    case "weekends":
      do {
        out.setDate(out.getDate() + 1);
      } while (out.getDay() !== 0 && out.getDay() !== 6);
      return out;
    case "weekly": {
      const delta = ((rule.value - out.getDay() + 7) % 7) || 7;
      out.setDate(out.getDate() + delta);
      return out;
    }
    case "interval":
      if (rule.unit === "day") out.setDate(out.getDate() + rule.value);
      else if (rule.unit === "week") out.setDate(out.getDate() + rule.value * 7);
      else if (rule.unit === "month") return addMonths(out, rule.value);
      else out.setFullYear(out.getFullYear() + rule.value);
      return out;
  }
}

/**
 * The next occurrence after `fromMs`, rolled forward past `nowMs` (defaults
 * to now). Forward-rolls past missed dates (bounded: a sane rule resolves in
 * a handful of steps; pathological inputs bail out rather than looping
 * forever).
 */
export function nextOccurrence(
  ruleText: string,
  fromMs: number,
  nowMs: number = Date.now(),
): number | null {
  const rule = parseRecurrence(ruleText);
  if (rule === null) return null;
  let d = new Date(fromMs);
  for (let i = 0; i < 4000; i++) {
    d = step(rule, d);
    if (d.getTime() > fromMs && d.getTime() > nowMs) return d.getTime();
  }
  return null;
}

/** "every Monday", "every 2 weeks" — plain-English label for the UI. */
export function describeRecurrence(ruleText: string): string | null {
  const rule = parseRecurrence(ruleText);
  if (rule === null) return null;
  switch (rule.kind) {
    case "daily":
      return "Every day";
    case "weekdays":
      return "Every weekday";
    case "weekends":
      return "Every weekend";
    case "weekly":
      return `Every ${WEEKDAYS[rule.value][0].toUpperCase()}${WEEKDAYS[rule.value].slice(1)}`;
    case "interval": {
      const n = rule.value;
      const unit = rule.unit === "day" ? "day" : rule.unit === "week" ? "week" : rule.unit === "month" ? "month" : "year";
      return n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`;
    }
  }
}
