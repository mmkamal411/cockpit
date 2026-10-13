import { NextResponse } from "next/server";
import { requirePilot, serverError } from "@/lib/api-auth";

const METRICS = ["weight", "sleep", "water", "exercise", "blood_glucose", "a1c_lab", "steps"];

const NY_TZ = "America/New_York";

/** UTC instant of a wall-clock time in the given zone (handles DST). */
function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(guess));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return new Date(guess - (asUtc - guess));
}

/**
 * GET /api/health/logs?metric=weight&from=2026-09-13&to=2026-10-13&limit=100
 * The pilot's log entries, newest first.
 *
 * GET /api/health/logs?today_only=true[&metric=steps]
 * Today's entries (America/New_York) plus today_total — the sum of today's
 * step counts. The step total is what the frontend shows prominently.
 */
export async function GET(req: Request) {
  const auth = await requirePilot();
  if (auth instanceof NextResponse) return auth;
  const { supabase } = auth;

  try {
    const { searchParams } = new URL(req.url);
    const metric = searchParams.get("metric");
    const from = searchParams.get("from");
    const to = searchParams.get("to");
    const todayOnly = searchParams.get("today_only") === "true";
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "100", 10) || 100, 1), 500);

    let query = supabase
      .from("health_logs")
      .select("id, metric, value, unit, meta, logged_at")
      .order("logged_at", { ascending: false })
      .limit(limit);

    if (metric && METRICS.includes(metric)) {
      query = query.eq("metric", metric);
    }
    if (todayOnly) {
      // Today's boundaries in the pilot's local day (America/New_York).
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: NY_TZ,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(new Date());
      const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
      const dayStart = zonedTimeToUtc(get("year"), get("month"), get("day"), 0, 0, NY_TZ);
      const dayEnd = new Date(dayStart);
      dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
      query = query.gte("logged_at", dayStart.toISOString()).lt("logged_at", dayEnd.toISOString());
    } else {
      if (from) {
        query = query.gte("logged_at", new Date(from).toISOString());
      }
      if (to) {
        const end = new Date(to);
        end.setDate(end.getDate() + 1);
        query = query.lt("logged_at", end.toISOString());
      }
    }

    const { data, error } = await query;
    if (error) throw error;
    const logs = data ?? [];
    if (!todayOnly) {
      return NextResponse.json({ logs });
    }
    // Today only: the frontend shows today's step sum prominently.
    const todayTotal = logs
      .filter((l) => l.metric === "steps")
      .reduce((sum, l) => sum + Number(l.value), 0);
    return NextResponse.json({ logs, today_total: Math.round(todayTotal * 100) / 100 });
  } catch {
    return serverError();
  }
}
