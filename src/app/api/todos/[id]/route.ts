import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { rowToItem } from "../route";

export const dynamic = "force-dynamic";

/**
 * PUT /api/todos/[id] — update a to-do. Body is a partial:
 *   { text?, dueAt?, done?, priority?, labels?, notes?, listId?,
 *     parentTodoId?, section?, assignedToPilotId?, recurrence?,
 *     reminderAt? }
 * DELETE /api/todos/[id] — soft delete: stamps deleted_at (a tombstone),
 * so shared lists merge deletions instead of resurrecting rows.
 *
 * RLS: the owner has full access; collaborators on a shared list get
 * read ('view') or write ('edit') through todo_list_shares.
 */

const UNAUTH = { error: "Sign in to sync your to-dos." };
const GONE = { error: "That to-do is gone — it may have been deleted on another device." };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Priority = "p1" | "p2" | "p3" | "p4";

interface TodoBody {
  text?: unknown;
  dueAt?: unknown;
  done?: unknown;
  priority?: unknown;
  labels?: unknown;
  notes?: unknown;
  listId?: unknown;
  parentTodoId?: unknown;
  section?: unknown;
  assignedToPilotId?: unknown;
  recurrence?: unknown;
  reminderAt?: unknown;
}

const COLUMNS =
  "id,pilot_id,title,done,created_at,completed_at,updated_at,deleted_at,due_at," +
  "priority,labels,notes,source,list_id,parent_todo_id,section,assigned_to_pilot_id," +
  "recurrence,reminder_at,google_task_id,google_tasklist_id";

async function requirePilot() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { supabase, pilotId: user.id };
}

function cleanPriority(value: unknown): Priority | null {
  if (value === "p1" || value === "p2" || value === "p3" || value === "p4") return value;
  if (value === "high") return "p1";
  if (value === "medium") return "p2";
  if (value === "low") return "p3";
  return null;
}

function cleanEpochMs(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function cleanUuidOrNull(value: unknown): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return typeof value === "string" && UUID_RE.test(value) ? value : undefined;
}

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
    update.due_at = cleanEpochMs(body.dueAt);
  }
  if (typeof body.done === "boolean") {
    update.done = body.done;
    update.completed_at = body.done ? new Date().toISOString() : null;
  }
  if (body.priority !== undefined) {
    update.priority = cleanPriority(body.priority);
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
    update.notes =
      typeof body.notes === "string" && body.notes.trim() !== ""
        ? body.notes.trim().slice(0, 2000)
        : null;
  }
  if (body.listId !== undefined) {
    const listId = cleanUuidOrNull(body.listId);
    if (listId !== undefined) update.list_id = listId;
  }
  if (body.parentTodoId !== undefined) {
    const parentId = cleanUuidOrNull(body.parentTodoId);
    if (parentId !== undefined) update.parent_todo_id = parentId;
  }
  if (body.section !== undefined) {
    update.section =
      typeof body.section === "string" && body.section.trim() !== ""
        ? body.section.trim().slice(0, 80)
        : null;
  }
  if (body.assignedToPilotId !== undefined) {
    const assignee = cleanUuidOrNull(body.assignedToPilotId);
    if (assignee !== undefined) update.assigned_to_pilot_id = assignee;
  }
  if (body.recurrence !== undefined) {
    const rule =
      typeof body.recurrence === "string" ? body.recurrence.trim().toLowerCase() : "";
    update.recurrence =
      rule !== "" && rule.startsWith("every ") ? rule.slice(0, 80) : null;
  }
  if (body.reminderAt !== undefined) {
    update.reminder_at = cleanEpochMs(body.reminderAt);
  }

  if (Object.keys(update).length === 0) return { ok: false, reason: "no-fields" };
  return { ok: true, update };
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requirePilot();
    if (!auth) return NextResponse.json(UNAUTH, { status: 401 });
    const { id } = await params;

    const body = (await req.json().catch(() => ({}))) as TodoBody;
    const built = buildUpdate(body);
    if (!built.ok) {
      return NextResponse.json(
        {
          error:
            built.reason === "empty-text"
              ? "A to-do needs a few words of text."
              : "Nothing to change.",
        },
        { status: 400 },
      );
    }

    const { data, error } = await auth.supabase
      .from("todos")
      .update(built.update)
      .eq("id", id)
      .is("deleted_at", null)
      .select(COLUMNS)
      .maybeSingle();

    if (error) throw error;
    if (!data) return NextResponse.json(GONE, { status: 404 });
    return NextResponse.json(rowToItem(data));
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

    // Soft delete: the tombstone lets other devices (and shared-list
    // collaborators) merge the deletion instead of resurrecting the row.
    const { data, error } = await auth.supabase
      .from("todos")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", id)
      .is("deleted_at", null)
      .select(COLUMNS)
      .maybeSingle();

    if (error) throw error;
    if (!data) return NextResponse.json(GONE, { status: 404 });
    return NextResponse.json({ ok: true, todo: rowToItem(data) });
  } catch {
    return NextResponse.json(
      { error: "Couldn't delete your to-do. Please try again in a moment." },
      { status: 500 },
    );
  }
}
