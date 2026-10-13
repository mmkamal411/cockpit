import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { askCrystal, WorkerDown } from "@/lib/chat/worker-call";

export const dynamic = "force-dynamic";

/**
 * POST /api/todos/breakdown — Crystal task breakdown.
 * Body: { todoId }
 *
 * "Plan the science fair" → Crystal proposes dated sub-tasks. The reply is
 * parsed as JSON [{ text, dueAt? }]; anything unparseable is a plain-English
 * error, never a silent empty list. The caller creates the sub-tasks.
 */

const UNAUTH = { error: "Sign in to use Crystal." };

interface BreakdownBody {
  todoId?: unknown;
}

interface Subtask {
  text: string;
  dueAt?: number | null;
}

/** Extract the first JSON array from Crystal's reply (tolerates prose around it). */
function parseSubtasks(reply: string): Subtask[] | null {
  const start = reply.indexOf("[");
  const end = reply.lastIndexOf("]");
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const out: Subtask[] = [];
  for (const raw of parsed.slice(0, 12)) {
    if (typeof raw === "string" && raw.trim()) {
      out.push({ text: raw.trim().slice(0, 500), dueAt: null });
      continue;
    }
    if (raw && typeof raw === "object") {
      const r = raw as { text?: unknown; dueAt?: unknown; due?: unknown };
      if (typeof r.text === "string" && r.text.trim()) {
        let dueAt: number | null = null;
        const dueRaw = r.dueAt ?? r.due;
        if (typeof dueRaw === "number" && Number.isFinite(dueRaw)) dueAt = dueRaw;
        else if (typeof dueRaw === "string" && dueRaw) {
          const ms = Date.parse(dueRaw);
          if (!Number.isNaN(ms)) dueAt = ms;
        }
        out.push({ text: r.text.trim().slice(0, 500), dueAt });
      }
    }
  }
  return out.length > 0 ? out : null;
}

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json(UNAUTH, { status: 401 });

  try {
    const body = (await req.json().catch(() => ({}))) as BreakdownBody;
    const todoId = typeof body.todoId === "string" ? body.todoId : "";
    if (!todoId) {
      return NextResponse.json({ error: "Pick a to-do to break down first." }, { status: 400 });
    }

    // The todo must be visible to this pilot (RLS: own or shared).
    const { data: todo } = await supabase
      .from("todos")
      .select("id, title, due_at, notes")
      .eq("id", todoId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!todo) {
      return NextResponse.json(
        { error: "That to-do is gone — it may have been deleted." },
        { status: 404 },
      );
    }
    const t = todo as { title: string; due_at: string | null; notes: string | null };

    const { data: pilot } = await supabase
      .from("pilots")
      .select("timezone")
      .eq("id", user.id)
      .maybeSingle();
    const timezone = (pilot as { timezone?: string | null } | null)?.timezone ?? null;

    const dueLine = t.due_at
      ? `It's due ${new Date(t.due_at).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}.`
      : "It has no due date yet.";
    const notesLine = t.notes ? ` Extra context: ${t.notes.slice(0, 500)}` : "";

    const prompt =
      `Break this to-do into small, concrete sub-tasks: "${t.title}". ${dueLine}${notesLine}\n` +
      `Reply with ONLY a JSON array, no other text. Each item: {"text": "sub-task", "dueAt": "YYYY-MM-DD" or null}. ` +
      `Keep it to 3-7 sub-tasks, ordered sensibly, dates on or before the due date when there is one. ` +
      `Shame-free, plain language — these are next steps, not judgments.`;

    let reply: string;
    try {
      reply = await askCrystal(prompt, timezone);
    } catch (e) {
      if (e instanceof WorkerDown) {
        return NextResponse.json(
          { error: "Crystal couldn't reach the breakdown service. Try again in a moment." },
          { status: 502 },
        );
      }
      throw e;
    }

    const subtasks = parseSubtasks(reply);
    if (!subtasks) {
      return NextResponse.json(
        { error: "Crystal's answer didn't come back clearly. Try again — sometimes rewording helps." },
        { status: 502 },
      );
    }

    return NextResponse.json({ subtasks });
  } catch {
    return NextResponse.json(
      { error: "Couldn't break that down right now. Try again in a moment." },
      { status: 500 },
    );
  }
}
