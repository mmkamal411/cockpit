/**
 * Nudge producer contract — shared types.
 *
 * A producer is a pure-ish function: (db, pilot, now, submit) => result.
 * It NEVER writes to the `nudges` table directly — it hands candidates to
 * `submit` (the engine pipeline) and reports what happened. A producer that
 * throws is treated as "that category goes quiet this run" by the runner.
 *
 * Golden rule (PRODUCERS.md §1): a failed producer never breaks the engine —
 * and a failing engine never breaks the producer. Per-candidate and
 * per-producer failures are captured in `errors`, never thrown.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { NudgeCandidate, SubmitOutcome } from "../engine";

/** Who the producer is generating nudges for. */
export interface ProducerPilot {
  id: string;
  /** IANA timezone, e.g. "America/New_York". Used for day-boundary math. */
  timezone: string;
}

/**
 * Hands one candidate to the engine (score → gates → dedupe → schedule →
 * insert). In production this is the engine's submitCandidate; in tests a
 * capturing fake. Resolves with the engine's outcome (inserted / deduped /
 * suppressed).
 */
export type SubmitFn = (candidate: NudgeCandidate) => Promise<SubmitOutcome>;

/** Everything a producer needs for one run for one pilot. */
export interface ProducerContext {
  db: SupabaseClient;
  pilot: ProducerPilot;
  now: Date;
  submit: SubmitFn;
}

/** Per-producer, per-pilot outcome for one run. */
export interface ProducerResult {
  /** "meeting-soon" | "bill-due" | … */
  producer: string;
  inserted: number;
  deduped: number;
  suppressed: number;
  /** Rows seen but deliberately not emitted (outside the window, snoozed…). */
  skipped: number;
  /** Plain-English failure notes — captured, never thrown. */
  errors: string[];
}

/** A producer function: scan one data source, emit candidates. */
export type Producer = (ctx: ProducerContext) => Promise<ProducerResult>;

/** Fresh, empty result — producers fill it in as they go. */
export function newResult(producer: string): ProducerResult {
  return { producer, inserted: 0, deduped: 0, suppressed: 0, skipped: 0, errors: [] };
}

/** Tally one engine outcome into the result counters. */
export function tally(result: ProducerResult, outcome: SubmitOutcome): void {
  switch (outcome.action) {
    case "inserted":
      result.inserted += 1;
      break;
    case "deduped":
      result.deduped += 1;
      break;
    default:
      // below_threshold / category_disabled
      result.suppressed += 1;
  }
}

/** Never let a rejection detail leak — always a plain string. */
export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
