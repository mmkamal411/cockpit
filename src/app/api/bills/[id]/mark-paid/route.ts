import { NextRequest, NextResponse } from "next/server";
import { pilotRoute, dbErrorMessage, NotFoundError } from "@/lib/api/pilotRoute";
import { effectiveStatus, nextOccurrenceDate } from "@/lib/bills/logic";

/**
 * POST /api/bills/[id]/mark-paid
 *
 * One-tap paid. Idempotent — tapping twice is a no-op, never a double entry.
 *
 * - Sets status=paid, paid_at=now(), clears any snooze.
 * - Appends a bill_history row for trend comparison.
 * - For recurring bills (cadence != one-off, due_day set), spawns the next
 *   occurrence so the pilot never re-enters a monthly bill.
 *
 * Returns { bill, next_bill? }.
 */
export const POST = pilotRoute(async ({ supabase, pilotId }, _req: NextRequest, { params }) => {
  const { id } = await params;
  const nowIso = new Date().toISOString();

  // Fetch first so we can no-op when already paid (idempotency).
  const { data: existing, error: fetchError } = await supabase
    .from("bills")
    .select("*")
    .eq("id", id)
    .eq("pilot_id", pilotId)
    .is("deleted_at", null)
    .single();

  if (fetchError) {
    const { message, status } = dbErrorMessage(fetchError);
    return NextResponse.json({ error: message }, { status });
  }
  if (!existing) throw new NotFoundError("That bill isn't here anymore.");

  if (existing.paid_at) {
    // Already paid — no-op, return the current state.
    return NextResponse.json({
      bill: { ...existing, effective_status: "paid" as const },
      already_paid: true,
    });
  }

  const today = nowIso.slice(0, 10);
  const wasLate =
    !!existing.due_date && existing.due_date < today;

  const { data: paid, error: updateError } = await supabase
    .from("bills")
    .update({
      status: "paid",
      paid_at: nowIso,
      snoozed_until: null,
      last_amount: existing.amount,
    })
    .eq("id", id)
    .eq("pilot_id", pilotId)
    .select()
    .single();

  if (updateError) {
    const { message, status } = dbErrorMessage(updateError);
    return NextResponse.json({ error: message }, { status });
  }

  // Append-only history for "up 12% vs last quarter" comparisons.
  const { error: historyError } = await supabase.from("bill_history").insert({
    bill_id: id,
    pilot_id: pilotId,
    period: (existing.due_date ?? today).slice(0, 7) + "-01",
    amount: existing.amount,
    paid_at: nowIso,
    paid_late: wasLate,
  });
  if (historyError) {
    // History is nice-to-have; a paid bill must not 500 because the ledger
    // write failed. The bill itself is already marked paid above.
    console.error("bill_history insert failed", historyError.message);
  }

  // Recurring bills spawn their next occurrence immediately.
  let nextBill: Record<string, unknown> | null = null;
  const nextDue = nextOccurrenceDate(existing.cadence, existing.due_day, existing.due_date);
  if (nextDue) {
    const { data: spawned, error: spawnError } = await supabase
      .from("bills")
      .insert({
        pilot_id: pilotId,
        name: existing.name,
        payee: existing.payee,
        amount: existing.amount,
        due_date: nextDue,
        due_day: existing.due_day,
        cadence: existing.cadence,
        issuer_url: existing.issuer_url,
        notes: existing.notes,
        source: existing.source,
        last_amount: existing.amount,
      })
      .select()
      .single();
    if (!spawnError && spawned) {
      nextBill = { ...spawned, effective_status: effectiveStatus(spawned) };
    }
  }

  // Dismissing related nudges happens when the nudge engine lands; the
  // mark-paid action contract (doc 20) is already satisfied by paid_at.

  return NextResponse.json({
    bill: { ...paid, effective_status: "paid" as const },
    ...(nextBill ? { next_bill: nextBill } : {}),
  });
});
