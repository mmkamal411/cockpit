import { NextRequest, NextResponse } from "next/server";
import { pilotRoute, dbErrorMessage, BadRequestError, NotFoundError } from "@/lib/api/pilotRoute";
import { validateBillInput, effectiveStatus } from "@/lib/bills/logic";

/**
 * PATCH /api/bills/[id]
 * Body: any of { name, payee, amount, due_date, due_day, cadence, issuer_url, notes }.
 * Returns { bill }.
 */
export const PATCH = pilotRoute(async ({ supabase, pilotId }, req: NextRequest, { params }) => {
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    throw new BadRequestError("That request didn't come through. Try again.");
  }

  const problem = validateBillInput({ ...body, name: body.name ?? "x" });
  // validateBillInput requires a name; for PATCH the name is optional, so
  // only validate it when present.
  if (body.name !== undefined) {
    const nameProblem = validateBillInput({ name: body.name });
    if (nameProblem) throw new BadRequestError(nameProblem);
  } else if (problem && problem !== "Give the bill a name.") {
    throw new BadRequestError(problem);
  }

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = String(body.name).trim();
  if (body.payee !== undefined)
    patch.payee = typeof body.payee === "string" && body.payee.trim() ? body.payee.trim() : null;
  if (body.amount !== undefined)
    patch.amount = body.amount === null || body.amount === "" ? null : Number(body.amount);
  if (body.due_date !== undefined)
    patch.due_date = typeof body.due_date === "string" && body.due_date ? body.due_date : null;
  if (body.due_day !== undefined)
    patch.due_day = body.due_day === null || body.due_day === "" ? null : Number(body.due_day);
  if (body.cadence !== undefined)
    patch.cadence = typeof body.cadence === "string" && body.cadence ? body.cadence : "one-off";
  if (body.issuer_url !== undefined)
    patch.issuer_url =
      typeof body.issuer_url === "string" && body.issuer_url.trim() ? body.issuer_url.trim() : null;
  if (body.notes !== undefined)
    patch.notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;

  if (Object.keys(patch).length === 0) {
    throw new BadRequestError("Nothing to change.");
  }

  const { data, error } = await supabase
    .from("bills")
    .update(patch)
    .eq("id", id)
    .eq("pilot_id", pilotId)
    .is("deleted_at", null)
    .select()
    .single();

  if (error) {
    const { message, status } = dbErrorMessage(error);
    return NextResponse.json({ error: message }, { status });
  }
  if (!data) throw new NotFoundError("That bill isn't here anymore.");
  return NextResponse.json({ bill: { ...data, effective_status: effectiveStatus(data) } });
});

/**
 * DELETE /api/bills/[id]
 * Soft delete — the row stays for the audit trail.
 * Returns { ok: true }.
 */
export const DELETE = pilotRoute(async ({ supabase, pilotId }, _req: NextRequest, { params }) => {
  const { id } = await params;

  const { data, error } = await supabase
    .from("bills")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .eq("pilot_id", pilotId)
    .is("deleted_at", null)
    .select("id")
    .single();

  if (error) {
    const { message, status } = dbErrorMessage(error);
    return NextResponse.json({ error: message }, { status });
  }
  if (!data) throw new NotFoundError("That bill isn't here anymore.");
  return NextResponse.json({ ok: true });
});
