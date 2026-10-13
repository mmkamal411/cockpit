import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildContextBundle, type ChatContextBundle } from "@/lib/chat/context";
import { createReplyStream } from "@/lib/chat/sse";

export const dynamic = "force-dynamic";

/**
 * POST /api/chat — Crystal/Fireball chat, server-side.
 * Body: { thread_id?, message, mode? }
 *
 * Assembles the context bundle, calls the crystal worker, persists both
 * messages to the thread, and returns the reply. The browser never calls
 * the worker directly through this path (spec §5).
 */

type Persona = "crystal" | "fireball";

const UNAUTH = { error: "Sign in to chat with Crystal." };

const CRYSTAL_URL = (
  process.env.CRYSTAL_URL ||
  process.env.NEXT_PUBLIC_CRYSTAL_URL ||
  process.env.NEXT_PUBLIC_POOKIE_TUTOR_URL ||
  "https://crystal.mehedikamal.workers.dev"
).replace(/\/$/, "");

const MAX_MESSAGE = 4000;
const WORKER_TIMEOUT_MS = 30000;
const HISTORY_LIMIT = 20;

async function requirePilot() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { supabase, pilotId: user.id };
}

interface ChatBody {
  thread_id?: unknown;
  message?: unknown;
  mode?: unknown;
  stream?: unknown;
}

interface PriorMessage {
  role: string;
  text: string;
}

function cleanMode(value: unknown): Persona {
  return value === "fireball" ? "fireball" : "crystal";
}

/** Today's active thread, or null — one active thread per day (API-enforced). */
async function findTodayThread(
  supabase: Awaited<ReturnType<typeof createClient>>,
  pilotId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("chat_threads")
    .select("id, updated_at")
    .eq("pilot_id", pilotId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);
  return new Date(data.updated_at) >= startOfDay ? (data.id as string) : null;
}

async function createThread(
  supabase: Awaited<ReturnType<typeof createClient>>,
  pilotId: string,
  message: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("chat_threads")
    .insert({ pilot_id: pilotId, title: message.slice(0, 60) || "New conversation" })
    .select("id")
    .single();
  if (error || !data) return null;
  return data.id as string;
}

class WorkerDown extends Error {}

async function callWorker(
  messages: { role: string; text: string }[],
  context: ChatContextBundle,
  mode: Persona,
): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${CRYSTAL_URL}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
      body: JSON.stringify({ messages, context, mode }),
    });
  } catch {
    throw new WorkerDown("worker unreachable");
  }
  if (!res.ok) throw new WorkerDown(`worker ${res.status}`);
  const data = (await res.json().catch(() => null)) as { reply?: unknown } | null;
  const reply =
    data && typeof data.reply === "string" && data.reply.trim() ? data.reply.trim() : "";
  if (!reply) throw new WorkerDown("empty reply");
  return reply;
}

export async function POST(req: Request) {
  const auth = await requirePilot();
  if (!auth) return NextResponse.json(UNAUTH, { status: 401 });

  let body: ChatBody | null = null;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    body = null;
  }
  const message =
    typeof body?.message === "string" ? body.message.trim().slice(0, MAX_MESSAGE) : "";
  if (!message) {
    return NextResponse.json(
      { error: "Type a message first — I can't read minds yet." },
      { status: 400 },
    );
  }
  const mode = cleanMode(body?.mode);
  const { supabase, pilotId } = auth;

  try {
    // 1. Resolve the thread (RLS keeps every query pilot-scoped).
    let threadId = typeof body?.thread_id === "string" ? body.thread_id : null;
    if (threadId) {
      const { data } = await supabase
        .from("chat_threads")
        .select("id")
        .eq("id", threadId)
        .eq("pilot_id", pilotId)
        .maybeSingle();
      if (!data) {
        return NextResponse.json(
          { error: "That conversation isn't on this account." },
          { status: 404 },
        );
      }
    } else {
      threadId =
        (await findTodayThread(supabase, pilotId)) ??
        (await createThread(supabase, pilotId, message));
      if (!threadId) {
        return NextResponse.json(
          { error: "Couldn't open a conversation. Try again in a moment." },
          { status: 500 },
        );
      }
    }

    // 2. Worker history: the last messages of this thread, role/text only.
    const { data: prior } = await supabase
      .from("chat_messages")
      .select("role, text")
      .eq("thread_id", threadId)
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT);
    const history = ((prior ?? []) as PriorMessage[])
      .reverse()
      .map((m) => ({ role: m.role, text: m.text }));

    // 3. Persist the pilot's message.
    const { error: userErr } = await supabase
      .from("chat_messages")
      .insert({ thread_id: threadId, role: "user", text: message });
    if (userErr) throw userErr;

    // 4. Context bundle + worker call.
    const context = await buildContextBundle(supabase, pilotId);
    const reply = await callWorker(
      [...history, { role: "user", text: message }],
      context,
      mode,
    );

    // 5. Persist the reply + touch the thread BEFORE responding, so the
    //    thread is complete even if the client disconnects mid-stream.
    try {
      await supabase
        .from("chat_messages")
        .insert({ thread_id: threadId, role: "assistant", text: reply, persona: mode });
      await supabase
        .from("chat_threads")
        .update({ updated_at: new Date().toISOString() })
        .eq("id", threadId);
    } catch {
      /* persistence is best-effort; the reply below still goes out */
    }

    // 6. Streaming clients get SSE (spec §3); everyone else gets JSON.
    const wantStream =
      body?.stream === true ||
      (req.headers.get("accept") || "").includes("text/event-stream");
    if (wantStream) {
      return new Response(createReplyStream(reply, { thread_id: threadId, mode }), {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }
    return NextResponse.json({ reply, thread_id: threadId, mode });
  } catch (err) {
    if (err instanceof WorkerDown) {
      return NextResponse.json(
        {
          error:
            "I went quiet for a moment — check your connection and try again. I'm still here.",
        },
        { status: 502 },
      );
    }
    return NextResponse.json(
      { error: "Something hiccuped on my end. Try again in a moment." },
      { status: 500 },
    );
  }
}
