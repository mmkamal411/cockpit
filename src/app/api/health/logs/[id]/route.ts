import { NextResponse } from "next/server";
import { requirePilot, serverError } from "@/lib/api-auth";

interface RouteParams {
  params: Promise<{ id: string }>;
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
