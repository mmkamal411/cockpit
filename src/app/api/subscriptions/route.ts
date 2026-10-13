import { NextRequest, NextResponse } from "next/server";
import { pilotRoute, dbErrorMessage, BadRequestError } from "@/lib/api/pilotRoute";

export const SUBSCRIPTION_CADENCES = ["monthly", "quarterly", "annual"] as const;
export const SUBSCRIPTION_CATEGORIES = [
  "streaming",
  "music",
  "gaming",
  "software",
  "news",
  "fitness",
  "other",
] as const;

export interface SubscriptionLike {
  amount?: number | string | null;
  cadence?: string | null;
}

export interface SubscriptionInput {
  name?: unknown;
  amount?: unknown;
  cadence?: unknown;
  next_renewal?: unknown;
  category?: unknown;
  status?: unknown;
}

/**
 * Plain-English validation, mirrored on validateBillInput in src/lib/bills/logic.ts.
 * Pass { nameRequired: true } for POST, { nameRequired: false } for PUT.
 */
export function validateSubscriptionInput(
  input: SubscriptionInput,
  opts: { nameRequired: boolean },
): string | null {
  if (input.name !== undefined) {
    if (typeof input.name !== "string" || input.name.trim().length === 0) {
      return "Give the subscription a name.";
    }
  } else if (opts.nameRequired) {
    return "Give the subscription a name.";
  }
  if (input.amount !== undefined && input.amount !== null && input.amount !== "") {
    const n = Number(input.amount);
    if (!Number.isFinite(n) || n < 0) return "The amount needs to be a number, zero or more.";
  }
  if (input.cadence !== undefined && input.cadence !== null && input.cadence !== "") {
    if (!SUBSCRIPTION_CADENCES.includes(String(input.cadence) as (typeof SUBSCRIPTION_CADENCES)[number])) {
      return "Pick monthly, quarterly, or annual for how often it renews.";
    }
  }
  if (input.next_renewal !== undefined && input.next_renewal !== null && input.next_renewal !== "") {
    if (typeof input.next_renewal !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.next_renewal)) {
      return "The renewal date needs to look like 2026-11-01.";
    }
  }
  if (input.category !== undefined && input.category !== null && input.category !== "") {
    if (!SUBSCRIPTION_CATEGORIES.includes(String(input.category) as (typeof SUBSCRIPTION_CATEGORIES)[number])) {
      return "Pick a category: streaming, music, gaming, software, news, fitness, or other.";
    }
  }
  if (input.status !== undefined && input.status !== null && input.status !== "") {
    if (!["active", "paused", "cancelled"].includes(String(input.status))) {
      return "Pick active, paused, or cancelled for the status.";
    }
  }
  return null;
}

/** This subscription's cost normalized to a monthly amount. */
export function monthlyCost(subscription: SubscriptionLike): number {
  const amount = Number(subscription.amount ?? 0);
  if (!Number.isFinite(amount)) return 0;
  switch (subscription.cadence) {
    case "quarterly":
      return amount / 3;
    case "annual":
      return amount / 12;
    default:
      return amount;
  }
}

/**
 * GET /api/subscriptions
 * Returns { subscriptions: [...], monthly_total, annual_total }.
 * Ordered by next_renewal (nulls last); soft-deleted rows excluded.
 * Totals are summed over active subscriptions only.
 */
export const GET = pilotRoute(async ({ supabase, pilotId }) => {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("pilot_id", pilotId)
    .is("deleted_at", null)
    .order("next_renewal", { ascending: true, nullsFirst: false });

  if (error) {
    const { message, status } = dbErrorMessage(error);
    return NextResponse.json({ error: message }, { status });
  }

  const subscriptions = data ?? [];
  let monthly_total = 0;
  for (const s of subscriptions) {
    if (s.status === "active") monthly_total += monthlyCost(s);
  }
  monthly_total = Math.round(monthly_total * 100) / 100;
  const annual_total = Math.round(monthly_total * 12 * 100) / 100;

  return NextResponse.json({ subscriptions, monthly_total, annual_total });
});

/**
 * POST /api/subscriptions
 * Body: { name, amount?, cadence?, next_renewal?, category?, notes? }
 * Returns { subscription } with a 201.
 */
export const POST = pilotRoute(async ({ supabase, pilotId }, req: NextRequest) => {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    throw new BadRequestError("That request didn't come through. Try again.");
  }

  const problem = validateSubscriptionInput(body, { nameRequired: true });
  if (problem) throw new BadRequestError(problem);

  const row = {
    pilot_id: pilotId,
    name: String(body.name).trim(),
    amount:
      body.amount === undefined || body.amount === null || body.amount === ""
        ? null
        : Number(body.amount),
    cadence: typeof body.cadence === "string" && body.cadence ? body.cadence : "monthly",
    next_renewal:
      typeof body.next_renewal === "string" && body.next_renewal ? body.next_renewal : null,
    category: typeof body.category === "string" && body.category ? body.category : "other",
    status: "active",
    notes: typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null,
  };

  const { data, error } = await supabase.from("subscriptions").insert(row).select().single();
  if (error) {
    const { message, status } = dbErrorMessage(error);
    return NextResponse.json({ error: message }, { status });
  }
  return NextResponse.json({ subscription: data }, { status: 201 });
});
