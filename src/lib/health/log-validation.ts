/**
 * Shared metric definitions + sanity bounds for the health log write routes
 * (POST /api/health/log and PATCH /api/health/logs/[id]).
 *
 * Bounds are plain-English guardrails against typos (a 900 lb body weight, a
 * 40-hour nap) — not medical judgments.
 */

export const HEALTH_METRICS = [
  "weight",
  "sleep",
  "water",
  "exercise",
  "blood_glucose",
  "a1c_lab",
  "steps",
] as const;

export type HealthMetric = (typeof HEALTH_METRICS)[number];

/** Sanity bounds per metric (value is in the posted unit). */
export const HEALTH_BOUNDS: Record<HealthMetric, { min: number; max: number; what: string }> = {
  weight: { min: 50, max: 1500, what: "weight" },
  sleep: { min: 0, max: 24, what: "sleep hours" },
  water: { min: 0, max: 50, what: "glasses of water" },
  exercise: { min: 0, max: 1440, what: "exercise minutes" },
  blood_glucose: { min: 20, max: 1000, what: "blood sugar reading" },
  a1c_lab: { min: 3, max: 20, what: "A1C value" },
  steps: { min: 0, max: 100000, what: "step count" },
};

/**
 * Plain-English rejection when a value falls outside the metric's sanity
 * bounds; null when it looks fine.
 */
export function checkHealthValue(metric: HealthMetric, value: number): string | null {
  const bounds = HEALTH_BOUNDS[metric];
  if (value < bounds.min || value > bounds.max) {
    return `That ${bounds.what} doesn't look right — try again.`;
  }
  return null;
}

/** Default display unit per metric when the client doesn't send one. */
export const HEALTH_DEFAULT_UNIT: Record<HealthMetric, string> = {
  weight: "lb",
  sleep: "h",
  water: "glasses",
  exercise: "min",
  blood_glucose: "mg/dL",
  a1c_lab: "%",
  steps: "steps",
};
