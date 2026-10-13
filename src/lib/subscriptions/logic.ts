/**
 * Subscriptions business logic — pure functions, no I/O.
 *
 * A subscription has an amount per billing period and a cadence
 * (monthly/quarterly/annual). These functions normalize costs to a
 * monthly or annual view so the applet can answer "what am I spending
 * on subscriptions?" across mixed cadences.
 */

export type SubscriptionCadence = "monthly" | "quarterly" | "annual";
export type SubscriptionStatus = "active" | "paused" | "cancelled";
export type SubscriptionCategory =
  | "streaming"
  | "music"
  | "gaming"
  | "software"
  | "news"
  | "fitness"
  | "other";

export interface SubscriptionLike {
  id?: string;
  name?: string | null;
  amount?: number | string | null;
  cadence?: string | null;
  next_renewal?: string | null;
  category?: string | null;
  status?: string | null;
  notes?: string | null;
}

export const SUBSCRIPTION_CADENCES: SubscriptionCadence[] = [
  "monthly",
  "quarterly",
  "annual",
];

export const SUBSCRIPTION_CATEGORIES: SubscriptionCategory[] = [
  "streaming",
  "music",
  "gaming",
  "software",
  "news",
  "fitness",
  "other",
];

/** Periods per year for each cadence: monthly=12, quarterly=4, annual=1. */
function periodsPerYear(cadence: string | null | undefined): number {
  switch (cadence) {
    case "monthly":
      return 12;
    case "quarterly":
      return 4;
    case "annual":
      return 1;
    default:
      return 12;
  }
}

function toAmount(amount: number | string | null | undefined): number {
  const n = Number(amount ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Cost per month for a subscription, normalized from its cadence:
 * monthly = amount, quarterly = amount/3, annual = amount/12.
 */
export function monthlyCost(sub: Pick<SubscriptionLike, "amount" | "cadence">): number {
  return (toAmount(sub.amount) * periodsPerYear(sub.cadence)) / 12;
}

/**
 * Cost per year for a subscription, normalized from its cadence:
 * monthly = amount*12, quarterly = amount*4, annual = amount.
 */
export function annualCost(sub: Pick<SubscriptionLike, "amount" | "cadence">): number {
  return toAmount(sub.amount) * periodsPerYear(sub.cadence);
}

/** Sum of monthly costs across a list of subscriptions, rounded to cents. */
export function totalMonthlyCost<T extends Pick<SubscriptionLike, "amount" | "cadence">>(
  subs: T[],
): number {
  const total = subs.reduce((sum, s) => sum + monthlyCost(s), 0);
  return Math.round(total * 100) / 100;
}

/** Sum of annual costs across a list of subscriptions, rounded to cents. */
export function totalAnnualCost<T extends Pick<SubscriptionLike, "amount" | "cadence">>(
  subs: T[],
): number {
  const total = subs.reduce((sum, s) => sum + annualCost(s), 0);
  return Math.round(total * 100) / 100;
}

/** Validate a create/update payload. Returns a plain-English error or null. */
export function validateSubscriptionInput(input: {
  name?: unknown;
  amount?: unknown;
  cadence?: unknown;
  next_renewal?: unknown;
  category?: unknown;
}): string | null {
  if (typeof input.name !== "string" || input.name.trim().length === 0) {
    return "Give the subscription a name.";
  }
  if (input.amount === undefined || input.amount === null || input.amount === "") {
    return "The amount needs to be a number, zero or more.";
  }
  const n = Number(input.amount);
  if (!Number.isFinite(n) || n < 0) {
    return "The amount needs to be a number, zero or more.";
  }
  if (input.cadence !== undefined && input.cadence !== null && input.cadence !== "") {
    if (!SUBSCRIPTION_CADENCES.includes(String(input.cadence) as SubscriptionCadence)) {
      return "Pick monthly, quarterly, or annual for how often it bills.";
    }
  }
  if (input.next_renewal !== undefined && input.next_renewal !== null && input.next_renewal !== "") {
    if (typeof input.next_renewal !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.next_renewal)) {
      return "The renewal date needs to look like 2026-11-15.";
    }
  }
  if (input.category !== undefined && input.category !== null && input.category !== "") {
    if (!SUBSCRIPTION_CATEGORIES.includes(String(input.category) as SubscriptionCategory)) {
      return "Pick a category like streaming, music, gaming, software, news, fitness, or other.";
    }
  }
  return null;
}

/**
 * Sort for the applet's list: active first (by next_renewal, dateless
 * last), then paused, then cancelled. Unknown statuses sort last.
 */
export function sortByRenewal<T extends SubscriptionLike>(subs: T[]): T[] {
  const statusRank = (s: T): number => {
    switch (s.status) {
      case "active":
        return 0;
      case "paused":
        return 1;
      case "cancelled":
        return 2;
      default:
        return 3;
    }
  };
  const renewalRank = (s: T): string => s.next_renewal ?? "9999-12-31";
  return [...subs].sort((a, b) => {
    const rank = statusRank(a) - statusRank(b);
    if (rank !== 0) return rank;
    const date = renewalRank(a).localeCompare(renewalRank(b));
    if (date !== 0) return date;
    return String(a.name ?? "").localeCompare(String(b.name ?? ""));
  });
}
