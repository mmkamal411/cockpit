import { NextResponse } from "next/server";
import { pilotRoute, dbErrorMessage, BadRequestError } from "@/lib/api/pilotRoute";
import { effectiveStatus } from "@/lib/bills/logic";

/**
 * GET /api/bills/month?month=YYYY-MM (default: current month)
 *
 * Month-view aggregation: every bill due in the month (by due_date),
 * the month's total vs last month's total, and a plain-English delta.
 *
 * Returns {
 *   month: "2026-10",
 *   bills: [...],            // due in this month, unpaid or paid
 *   total: number,            // sum of amounts due this month
 *   paid_total: number,       // sum already paid this month
 *   last_month_total: number,
 *   delta_vs_last_month: number,
 *   delta_label: "…",         // e.g. "$142 more than September"
 * }.
 */
export const GET = pilotRoute(async ({ supabase, pilotId }, req) => {
  const monthParam = req.nextUrl.searchParams.get("month");
  const now = new Date();
  const monthStr =
    monthParam && /^\d{4}-\d{2}$/.test(monthParam)
      ? monthParam
      : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthStr)) {
    throw new BadRequestError("Pick a month like 2026-10.");
  }

  const [y, m] = monthStr.split("-").map(Number);
  const firstDay = `${monthStr}-01`;
  const lastDayDate = new Date(y, m, 0);
  const lastDay = `${monthStr}-${String(lastDayDate.getDate()).padStart(2, "0")}`;

  const prevDate = new Date(y, m - 2, 1);
  const prevStr = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, "0")}`;
  const [py, pm] = prevStr.split("-").map(Number);
  const prevLast = new Date(py, pm, 0).getDate();
  const prevFirst = `${prevStr}-01`;
  const prevLastStr = `${prevStr}-${String(prevLast).padStart(2, "0")}`;

  const { data, error } = await supabase
    .from("bills")
    .select("*")
    .eq("pilot_id", pilotId)
    .is("deleted_at", null)
    .not("due_date", "is", null)
    .gte("due_date", prevFirst)
    .lte("due_date", lastDay)
    .order("due_date", { ascending: true });

  if (error) {
    const { message, status } = dbErrorMessage(error);
    return NextResponse.json({ error: message }, { status });
  }

  const rows = (data ?? []).map((b) => ({ ...b, effective_status: effectiveStatus(b) }));
  const inMonth = rows.filter((b) => b.due_date! >= firstDay && b.due_date! <= lastDay);
  const inPrev = rows.filter((b) => b.due_date! >= prevFirst && b.due_date! <= prevLastStr);

  const sum = (list: typeof rows) =>
    Math.round(list.reduce((t, b) => t + Number(b.amount ?? 0), 0) * 100) / 100;

  const total = sum(inMonth);
  const paidTotal = sum(inMonth.filter((b) => b.effective_status === "paid"));
  const lastMonthTotal = sum(inPrev);
  const delta = Math.round((total - lastMonthTotal) * 100) / 100;

  const prevName = prevDate.toLocaleDateString(undefined, { month: "long" });
  const fmt = (n: number) =>
    "$" + Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const deltaLabel =
    delta === 0
      ? `Same as ${prevName}`
      : delta > 0
        ? `${fmt(delta)} more than ${prevName}`
        : `${fmt(delta)} less than ${prevName}`;

  return NextResponse.json({
    month: monthStr,
    bills: inMonth,
    total,
    paid_total: paidTotal,
    last_month_total: lastMonthTotal,
    delta_vs_last_month: delta,
    delta_label: deltaLabel,
  });
});
