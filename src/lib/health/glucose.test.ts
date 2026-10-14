/**
 * Glucose + A1C logic tests.
 *
 * Run: node src/lib/health/glucose.test.ts   (Node ≥ 22 strips types natively)
 * (Staging is down, so these pure-function tests are the verification gate.)
 */
import {
  A1C_MIN_DAYS,
  a1cFromAvgGlucose,
  summarizeGlucose,
  validateA1CLab,
  validateGlucose,
  GLUCOSE_CONTEXTS,
} from "./glucose.ts";

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

// --- A1C formula (ADA eAG inversion) ---
// Known anchors: avg 154 mg/dL ≈ 7.0%, avg 126 ≈ 6.0%, avg 183 ≈ 8.0%.
check("a1c(154) ≈ 7.0", a1cFromAvgGlucose(154), 7.0);
check("a1c(126) ≈ 6.0", a1cFromAvgGlucose(126), 6.0);
check("a1c(183) ≈ 8.0", a1cFromAvgGlucose(183), 8.0);
check("a1c(100) rounds to 1 decimal", a1cFromAvgGlucose(100), 5.1);

// --- Summary: 14-day gate ---
const dayOf = (iso: string) => iso.slice(0, 10);
function readingsOnDays(n: number, value = 120) {
  const out = [];
  for (let d = 0; d < n; d++) {
    const day = `2026-09-${String(d + 1).padStart(2, "0")}`;
    out.push({ value, logged_at: `${day}T08:00:00Z` });
    out.push({ value: value + 40, logged_at: `${day}T19:00:00Z` }); // two/day
  }
  return out;
}

const thirteen = summarizeGlucose(readingsOnDays(13), dayOf);
check("13 days → not enough data", thirteen.enough_data, false);
check("13 days → no estimate", thirteen.estimated_a1c, null);
check("13 days counted", thirteen.days_of_data, 13);
check("13 days × 2 readings", thirteen.readings_count, 26);

const fourteen = summarizeGlucose(readingsOnDays(14, 120), dayOf);
check("14 days → enough data", fourteen.enough_data, true);
// avg = 140 → (140 + 46.7) / 28.7 = 6.505… → 6.5
check("14 days avg 140 → 6.5", fourteen.estimated_a1c, 6.5);
check("avg glucose computed", fourteen.avg_glucose_mg_dl, 140);

const empty = summarizeGlucose([], dayOf);
check("no readings → not enough", empty.enough_data, false);
check("no readings → null estimate", empty.estimated_a1c, null);

const sameDay = summarizeGlucose(
  [
    { value: 110, logged_at: "2026-09-01T08:00:00Z" },
    { value: 150, logged_at: "2026-09-01T12:00:00Z" },
    { value: 130, logged_at: "2026-09-01T20:00:00Z" },
  ],
  dayOf,
);
check("3 readings same day → 1 day", sameDay.days_of_data, 1);
check("non-finite values skipped", summarizeGlucose([{ value: NaN, logged_at: "2026-09-01T08:00:00Z" }], dayOf).readings_count, 0);

// --- Validation ---
check("glucose 112 valid", validateGlucose(112), null);
check("glucose 20 valid (edge)", validateGlucose(20), null);
check("glucose 1000 valid (edge)", validateGlucose(1000), null);
check(
  "glucose 19 rejected",
  validateGlucose(19),
  "That blood sugar reading doesn't look right — readings are usually between 20 and 1000 mg/dL.",
);
check("glucose 0 rejected", validateGlucose(0) !== null, true);
check("glucose NaN rejected", validateGlucose(NaN), "Enter a number.");

check("a1c 6.5 valid", validateA1CLab(6.5), null);
check("a1c 3 valid (edge)", validateA1CLab(3), null);
check("a1c 20 valid (edge)", validateA1CLab(20), null);
check(
  "a1c 25 rejected",
  validateA1CLab(25),
  "That A1C doesn't look right — lab A1C is usually between 3 and 20%.",
);
check("a1c NaN rejected", validateA1CLab(NaN), "Enter your A1C as a number, like 6.5.");

// --- Context tags ---
check("five context tags", GLUCOSE_CONTEXTS.length, 5);
check("fasting is a tag", (GLUCOSE_CONTEXTS as readonly string[]).includes("fasting"), true);
check("A1C_MIN_DAYS is 14", A1C_MIN_DAYS, 14);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
