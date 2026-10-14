import { NextResponse } from "next/server";
import { requirePilot, serverError } from "@/lib/api-auth";

const METRICS = ["weight", "sleep", "water", "exercise", "steps"];

/**
 * GET /api/health/goals — the pilot's active goals per metric.
 */
export async function GET() {
  const auth = await requirePilot();
  if (auth instanceof NextResponse) return auth;
  const { supabase } = auth;

  try {
    const { data, error } = await supabase
      .from("health_goals")
      .select("metric, target_value, unit")
      .eq("active", true);
    if (error) throw error;
    return NextResponse.json({ goals: data ?? [] });
  } catch {
    return serverError();
  }
}

/**
 * PUT /api/health/goals
 * Body: { metric, target_value, unit }. Upserts one active goal per metric.
 */
export async function PUT(req: Request) {
  const auth = await requirePilot();
  if (auth instanceof NextResponse) return auth;
  const { supabase, user } = auth;

  try {
    const body = await req.json().catch(() => ({}));
    const metric = body.metric;
    if (!METRICS.includes(metric)) {
      return NextResponse.json(
        { error: "Pick weight, sleep, water, exercise, or steps." },
        { status: 400 },
      );
    }
    const target = Number(body.target_value);
    if (!Number.isFinite(target) || target <= 0) {
      return NextResponse.json({ error: "Enter a goal number." }, { status: 400 });
    }
    const unit = typeof body.unit === "string" && body.unit.trim()
      ? body.unit.trim().slice(0, 12)
      : metric === "steps" ? "steps"
      : "lb";

    const { data, error } = await supabase
      .from("health_goals")
      .upsert(
        { pilot_id: user.id, metric, target_value: target, unit, active: true },
        { onConflict: "pilot_id,metric" },
      )
      .select("metric, target_value, unit")
      .single();
    if (error) throw error;
    return NextResponse.json({ goal: data });
  } catch {
    return serverError();
  }
}
