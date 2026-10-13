import { NextResponse } from "next/server";
import { requirePilot, serverError } from "@/lib/api-auth";
import { checkHealthValue, type HealthMetric } from "@/lib/health/log-validation";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PATCH /api/health/logs/[id]
 * Correct a mis-typed entry. Body: any of { value, unit, logged_at, meta }.
 * At least one field is required; a new value is re-checked against the
 * entry's own metric bounds. RLS keeps pilots to their own rows.
 */
export async function PATCH(req: Request, { params }: RouteParams) {
  const auth = await requirePilot();
  if (auth instanceof NextResponse) return auth;
  const { supabase } = auth;
  const { id } = await params;

  try {
    const body = await req.json().catch(() => ({}));
    const patch: Record<string, unknown> = {};

    if (body.value !== undefined) {
      const value = Number(body.value);
      if (!Number.isFinite(value)) {
        return NextResponse.json({ error: "Enter a number." }, { status: 400 });
      }
      patch.value = value;
    }
    if (body.unit !== undefined) {
      if (typeof body.unit !== "string" || !body.unit.trim()) {
        return NextResponse.json({ error: "Enter a unit, like lb or steps." }, { status: 400 });
      }
      patch.unit = body.unit.trim().slice(0, 12);
    }
    if (body.logged_at !== undefined) {
      const loggedAt = new Date(body.logged_at);
      if (Number.isNaN(loggedAt.getTime())) {
        return NextResponse.json({ error: "That date doesn't look right." }, { status: 400 });
      }
      patch.logged_at = loggedAt.toISOString();
    }
    if (body.meta !== undefined) {
      if (!body.meta || typeof body.meta !== "object" || Array.isArray(body.meta)) {
        return NextResponse.json({ error: "Those details don't look right." }, { status: 400 });
      }
      patch.meta = body.meta;
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
    }

    // Read the row first so a corrected value is checked against the
    // entry's own metric bounds — and so a missing row is a clean 404.
    const { data: row, error: readErr } = await supabase
      .from("health_logs")
      .select("id, metric")
      .eq("id", id)
      .maybeSingle();
    if (readErr) throw readErr;
    if (!row) {
      return NextResponse.json({ error: "That entry wasn't found." }, { status: 404 });
    }
    if (patch.value !== undefined) {
      const bad = checkHealthValue(row.metric as HealthMetric, patch.value as number);
      if (bad) return NextResponse.json({ error: bad }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("health_logs")
      .update(patch)
      .eq("id", id)
      .select("id, metric, value, unit, meta, logged_at")
      .single();
    if (error) throw error;
    return NextResponse.json({ log: data });
  } catch {
    return serverError();
  }
}

/**
 * DELETE /api/health/logs/[id]
 * The pilot's data is the pilot's right — delete any entry.
 */
export async function DELETE(_req: Request, { params }: RouteParams) {
  const auth = await requirePilot();
  if (auth instanceof NextResponse) return auth;
  const { supabase } = auth;
  const { id } = await params;

  try {
    const { error, count } = await supabase
      .from("health_logs")
      .delete({ count: "exact" })
      .eq("id", id);
    if (error) throw error;
    if (!count) {
      return NextResponse.json({ error: "That entry wasn't found." }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return serverError();
  }
}
