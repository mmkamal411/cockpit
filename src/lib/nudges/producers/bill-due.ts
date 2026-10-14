/**
 * bill-due producer — "Electric bill $142 due today".
 *
 * Reads the pilot's live bills (unpaid, not deleted, not snoozed past now,
 * with a due date) and emits one candidate per bill due within the next
 * three days or already overdue. Stable dedup key `bill:<bill_id>:<due_date>`
 * — the engine dedupes the re-run, and the key rolls naturally when the
 * next occurrence lands (recurring bills spawn a new row at mark-paid).
 *
 * Contract (PRODUCERS.md): category "bill", source "bills", honest deadline
 * (end of the due day — past-due bills score the 1.5× multiplier
 * automatically), tier normal. Snoozed bills are respected (skipped until
 * the snooze lifts). Dateless bills have no urgency signal → skipped.
 */
import type { NudgeCandidate } from "../engine";
import { newResult, tally, errMsg, type Producer, type ProducerResult } from "./types";

/** Bills due within this many days (or overdue) get a nudge. */
export const BILL_LOOKAHEAD_DAYS = 3;

interface BillRow {
  id: string;
  name: string;
  payee: string | null;
  amount: number | string | null;
  due_date: string | null;
  status: string;
  snoozed_until: string | null;
  paid_at: string | null;
}

/** "2026-10-13" in the pilot's timezone — day-boundary math without a tz lib. */
export function pilotLocalDay(d: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

/** Whole days from the pilot's today to the bill's due date (negative = overdue). */
export function daysUntilDue(dueDate: string, now: Date, timezone: string): number {
  const dueDay = pilotLocalDay(new Date(`${dueDate}T12:00:00Z`), timezone);
  const todayDay = pilotLocalDay(now, timezone);
  return Math.round((Date.parse(dueDay) - Date.parse(todayDay)) / 86400000);
}

/** $142 not $142.00; cents always show two digits ($142.50). */
export function formatAmount(amount: number | string | null): string | null {
  if (amount === null || amount === undefined) return null;
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return null;
  const frac = Number.isInteger(n) ? 0 : 2;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: frac, maximumFractionDigits: 2 })}`;
}

export function billDueWords(daysLeft: number): string {
  if (daysLeft < 0) return `overdue by ${-daysLeft} day${-daysLeft === 1 ? "" : "s"}`;
  if (daysLeft === 0) return "due today";
  if (daysLeft === 1) return "due tomorrow";
  return `due in ${daysLeft} days`;
}

function buildCandidate(row: BillRow, daysLeft: number, now: Date, pilotId: string, timezone: string): NudgeCandidate {
  const amount = formatAmount(row.amount);
  const name = row.name || "Bill";
  const title = `${name}${amount ? ` ${amount}` : ""} ${billDueWords(daysLeft)}`.slice(0, 300);
  const dueLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    month: "short",
    day: "numeric",
  }).format(new Date(`${row.due_date}T12:00:00Z`));
  const body = `${row.payee ? `From ${row.payee}. ` : ""}Due ${dueLabel}.`;
  return {
    pilot_id: pilotId,
    category: "bill",
    title,
    body,
    dedup_key: `bill:${row.id}:${row.due_date}`,
    source: "bills",
    source_ref: { bill_id: row.id },
    scheduled_for: now.toISOString(),
    // End of the due day (UTC approximation — the engine only uses this for
    // the urgency bucket; a past-due bill scores 1.5× automatically).
    deadline: `${row.due_date}T23:59:59Z`,
  };
}

export const billDueProducer: Producer = async (ctx): Promise<ProducerResult> => {
  const result = newResult("bill-due");
  const { db, pilot, now, submit } = ctx;
  const cutoff = new Date(now.getTime() + BILL_LOOKAHEAD_DAYS * 86400000);
  const cutoffDate = `${cutoff.getUTCFullYear()}-${String(cutoff.getUTCMonth() + 1).padStart(2, "0")}-${String(
    cutoff.getUTCDate(),
  ).padStart(2, "0")}`;

  let rows: BillRow[];
  try {
    const { data, error } = await db
      .from("bills")
      .select("id,name,payee,amount,due_date,status,snoozed_until,paid_at")
      .eq("pilot_id", pilot.id)
      .is("deleted_at", null)
      .is("paid_at", null)
      .neq("status", "paid")
      .lte("due_date", cutoffDate)
      .order("due_date", { ascending: true });
    if (error) {
      result.errors.push(`Couldn't read your bills this run — trying again next time. (${error.message})`);
      return result;
    }
    rows = (data ?? []) as unknown as BillRow[];
  } catch (e) {
    result.errors.push(`Couldn't read your bills this run — trying again next time. (${errMsg(e)})`);
    return result;
  }

  const timezone = pilot.timezone || "UTC";
  for (const row of rows) {
    // Dateless bills carry no urgency signal — not a nudge.
    if (!row.due_date) {
      result.skipped += 1;
      continue;
    }
    // Respect the snooze: the pilot asked not to be reminded yet.
    if (row.snoozed_until && new Date(row.snoozed_until).getTime() > now.getTime()) {
      result.skipped += 1;
      continue;
    }
    try {
      const outcome = await submit(buildCandidate(row, daysUntilDue(row.due_date, now, timezone), now, pilot.id, timezone));
      tally(result, outcome);
    } catch (e) {
      result.errors.push(`Couldn't create the reminder for "${row.name}" — skipping it this run. (${errMsg(e)})`);
    }
  }
  return result;
};
