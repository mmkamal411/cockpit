import { strict as assert } from "node:assert";
import { describeRecurrence, nextOccurrence, parseRecurrence } from "./recurrence.ts";

// --- parseRecurrence ---
assert.deepEqual(parseRecurrence("every day"), { kind: "daily", value: 1 });
assert.deepEqual(parseRecurrence("EVERY DAY"), { kind: "daily", value: 1 });
assert.deepEqual(parseRecurrence("  every   monday  "), { kind: "weekly", value: 1 });
assert.deepEqual(parseRecurrence("every 2 weeks"), { kind: "interval", value: 2, unit: "week" });
assert.deepEqual(parseRecurrence("every 1 month"), { kind: "interval", value: 1, unit: "month" });
assert.deepEqual(parseRecurrence("every 3 years"), { kind: "interval", value: 3, unit: "year" });
assert.equal(parseRecurrence("every"), null);
assert.equal(parseRecurrence("every fortnight"), null);
assert.equal(parseRecurrence("every 0 days"), null);
assert.equal(parseRecurrence("tomorrow"), null);

// --- nextOccurrence: daily forward-roll ---
// Tuesday Oct 13 2026 10:00 local -> next day 10:00.
{
  const from = new Date(2026, 9, 13, 10, 0, 0).getTime();
  const next = nextOccurrence("every day", from);
  assert(next !== null);
  const d = new Date(next);
  assert.equal(d.getDate(), 14);
  assert.equal(d.getHours(), 10);
}

// --- weekly: next Monday after Tuesday ---
{
  const from = new Date(2026, 9, 13, 10, 0, 0).getTime(); // Tuesday
  const next = nextOccurrence("every monday", from)!;
  const d = new Date(next);
  assert.equal(d.getDay(), 1);
  assert.equal(d.getDate(), 19);
}

// --- weekly: same weekday but later today rolls to next week ---
{
  const from = new Date(2026, 9, 13, 10, 0, 0).getTime(); // Tuesday 10:00
  const next = nextOccurrence("every tuesday", from)!;
  const d = new Date(next);
  assert.equal(d.getDate(), 20); // next Tuesday, not today
}

// --- weekdays skip weekends ---
{
  const friday = new Date(2026, 9, 16, 9, 0, 0).getTime(); // Friday
  const next = nextOccurrence("every weekday", friday)!;
  const d = new Date(next);
  assert.equal(d.getDay(), 1); // Monday
  assert.equal(d.getDate(), 19);
}

// --- interval: every 2 weeks ---
{
  const from = new Date(2026, 9, 13, 10, 0, 0).getTime();
  const next = nextOccurrence("every 2 weeks", from)!;
  assert.equal(new Date(next).getDate(), 27);
}

// --- forward-roll from the distant past never lands in the past ---
{
  const longAgo = new Date(2020, 0, 1, 9, 0, 0).getTime();
  const next = nextOccurrence("every day", longAgo)!;
  assert(next > Date.now(), "forward-roll must land in the future");
}

// --- month clamp: Jan 31 + 1 month -> Feb 28/29 ---
{
  const jan31 = new Date(2026, 0, 31, 9, 0, 0).getTime();
  const now = new Date(2026, 1, 1, 0, 0, 0).getTime();
  const next = nextOccurrence("every month", jan31, now)!;
  const d = new Date(next);
  assert.equal(d.getMonth(), 1); // February, not March
  assert(d.getDate() >= 27 && d.getDate() <= 29);
}

// --- describeRecurrence ---
assert.equal(describeRecurrence("every day"), "Every day");
assert.equal(describeRecurrence("every friday"), "Every Friday");
assert.equal(describeRecurrence("every 2 weeks"), "Every 2 weeks");
assert.equal(describeRecurrence("every month"), "Every month");
assert.equal(describeRecurrence("nonsense"), null);

console.log("recurrence.test.ts: all assertions passed");
