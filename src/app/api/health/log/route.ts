import { NextResponse } from "next/server";
import { requirePilot, serverError } from "@/lib/api-auth";

const METRICS = ["weight", "sleep", "water", "exercise"] as const;
type Metric = (typeof METRICS)[number];

/** Sanity bounds per metric (value is in the posted unit). Plain-English rejections. */
const BOUNDS: Record<Metric, { min: number; max: number; what: string }> = {
  weight: { min: 50, max: 1500, what: "weight" },
  sleep: { min: 0, max: 24, what: "sleep hours" },
  water: { min: 0, max: 50, what: "glasses of water" },
  exercise: { min: 0, max: 1440, what: "exercise minutes" },
};

/**
 * POST /api/health/log
 * Body: { metric, value, unit, meta?, logged_at? }
 * Weight upserts same-day (latest wins); others append.
 */
export async function POST(req: Request) {
  const auth = await requirePilot();
  if (auth instanceof NextResponse) return auth;
  const { supabase, user } = auth;

  try {
    const body = await req.json().catch(() => ({}));
    const metric = body.metric as Metric;
    if (!METRICS.includes(metric)) {
      return NextResponse.json(
        { error: "Pick weight, sleep, water, or exercise." },
        { status: 400 },
      );
    }
    const value = Number(body.value);
    if (!Number.isFinite(value)) {
      return NextResponse.json({ error: "Enter a number." }, { status: 400 });
    }
    const bounds = BOUNDS[metric];
    if (value < bounds.min || value > bounds.max) {
      return NextResponse.json(
        { error: `That ${bounds.what} doesn't look right — try again.` },
        { status: 400 },
      );
    }
    const unit = typeof body.unit === "string" && body.unit.trim()
      ? body.unit.trim().slice(0, 12)
      : metric === "weight" ? "lb" : metric === "sleep" ? "h" : metric === "water" ? "glasses" : "min";
    const meta = body.meta && typeof body.meta === "object" ? body.meta : {};
    const loggedAt = body.logged_at ? new Date(body.logged_at) : new Date();
    if (Number.isNaN(loggedAt.getTime())) {
      return NextResponse.json({ error: "That date doesn't look right." }, { status: 400 });
    }

    // Weight: one row per day, latest wins. Others: append.
    if (metric === "weight") {
      const dayStart = new Date(loggedAt);
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart);
      dayEnd.setDate(dayEnd.getDate() + 1);

      const { data: existing } = await supabase
        .from("health_logs")
        .select("id")
        .eq("pilot_id", user.id)
        .eq("metric", "weight")
        .gte("logged_at", dayStart.toISOString())
        .lt("logged_at", dayEnd.toISOString())
        .order("logged_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (existing) {
        const { data, error } = await supabase
          .from("health_logs")
          .update({ value, unit, meta, logged_at: loggedAt.toISOString() })
          .eq("id", existing.id)
          .select("id, metric, value, unit, logged_at")
          .single();
        if (error) throw error;
        return NextResponse.json({ log: data, updated: true });
      }
    }

    const { data, error } = await supabase
      .from("health_logs")
      .insert({
        pilot_id: user.id,
        metric,
        value,
        unit,
        meta,
        logged_at: loggedAt.toISOString(),
        source: "manual",
      })
      .select("id, metric, value, unit, logged_at")
      .single();
    if (error) throw error;

    // The streak trigger maintains health_streaks; read back the new streak.
    const { data: streak } = await supabase
      .from("health_streaks")
      .select("current_streak, best_streak")
      .eq("pilot_id", user.id)
      .eq("metric", metric)
      .maybeSingle();

    return NextResponse.json({ log: data, streak }, { status: 201 });
  } catch {
    return serverError();
  }
}
