import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/todos — the signed-in pilot's to-do list, newest first.
 * POST /api/todos — create a to-do. Body: { text, dueAt?, priority?, labels?, notes? }
 *
 * Client <-> DB field mapping: text <-> title, createdAt <-> created_at,
 * dueAt (epoch ms) <-> due_at (timestamptz).
 */

const UNAUTH = { error: "Sign in to sync your to-dos." };

type Priority = "low" | "medium" | "high";

interface TodoRow {
  id: string;
  title: string;
  done: boolean;
  created_at: string;
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

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return text === "" ? null : text.slice(0, 500);
}

function cleanPriority(value: unknown): Priority | null {
  return value === "low" || value === "medium" || value === "high" ? value : null;
}

function cleanLabels(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((l): l is string => typeof l === "string").map((l) => l.trim()).filter(Boolean).slice(0, 20);
}

function cleanNotes(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const notes = value.trim();
  return notes === "" ? null : notes.slice(0, 2000);
}

function cleanDueAt(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function GET() {
  try {
    const auth = await requirePilot();
    if (!auth) return NextResponse.json(UNAUTH, { status: 401 });

    const { data, error } = await auth.supabase
      .from("todos")
      .select("id,title,done,created_at,due_at,priority,labels,notes,source")
      .eq("pilot_id", auth.pilotId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return NextResponse.json(((data ?? []) as TodoRow[]).map(toItem));
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

    const { data, error } = await auth.supabase
      .from("todos")
      .insert({
        pilot_id: auth.pilotId,
        title: text,
        due_at: cleanDueAt(body.dueAt),
        done: false,
        priority: cleanPriority(body.priority),
        labels: cleanLabels(body.labels),
        notes: cleanNotes(body.notes),
        source: "manual",
      })
      .select("id,title,done,created_at,due_at,priority,labels,notes,source")
      .single();

    if (error) throw error;
    return NextResponse.json(toItem(data as TodoRow), { status: 201 });
  } catch {
    return NextResponse.json(
      { error: "Couldn't save your to-do. Please try again in a moment." },
      { status: 500 },
    );
  }
}
