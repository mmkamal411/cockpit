import { NextResponse } from "next/server";
import { requirePilot, serverError } from "@/lib/api-auth";

const METRICS = ["weight", "sleep", "water", "exercise", "blood_glucose", "a1c_lab"];

/**
 * GET /api/health/trends?metric=sleep&period=30d
 * Daily points, 7-day rolling average, and delta vs the prior period.
 * For blood_glucose, also returns individual readings (with context tags)
 * so the chart can show each reading against the reference bands.
 * For steps, each daily point is the SUM of that day's entries (entries
 * accumulate), not an average.
 * Plain numbers only — no interpretation, no advice.
 */
export async function GET(req: Request) {
  const auth = await requirePilot();
  if (auth instanceof NextResponse) return auth;
  const { supabase } = auth;

  try {
    const { searchParams } = new URL(req.url);
    const metric = searchParams.get("metric");
    if (!metric || !METRICS.includes(metric)) {
      return NextResponse.json(
        { error: "Pick weight, sleep, water, exercise, blood sugar, or lab A1C." },
        { status: 400 },
      );
    }
    const days = searchParams.get("period") === "7d" ? 7 : 30;

    const end = new Date();
    const start = new Date();
    start.setDate(start.getDate() - days);
    const priorStart = new Date();
    priorStart.setDate(priorStart.getDate() - days * 2);

    const { data, error } = await supabase
      .from("health_logs")
      .select("value, unit, meta, logged_at")
      .eq("metric", metric)
      .gte("logged_at", priorStart.toISOString())
      .order("logged_at", { ascending: true });
    if (error) throw error;

    const unit = (data ?? []).length > 0 ? data[data.length - 1].unit : null;

    // Bucket by local date (America/New_York) — one point per day.
    const byDay = new Map<string, number[]>();
    for (const row of data ?? []) {
      const day = new Date(row.logged_at).toLocaleDateString("en-CA", {
        timeZone: "America/New_York",
      });
      const arr = byDay.get(day) ?? [];
      arr.push(Number(row.value));
      byDay.set(day, arr);
    }

    const daily: { date: string; value: number }[] = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
      const vals = byDay.get(key);
      if (vals && vals.length > 0) {
        const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
        daily.push({ date: key, value: Math.round(avg * 100) / 100 });
      } else {
        daily.push({ date: key, value: NaN });
      }
    }

    const present = daily.filter((d) => !Number.isNaN(d.value)).map((d) => d.value);
    const avg = present.length > 0 ? present.reduce((a, b) => a + b, 0) / present.length : null;

    // 7-day rolling average over the daily points.
    const rolling: (number | null)[] = daily.map((_, i) => {
      const window = daily.slice(Math.max(0, i - 6), i + 1).filter((d) => !Number.isNaN(d.value));
      if (window.length === 0) return null;
      return Math.round((window.reduce((a, b) => a + b.value, 0) / window.length) * 100) / 100;
    });

    // Prior-period average for the delta.
    const priorVals: number[] = [];
    for (const [day, vals] of byDay) {
      const d = new Date(day + "T12:00:00");
      if (d >= priorStart && d < start) {
        priorVals.push(...vals);
      }
    }
    const priorAvg = priorVals.length > 0
      ? priorVals.reduce((a, b) => a + b, 0) / priorVals.length
      : null;
    const delta = avg !== null && priorAvg !== null
      ? Math.round((avg - priorAvg) * 100) / 100
      : null;

    return NextResponse.json({
      metric,
      period_days: days,
      daily: daily.map((d, i) => ({
        date: d.date,
        value: Number.isNaN(d.value) ? null : d.value,
        rolling_avg: rolling[i],
      })),
      average: avg === null ? null : Math.round(avg * 100) / 100,
      delta_vs_prior: delta,
      unit,
      // Glucose charts plot every reading (with its context tag) inside
      // the requested window — daily averages hide the pattern.
      readings: metric === "blood_glucose"
        ? (data ?? [])
            .filter((r) => new Date(r.logged_at) >= start)
            .map((r) => ({
              logged_at: r.logged_at,
              value: Number(r.value),
              context:
                r.meta && typeof r.meta === "object" && typeof (r.meta as Record<string, unknown>).context === "string"
                  ? ((r.meta as Record<string, unknown>).context as string)
                  : "other",
            }))
        : undefined,
    });
  } catch {
    return serverError();
  }
}
