import { NextRequest, NextResponse } from "next/server";
import { pilotRoute, dbErrorMessage, BadRequestError, NotFoundError } from "@/lib/api/pilotRoute";
import { effectiveStatus } from "@/lib/bills/logic";

/**
 * POST /api/bills/drafts/[id]/confirm
 *
 * Promotes a detection candidate into a real bill. The draft is marked
 * confirmed (kept for the audit trail); a new bills row is created from
 * the candidate JSON.
 *
 * Returns { bill }.
 */
export const POST = pilotRoute(async ({ supabase, pilotId }, _req: NextRequest, { params }) => {
  const { id } = await params;

  const { data: draft, error: fetchError } = await supabase
    .from("bill_drafts")
    .select("*")
    .eq("id", id)
    .eq("pilot_id", pilotId)
    .eq("state", "pending")
    .single();

  if (fetchError) {
    const { message, status } = dbErrorMessage(fetchError);
    return NextResponse.json({ error: message }, { status });
  }
  if (!draft) throw new NotFoundError("That suggestion isn't waiting anymore.");

  const c = (draft.candidate_json ?? {}) as Record<string, unknown>;
  const name = typeof c.issuer === "string" && c.issuer.trim() ? c.issuer.trim() : "Untitled bill";
  const amount =
    c.amount !== undefined && c.amount !== null && c.amount !== "" ? Number(c.amount) : null;
  if (amount !== null && (!Number.isFinite(amount) || amount < 0)) {
    throw new BadRequestError("That suggestion has a garbled amount — add it manually instead.");
  }
  const dueDate =
    typeof c.due_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(c.due_date) ? c.due_date : null;

  const { data: bill, error: insertError } = await supabase
    .from("bills")
    .insert({
      pilot_id: pilotId,
      name,
      payee: name,
      amount,
      due_date: dueDate,
      source: "email-draft",
    })
    .select()
    .single();

  if (insertError) {
    const { message, status } = dbErrorMessage(insertError);
    return NextResponse.json({ error: message }, { status });
  }

  await supabase
    .from("bill_drafts")
    .update({ state: "confirmed" })
    .eq("id", id)
    .eq("pilot_id", pilotId);

  return NextResponse.json(
    { bill: { ...bill, effective_status: effectiveStatus(bill) } },
    { status: 201 },
  );
});
