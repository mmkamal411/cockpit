import { NextResponse } from "next/server";
import { requirePilot, serverError } from "@/lib/api-auth";

/**
 * GET /api/health/streaks
 * Current and best streaks per metric. Maintained by the DB trigger.
 */
export async function GET() {
  const auth = await requirePilot();
  if (auth instanceof NextResponse) return auth;
  const { supabase } = auth;

  try {
    const { data, error } = await supabase
      .from("health_streaks")
      .select("metric, current_streak, best_streak, last_logged_date");
    if (error) throw error;
    return NextResponse.json({ streaks: data ?? [] });
  } catch {
    return serverError();
  }
}
