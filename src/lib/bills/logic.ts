/**
 * Bills business logic — pure functions, no I/O.
 *
 * Status is DERIVED from due_date + paid_at, never trusted from the stored
 * column alone: a bill whose due date passed while unpaid is overdue even
 * if nobody updated its row. The stored `status` column is a hint; these
 * functions are the truth.
 */

export type BillStatus = "overdue" | "due" | "upcoming" | "paid";
export type BillCadence = "monthly" | "quarterly" | "annual" | "one-off";

export interface BillLike {
  id: string;
  name: string;
  payee?: string | null;
  amount?: number | string | null;
  due_date?: string | null;
  due_day?: number | null;
  cadence?: string | null;
  status?: string | null;
  paid_at?: string | null;
  snoozed_until?: string | null;
}

export const DUE_SOON_DAYS = 7;

/** Start of today in the pilot's local timezone, as YYYY-MM-DD. */
export function todayStr(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(isoDate: string, days: number): string {
  const d = new Date(isoDate + "T12:00:00");
  d.setDate(d.getDate() + days);
  return todayStr(d);
}

/**
 * Effective status for display/grouping.
 * - paid_at set  -> "paid"
 * - due_date in the past (before today) -> "overdue"
 * - due_date within DUE_SOON_DAYS -> "due"
 * - otherwise -> "upcoming"
 * - no due_date at all -> "upcoming" (dateless bills never escalate)
 */
export function effectiveStatus(bill: BillLike, now = new Date()): BillStatus {
  if (bill.paid_at) return "paid";
  if (bill.status === "paid") return "paid";
  const due = bill.due_date;
  if (!due) return "upcoming";
  const today = todayStr(now);
  if (due < today) return "overdue";
  if (due <= addDays(today, DUE_SOON_DAYS)) return "due";
  return "upcoming";
}

/** Whole days a bill is overdue (0 when not overdue). */
export function daysOverdue(bill: BillLike, now = new Date()): number {
  if (!bill.due_date || bill.paid_at) return 0;
  const today = todayStr(now);
  if (bill.due_date >= today) return 0;
  const ms = new Date(today + "T12:00:00").getTime() - new Date(bill.due_date + "T12:00:00").getTime();
  return Math.round(ms / 86_400_000);
}

/** Whether reminders are currently snoozed. */
export function isSnoozed(bill: BillLike, now = new Date()): boolean {
  if (!bill.snoozed_until) return false;
  return new Date(bill.snoozed_until).getTime() > now.getTime();
}

export type BillGroup = "overdue" | "due" | "upcoming" | "paid";

/** Group a bill list into the applet's four sections, each sorted by due date. */
export function groupBills<T extends BillLike>(bills: T[], now = new Date()): Record<BillGroup, T[]> {
  const groups: Record<BillGroup, T[]> = { overdue: [], due: [], upcoming: [], paid: [] };
  for (const bill of bills) {
    groups[effectiveStatus(bill, now)].push(bill);
  }
  const byDue = (a: T, b: T) => (a.due_date ?? "9999-12-31").localeCompare(b.due_date ?? "9999-12-31");
  (Object.keys(groups) as BillGroup[]).forEach((k) => groups[k].sort(byDue));
  return groups;
}

/** Sum of amounts due in the next `days` days (unpaid only). */
export function totalDue<T extends BillLike>(bills: T[], days: number, now = new Date()): number {
  const cutoff = addDays(todayStr(now), days);
  const today = todayStr(now);
  let total = 0;
  for (const bill of bills) {
    if (bill.paid_at || !bill.due_date) continue;
    if (bill.due_date < today || bill.due_date > cutoff) continue;
    total += Number(bill.amount ?? 0);
  }
  return Math.round(total * 100) / 100;
}

/**
 * Next occurrence date for a recurring bill, derived from due_day.
 * Returns null for one-off bills or when due_day is missing.
 */
export function nextOccurrenceDate(
  cadence: string | null | undefined,
  dueDay: number | null | undefined,
  fromDueDate: string | null | undefined,
  now = new Date(),
): string | null {
  if (!cadence || cadence === "one-off" || !dueDay) return null;
  const monthsAhead = cadence === "monthly" ? 1 : cadence === "quarterly" ? 3 : 12;
  const base = fromDueDate ? new Date(fromDueDate + "T12:00:00") : now;
  // Clamp the day to the target month's length (Feb 30 -> Feb 28).
  const target = new Date(base.getFullYear(), base.getMonth() + monthsAhead, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(dueDay, lastDay));
  return todayStr(target);
}

/** Plain-English relative due label: "Overdue by 3 days", "Due tomorrow", "Due Oct 20". */
export function dueLabel(bill: BillLike, now = new Date()): string {
  if (bill.paid_at) return "Paid";
  if (!bill.due_date) return "No due date";
  const overdue = daysOverdue(bill, now);
  if (overdue > 0) return overdue === 1 ? "Overdue by 1 day" : `Overdue by ${overdue} days`;
  const today = todayStr(now);
  if (bill.due_date === today) return "Due today";
  if (bill.due_date === addDays(today, 1)) return "Due tomorrow";
  const d = new Date(bill.due_date + "T12:00:00");
  return `Due ${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}`;
}

/** Validate a create/update payload. Returns a plain-English error or null. */
export function validateBillInput(input: {
  name?: unknown;
  amount?: unknown;
  due_date?: unknown;
  due_day?: unknown;
  cadence?: unknown;
}): string | null {
  if (typeof input.name !== "string" || input.name.trim().length === 0) {
    return "Give the bill a name.";
  }
  if (input.amount !== undefined && input.amount !== null && input.amount !== "") {
    const n = Number(input.amount);
    if (!Number.isFinite(n) || n < 0) return "The amount needs to be a number, zero or more.";
  }
  if (input.due_date !== undefined && input.due_date !== null && input.due_date !== "") {
    if (typeof input.due_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.due_date)) {
      return "The due date needs to look like 2026-10-20.";
    }
  }
  if (input.due_day !== undefined && input.due_day !== null && input.due_day !== "") {
    const n = Number(input.due_day);
    if (!Number.isInteger(n) || n < 1 || n > 31) return "The due day needs to be a day of the month (1–31).";
  }
  if (input.cadence !== undefined && input.cadence !== null && input.cadence !== "") {
    if (!["monthly", "quarterly", "annual", "one-off"].includes(String(input.cadence))) {
      return "Pick monthly, quarterly, annual, or one-off for how often it repeats.";
    }
  }
  return null;
}
