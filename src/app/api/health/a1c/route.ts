import { NextResponse } from "next/server";
import { requirePilot, serverError } from "@/lib/api-auth";
import {
  A1C_MIN_DAYS,
  A1C_WINDOW_DAYS,
  summarizeGlucose,
} from "@/lib/health/glucose";

/**
 * GET /api/health/a1c
 * Estimated A1C from recent glucose readings + the pilot's lab A1C history.
 * The estimate is ALWAYS labeled "estimated" — it is not a lab result.
 */
export async function GET() {
  const auth = await requirePilot();
  if (auth instanceof NextResponse) return auth;
  const { supabase } = auth;

  try {
    const start = new Date();
    start.setDate(start.getDate() - A1C_WINDOW_DAYS);

    const { data: glucose, error: gErr } = await supabase
      .from("health_logs")
      .select("value, logged_at")
      .eq("metric", "blood_glucose")
      .gte("logged_at", start.toISOString())
      .order("logged_at", { ascending: true });
    if (gErr) throw gErr;

    const { data: labs, error: lErr } = await supabase
      .from("health_logs")
      .select("id, value, logged_at, meta")
      .eq("metric", "a1c_lab")
      .order("logged_at", { ascending: false })
      .limit(10);
    if (lErr) throw lErr;

    // Distinct local days with at least one reading — shared pure logic.
    const summary = summarizeGlucose(
      (glucose ?? []).map((r) => ({ value: Number(r.value), logged_at: r.logged_at })),
      (iso) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" }),
    );

    return NextResponse.json({
      estimated_a1c: summary.estimated_a1c,
      enough_data: summary.enough_data,
      min_days: A1C_MIN_DAYS,
      estimated_from:
        summary.avg_glucose_mg_dl !== null
          ? {
              avg_glucose_mg_dl: summary.avg_glucose_mg_dl,
              days_of_data: summary.days_of_data,
              readings_count: summary.readings_count,
              window_days: A1C_WINDOW_DAYS,
            }
          : null,
      lab_results: (labs ?? []).map((l) => ({
        id: l.id,
        value: Number(l.value),
        logged_at: l.logged_at,
        lab_name:
          l.meta && typeof l.meta === "object" && typeof (l.meta as Record<string, unknown>).lab_name === "string"
            ? ((l.meta as Record<string, unknown>).lab_name as string)
            : null,
      })),
    });
  } catch {
    return serverError();
  }
}
