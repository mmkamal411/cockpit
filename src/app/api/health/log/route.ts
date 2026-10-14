import { NextResponse } from "next/server";
import { requirePilot, serverError } from "@/lib/api-auth";
import {
  HEALTH_DEFAULT_UNIT,
  HEALTH_METRICS,
  checkHealthValue,
  type HealthMetric,
} from "@/lib/health/log-validation";

/** Allowed context tags for a blood glucose reading. */
const GLUCOSE_CONTEXTS = ["fasting", "before_meal", "after_meal", "bedtime", "other"] as const;

/**
 * POST /api/health/log
 * Body: { metric, value, unit, meta?, logged_at? }
 * Weight upserts same-day (latest wins); others append.
 * blood_glucose meta: { context: fasting|before_meal|after_meal|bedtime|other }
 * a1c_lab meta: { lab_name? }
 * steps: append only — multiple entries per day accumulate into the day's total.
 */
export async function POST(req: Request) {
  const auth = await requirePilot();
  if (auth instanceof NextResponse) return auth;
  const { supabase, user } = auth;

  try {
    const body = await req.json().catch(() => ({}));
    const metric = body.metric as HealthMetric;
    if (!HEALTH_METRICS.includes(metric)) {
      return NextResponse.json(
        { error: "Pick weight, sleep, water, exercise, steps, blood sugar, or lab A1C." },
        { status: 400 },
      );
    }
    const value = Number(body.value);
    if (!Number.isFinite(value)) {
      return NextResponse.json({ error: "Enter a number." }, { status: 400 });
    }
    const bad = checkHealthValue(metric, value);
    if (bad) {
      return NextResponse.json({ error: bad }, { status: 400 });
    }
    const unit = typeof body.unit === "string" && body.unit.trim()
      ? body.unit.trim().slice(0, 12)
      : HEALTH_DEFAULT_UNIT[metric];
    const meta = body.meta && typeof body.meta === "object" ? body.meta : {};

    // Blood glucose: validate the context tag.
    if (metric === "blood_glucose") {
      const ctx = typeof meta.context === "string" ? meta.context : "other";
      if (!(GLUCOSE_CONTEXTS as readonly string[]).includes(ctx)) {
        return NextResponse.json(
          { error: "Pick when this reading was taken: fasting, before a meal, after a meal, bedtime, or other." },
          { status: 400 },
        );
      }
      meta.context = ctx;
    }
    // Lab A1C: optional lab name, kept short.
    if (metric === "a1c_lab" && typeof meta.lab_name === "string") {
      meta.lab_name = meta.lab_name.trim().slice(0, 80);
      if (!meta.lab_name) delete meta.lab_name;
    }
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
