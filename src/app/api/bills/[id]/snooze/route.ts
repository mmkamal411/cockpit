import { NextRequest, NextResponse } from "next/server";
import { pilotRoute, dbErrorMessage, BadRequestError, NotFoundError } from "@/lib/api/pilotRoute";
import { effectiveStatus } from "@/lib/bills/logic";

/**
 * POST /api/bills/[id]/snooze
 * Body: { until: ISO timestamp } or { days: number }.
 *
 * Defers reminders without touching the bill itself. The future nudge
 * engine will respect snoozed_until; the applet hides snoozed bills from
 * the "due" section until the snooze lifts.
 *
 * Returns { bill }.
 */
export const POST = pilotRoute(async ({ supabase, pilotId }, req: NextRequest, { params }) => {
  const { id } = await params;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    throw new BadRequestError("That request didn't come through. Try again.");
  }

  let until: Date | null = null;
  if (typeof body.until === "string") {
    const d = new Date(body.until);
    if (Number.isNaN(d.getTime())) throw new BadRequestError("That date didn't make sense.");
    until = d;
  } else if (body.days !== undefined) {
    const days = Number(body.days);
    if (!Number.isFinite(days) || days <= 0 || days > 90) {
      throw new BadRequestError("Snooze for between 1 and 90 days.");
    }
    until = new Date(Date.now() + days * 86_400_000);
  } else {
    // Default: snooze until tomorrow morning.
    until = new Date(Date.now() + 86_400_000);
  }

  if (until.getTime() <= Date.now()) {
    throw new BadRequestError("The snooze has to end in the future.");
  }

  const { data, error } = await supabase
    .from("bills")
    .update({ snoozed_until: until.toISOString() })
    .eq("id", id)
    .eq("pilot_id", pilotId)
    .is("deleted_at", null)
    .is("paid_at", null)
    .select()
    .single();

  if (error) {
    const { message, status } = dbErrorMessage(error);
    return NextResponse.json({ error: message }, { status });
  }
  if (!data) throw new NotFoundError("That bill isn't here anymore, or it's already paid.");
  return NextResponse.json({ bill: { ...data, effective_status: effectiveStatus(data) } });
});
