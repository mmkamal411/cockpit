import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** POST /api/chat/threads/[id]/pin — pin or unpin a thread. Body: { pinned } */

const UNAUTH = { error: "Sign in to pin conversations." };

async function requirePilot() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { supabase, pilotId: user.id };
}

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function POST(req: Request, { params }: RouteParams) {
  const auth = await requirePilot();
  if (!auth) return NextResponse.json(UNAUTH, { status: 401 });
  const { id } = await params;
  let pinned = true;
  try {
    const body = (await req.json()) as { pinned?: unknown };
    pinned = body?.pinned !== false;
  } catch {
    /* default: pin */
  }
  try {
    const { data, error } = await auth.supabase
      .from("chat_threads")
      .update({ pinned, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("pilot_id", auth.pilotId)
      .select("id, pinned")
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      return NextResponse.json(
        { error: "That conversation isn't on this account." },
        { status: 404 },
      );
    }
    return NextResponse.json({ ok: true, pinned: data.pinned });
  } catch {
    return NextResponse.json(
      { error: "Couldn't pin that conversation. Try again in a moment." },
      { status: 500 },
    );
  }
}
