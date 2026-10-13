import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * PATCH /api/calendar/calendars/[id]
 * Body: { visible?: boolean, kind?: "personal"|"work"|"family"|"school" }
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Sign in first." }, { status: 401 });
    }
    const body = await req.json().catch(() => ({}));
    const patch: Record<string, unknown> = {};
    if (typeof body.visible === "boolean") patch.visible = body.visible;
    if (["personal", "work", "family", "school"].includes(body.kind)) patch.kind = body.kind;
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    }
    const { error } = await supabase.from("calendars").update(patch).eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Couldn't update the calendar right now." }, { status: 500 });
  }
}
