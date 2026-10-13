/**
 * Nudge producer runner — the scheduled half of the pipeline.
 *
 * runProducers(db) is the single entry point a scheduler calls: it finds
 * every pilot (or one pilot), loads their nudge preferences + timezone, and
 * runs each registered producer. Every producer — and every pilot — runs
 * inside its own try/catch: one category's failure (or one pilot's bad row)
 * never stops the others. That is PRODUCERS.md §1's golden rule, enforced
 * here rather than trusted to each producer.
 *
 * Wired to HTTP at POST /api/nudges/producers/run (service-key auth), which
 * a scheduler (cron, Cloudflare scheduled worker, etc.) hits on a cadence.
 * The producers are dedupe-safe, so a 15-minute cadence is cheap: the vast
 * majority of runs emit nothing and return "deduped"/empty.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { getPreferences, submitCandidate, type NudgeCandidate, type SubmitOutcome } from "../engine";
import { meetingSoonProducer } from "./meeting-soon";
import { billDueProducer } from "./bill-due";
import { errMsg, type Producer, type ProducerResult, type ProducerPilot, type SubmitFn } from "./types";

/** Every producer that runs each cycle, in order. Add future producers here. */
export const PRODUCERS: ReadonlyArray<{ name: string; run: Producer }> = [
  { name: "meeting-soon", run: meetingSoonProducer },
  { name: "bill-due", run: billDueProducer },
];

export interface RunProducersOptions {
  /** Run for one pilot only. Omit to run for every pilot. */
  pilotId?: string;
  /** Override "now" (tests). */
  now?: Date;
  /**
   * Override how candidates reach the engine (tests). Defaults to the real
   * engine pipeline: score → gates → dedupe → quiet-hours → insert.
   */
  submitFactory?: (prefs: { min_score: number }, timezone: string, now: Date) => SubmitFn;
}

export interface PilotRunSummary {
  pilot_id: string;
  producers: ProducerResult[];
  /** Per-pilot failures (e.g. preferences unreadable) — captured, not thrown. */
  errors: string[];
}

export interface RunProducersSummary {
  ran_at: string;
  pilots_run: number;
  pilots: PilotRunSummary[];
}

async function loadPilots(db: SupabaseClient, pilotId?: string): Promise<ProducerPilot[]> {
  const query = db.from("pilots").select("id,timezone");
  const { data, error } = pilotId ? await query.eq("id", pilotId) : await query;
  if (error) throw new Error(`Couldn't list pilots: ${error.message}`);
  return ((data ?? []) as Array<{ id: string; timezone: string | null }>).map((p) => ({
    id: p.id,
    timezone: p.timezone ?? "UTC",
  }));
}

export async function runProducersFor(
  db: SupabaseClient,
  opts: RunProducersOptions,
  producers: ReadonlyArray<{ name: string; run: Producer }>,
): Promise<RunProducersSummary> {
  const now = opts.now ?? new Date();
  const pilots = await loadPilots(db, opts.pilotId);
  const summary: RunProducersSummary = { ran_at: now.toISOString(), pilots_run: pilots.length, pilots: [] };

  for (const pilot of pilots) {
    const pilotSummary: PilotRunSummary = { pilot_id: pilot.id, producers: [], errors: [] };
    try {
      const prefs = await getPreferences(db, pilot.id);
      const timezone = pilot.timezone || "UTC";
      const submit: SubmitFn =
        opts.submitFactory?.(prefs, timezone, now) ??
        ((candidate: NudgeCandidate): Promise<SubmitOutcome> =>
          submitCandidate(db, candidate, { prefs, timezone, now }));

      for (const { name, run } of producers) {
        try {
          pilotSummary.producers.push(await run({ db, pilot, now, submit }));
        } catch (e) {
          // A crashed producer goes quiet this run; the next one still runs.
          pilotSummary.producers.push({
            producer: name,
            inserted: 0,
            deduped: 0,
            suppressed: 0,
            skipped: 0,
            errors: [`Producer crashed and was skipped this run. (${errMsg(e)})`],
          });
        }
      }
    } catch (e) {
      pilotSummary.errors.push(`Couldn't run producers for this pilot — trying again next run. (${errMsg(e)})`);
    }
    summary.pilots.push(pilotSummary);
  }
  return summary;
}

export async function runProducers(db: SupabaseClient, opts: RunProducersOptions = {}): Promise<RunProducersSummary> {
  return runProducersFor(db, opts, PRODUCERS);
}
