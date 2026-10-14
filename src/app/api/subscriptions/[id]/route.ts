import { NextRequest, NextResponse } from "next/server";
import { pilotRoute, dbErrorMessage, BadRequestError, NotFoundError } from "@/lib/api/pilotRoute";
import { validateSubscriptionInput } from "../route";

/**
 * PUT /api/subscriptions/[id]
 * Body: any of { name, amount, cadence, next_renewal, category, status, notes }.
 * Only the pilot's own, non-deleted row can be changed.
 * Returns { subscription }.
 */
export const PUT = pilotRoute(async ({ supabase, pilotId }, req: NextRequest, { params }) => {
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    throw new BadRequestError("That request didn't come through. Try again.");
  }

  const problem = validateSubscriptionInput(body, { nameRequired: false });
  if (problem) throw new BadRequestError(problem);

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = String(body.name).trim();
  if (body.amount !== undefined)
    patch.amount = body.amount === null || body.amount === "" ? null : Number(body.amount);
  if (body.cadence !== undefined)
    patch.cadence = typeof body.cadence === "string" && body.cadence ? body.cadence : null;
  if (body.next_renewal !== undefined)
    patch.next_renewal =
      typeof body.next_renewal === "string" && body.next_renewal ? body.next_renewal : null;
  if (body.category !== undefined)
    patch.category = typeof body.category === "string" && body.category ? body.category : null;
  if (body.status !== undefined)
    patch.status = typeof body.status === "string" && body.status ? body.status : null;
  if (body.notes !== undefined)
    patch.notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim() : null;

  if (Object.keys(patch).length === 0) {
    throw new BadRequestError("Nothing to change.");
  }

  const { data, error } = await supabase
    .from("subscriptions")
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
  if (!data) throw new NotFoundError("That subscription isn't here anymore.");
  return NextResponse.json({ subscription: data });
});

/**
 * DELETE /api/subscriptions/[id]
 * Soft delete — the row stays for the audit trail.
 * Returns { ok: true }.
 */
export const DELETE = pilotRoute(async ({ supabase, pilotId }, _req: NextRequest, { params }) => {
  const { id } = await params;

  const { data, error } = await supabase
    .from("subscriptions")
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
  if (!data) throw new NotFoundError("That subscription isn't here anymore.");
  return NextResponse.json({ ok: true });
});
