/**
 * Unit tests for the nudge producers (src/lib/nudges/producers/).
 *
 * No test runner in this repo — run directly with Node's type stripping:
 *   node src/lib/nudges/producers/producers.test.ts
 * Exit code is non-zero on any failure.
 *
 * The mock Supabase client below is an approximation of PostgREST filtering
 * (eq/neq/gte/lte/is/order on dotted paths, ISO strings comparing
 * lexicographically). It is NOT a PostgREST emulator — it exists so the
 * producer logic (windows, skips, titles, dedup keys) is tested, not the DB.
 */
// @ts-expect-error TS5097: explicit .ts extension required for Node's
// type-stripping test runner (node src/lib/nudges/producers/producers.test.ts).
import { meetingSoonProducer, meetingWhenWords } from "./meeting-soon.ts";
// @ts-expect-error TS5097: explicit .ts extension required for Node's
// type-stripping test runner (node src/lib/nudges/producers/producers.test.ts).
import { billDueProducer, billDueWords, formatAmount, daysUntilDue } from "./bill-due.ts";
// @ts-expect-error TS5097: explicit .ts extension required for Node's
// type-stripping test runner (node src/lib/nudges/producers/producers.test.ts).
import { runProducersFor, PRODUCERS } from "./index.ts";

let failures = 0;
let passes = 0;

function eq(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    failures += 1;
    console.error(`FAIL ${label}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`);
  } else {
    passes += 1;
  }
}

function ok(cond: boolean, label: string): void {
  eq(cond, true, label);
}

/* ------------------------------------------------------------------ */
/* Mock Supabase client                                                */
/* ------------------------------------------------------------------ */

function getPath(row: Record<string, unknown>, col: string): unknown {
  return col.split(".").reduce<unknown>((acc, k) => {
    if (acc === null || acc === undefined || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[k];
  }, row);
}

interface MockOpts {
  /** Tables whose reads fail with { error } — tests producer error paths. */
  failTables?: string[];
}

function makeDb(tables: Record<string, Record<string, unknown>[]>, opts: MockOpts = {}): unknown {
  const fail = new Set(opts.failTables ?? []);
  function from(table: string) {
    const filters: Array<(r: Record<string, unknown>) => boolean> = [];
    let ordering: { col: string; asc: boolean } | null = null;
    const apply = (): Record<string, unknown>[] => {
      let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      if (ordering) {
        const { col, asc } = ordering;
        rows = [...rows].sort((a, b) => {
          const av = getPath(a, col);
          const bv = getPath(b, col);
          if (av === bv) return 0;
          return (av! < bv! ? -1 : 1) * (asc ? 1 : -1);
        });
      }
      return rows;
    };
    const self: Record<string, unknown> = {
      select() {
        return self;
      },
      eq(col: string, val: unknown) {
        filters.push((r) => getPath(r, col) === val);
        return self;
      },
      neq(col: string, val: unknown) {
        filters.push((r) => getPath(r, col) !== val);
        return self;
      },
      gte(col: string, val: unknown) {
        filters.push((r) => {
          const v = getPath(r, col);
          return v !== undefined && v !== null && v >= (val as never);
        });
        return self;
      },
      lte(col: string, val: unknown) {
        filters.push((r) => {
          const v = getPath(r, col);
          return v !== undefined && v !== null && v <= (val as never);
        });
        return self;
      },
      is(col: string, val: unknown) {
        filters.push((r) => getPath(r, col) === val);
        return self;
      },
      order(col: string, o?: { ascending?: boolean }) {
        ordering = { col, asc: o?.ascending !== false };
        return self;
      },
      maybeSingle() {
        if (fail.has(table)) return Promise.resolve({ data: null, error: { message: "boom" } });
        const rows = apply();
        return Promise.resolve({ data: rows[0] ?? null, error: null });
      },
      then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
        if (fail.has(table)) return Promise.resolve({ data: null, error: { message: "boom" } }).then(resolve, reject);
        try {
          return Promise.resolve({ data: apply(), error: null }).then(resolve, reject);
        } catch (e) {
          return Promise.reject(e).catch(reject);
        }
      },
    };
    return self;
  }
  return { from };
}

/** Capturing submit fake — records candidates, returns canned outcomes. */
function captureSubmit(outcome: { action: "inserted" } | { action: "deduped" } | { action: "suppressed" } = { action: "inserted" }) {
  const seen: Record<string, unknown>[] = [];
  const submit = async (candidate: Record<string, unknown>) => {
    seen.push(candidate);
    if (outcome.action === "inserted") return { action: "inserted", nudge: { id: "n1" }, score: 96, scheduledFor: candidate.scheduled_for };
    if (outcome.action === "deduped") return { action: "deduped", score: 96 };
    return { action: "below_threshold", score: 5 };
  };
  return { seen, submit };
}

const NOW = new Date("2026-10-13T12:00:00.000Z");
const PILOT = { id: "pilot-1", timezone: "America/New_York" };

function meetingRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "row-1",
    provider_event_id: "evt-1",
    title: "Team standup",
    starts_at: "2026-10-13T12:15:00.000Z",
    ends_at: "2026-10-13T12:30:00.000Z",
    all_day: false,
    location: "Room 4B",
    status: "confirmed",
    calendars: { name: "Work", visible: true, calendar_connections: { pilot_id: "pilot-1" } },
    ...over,
  };
}

function billRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "b1",
    pilot_id: "pilot-1",
    name: "Electric",
    payee: "Georgia Power",
    amount: 142,
    due_date: "2026-10-13",
    status: "upcoming",
    snoozed_until: null,
    paid_at: null,
    deleted_at: null,
    ...over,
  };
}

/* ------------------------------------------------------------------ */
/* meeting-soon                                                        */
/* ------------------------------------------------------------------ */

{
  const { seen, submit } = captureSubmit();
  const db = makeDb({ calendar_events: [meetingRow()] });
  const res = await meetingSoonProducer({ db: db as never, pilot: PILOT, now: NOW, submit: submit as never });
  eq(res.inserted, 1, "meeting: emits one candidate for an event 15 min out");
  eq(seen.length, 1, "meeting: submit called once");
  const c = seen[0] as Record<string, unknown>;
  eq(c.category, "meeting", "meeting: category");
  eq(c.source, "calendar", "meeting: source");
  eq(c.title, "Team standup — starts in 15 minutes", "meeting: title wording");
  eq(c.dedup_key, "meeting:evt-1", "meeting: stable dedup key");
  eq(c.deadline, "2026-10-13T12:15:00.000Z", "meeting: honest deadline = start time");
  ok(typeof c.scheduled_for === "string", "meeting: scheduled_for set");
  ok(String(c.body).includes("Room 4B"), "meeting: body carries the location");
}

{
  // Window edges: 61 min out is skipped; 5-min grace covers just-started.
  const rows = [
    meetingRow({ provider_event_id: "too-far", starts_at: "2026-10-13T13:01:00.000Z" }),
    meetingRow({ provider_event_id: "just-started", starts_at: "2026-10-13T11:56:00.000Z", title: "1:1" }),
    meetingRow({ provider_event_id: "long-ago", starts_at: "2026-10-13T11:49:00.000Z" }),
  ];
  const { seen, submit } = captureSubmit();
  const db = makeDb({ calendar_events: rows });
  const res = await meetingSoonProducer({ db: db as never, pilot: PILOT, now: NOW, submit: submit as never });
  eq(res.inserted, 1, "meeting: only the just-started event is emitted");
  eq((seen[0] as Record<string, unknown>).dedup_key, "meeting:just-started", "meeting: right event kept");
  eq((seen[0] as Record<string, unknown>).title, "1:1 — starting now", "meeting: 'starting now' wording");
}

{
  // Cancelled and all-day events never nudge.
  const rows = [
    meetingRow({ provider_event_id: "cancelled", status: "cancelled" }),
    meetingRow({ provider_event_id: "allday", all_day: true }),
  ];
  const { submit } = captureSubmit();
  const db = makeDb({ calendar_events: rows });
  const res = await meetingSoonProducer({ db: db as never, pilot: PILOT, now: NOW, submit: submit as never });
  eq(res.inserted, 0, "meeting: cancelled + all-day events are skipped");
}

{
  // Other pilots' events and hidden calendars are excluded.
  const rows = [
    meetingRow({
      provider_event_id: "other-pilot",
      calendars: { name: "Work", visible: true, calendar_connections: { pilot_id: "pilot-2" } },
    }),
    meetingRow({
      provider_event_id: "hidden-cal",
      calendars: { name: "Hidden", visible: false, calendar_connections: { pilot_id: "pilot-1" } },
    }),
  ];
  const { submit } = captureSubmit();
  const db = makeDb({ calendar_events: rows });
  const res = await meetingSoonProducer({ db: db as never, pilot: PILOT, now: NOW, submit: submit as never });
  eq(res.inserted, 0, "meeting: other pilot + hidden calendar excluded");
}

{
  // A failing submit is captured, never thrown (golden rule).
  const failing = async () => {
    throw new Error("engine exploded");
  };
  const db = makeDb({ calendar_events: [meetingRow()] });
  const res = await meetingSoonProducer({ db: db as never, pilot: PILOT, now: NOW, submit: failing as never });
  eq(res.inserted, 0, "meeting: failed submit inserts nothing");
  eq(res.errors.length, 1, "meeting: failure captured in errors");
}

{
  // A failing calendar read goes quiet, doesn't throw.
  const { submit } = captureSubmit();
  const db = makeDb({}, { failTables: ["calendar_events"] });
  const res = await meetingSoonProducer({ db: db as never, pilot: PILOT, now: NOW, submit: submit as never });
  eq(res.inserted, 0, "meeting: read failure inserts nothing");
  eq(res.errors.length, 1, "meeting: read failure captured");
}

{
  // Deduped outcomes are tallied, not treated as errors.
  const { submit } = captureSubmit({ action: "deduped" });
  const db = makeDb({ calendar_events: [meetingRow()] });
  const res = await meetingSoonProducer({ db: db as never, pilot: PILOT, now: NOW, submit: submit as never });
  eq(res.deduped, 1, "meeting: deduped outcome tallied");
  eq(res.errors.length, 0, "meeting: dedupe is not an error");
}

eq(meetingWhenWords(new Date("2026-10-13T12:00:30.000Z"), NOW), "starting now", "when: sub-minute → starting now");
eq(meetingWhenWords(new Date("2026-10-13T12:45:00.000Z"), NOW), "starts in 45 minutes", "when: 45 min wording");
eq(meetingWhenWords(new Date("2026-10-13T12:01:00.000Z"), NOW), "starting now", "when: 1 min → starting now");

/* ------------------------------------------------------------------ */
/* bill-due                                                            */
/* ------------------------------------------------------------------ */

{
  const { seen, submit } = captureSubmit();
  const db = makeDb({ bills: [billRow()] });
  const res = await billDueProducer({ db: db as never, pilot: PILOT, now: NOW, submit: submit as never });
  eq(res.inserted, 1, "bill: emits for a bill due today");
  const c = seen[0] as Record<string, unknown>;
  eq(c.category, "bill", "bill: category");
  eq(c.source, "bills", "bill: source");
  eq(c.title, "Electric $142 due today", "bill: title wording");
  eq(c.dedup_key, "bill:b1:2026-10-13", "bill: stable dedup key");
  eq(c.deadline, "2026-10-13T23:59:59Z", "bill: deadline = end of due day");
  ok(String(c.body).includes("Georgia Power"), "bill: body names the payee");
}

{
  // Overdue / tomorrow / in-3-days wording; beyond the lookahead is skipped.
  const rows = [
    billRow({ id: "b-over", due_date: "2026-10-11", name: "Water" }),
    billRow({ id: "b-tom", due_date: "2026-10-14", name: "Internet" }),
    billRow({ id: "b-3d", due_date: "2026-10-16", name: "Rent" }),
    billRow({ id: "b-far", due_date: "2026-10-17", name: "Gym" }),
  ];
  const { seen, submit } = captureSubmit();
  const db = makeDb({ bills: rows });
  const res = await billDueProducer({ db: db as never, pilot: PILOT, now: NOW, submit: submit as never });
  eq(res.inserted, 3, "bill: 3 emitted, far-future skipped");
  const titles = (seen as Array<Record<string, unknown>>).map((c) => c.title);
  ok(titles.some((t) => String(t).includes("overdue by 2 days")), "bill: overdue wording");
  ok(titles.some((t) => String(t).includes("due tomorrow")), "bill: tomorrow wording");
  ok(titles.some((t) => String(t).includes("due in 3 days")), "bill: 3-day wording");
  const overdue = seen.find((c) => (c as Record<string, unknown>).dedup_key === "bill:b-over:2026-10-11") as Record<string, unknown>;
  ok(new Date(overdue.deadline as string).getTime() < NOW.getTime(), "bill: overdue deadline is in the past (1.5× urgency)");
}

{
  // Paid, snoozed, and dateless bills are skipped — never nudged.
  const rows = [
    billRow({ id: "b-paid", status: "paid", paid_at: "2026-10-12T10:00:00Z" }),
    billRow({ id: "b-paid2", paid_at: "2026-10-12T10:00:00Z" }),
    billRow({ id: "b-snoozed", snoozed_until: "2026-10-14T12:00:00Z" }),
    billRow({ id: "b-nodate", due_date: null }),
    billRow({ id: "b-snooze-past", snoozed_until: "2026-10-13T11:00:00Z" }),
  ];
  const { submit } = captureSubmit();
  const db = makeDb({ bills: rows });
  const res = await billDueProducer({ db: db as never, pilot: PILOT, now: NOW, submit: submit as never });
  eq(res.inserted, 1, "bill: only the past-snooze bill is emitted");
  // Paid rows, the dateless row, and the paid_at row are filtered by the DB
  // query itself; only the future-snoozed row reaches the in-code skip.
  eq(res.skipped, 1, "bill: future-snoozed bill skipped");
}

{
  const { submit } = captureSubmit();
  const db = makeDb({}, { failTables: ["bills"] });
  const res = await billDueProducer({ db: db as never, pilot: PILOT, now: NOW, submit: submit as never });
  eq(res.inserted, 0, "bill: read failure inserts nothing");
  eq(res.errors.length, 1, "bill: read failure captured");
}

eq(billDueWords(-1), "overdue by 1 day", "words: singular overdue");
eq(billDueWords(0), "due today", "words: today");
eq(formatAmount(142), "$142", "amount: whole dollars");
eq(formatAmount("142.50"), "$142.50", "amount: cents kept");
eq(formatAmount(null), null, "amount: null → null");
eq(formatAmount("junk"), null, "amount: junk → null");
// Timezone-aware day math: 02:00 UTC is still Oct 12 in New York.
eq(daysUntilDue("2026-10-12", new Date("2026-10-13T02:00:00.000Z"), "America/New_York"), 0, "days: pilot-local day boundary");

/* ------------------------------------------------------------------ */
/* runner                                                              */
/* ------------------------------------------------------------------ */

{
  eq(PRODUCERS.length, 2, "runner: two producers registered");
  eq(PRODUCERS[0].name, "meeting-soon", "runner: meeting-soon first");
  eq(PRODUCERS[1].name, "bill-due", "runner: bill-due second");
}

{
  // All pilots, both producers, via a capturing submit factory.
  const submitted: string[] = [];
  const db = makeDb({
    pilots: [
      { id: "pilot-1", timezone: "America/New_York" },
      { id: "pilot-2", timezone: "UTC" },
    ],
    nudge_preferences: [],
    calendar_events: [
      { ...meetingRow(), calendars: { name: "Work", visible: true, calendar_connections: { pilot_id: "pilot-1" } } },
    ],
    bills: [{ ...billRow(), pilot_id: "pilot-2" }],
  });
  const summary = await runProducersFor(
    db as never,
    {
      now: NOW,
      submitFactory: () => async (c: never) => {
        submitted.push((c as unknown as Record<string, string>).dedup_key);
        return { action: "inserted", nudge: {}, score: 90, scheduledFor: NOW.toISOString() };
      },
    },
    PRODUCERS,
  );
  eq(summary.pilots_run, 2, "runner: runs for every pilot");
  eq(summary.pilots.length, 2, "runner: summary per pilot");
  ok(summary.pilots.every((p) => p.producers.length === 2), "runner: both producers ran per pilot");
  ok(submitted.includes("meeting:evt-1"), "runner: meeting candidate emitted");
  ok(submitted.includes("bill:b1:2026-10-13"), "runner: bill candidate emitted");
}

{
  // pilotId scoping.
  const db = makeDb({
    pilots: [{ id: "pilot-1", timezone: "UTC" }, { id: "pilot-2", timezone: "UTC" }],
    nudge_preferences: [],
    calendar_events: [],
    bills: [],
  });
  const summary = await runProducersFor(
    db as never,
    {
      now: NOW,
      pilotId: "pilot-2",
      submitFactory: () => async () => ({ action: "inserted", nudge: {}, score: 1, scheduledFor: "" }),
    },
    PRODUCERS,
  );
  eq(summary.pilots_run, 1, "runner: pilotId scopes to one pilot");
  eq(summary.pilots[0].pilot_id, "pilot-2", "runner: the right pilot ran");
}

{
  // A crashing producer is captured; the other still runs.
  const crashing = async () => {
    throw new Error("producer bug");
  };
  const db = makeDb({ pilots: [{ id: "pilot-1", timezone: "UTC" }], nudge_preferences: [] });
  const summary = await runProducersFor(
    db as never,
    {
      now: NOW,
      submitFactory: () => async () => ({ action: "inserted", nudge: {}, score: 1, scheduledFor: "" }),
    },
    [
      { name: "crashes", run: crashing as never },
      { name: "fine", run: (async () => ({ producer: "fine", inserted: 0, deduped: 0, suppressed: 0, skipped: 0, errors: [] })) as never },
    ],
  );
  eq(summary.pilots[0].producers.length, 2, "runner: both producers attempted despite crash");
  eq(summary.pilots[0].producers[0].errors.length, 1, "runner: crash captured in errors");
}

{
  // A failing submitFactory is a per-pilot error, never a thrown run.
  const db = makeDb({ pilots: [{ id: "pilot-1", timezone: "UTC" }] });
  const summary = await runProducersFor(
    db as never,
    {
      now: NOW,
      submitFactory: () => {
        throw new Error("prefs exploded");
      },
    },
    PRODUCERS,
  );
  eq(summary.pilots[0].errors.length, 1, "runner: pilot-level failure captured");
}

console.log(`\n${passes} passed, ${failures} failed`);
if (failures > 0) process.exit(1);
