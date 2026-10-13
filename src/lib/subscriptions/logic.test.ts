/**
 * Subscriptions business logic tests.
 *
 * Run: npx tsx src/lib/subscriptions/logic.test.ts
 * (Staging is down, so these pure-function tests are the verification gate.)
 */
import {
  monthlyCost,
  annualCost,
  totalMonthlyCost,
  totalAnnualCost,
  validateSubscriptionInput,
  sortByRenewal,
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

// --- monthlyCost ---
check("monthly stays the same", monthlyCost({ amount: 15.99, cadence: "monthly" }), 15.99);
check("quarterly divided by 3", monthlyCost({ amount: 30, cadence: "quarterly" }), 10);
check("annual divided by 12", monthlyCost({ amount: 120, cadence: "annual" }), 10);
check("missing cadence defaults to monthly", monthlyCost({ amount: 9 }), 9);
check("string amount works", monthlyCost({ amount: "24.99", cadence: "monthly" }), 24.99);

// --- annualCost ---
check("monthly times 12", annualCost({ amount: 15.99, cadence: "monthly" }), 191.88);
check("quarterly times 4", annualCost({ amount: 30, cadence: "quarterly" }), 120);
check("annual stays the same", annualCost({ amount: 120, cadence: "annual" }), 120);
check("monthly and annual agree over a year", monthlyCost({ amount: 120, cadence: "annual" }) * 12, annualCost({ amount: 120, cadence: "annual" }));

// --- totals ---
check(
  "totalMonthlyCost mixes cadences",
  totalMonthlyCost([
    { amount: 10, cadence: "monthly" },
    { amount: 60, cadence: "quarterly" },
    { amount: 120, cadence: "annual" },
  ]),
  40,
);
check(
  "totalAnnualCost mixes cadences",
  totalAnnualCost([
    { amount: 10, cadence: "monthly" },
    { amount: 60, cadence: "quarterly" },
  ]),
  360,
);

// --- validateSubscriptionInput ---
check(
  "valid",
  validateSubscriptionInput({ name: "Netflix", amount: "15.99", cadence: "monthly", next_renewal: "2026-11-15", category: "streaming" }),
  null,
);
check("free subscription is fine", validateSubscriptionInput({ name: "Free trial", amount: 0 }), null);
check("empty name", validateSubscriptionInput({ name: "  ", amount: 5 }), "Give the subscription a name.");
check("missing name", validateSubscriptionInput({ amount: 5 }), "Give the subscription a name.");
check("missing amount", validateSubscriptionInput({ name: "Netflix" }), "The amount needs to be a number, zero or more.");
check("negative amount", validateSubscriptionInput({ name: "Netflix", amount: "-5" }), "The amount needs to be a number, zero or more.");
check("non-numeric amount", validateSubscriptionInput({ name: "Netflix", amount: "lots" }), "The amount needs to be a number, zero or more.");
check("bad cadence", validateSubscriptionInput({ name: "Netflix", amount: 5, cadence: "weekly" }), "Pick monthly, quarterly, or annual for how often it bills.");
check("bad renewal date", validateSubscriptionInput({ name: "Netflix", amount: 5, next_renewal: "Nov 15" }), "The renewal date needs to look like 2026-11-15.");
check("bad category", validateSubscriptionInput({ name: "Netflix", amount: 5, category: "food" }), "Pick a category like streaming, music, gaming, software, news, fitness, or other.");
check("optional fields can be skipped", validateSubscriptionInput({ name: "Netflix", amount: 5 }), null);

// --- sortByRenewal ---
check(
  "active before paused before cancelled",
  sortByRenewal([
    { name: "c", status: "cancelled" },
    { name: "p", status: "paused" },
    { name: "a", status: "active" },
  ]).map((s) => s.name),
  ["a", "p", "c"],
);
check(
  "active sorts by next_renewal, dateless last",
  sortByRenewal([
    { name: "late", status: "active", next_renewal: "2026-12-01" },
    { name: "dateless", status: "active", next_renewal: null },
    { name: "early", status: "active", next_renewal: "2026-10-20" },
  ]).map((s) => s.name),
  ["early", "late", "dateless"],
);
check(
  "paused outranks cancelled even when sooner",
  sortByRenewal([
    { name: "cancelled", status: "cancelled", next_renewal: "2026-10-14" },
    { name: "paused", status: "paused", next_renewal: "2026-11-01" },
  ]).map((s) => s.name),
  ["paused", "cancelled"],
);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
