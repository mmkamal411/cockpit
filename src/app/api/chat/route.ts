import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensurePilot } from "@/lib/auth/ensure-pilot";
import { buildContextBundle } from "@/lib/chat/context";
import {
  ContractViolationError,
  toWireRequest,
  toWireResponse,
  type Persona,
  type WorkerChatRequest,
  type WorkerChatResponse,
} from "@/lib/chat/contract";
import { createReplyStream } from "@/lib/chat/sse";

export const dynamic = "force-dynamic";

/**
 * POST /api/chat — Crystal/Fireball chat, server-side.
 * Body: { thread_id?, message, mode? }
 *
 * Assembles the context bundle, calls the crystal worker, persists both
 * messages to the thread, and returns the reply. The browser never calls
 * the worker directly (spec §5).
 *
 * Worker auth (Phase 0): the worker requires a shared secret on every
 * request. This route attaches `Authorization: Bearer <CRYSTAL_WORKER_SECRET>`
 * from the server-side env. The secret is NEVER exposed to the browser.
 */

const UNAUTH = { error: "Sign in to chat with Crystal." };

const CRYSTAL_URL = (
  process.env.CRYSTAL_URL ||
  process.env.NEXT_PUBLIC_CRYSTAL_URL ||
  process.env.NEXT_PUBLIC_POOKIE_TUTOR_URL ||
  "https://crystal.mehedikamal.workers.dev"
).replace(/\/$/, "");

/** Shared secret for the crystal worker (server-side only — never NEXT_PUBLIC). */
const CRYSTAL_SECRET = process.env.CRYSTAL_WORKER_SECRET ?? "";

const MAX_MESSAGE = 4000;
const WORKER_TIMEOUT_MS = 30000;
const HISTORY_LIMIT = 20;

async function requirePilot() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { supabase, pilotId: user.id, email: user.email ?? null };
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

/** The worker denied the request (bad/missing shared secret) — a setup
 *  problem, not a chat problem. Surfaced to the pilot in plain English. */
class WorkerMisconfigured extends WorkerDown {}

/** Structured server-side log for contract violations — internals never reach the pilot. */
function logContractViolation(where: "outbound" | "inbound", err: ContractViolationError) {
  console.error(
    JSON.stringify({
      level: "error",
      event: "chat_contract_violation",
      route: "POST /api/chat",
      where,
      detail: err.message,
      details: err.details,
      at: new Date().toISOString(),
    }),
  );
}

async function callWorker(body: WorkerChatRequest): Promise<WorkerChatResponse> {
  if (!CRYSTAL_SECRET) {
    // Fail closed: never call the worker without the secret.
    throw new WorkerMisconfigured("CRYSTAL_WORKER_SECRET is not set");
  }
  const workerUrl = `${CRYSTAL_URL}/chat`;
  let res: Response;
  try {
    res = await fetch(workerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CRYSTAL_SECRET}`,
      },
      signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
      body: JSON.stringify(body),
    });
  } catch (err) {
    // The worker never answered: network error or the 30s timeout fired.
    console.error(
      JSON.stringify({
        level: "error",
        event: "chat_worker_unreachable",
        route: "POST /api/chat",
        url: workerUrl,
        timeout_ms: WORKER_TIMEOUT_MS,
        reason: err instanceof Error ? err.name : typeof err,
        detail: err instanceof Error ? err.message.slice(0, 200) : null,
        at: new Date().toISOString(),
      }),
    );
    throw new WorkerDown("worker unreachable");
  }
  if (res.status === 401) {
    throw new WorkerMisconfigured("worker rejected the shared secret (401)");
  }
  if (!res.ok) {
    // The worker answered with an error (e.g. 502 {error:"ai_error"} from
    // the Workers AI call). Keep the worker's own detail for diagnosis.
    let workerDetail: string | null = null;
    try {
      const errBody = (await res.json()) as { error?: unknown; detail?: unknown };
      const detail =
        typeof errBody?.detail === "string"
          ? errBody.detail
          : typeof errBody?.error === "string"
            ? errBody.error
            : null;
      workerDetail = detail?.slice(0, 300) ?? null;
    } catch {
      workerDetail = null;
    }
    console.error(
      JSON.stringify({
        level: "error",
        event: "chat_worker_error",
        route: "POST /api/chat",
        url: workerUrl,
        status: res.status,
        worker_detail: workerDetail,
        at: new Date().toISOString(),
      }),
    );
    throw new WorkerDown(`worker ${res.status}`);
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  // Throws ContractViolationError on a malformed worker envelope (loud,
  // never silently treated as a valid reply).
  try {
    return toWireResponse(data, body.mode);
  } catch (err) {
    if (err instanceof ContractViolationError) logContractViolation("inbound", err);
    throw err;
  }
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
  const { supabase, pilotId, email } = auth;

  // The pilots row must exist before any pilot_id-keyed insert (FK to
  // pilots(id)). Lazy-provision it here so a missed signup-time upsert
  // degrades to a one-time self-repair instead of a broken chat. LOUD on
  // failure — never a silent 500 loop.
  const ensured = await ensurePilot(supabase, pilotId, email);
  if (!ensured.ok) {
    return NextResponse.json({ error: ensured.message }, { status: 503 });
  }

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

    // 4. Context bundle + worker call. The bundle is validated against the
    //    canonical contract (contract.ts) before anything leaves the app —
    //    a violation throws ContractViolationError LOUDLY instead of sending
    //    malformed or out-of-contract fields to the worker.
    const context = await buildContextBundle(supabase, pilotId);
    const wireRequest = toWireRequest(
      [...history, { role: "user", text: message }],
      context,
      mode,
    );
    const workerRes = await callWorker(wireRequest);
    const reply = workerRes.reply;
    const replyPersona = workerRes.persona;

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
      return new Response(createReplyStream(reply, { thread_id: threadId, mode: replyPersona }), {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }
    return NextResponse.json({ reply, thread_id: threadId, mode: replyPersona });
  } catch (err) {
    if (err instanceof WorkerMisconfigured) {
      return NextResponse.json(
        {
          error:
            "I can't reach my voice service right now — the app setup is missing a key. The team has been notified.",
        },
        { status: 502 },
      );
    }
    if (err instanceof ContractViolationError) {
      logContractViolation("outbound", err);
      return NextResponse.json(
        {
          error:
            "I couldn't put your answer together — something on my end wasn't quite right. Try again in a moment.",
        },
        { status: 502 },
      );
    }
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
