/**
 * Bills business logic tests.
 *
 * Run: npx tsx src/lib/bills/logic.test.ts
 * (Staging is down, so these pure-function tests are the verification gate.)
 */
import {
  effectiveStatus,
  daysOverdue,
  isSnoozed,
  groupBills,
  totalDue,
  nextOccurrenceDate,
  dueLabel,
  validateBillInput,
} from "./logic";

let passed = 0;
let failed = 0;

function check(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
  } else {
    failed++;
    console.error(`FAIL ${name}\n  expected: ${e}\n  actual:   ${a}`);
  }
}

// Fixed "today" for deterministic tests: 2026-10-13 (a Tuesday).
const NOW = new Date("2026-10-13T12:00:00");

// --- effectiveStatus ---
check("paid wins over everything", effectiveStatus({ id: "1", due_date: "2026-10-01", paid_at: "2026-10-12T10:00:00Z" }, NOW), "paid");
check("past due -> overdue", effectiveStatus({ id: "1", due_date: "2026-10-10" }, NOW), "overdue");
check("due today -> due", effectiveStatus({ id: "1", due_date: "2026-10-13" }, NOW), "due");
check("due in 3 days -> due", effectiveStatus({ id: "1", due_date: "2026-10-16" }, NOW), "due");
check("due in 7 days -> due (boundary)", effectiveStatus({ id: "1", due_date: "2026-10-20" }, NOW), "due");
check("due in 8 days -> upcoming", effectiveStatus({ id: "1", due_date: "2026-10-21" }, NOW), "upcoming");
check("no due date -> upcoming", effectiveStatus({ id: "1", due_date: null }, NOW), "upcoming");
check("stored status ignored when stale", effectiveStatus({ id: "1", due_date: "2026-10-01", status: "upcoming" }, NOW), "overdue");

// --- daysOverdue ---
check("3 days overdue", daysOverdue({ id: "1", due_date: "2026-10-10" }, NOW), 3);
check("not overdue", daysOverdue({ id: "1", due_date: "2026-10-20" }, NOW), 0);
check("paid bill never overdue", daysOverdue({ id: "1", due_date: "2026-10-01", paid_at: "x" }, NOW), 0);

// --- isSnoozed ---
check("future snooze", isSnoozed({ id: "1", snoozed_until: "2026-10-20T00:00:00Z" }, NOW), true);
check("past snooze", isSnoozed({ id: "1", snoozed_until: "2026-10-01T00:00:00Z" }, NOW), false);
check("no snooze", isSnoozed({ id: "1" }, NOW), false);

// --- groupBills ---
const mixed = [
  { id: "a", name: "Overdue", due_date: "2026-10-01" },
  { id: "b", name: "Due soon", due_date: "2026-10-15" },
  { id: "c", name: "Later", due_date: "2026-11-01" },
  { id: "d", name: "Paid", due_date: "2026-10-01", paid_at: "2026-10-02T00:00:00Z" },
];
const groups = groupBills(mixed, NOW);
check("group overdue", groups.overdue.map((b) => b.id), ["a"]);
check("group due", groups.due.map((b) => b.id), ["b"]);
check("group upcoming", groups.upcoming.map((b) => b.id), ["c"]);
check("group paid", groups.paid.map((b) => b.id), ["d"]);

// --- totalDue ---
check(
  "total due next 7 days",
  totalDue(
    [
      { id: "1", due_date: "2026-10-14", amount: 50 },
      { id: "2", due_date: "2026-10-20", amount: 100 }, // boundary: included
      { id: "3", due_date: "2026-10-21", amount: 999 }, // outside
      { id: "4", due_date: "2026-10-14", amount: 25, paid_at: "x" }, // paid: excluded
      { id: "5", due_date: null, amount: 10 }, // dateless: excluded
    ],
    7,
    NOW,
  ),
  150,
);

// --- nextOccurrenceDate ---
check("monthly", nextOccurrenceDate("monthly", 15, "2026-10-15", NOW), "2026-11-15");
check("monthly clamps Feb", nextOccurrenceDate("monthly", 30, "2026-01-30", NOW), "2026-02-28");
check("quarterly", nextOccurrenceDate("quarterly", 1, "2026-10-01", NOW), "2027-01-01");
check("annual", nextOccurrenceDate("annual", 15, "2026-10-15", NOW), "2027-10-15");
check("one-off -> null", nextOccurrenceDate("one-off", 15, "2026-10-15", NOW), null);
check("no due_day -> null", nextOccurrenceDate("monthly", null, "2026-10-15", NOW), null);

// --- dueLabel ---
check("paid label", dueLabel({ id: "1", paid_at: "x" }, NOW), "Paid");
check("overdue label", dueLabel({ id: "1", due_date: "2026-10-10" }, NOW), "Overdue by 3 days");
check("overdue 1 day", dueLabel({ id: "1", due_date: "2026-10-12" }, NOW), "Overdue by 1 day");
check("due today", dueLabel({ id: "1", due_date: "2026-10-13" }, NOW), "Due today");
check("due tomorrow", dueLabel({ id: "1", due_date: "2026-10-14" }, NOW), "Due tomorrow");
check("no due date", dueLabel({ id: "1", due_date: null }, NOW), "No due date");

// --- validateBillInput ---
check("valid", validateBillInput({ name: "Power", amount: "87.40", due_date: "2026-10-20", cadence: "monthly" }), null);
check("empty name", validateBillInput({ name: "  " }), "Give the bill a name.");
check("missing name", validateBillInput({}), "Give the bill a name.");
check("bad amount", validateBillInput({ name: "x", amount: "-5" }), "The amount needs to be a number, zero or more.");
check("bad date", validateBillInput({ name: "x", due_date: "tomorrow" }), "The due date needs to look like 2026-10-20.");
check("bad due_day", validateBillInput({ name: "x", due_day: "32" }), "The due day needs to be a day of the month (1–31).");
check("bad cadence", validateBillInput({ name: "x", cadence: "weekly" }), "Pick monthly, quarterly, annual, or one-off for how often it repeats.");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
