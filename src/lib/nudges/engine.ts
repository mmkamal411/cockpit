/**
 * Nudge engine core — score → dedupe → schedule → insert.
 *
 * Pure logic lives here (unit-tested in engine.test.ts, runnable with
 * `node src/lib/nudges/engine.test.ts`). The only DB touchpoints are
 * dedupeCheck / expireOld / submitCandidate, which take a minimal
 * Supabase-shaped client so producers and routes can pass either the
 * pilot-scoped client or the service client.
 *
 * Phase 1 bar: scoring (importance × urgency), dedupe by (pilot, dedup_key),
 * quiet-hours-aware scheduling, expiry. Push delivery and learning-to-rank
 * are Phase 2 — deliberately not here.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

/** Nudge categories — must match the nudges_category_check constraint. */
export type NudgeCategory =
  | "meeting"
  | "bill"
  | "weather"
  | "todo"
  | "school"
  | "health"
  | "system";

export type NudgeStatus =
  | "pending"
  | "delivered"
  | "acknowledged"
  | "snoozed"
  | "expired"
  | "muted";

export const NUDGE_CATEGORIES: readonly NudgeCategory[] = [
  "meeting",
  "bill",
  "weather",
  "todo",
  "school",
  "health",
  "system",
];

/**
 * Category base scores = the "importance" half of importance × urgency.
 * Tuned for a pilot's average day: system (safety/critical) highest,
 * health lowest because health nudges are the noisiest by nature.
 */
export const CATEGORY_BASE_SCORES: Record<NudgeCategory, number> = {
  meeting: 80,
  bill: 70,
  weather: 50,
  todo: 40,
  school: 60,
  health: 30,
  system: 90,
};

/** Urgency multipliers from time-to-deadline. */
const URGENCY_MULTIPLIERS = [
  { withinMs: 60 * 60 * 1000, mult: 1.5 }, // < 1h
  { withinMs: 24 * 60 * 60 * 1000, mult: 1.2 }, // < 24h
] as const;

/** Urgency tiers. Only "urgent" may ever break quiet hours (opt-in). */
export type NudgeTier = "normal" | "urgent";

export interface NudgeCandidate {
  pilot_id: string;
  category: NudgeCategory;
  title: string;
  body?: string;
  /** Stable key per underlying event, e.g. "meeting:<event_id>". Required. */
  dedup_key: string;
  /** Producing module: calendar | bills | weather | todos | school | crystal | system. */
  source: string;
  source_ref?: Record<string, unknown>;
  /** When the engine should surface this. Defaults to "as soon as it makes sense". */
  scheduled_for?: string;
  /** ISO timestamp of the underlying deadline — drives the urgency multiplier. */
  deadline?: string;
  tier?: NudgeTier;
}

/** Mirrors public.nudge_preferences (plus pilot_id). */
export interface NudgePreferences {
  pilot_id: string;
  /** Per-category enabled flags. Absent category = enabled. */
  categories: Partial<Record<NudgeCategory, boolean>>;
  min_score: number;
  /** "HH:MM" pilot-local, 24h. */
  quiet_hours_start: string;
  quiet_hours_end: string;
  breakthrough_allowed: boolean;
}

export const DEFAULT_PREFS: Omit<NudgePreferences, "pilot_id"> = {
  categories: {},
  min_score: 0,
  quiet_hours_start: "22:00",
  quiet_hours_end: "07:00",
  breakthrough_allowed: false,
};

/**
 * scoreCandidate — importance × urgency → numeric score.
 *
 * base = category weight; multiplier from time-to-deadline
 * (<1h: 1.5×, <24h: 1.2×, else 1.0×). Past-due counts as <1h
 * (the most urgent state there is). Rounded to 2 decimals.
 */
export function scoreCandidate(candidate: NudgeCandidate, now: Date = new Date()): number {
  const base = CATEGORY_BASE_SCORES[candidate.category] ?? 40;
  let mult = 1.0;
  const deadlineIso = candidate.deadline ?? candidate.scheduled_for;
  if (deadlineIso) {
    const msLeft = new Date(deadlineIso).getTime() - now.getTime();
    if (!Number.isNaN(msLeft)) {
      for (const { withinMs, mult: m } of URGENCY_MULTIPLIERS) {
        if (msLeft < withinMs) {
          mult = m;
          break;
        }
      }
    }
  }
  return Math.round(base * mult * 100) / 100;
}

/** True when the category is enabled in the pilot's preferences (absent = on). */
export function isCategoryEnabled(category: NudgeCategory, prefs: NudgePreferences): boolean {
  return prefs.categories[category] !== false;
}

/** "HH:MM" → minutes since midnight, or null when malformed. */
export function parseHHMM(value: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Local wall-clock parts of `d` in `tz` (IANA). */
function localParts(d: Date, tz: string): { minutes: number; year: number; month: number; day: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  return {
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  };
}

/** IANA offset in ms (local − UTC) at instant `d`. */
function tzOffsetMs(d: Date, tz: string): number {
  const p = localParts(d, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, Math.floor(p.minutes / 60), p.minutes % 60);
  return asUtc - d.getTime();
}

/** UTC instant for a local wall-clock time in `tz` (two-pass DST refinement). */
function utcForLocalWall(
  year: number,
  month: number,
  day: number,
  hh: number,
  mm: number,
  tz: string,
): Date {
  const wall = Date.UTC(year, month - 1, day, hh, mm);
  // Fixed-point: d = wall − offset(d). Two passes is plenty.
  let d = wall - tzOffsetMs(new Date(wall), tz);
  d = wall - tzOffsetMs(new Date(d), tz);
  return new Date(d);
}

function addDays(p: { year: number; month: number; day: number }, n: number) {
  const d = new Date(Date.UTC(p.year, p.month - 1, p.day + n));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/**
 * applyQuietHours — move `desired` out of the pilot's quiet window.
 *
 * - Outside quiet hours → returned unchanged.
 * - Inside quiet hours → pushed to quiet_hours_end (pilot-local). When the
 *   window wraps past midnight (22:00–07:00) and `desired` is in the evening
 *   half, the target is *tomorrow* morning at quiet end.
 * - tier "urgent" + breakthrough_allowed → breaks through unchanged.
 * - Never returns a time in the past: a target that already passed rolls to
 *   the next day's quiet end.
 * - Malformed prefs or start == end (no quiet hours) → unchanged.
 */
export function applyQuietHours(
  desired: Date,
  prefs: NudgePreferences,
  timezone: string,
  tier: NudgeTier = "normal",
  now: Date = new Date(),
): Date {
  const start = parseHHMM(prefs.quiet_hours_start);
  const end = parseHHMM(prefs.quiet_hours_end);
  if (start == null || end == null || start === end) return desired;

  let parts: { minutes: number; year: number; month: number; day: number };
  try {
    parts = localParts(desired, timezone);
  } catch {
    return desired; // unknown timezone — don't silently reschedule
  }

  const inQuiet =
    start < end
      ? parts.minutes >= start && parts.minutes < end
      : parts.minutes >= start || parts.minutes < end;
  if (!inQuiet) return desired;
  if (tier === "urgent" && prefs.breakthrough_allowed) return desired;

  const wraps = start > end;
  let day = { year: parts.year, month: parts.month, day: parts.day };
  if (wraps && parts.minutes >= start) day = addDays(day, 1); // end is tomorrow

  let target = utcForLocalWall(day.year, day.month, day.day, Math.floor(end / 60), end % 60, timezone);
  // Never return a time in the past: roll forward to the next day's quiet end.
  while (target.getTime() <= now.getTime()) {
    day = addDays(day, 1);
    target = utcForLocalWall(day.year, day.month, day.day, Math.floor(end / 60), end % 60, timezone);
  }
  return target;
}

/**
 * dedupeCheck — true when a LIVE nudge already exists for (pilot, dedup_key).
 * Live = status not in (expired, muted). Mirrors uq_nudges_pilot_dedup_live.
 */
export async function dedupeCheck(
  db: SupabaseClient,
  pilot_id: string,
  dedup_key: string,
): Promise<boolean> {
  const { data, error } = await db
    .from("nudges")
    .select("id")
    .eq("pilot_id", pilot_id)
    .eq("dedup_key", dedup_key)
    .not("status", "in", "(expired,muted)")
    .limit(1);
  if (error) throw new Error(`dedupe check failed: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/** Legacy (pre-007) column values kept in sync so old readers stay correct. */
export function legacyColumnsFor(candidate: NudgeCandidate, score: number) {
  const kind =
    candidate.category === "weather"
      ? "health"
      : candidate.category === "school"
        ? "homework"
        : candidate.category;
  const priority = score >= 85 ? "urgent" : score >= 65 ? "high" : score >= 40 ? "normal" : "low";
  return { kind, detail: candidate.body ?? null, priority, dismissed_at: null, delivered_at: null };
}

export type SubmitOutcome =
  | { action: "inserted"; nudge: Record<string, unknown>; score: number; scheduledFor: string }
  | { action: "deduped"; score: number }
  | { action: "below_threshold"; score: number }
  | { action: "category_disabled"; score: number };

/**
 * submitCandidate — the full pipeline: score → category gate → min-score
 * gate → dedupe → quiet-hours schedule → insert.
 *
 * A failed producer must never break the engine: callers wrap this in
 * try/catch and treat a throw as "that category goes quiet this run".
 */
export async function submitCandidate(
  db: SupabaseClient,
  candidate: NudgeCandidate,
  opts: { prefs?: NudgePreferences; timezone?: string; now?: Date } = {},
): Promise<SubmitOutcome> {
  const now = opts.now ?? new Date();
  const prefs: NudgePreferences = opts.prefs ?? { ...DEFAULT_PREFS, pilot_id: candidate.pilot_id };
  const timezone = opts.timezone ?? "UTC";
  const tier: NudgeTier = candidate.tier ?? "normal";

  const score = scoreCandidate(candidate, now);

  if (!isCategoryEnabled(candidate.category, prefs)) {
    return { action: "category_disabled", score };
  }
  if (score < prefs.min_score) {
    return { action: "below_threshold", score };
  }

  const { data: existing, error: dupeError } = await db
    .from("nudges")
    .select("id")
    .eq("pilot_id", candidate.pilot_id)
    .eq("dedup_key", candidate.dedup_key)
    .not("status", "in", "(expired,muted)")
    .limit(1);
  if (dupeError) throw new Error(`dedupe check failed: ${dupeError.message}`);
  if (existing && existing.length > 0) {
    return { action: "deduped", score };
  }

  const desired = candidate.scheduled_for ? new Date(candidate.scheduled_for) : now;
  const scheduledFor = applyQuietHours(desired, prefs, timezone, tier, now);

  const legacy = legacyColumnsFor(candidate, score);
  const { data, error } = await db
    .from("nudges")
    .insert([
      {
        pilot_id: candidate.pilot_id,
        category: candidate.category,
        title: candidate.title,
        body: candidate.body ?? null,
        score,
        dedup_key: candidate.dedup_key,
        source: candidate.source,
        source_ref: candidate.source_ref ?? {},
        status: "pending",
        scheduled_for: scheduledFor.toISOString(),
        ...legacy,
      },
    ])
    .select()
    .single();
  if (error) {
    // 23505 = unique violation on uq_nudges_pilot_dedup_live: a concurrent
    // producer won the race — that's a dedupe, not a failure.
    if (error.code === "23505") return { action: "deduped", score };
    throw new Error(`nudge insert failed: ${error.message}`);
  }
  return { action: "inserted", nudge: data as Record<string, unknown>, score, scheduledFor: scheduledFor.toISOString() };
}

/**
 * expireOld — sweep: past-due nudges → expired; snoozes whose time has
 * passed → back to pending so they resurface.
 */
export async function expireOld(
  db: SupabaseClient,
  now: Date = new Date(),
  pilot_id?: string,
): Promise<{ expired: number; unsnoozed: number }> {
  const iso = now.toISOString();
  let expired = 0;
  let unsnoozed = 0;

  let expQ = db
    .from("nudges")
    .update({ status: "expired" })
    .in("status", ["pending", "delivered", "snoozed"])
    .lt("expires_at", iso)
    .select("id");
  if (pilot_id) expQ = expQ.eq("pilot_id", pilot_id);
  const expRes = (await expQ) as unknown as SweepResult;
  if (expRes.error) throw new Error(`expire sweep failed: ${expRes.error.message}`);
  expired = expRes.data?.length ?? 0;

  let snzQ = db
    .from("nudges")
    .update({ status: "pending", snoozed_until: null })
    .eq("status", "snoozed")
    .lt("snoozed_until", iso)
    .select("id");
  if (pilot_id) snzQ = snzQ.eq("pilot_id", pilot_id);
  const snzRes = (await snzQ) as unknown as SweepResult;
  if (snzRes.error) throw new Error(`unsnooze sweep failed: ${snzRes.error.message}`);
  unsnoozed = snzRes.data?.length ?? 0;

  return { expired, unsnoozed };
}

interface SweepResult {
  data: { id: string }[] | null;
  error: { message: string } | null;
}

/**
 * whyLine — the "why am I seeing this?" transparency line for the UI.
 * Plain language: source + score tier, no jargon.
 */
export function whyLine(nudge: { source?: string | null; score?: number | null; category?: string | null }): string {
  const source = nudge.source && nudge.source !== "system" ? nudge.source : "Cockpit";
  const score = typeof nudge.score === "number" ? nudge.score : 0;
  const tier = score >= 85 ? "urgent" : score >= 65 ? "important" : score >= 40 ? "worth a look" : "low-key";
  return `From ${source} — flagged as ${tier}.`;
}

/** Fetch a pilot's preferences, falling back to defaults (never throws). */
export async function getPreferences(
  db: SupabaseClient,
  pilot_id: string,
): Promise<NudgePreferences> {
  try {
    const { data, error } = await db
      .from("nudge_preferences")
      .select("categories,min_score,quiet_hours_start,quiet_hours_end,breakthrough_allowed")
      .eq("pilot_id", pilot_id)
      .maybeSingle();
    if (error || !data) return { ...DEFAULT_PREFS, pilot_id };
    return {
      pilot_id,
      categories: (data.categories as NudgePreferences["categories"]) ?? {},
      min_score: Number(data.min_score ?? 0),
      quiet_hours_start: String(data.quiet_hours_start ?? "22:00").slice(0, 5),
      quiet_hours_end: String(data.quiet_hours_end ?? "07:00").slice(0, 5),
      breakthrough_allowed: Boolean(data.breakthrough_allowed),
    };
  } catch {
    return { ...DEFAULT_PREFS, pilot_id };
  }
}
