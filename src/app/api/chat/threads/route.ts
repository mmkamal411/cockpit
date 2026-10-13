import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * GET  /api/chat/threads     — list the pilot's threads (pinned first, then
 *                              by recency) plus today's active thread id.
 * POST /api/chat/threads     — start a new thread. Body: { title? }
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

interface ThreadRow {
  id: string;
  title: string | null;
  pinned: boolean;
  created_at: string;
  updated_at: string;
}

export async function GET() {
  const auth = await requirePilot();
  if (!auth) return NextResponse.json(UNAUTH, { status: 401 });
  try {
    const { data, error } = await auth.supabase
      .from("chat_threads")
      .select("id, title, pinned, created_at, updated_at")
      .eq("pilot_id", auth.pilotId)
      .order("pinned", { ascending: false })
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) throw error;
    const threads = ((data ?? []) as ThreadRow[]).map((t) => ({
      id: t.id,
      title: t.title ?? "Conversation",
      pinned: t.pinned,
      created_at: t.created_at,
      updated_at: t.updated_at,
    }));
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const today = threads.find((t) => new Date(t.updated_at) >= startOfDay) ?? null;
    return NextResponse.json({ threads, today_id: today?.id ?? null });
  } catch {
    return NextResponse.json(
      { error: "Couldn't load your conversations. Try again in a moment." },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  const auth = await requirePilot();
  if (!auth) return NextResponse.json(UNAUTH, { status: 401 });
  try {
    let title: string | null = null;
    try {
      const body = (await req.json()) as { title?: unknown };
      if (typeof body?.title === "string" && body.title.trim()) {
        title = body.title.trim().slice(0, 80);
      }
    } catch {
      /* no body — fine */
    }
    const { data, error } = await auth.supabase
      .from("chat_threads")
      .insert({ pilot_id: auth.pilotId, title: title ?? "New conversation" })
      .select("id, title, pinned, created_at, updated_at")
      .single();
    if (error) throw error;
    return NextResponse.json({ thread: data });
  } catch {
    return NextResponse.json(
      { error: "Couldn't start a new conversation. Try again in a moment." },
      { status: 500 },
    );
  }
}
