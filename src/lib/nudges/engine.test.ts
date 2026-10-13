/**
 * Unit tests for the nudge engine (src/lib/nudges/engine.ts).
 *
 * No test runner in this repo — run directly with Node's type stripping:
 *   node src/lib/nudges/engine.test.ts
 * Exit code is non-zero on any failure.
 */
import {
  scoreCandidate,
  applyQuietHours,
  parseHHMM,
  isCategoryEnabled,
  dedupeCheck,
  submitCandidate,
  expireOld,
  whyLine,
  getPreferences,
  DEFAULT_PREFS,
  CATEGORY_BASE_SCORES,
  type NudgeCandidate,
  type NudgePreferences,
  type NudgeTier,
} from "./engine.ts";

let failures = 0;
let passes = 0;

function eq(actual: unknown, expected: unknown, label: string): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function ok(cond: boolean, label: string): void {
  if (!cond) throw new Error(`${label}: assertion failed`);
}

async function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    passes++;
    console.log(`  PASS ${name}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL ${name}: ${(e as Error).message}`);
  }
}

// --- Minimal thenable mock of the Supabase query builder --------------------

interface MockResponse {
  data: unknown;
  error: { message: string; code?: string } | null;
}

class MockQuery {
  calls: string[] = [];
  insertedRows: unknown[] | null = null;
  updatedValues: unknown = null;
  constructor(
    private responses: MockResponse[],
    private table: string,
    private log: MockQuery[],
  ) {
    log.push(this);
  }
  select(cols: string) { this.calls.push(`select:${cols}`); return this; }
  eq(c: string, v: unknown) { this.calls.push(`eq:${c}=${JSON.stringify(v)}`); return this; }
  not(c: string, op: string, v: unknown) { this.calls.push(`not:${c} ${op} ${v}`); return this; }
  lt(c: string, v: unknown) { this.calls.push(`lt:${c}<${String(v)}`); return this; }
  in(c: string, vs: unknown[]) { this.calls.push(`in:${c}=${JSON.stringify(vs)}`); return this; }
  limit(n: number) { this.calls.push(`limit:${n}`); return this; }
  order(c: string) { this.calls.push(`order:${c}`); return this; }
  single() { this.calls.push("single"); return this; }
  maybeSingle() { this.calls.push("maybeSingle"); return this; }
  insert(rows: unknown[]) { this.calls.push(`insert:${this.table}`); this.insertedRows = rows; return this; }
  update(vals: unknown) { this.calls.push(`update:${this.table}`); this.updatedValues = vals; return this; }
  then(resolve: (v: MockResponse) => void) {
    const r = this.responses.shift() ?? { data: null, error: null };
    resolve(r);
    return Promise.resolve();
  }
}

function mockDb(responses: MockResponse[]) {
  const log: MockQuery[] = [];
  return {
    log,
    client: {
      from(table: string) {
        return new MockQuery(responses, table, log);
      },
    } as never,
  };
}

const PILOT = "11111111-1111-1111-1111-111111111111";

function prefs(over: Partial<NudgePreferences> = {}): NudgePreferences {
  return { ...DEFAULT_PREFS, pilot_id: PILOT, ...over };
}

function candidate(over: Partial<NudgeCandidate> = {}): NudgeCandidate {
  return {
    pilot_id: PILOT,
    category: "meeting",
    title: "Standup in 15",
    dedup_key: "meeting:evt-1",
    source: "calendar",
    ...over,
  };
}

// --- scoring ----------------------------------------------------------------

await test("score: base score with no deadline", () => {
  eq(scoreCandidate(candidate()), 80, "meeting base");
  eq(scoreCandidate(candidate({ category: "bill" })), 70, "bill base");
  eq(scoreCandidate(candidate({ category: "system" })), 90, "system base");
  eq(scoreCandidate(candidate({ category: "health" })), 30, "health base");
  eq(scoreCandidate(candidate({ category: "todo" })), 40, "todo base");
  eq(scoreCandidate(candidate({ category: "school" })), 60, "school base");
  eq(scoreCandidate(candidate({ category: "weather" })), 50, "weather base");
});

await test("score: urgency multipliers from deadline", () => {
  const now = new Date("2026-10-13T12:00:00Z");
  eq(scoreCandidate(candidate({ deadline: "2026-10-13T12:30:00Z" }), now), 120, "<1h → 1.5×");
  eq(scoreCandidate(candidate({ deadline: "2026-10-13T18:00:00Z" }), now), 96, "<24h → 1.2×");
  eq(scoreCandidate(candidate({ deadline: "2026-10-20T12:00:00Z" }), now), 80, ">24h → 1.0×");
  eq(scoreCandidate(candidate({ deadline: "2026-10-13T11:00:00Z" }), now), 120, "past-due → 1.5×");
});

await test("score: scheduled_for drives urgency when no deadline", () => {
  const now = new Date("2026-10-13T12:00:00Z");
  eq(scoreCandidate(candidate({ scheduled_for: "2026-10-13T12:20:00Z" }), now), 120, "scheduled soon → 1.5×");
});

await test("score: malformed deadline does not throw", () => {
  eq(scoreCandidate(candidate({ deadline: "not-a-date" })), 80, "falls back to base");
});

// --- categories --------------------------------------------------------------

await test("isCategoryEnabled: absent = enabled, explicit false = muted", () => {
  ok(isCategoryEnabled("bill", prefs()), "absent category enabled");
  ok(!isCategoryEnabled("bill", prefs({ categories: { bill: false } })), "explicit false disabled");
  ok(isCategoryEnabled("bill", prefs({ categories: { bill: true } })), "explicit true enabled");
  ok(isCategoryEnabled("todo", prefs({ categories: { bill: false } })), "other categories unaffected");
});

await test("parseHHMM", () => {
  eq(parseHHMM("22:00"), 1320, "22:00");
  eq(parseHHMM("07:00"), 420, "07:00");
  eq(parseHHMM("7:00"), 420, "single-digit hour");
  eq(parseHHMM("bogus"), null, "garbage → null");
  eq(parseHHMM("25:00"), null, "hour > 23 → null");
  eq(parseHHMM("12:60"), null, "minute > 59 → null");
});

// --- quiet hours ---------------------------------------------------------------

const TZ = "America/New_York"; // EDT (UTC-4) on 2026-10-13

await test("quiet hours: daytime nudge passes through unchanged", () => {
  const desired = new Date("2026-10-13T14:00:00Z"); // 10:00 EDT
  const out = applyQuietHours(desired, prefs(), TZ, "normal", new Date("2026-10-13T13:00:00Z"));
  eq(out.getTime(), desired.getTime(), "unchanged");
});

await test("quiet hours: evening nudge pushed to next morning quiet end", () => {
  const desired = new Date("2026-10-13T03:30:00Z"); // 23:30 EDT Oct 12 — in quiet
  const out = applyQuietHours(desired, prefs(), TZ, "normal", new Date("2026-10-13T02:00:00Z"));
  eq(out.toISOString(), "2026-10-13T11:00:00.000Z", "→ 07:00 EDT next day");
});

await test("quiet hours: early-morning nudge pushed to same-morning quiet end", () => {
  const desired = new Date("2026-10-13T07:30:00Z"); // 03:30 EDT — in quiet
  const out = applyQuietHours(desired, prefs(), TZ, "normal", new Date("2026-10-13T06:00:00Z"));
  eq(out.toISOString(), "2026-10-13T11:00:00.000Z", "→ 07:00 EDT same day");
});

await test("quiet hours: urgent tier breaks through only with opt-in", () => {
  const desired = new Date("2026-10-13T03:30:00Z"); // 23:30 EDT
  const now = new Date("2026-10-13T02:00:00Z");
  const blocked = applyQuietHours(desired, prefs(), TZ, "urgent", now);
  eq(blocked.toISOString(), "2026-10-13T11:00:00.000Z", "urgent without opt-in still queued");
  const allowed = applyQuietHours(desired, prefs({ breakthrough_allowed: true }), TZ, "urgent", now);
  eq(allowed.getTime(), desired.getTime(), "urgent with opt-in breaks through");
  const normal = applyQuietHours(desired, prefs({ breakthrough_allowed: true }), TZ, "normal", now);
  eq(normal.toISOString(), "2026-10-13T11:00:00.000Z", "normal tier never breaks through");
});

await test("quiet hours: non-wrapping window (01:00–05:00)", () => {
  const p = prefs({ quiet_hours_start: "01:00", quiet_hours_end: "05:00" });
  const desired = new Date("2026-10-13T06:00:00Z"); // 02:00 EDT — in quiet
  const out = applyQuietHours(desired, p, TZ, "normal", new Date("2026-10-13T05:00:00Z"));
  eq(out.toISOString(), "2026-10-13T09:00:00.000Z", "→ 05:00 EDT same day");
});

await test("quiet hours: start == end means no quiet hours", () => {
  const p = prefs({ quiet_hours_start: "00:00", quiet_hours_end: "00:00" });
  const desired = new Date("2026-10-13T03:30:00Z");
  eq(applyQuietHours(desired, p, TZ).getTime(), desired.getTime(), "unchanged");
});

await test("quiet hours: stale desired rolls forward past now", () => {
  const desired = new Date("2026-10-10T03:30:00Z"); // days old, 23:30 EDT
  const now = new Date("2026-10-13T12:00:00Z");
  const out = applyQuietHours(desired, prefs(), TZ, "normal", now);
  ok(out.getTime() > now.getTime(), "target is in the future");
  eq(out.toISOString(), "2026-10-14T11:00:00.000Z", "rolls to the next available 07:00 EDT");
});

await test("quiet hours: boundary — exactly at quiet start is quiet, at end is free", () => {
  const now = new Date("2026-10-13T01:00:00Z");
  const atStart = new Date("2026-10-13T02:00:00Z"); // 22:00 EDT
  const moved = applyQuietHours(atStart, prefs(), TZ, "normal", now);
  ok(moved.getTime() !== atStart.getTime(), "22:00 is inside quiet hours");
  const atEnd = new Date("2026-10-13T11:00:00Z"); // 07:00 EDT
  eq(applyQuietHours(atEnd, prefs(), TZ, "normal", now).getTime(), atEnd.getTime(), "07:00 is outside quiet hours");
});

// --- dedupe ------------------------------------------------------------------

await test("dedupeCheck: true when a live row exists", async () => {
  const { client, log } = mockDb([{ data: [{ id: "x" }], error: null }]);
  ok(await dedupeCheck(client, PILOT, "meeting:evt-1"), "duplicate found");
  const calls = log[0].calls.join(" ");
  ok(calls.includes("not:status in (expired,muted)"), "excludes expired/muted");
});

await test("dedupeCheck: false when nothing live", async () => {
  const { client } = mockDb([{ data: [], error: null }]);
  ok(!(await dedupeCheck(client, PILOT, "meeting:evt-1")), "no duplicate");
});

await test("dedupeCheck: throws on DB error (never silent)", async () => {
  const { client } = mockDb([{ data: null, error: { message: "boom" } }]);
  let threw = false;
  try {
    await dedupeCheck(client, PILOT, "k");
  } catch {
    threw = true;
  }
  ok(threw, "error propagates");
});

// --- submitCandidate pipeline --------------------------------------------------

await test("submitCandidate: inserts with score + quiet-hours schedule", async () => {
  const now = new Date("2026-10-13T02:00:00Z");
  const { client, log } = mockDb([
    { data: [], error: null }, // dedupe: none
    { data: [{ id: "new-id" }], error: null }, // insert
  ]);
  const out = await submitCandidate(
    client,
    candidate({ scheduled_for: "2026-10-13T03:30:00Z" }), // 23:30 EDT — quiet
    { prefs: prefs(), timezone: TZ, now },
  );
  eq(out.action, "inserted", "action");
  if (out.action === "inserted") {
    eq(out.score, 80, "score");
    eq(out.scheduledFor, "2026-10-13T11:00:00.000Z", "pushed past quiet hours");
    const row = log[1].insertedRows?.[0] as Record<string, unknown>;
    eq(row["dedup_key"], "meeting:evt-1", "dedup_key stored");
    eq(row["status"], "pending", "status pending");
    eq(row["kind"], "meeting", "legacy kind synced");
  } else {
    throw new Error("expected inserted");
  }
});

await test("submitCandidate: deduped when a live nudge exists", async () => {
  const { client } = mockDb([{ data: [{ id: "live" }], error: null }]);
  const out = await submitCandidate(client, candidate(), { prefs: prefs(), timezone: TZ });
  eq(out.action, "deduped", "action");
  eq(out.score, 80, "score still computed");
});

await test("submitCandidate: 23505 unique violation → deduped (race safety)", async () => {
  const { client } = mockDb([
    { data: [], error: null },
    { data: null, error: { message: "duplicate", code: "23505" } },
  ]);
  const out = await submitCandidate(client, candidate(), { prefs: prefs(), timezone: TZ });
  eq(out.action, "deduped", "race → deduped, not a throw");
});

await test("submitCandidate: below min_score is swallowed", async () => {
  const { client, log } = mockDb([]);
  const out = await submitCandidate(client, candidate({ category: "health" }), {
    prefs: prefs({ min_score: 50 }),
    timezone: TZ,
  });
  eq(out.action, "below_threshold", "action");
  eq(log.length, 0, "no DB traffic at all");
});

await test("submitCandidate: disabled category is skipped", async () => {
  const { client, log } = mockDb([]);
  const out = await submitCandidate(client, candidate({ category: "bill" }), {
    prefs: prefs({ categories: { bill: false } }),
    timezone: TZ,
  });
  eq(out.action, "category_disabled", "action");
  eq(log.length, 0, "no DB traffic at all");
});

await test("submitCandidate: non-23505 insert error propagates", async () => {
  const { client } = mockDb([
    { data: [], error: null },
    { data: null, error: { message: "db down" } },
  ]);
  let threw = false;
  try {
    await submitCandidate(client, candidate(), { prefs: prefs(), timezone: TZ });
  } catch {
    threw = true;
  }
  ok(threw, "insert errors propagate so producers can log");
});

// --- expireOld -----------------------------------------------------------------

await test("expireOld: expires past-due, unsnoozes elapsed snoozes", async () => {
  const { client, log } = mockDb([
    { data: [{ id: "a" }, { id: "b" }], error: null }, // expired
    { data: [{ id: "c" }], error: null }, // unsnoozed
  ]);
  const out = await expireOld(client, new Date("2026-10-13T12:00:00Z"), PILOT);
  eq(out.expired, 2, "expired count");
  eq(out.unsnoozed, 1, "unsnoozed count");
  ok((log[0].updatedValues as Record<string, unknown>)["status"] === "expired", "first update = expire");
  ok((log[1].updatedValues as Record<string, unknown>)["status"] === "pending", "second update = unsnooze");
  ok(log[0].calls.some((c) => c.startsWith("eq:pilot_id")), "pilot-scoped");
});

// --- transparency + preferences --------------------------------------------------

await test("whyLine: plain-language transparency", () => {
  eq(
    whyLine({ source: "calendar", score: 96, category: "meeting" }),
    "From calendar — flagged as urgent.",
    "urgent line",
  );
  eq(
    whyLine({ source: "system", score: 30, category: "health" }),
    "From Cockpit — flagged as low-key.",
    "system source → Cockpit",
  );
  eq(
    whyLine({ source: null, score: null, category: null }),
    "From Cockpit — flagged as low-key.",
    "null-safe",
  );
});

await test("getPreferences: falls back to defaults on error", async () => {
  const { client } = mockDb([{ data: null, error: { message: "boom" } }]);
  const p = await getPreferences(client, PILOT);
  eq(p.quiet_hours_start, DEFAULT_PREFS.quiet_hours_start, "default start");
  eq(p.breakthrough_allowed, false, "default breakthrough");
});

await test("getPreferences: maps a stored row", async () => {
  const { client } = mockDb([
    {
      data: {
        categories: { bill: false },
        min_score: 60,
        quiet_hours_start: "23:00:00",
        quiet_hours_end: "06:30:00",
        breakthrough_allowed: true,
      },
      error: null,
    },
  ]);
  const p = await getPreferences(client, PILOT);
  eq(p.min_score, 60, "min_score");
  eq(p.quiet_hours_start, "23:00", "start trimmed to HH:MM");
  eq(p.quiet_hours_end, "06:30", "end trimmed to HH:MM");
  ok(p.breakthrough_allowed, "breakthrough");
  ok(!isCategoryEnabled("bill", p), "bill disabled");
});

await test("CATEGORY_BASE_SCORES covers every category", () => {
  for (const c of ["meeting", "bill", "weather", "todo", "school", "health", "system"] as const) {
    ok(typeof CATEGORY_BASE_SCORES[c] === "number", c);
  }
});

// --- summary ---------------------------------------------------------------------

console.log(`\n${passes} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
