import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensurePilot } from "@/lib/auth/ensure-pilot";

export const dynamic = "force-dynamic";

/** POST /api/chat/mode — persist the pilot's preferred mode. Body: { mode } */

const UNAUTH = { error: "Sign in to save your mode preference." };

async function requirePilot() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { supabase, pilotId: user.id, email: user.email ?? null };
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
    // pilots.default_mode lives on the pilots row — make sure it exists
    // first, otherwise the update below would silently affect zero rows
    // and report success. LOUD on failure.
    const ensured = await ensurePilot(auth.supabase, auth.pilotId, auth.email);
    if (!ensured.ok) {
      return NextResponse.json({ error: ensured.message }, { status: 503 });
    }
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
