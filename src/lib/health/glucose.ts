/**
 * Blood glucose + A1C pure logic (no I/O — unit-testable).
 *
 * ADA estimated-average-glucose relationship:
 *   eAG (mg/dL) = 28.7 × A1C − 46.7
 * Inverted: A1C ≈ (avg_glucose + 46.7) / 28.7
 */

/** Distinct days of readings required before an estimated A1C is shown. */
export const A1C_MIN_DAYS = 14;
/** Lookback window (days) for the glucose average behind the estimate. */
export const A1C_WINDOW_DAYS = 90;

/** mg/dL sanity bounds for a manual reading. */
export const GLUCOSE_BOUNDS = { min: 20, max: 1000 } as const;
/** % sanity bounds for a lab A1C entry. */
export const A1C_LAB_BOUNDS = { min: 3, max: 20 } as const;

/** Allowed context tags for a glucose reading. */
export const GLUCOSE_CONTEXTS = [
  "fasting",
  "before_meal",
  "after_meal",
  "bedtime",
  "other",
] as const;
export type GlucoseContext = (typeof GLUCOSE_CONTEXTS)[number];

/** General ADA reference ranges — reference only, never personal targets. */
export const GLUCOSE_REF = {
  fastingBand: [80, 130] as const,
  postMealLine: 180,
} as const;

/** Estimated A1C (%) from an average glucose (mg/dL). Rounded to 1 decimal. */
export function a1cFromAvgGlucose(avgMgDl: number): number {
  return Math.round(((avgMgDl + 46.7) / 28.7) * 10) / 10;
}

export interface GlucoseReading {
  value: number;
  logged_at: string;
}

export interface A1CEstimate {
  enough_data: boolean;
  estimated_a1c: number | null;
  avg_glucose_mg_dl: number | null;
  days_of_data: number;
  readings_count: number;
}

/**
 * Compute the estimated-A1C inputs from raw readings.
 * dayOf: maps an ISO timestamp to a local YYYY-MM-DD day key.
 */
export function summarizeGlucose(
  readings: GlucoseReading[],
  dayOf: (iso: string) => string,
): A1CEstimate {
  const days = new Set<string>();
  let sum = 0;
  let count = 0;
  for (const r of readings) {
    if (!Number.isFinite(r.value)) continue;
    days.add(dayOf(r.logged_at));
    sum += r.value;
    count += 1;
  }
  const daysOfData = days.size;
  const avg = count > 0 ? Math.round((sum / count) * 10) / 10 : null;
  const enough = daysOfData >= A1C_MIN_DAYS && avg !== null;
  return {
    enough_data: enough,
    estimated_a1c: enough && avg !== null ? a1cFromAvgGlucose(avg) : null,
    avg_glucose_mg_dl: avg,
    days_of_data: daysOfData,
    readings_count: count,
  };
}

/** Plain-English validation for a glucose reading value. Null = valid. */
export function validateGlucose(value: number): string | null {
  if (!Number.isFinite(value)) return "Enter a number.";
  if (value < GLUCOSE_BOUNDS.min || value > GLUCOSE_BOUNDS.max) {
    return "That blood sugar reading doesn't look right — readings are usually between 20 and 1000 mg/dL.";
  }
  return null;
}

/** Plain-English validation for a lab A1C value. Null = valid. */
export function validateA1CLab(value: number): string | null {
  if (!Number.isFinite(value)) return "Enter your A1C as a number, like 6.5.";
  if (value < A1C_LAB_BOUNDS.min || value > A1C_LAB_BOUNDS.max) {
    return "That A1C doesn't look right — lab A1C is usually between 3 and 20%.";
  }
  return null;
}
