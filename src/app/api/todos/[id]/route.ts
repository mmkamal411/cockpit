import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * PUT /api/todos/[id] — update a to-do. Body is a partial:
 *   { text?, dueAt?, done?, priority?, labels?, notes? }
 * DELETE /api/todos/[id] — delete a to-do.
 *
 * RLS guarantees a pilot can only touch their own rows.
 */

const UNAUTH = { error: "Sign in to sync your to-dos." };
const GONE = { error: "That to-do is gone — it may have been deleted on another device." };

type Priority = "low" | "medium" | "high";

interface TodoRow {
  id: string;
  title: string;
  done: boolean;
  created_at: string;
  completed_at: string | null;
  due_at: string | null;
  priority: Priority | null;
  labels: string[] | null;
  notes: string | null;
  source: "manual" | "calendar" | "mail";
}

interface TodoBody {
  text?: unknown;
  dueAt?: unknown;
  done?: unknown;
  priority?: unknown;
  labels?: unknown;
  notes?: unknown;
}

function toItem(row: TodoRow) {
  return {
    id: row.id,
    text: row.title,
    done: row.done,
    createdAt: Date.parse(row.created_at) || Date.now(),
    completedAt: row.completed_at ? Date.parse(row.completed_at) : null,
    dueAt: row.due_at ? Date.parse(row.due_at) : null,
    priority: row.priority,
    labels: row.labels ?? [],
    notes: row.notes,
    source: row.source,
  };
}

async function requirePilot() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { supabase, pilotId: user.id };
}

const COLUMNS = "id,title,done,created_at,completed_at,due_at,priority,labels,notes,source";

/** Build the DB update object from the partial body. Null = clear the field. */
function buildUpdate(body: TodoBody):
  | { ok: true; update: Record<string, unknown> }
  | { ok: false; reason: "empty-text" | "no-fields" } {
  const update: Record<string, unknown> = {};

  if (body.text !== undefined) {
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (text === "") return { ok: false, reason: "empty-text" };
    update.title = text.slice(0, 500);
  }
  if (body.dueAt !== undefined) {
    if (body.dueAt === null) {
      update.due_at = null;
    } else if (typeof body.dueAt === "number" && Number.isFinite(body.dueAt)) {
      const date = new Date(body.dueAt);
      update.due_at = Number.isNaN(date.getTime()) ? null : date.toISOString();
    }
  }
  if (typeof body.done === "boolean") {
    update.done = body.done;
    // Keep a completion timestamp so the Today briefing can fold this todo
    // into "Handled today" instead of every done todo ever.
    update.completed_at = body.done ? new Date().toISOString() : null;
  }
  if (body.priority !== undefined) {
    update.priority =
      body.priority === "low" || body.priority === "medium" || body.priority === "high"
        ? body.priority
        : null;
  }
  if (body.labels !== undefined) {
    update.labels = Array.isArray(body.labels)
      ? body.labels
          .filter((l): l is string => typeof l === "string")
          .map((l) => l.trim())
          .filter(Boolean)
          .slice(0, 20)
      : [];
  }
  if (body.notes !== undefined) {
    if (typeof body.notes !== "string" || body.notes.trim() === "") {
      update.notes = null;
    } else {
      update.notes = body.notes.trim().slice(0, 2000);
    }
  }

  return Object.keys(update).length > 0
    ? { ok: true, update }
    : { ok: false, reason: "no-fields" };
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePilot();
    if (!auth) return NextResponse.json(UNAUTH, { status: 401 });

    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as TodoBody;
    const result = buildUpdate(body);

    if (!result.ok && result.reason === "empty-text") {
      return NextResponse.json({ error: "Give your to-do a few words first." }, { status: 400 });
    }
    if (!result.ok) {
      return NextResponse.json({ error: "Nothing to update — send at least one field." }, { status: 400 });
    }
    const update = result.update;

    const { data, error } = await auth.supabase
      .from("todos")
      .update(update)
      .eq("id", id)
      .eq("pilot_id", auth.pilotId)
      .select(COLUMNS)
      .single();

    if (error) {
      // PGRST116 = no row matched: someone else's id or already deleted.
      if (error.code === "PGRST116") return NextResponse.json(GONE, { status: 404 });
      throw error;
    }
    return NextResponse.json(toItem(data as TodoRow));
  } catch {
    return NextResponse.json(
      { error: "Couldn't update your to-do. Please try again in a moment." },
      { status: 500 },
    );
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePilot();
    if (!auth) return NextResponse.json(UNAUTH, { status: 401 });

    const { id } = await params;
    const { error } = await auth.supabase
      .from("todos")
      .delete()
      .eq("id", id)
      .eq("pilot_id", auth.pilotId)
      .select("id")
      .single();

    if (error) {
      if (error.code === "PGRST116") return NextResponse.json(GONE, { status: 404 });
      throw error;
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Couldn't delete your to-do. Please try again in a moment." },
      { status: 500 },
    );
  }
}
