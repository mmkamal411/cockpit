import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * GET    /api/chat/threads/[id] — the thread plus its messages (oldest first).
 * DELETE /api/chat/threads/[id] — delete the thread (messages cascade).
 */

const UNAUTH = { error: "Sign in to see your conversations." };

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

export async function GET(_req: Request, { params }: RouteParams) {
  const auth = await requirePilot();
  if (!auth) return NextResponse.json(UNAUTH, { status: 401 });
  const { id } = await params;
  try {
    const { data: thread, error: threadErr } = await auth.supabase
      .from("chat_threads")
      .select("id, title, pinned, created_at, updated_at")
      .eq("id", id)
      .eq("pilot_id", auth.pilotId)
      .maybeSingle();
    if (threadErr) throw threadErr;
    if (!thread) {
      return NextResponse.json(
        { error: "That conversation isn't on this account." },
        { status: 404 },
      );
    }
    const { data: messages, error: msgErr } = await auth.supabase
      .from("chat_messages")
      .select("id, role, text, persona, created_at")
      .eq("thread_id", id)
      .order("created_at", { ascending: true })
      .limit(200);
    if (msgErr) throw msgErr;
    return NextResponse.json({ thread, messages: messages ?? [] });
  } catch {
    return NextResponse.json(
      { error: "Couldn't load that conversation. Try again in a moment." },
      { status: 500 },
    );
  }
}

export async function DELETE(_req: Request, { params }: RouteParams) {
  const auth = await requirePilot();
  if (!auth) return NextResponse.json(UNAUTH, { status: 401 });
  const { id } = await params;
  try {
    const { error } = await auth.supabase
      .from("chat_threads")
      .delete()
      .eq("id", id)
      .eq("pilot_id", auth.pilotId);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Couldn't delete that conversation. Try again in a moment." },
      { status: 500 },
    );
  }
}
