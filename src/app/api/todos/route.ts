import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/todos — the signed-in pilot's to-dos: their own lists plus lists
 * shared with them (RLS decides the rows). Newest first.
 * POST /api/todos — create a to-do. The client generates the UUID (id);
 * the server honors it so offline queues can reconcile without duplicates.
 *
 * Client <-> DB field mapping: text <-> title, createdAt <-> created_at,
 * dueAt (epoch ms) <-> due_at (timestamptz).
 */

const UNAUTH = { error: "Sign in to sync your to-dos." };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Priority = "p1" | "p2" | "p3" | "p4";

interface TodoRow {
  id: string;
  pilot_id: string;
  title: string;
  done: boolean;
  created_at: string;
  completed_at: string | null;
  updated_at: string;
  deleted_at: string | null;
  due_at: string | null;
  priority: Priority | null;
  labels: string[] | null;
  notes: string | null;
  source: "manual" | "calendar" | "mail";
  list_id: string | null;
  parent_todo_id: string | null;
  section: string | null;
  assigned_to_pilot_id: string | null;
  recurrence: string | null;
  reminder_at: string | null;
  google_task_id: string | null;
  google_tasklist_id: string | null;
}

interface TodoBody {
  id?: unknown;
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

export function rowToItem(row: TodoRow) {
  return {
    id: row.id,
    pilotId: row.pilot_id,
    text: row.title,
    done: row.done,
    createdAt: Date.parse(row.created_at) || Date.now(),
    completedAt: row.completed_at ? Date.parse(row.completed_at) : null,
    updatedAt: Date.parse(row.updated_at) || Date.now(),
    deletedAt: row.deleted_at ? Date.parse(row.deleted_at) : null,
    dueAt: row.due_at ? Date.parse(row.due_at) : null,
    priority: row.priority,
    labels: row.labels ?? [],
    notes: row.notes,
    source: row.source,
    listId: row.list_id,
    parentTodoId: row.parent_todo_id,
    section: row.section,
    assignedToPilotId: row.assigned_to_pilot_id,
    recurrence: row.recurrence,
    reminderAt: row.reminder_at ? Date.parse(row.reminder_at) : null,
    googleTaskId: row.google_task_id,
    googleTasklistId: row.google_tasklist_id,
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

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text === "" ? null : text.slice(0, 500);
}

function cleanPriority(value: unknown): Priority | null {
  if (value === "p1" || value === "p2" || value === "p3" || value === "p4") return value;
  // Legacy low/medium/high (pre-037 clients and old queued ops) remap here.
  if (value === "high") return "p1";
  if (value === "medium") return "p2";
  if (value === "low") return "p3";
  return null;
}

function cleanLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((l): l is string => typeof l === "string")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function cleanNotes(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const notes = value.trim();
  return notes === "" ? null : notes.slice(0, 2000);
}

function cleanSection(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const section = value.trim();
  return section === "" ? null : section.slice(0, 80);
}

function cleanRecurrence(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const rule = value.trim().toLowerCase();
  if (rule === "") return null;
  if (!rule.startsWith("every ")) return null;
  return rule.slice(0, 80);
}

function cleanEpochMs(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function cleanUuid(value: unknown): string | null {
  return typeof value === "string" && UUID_RE.test(value) ? value : null;
}

/** Resolve the pilot's default list (the migration backfilled one per pilot). */
async function defaultListId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  pilotId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("todo_lists")
    .select("id")
    .eq("pilot_id", pilotId)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as { id?: string } | null)?.id ?? null;
}

export async function GET() {
  try {
    const auth = await requirePilot();
    if (!auth) return NextResponse.json(UNAUTH, { status: 401 });

    const { data, error } = await auth.supabase
      .from("todos")
      .select(COLUMNS)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return NextResponse.json(((data ?? []) as TodoRow[]).map(rowToItem));
  } catch {
    return NextResponse.json(
      { error: "Couldn't load your to-dos. Please try again in a moment." },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const auth = await requirePilot();
    if (!auth) return NextResponse.json(UNAUTH, { status: 401 });

    const body = (await req.json().catch(() => ({}))) as TodoBody;
    const text = cleanText(body.text);
    if (!text) {
      return NextResponse.json({ error: "Give your to-do a few words first." }, { status: 400 });
    }

    // Client-generated UUIDs: the offline queue creates rows locally first,
    // and the server honors the id so a retried POST never duplicates.
    const id = cleanUuid(body.id) ?? crypto.randomUUID();

    let listId = cleanUuid(body.listId);
    if (!listId) {
      listId = await defaultListId(auth.supabase, auth.pilotId);
    }
    if (!listId) {
      return NextResponse.json(
        { error: "Your lists aren't ready yet — try again in a moment." },
        { status: 500 },
      );
    }

    // Idempotency: a retried POST for the same client id returns the row.
    const { data: existing } = await auth.supabase
      .from("todos")
      .select(COLUMNS)
      .eq("id", id)
      .maybeSingle();
    if (existing) {
      return NextResponse.json(rowToItem(existing as TodoRow), { status: 200 });
    }

    const { data, error } = await auth.supabase
      .from("todos")
      .insert({
        id,
        pilot_id: auth.pilotId,
        title: text,
        due_at: cleanEpochMs(body.dueAt),
        done: false,
        priority: cleanPriority(body.priority),
        labels: cleanLabels(body.labels),
        notes: cleanNotes(body.notes),
        source: "manual",
        list_id: listId,
        parent_todo_id: cleanUuid(body.parentTodoId),
        section: cleanSection(body.section),
        assigned_to_pilot_id: cleanUuid(body.assignedToPilotId),
        recurrence: cleanRecurrence(body.recurrence),
        reminder_at: cleanEpochMs(body.reminderAt),
      })
      .select(COLUMNS)
      .single();

    if (error) throw error;
    return NextResponse.json(rowToItem(data as TodoRow), { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Couldn't save your to-do. Please try again in a moment." },
      { status: 500 },
    );
  }
}
