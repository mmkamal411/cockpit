import { NextRequest, NextResponse } from "next/server";
import { pilotRoute, dbErrorMessage, BadRequestError } from "@/lib/api/pilotRoute";
import { validateBillInput, effectiveStatus } from "@/lib/bills/logic";

/**
 * GET /api/bills
 * Query: status=overdue|due|upcoming|paid (repeatable), window=30d (days ahead),
 *        include_deleted=false.
 * Returns { bills: [...] } with an `effective_status` computed per bill.
 */
export const GET = pilotRoute(async ({ supabase, pilotId }, req) => {
  const searchParams = req.nextUrl.searchParams;
  const statuses = searchParams.getAll("status");
  const windowDays = Math.min(Math.max(Number(searchParams.get("window") ?? "90") || 90, 1), 365);

  let query = supabase
    .from("bills")
    .select("*")
    .eq("pilot_id", pilotId)
    .is("deleted_at", null)
    .order("due_date", { ascending: true, nullsFirst: false });

  const { data, error } = await query;
  if (error) {
    const { message, status } = dbErrorMessage(error);
    return NextResponse.json({ error: message }, { status });
  }

  let bills = (data ?? []).map((b) => ({
    ...b,
    effective_status: effectiveStatus(b),
  }));

  if (statuses.length > 0) {
    const want = new Set(statuses);
    bills = bills.filter((b) => want.has(b.effective_status));
  }

  // Window filter applies to unpaid bills with a due date; paid bills and
  // dateless bills always pass through.
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const todayStr = `${yyyy}-${mm}-${dd}`;
  const cutoff = new Date(today.getTime() + windowDays * 86_400_000);
  const cutoffStr = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, "0")}-${String(cutoff.getDate()).padStart(2, "0")}`;
  bills = bills.filter((b) => {
    if (b.effective_status === "paid" || !b.due_date) return true;
    if (b.effective_status === "overdue") return true; // overdue always shown
    return b.due_date <= cutoffStr && b.due_date >= todayStr;
  });

  return NextResponse.json({ bills });
});

/**
 * POST /api/bills
 * Body: { name, payee?, amount?, due_date?, due_day?, cadence?, issuer_url?, notes? }
 * Returns { bill }.
 */
export const POST = pilotRoute(async ({ supabase, pilotId }, req: NextRequest) => {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    throw new BadRequestError("That request didn't come through. Try again.");
  }

  const problem = validateBillInput(body);
  if (problem) throw new BadRequestError(problem);

  const row = {
    pilot_id: pilotId,
    name: String(body.name).trim(),
    payee: typeof body.payee === "string" && body.payee.trim() ? body.payee.trim() : null,
    amount:
      body.amount === undefined || body.amount === null || body.amount === ""
        ? null
        : Number(body.amount),
    due_date: typeof body.due_date === "string" && body.due_date ? body.due_date : null,
    due_day:
      body.due_day === undefined || body.due_day === null || body.due_day === ""
        ? null
        : Number(body.due_day),
    cadence: typeof body.cadence === "string" && body.cadence ? body.cadence : "one-off",
    issuer_url:
      typeof body.issuer_url === "string" && body.issuer_url.trim() ? body.issuer_url.trim() : null,
    notes: typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null,
    source: "manual",
  };

  const { data, error } = await supabase.from("bills").insert(row).select().single();
  if (error) {
    const { message, status } = dbErrorMessage(error);
    return NextResponse.json({ error: message }, { status });
  }
  return NextResponse.json({ bill: { ...data, effective_status: effectiveStatus(data) } }, { status: 201 });
});
