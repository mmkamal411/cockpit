import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** POST /api/chat/mode — persist the pilot's preferred mode. Body: { mode } */

const UNAUTH = { error: "Sign in to save your mode preference." };

async function requirePilot() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { supabase, pilotId: user.id };
}

export async function POST(req: Request) {
  const auth = await requirePilot();
  if (!auth) return NextResponse.json(UNAUTH, { status: 401 });
  let mode = "crystal";
  try {
    const body = (await req.json()) as { mode?: unknown };
    mode = body?.mode === "fireball" ? "fireball" : "crystal";
  } catch {
    /* default: crystal */
  }
  try {
    const { error } = await auth.supabase
      .from("pilots")
      .update({ default_mode: mode })
      .eq("id", auth.pilotId);
    if (error) throw error;
    return NextResponse.json({ ok: true, mode });
  } catch {
    return NextResponse.json(
      { error: "Your mode preference isn't ready yet — chat still works." },
      { status: 503 },
    );
  }
}
