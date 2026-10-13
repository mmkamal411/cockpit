import { NextResponse } from "next/server";
import { requirePilot, serverError } from "@/lib/api-auth";

const METRICS = ["weight", "sleep", "water", "exercise", "blood_glucose", "a1c_lab"];

/**
 * GET /api/health/logs?metric=weight&from=2026-09-13&to=2026-10-13&limit=100
 * The pilot's log entries, newest first.
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
    const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "100", 10) || 100, 1), 500);

    let query = supabase
      .from("health_logs")
      .select("id, metric, value, unit, meta, logged_at")
      .order("logged_at", { ascending: false })
      .limit(limit);

    if (metric && METRICS.includes(metric)) {
      query = query.eq("metric", metric);
    }
    if (from) {
      query = query.gte("logged_at", new Date(from).toISOString());
    }
    if (to) {
      const end = new Date(to);
      end.setDate(end.getDate() + 1);
      query = query.lt("logged_at", end.toISOString());
    }

    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ logs: data ?? [] });
  } catch {
    return serverError();
  }
}
