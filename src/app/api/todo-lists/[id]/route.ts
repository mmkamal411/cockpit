import { NextResponse } from "next/server";
import { requirePilot, serverError } from "@/lib/api-auth";

/**
 * GET /api/todo-lists/[id] — one list (owner or shared-with-me).
 * PUT /api/todo-lists/[id] — owner only: { name?, color?, position? }.
 * DELETE /api/todo-lists/[id] — owner only. Todos move with the list
 * (ON DELETE CASCADE).
 */

interface RouteParams {
  params: Promise<{ id: string }>;
}

function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  return name === "" ? null : name.slice(0, 80);
}

function cleanColor(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const color = value.trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return null;
  return color.toLowerCase();
}

export async function GET(_req: Request, { params }: RouteParams) {
  const auth = await requirePilot();
  if (auth instanceof NextResponse) return auth;
  const { supabase, user } = auth;
  const { id } = await params;

  try {
    // Owner path.
    const { data: own } = await supabase
      .from("todo_lists")
      .select("id, name, color, position, created_at, updated_at, pilot_id")
      .eq("id", id)
      .eq("pilot_id", user.id)
      .maybeSingle();
    if (own) {
      return NextResponse.json({ list: { ...own, mine: true, permission: "edit" } });
    }

    // Shared-with-me path.
    const { data: share } = await supabase
      .from("todo_list_shares")
      .select("permission, todo_lists!inner(id, name, color, position, created_at, updated_at, pilot_id)")
      .eq("list_id", id)
      .eq("shared_with_pilot_id", user.id)
      .maybeSingle();
    if (!share) {
      return NextResponse.json({ error: "That list wasn't found." }, { status: 404 });
    }
    const list = (share as unknown as { permission: string; todo_lists: Record<string, unknown> });
    return NextResponse.json({
      list: { ...list.todo_lists, mine: false, permission: list.permission },
    });
  } catch {
    return serverError();
  }
}

export async function PUT(req: Request, { params }: RouteParams) {
  const auth = await requirePilot();
  if (auth instanceof NextResponse) return auth;
  const { supabase, user } = auth;
  const { id } = await params;

  try {
    const { data: list } = await supabase
      .from("todo_lists")
      .select("id")
      .eq("id", id)
      .eq("pilot_id", user.id)
      .maybeSingle();
    if (!list) {
      return NextResponse.json({ error: "That list wasn't found." }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    const update: Record<string, unknown> = {};
    if (body.name !== undefined) {
      const name = cleanName(body.name);
      if (!name) return NextResponse.json({ error: "Give the list a name first." }, { status: 400 });
      update.name = name;
    }
    if (body.color !== undefined) {
      const color = cleanColor(body.color);
      if (body.color !== null && !color) {
        return NextResponse.json({ error: "Pick a color from the swatches." }, { status: 400 });
      }
      update.color = color;
    }
    if (body.position !== undefined && typeof body.position === "number" && Number.isFinite(body.position)) {
      update.position = Math.max(0, Math.min(1000, Math.floor(body.position)));
    }
    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "Nothing to change." }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("todo_lists")
      .update(update)
      .eq("id", id)
      .select("id, name, color, position, created_at, updated_at")
      .single();
    if (error) throw error;
    return NextResponse.json({ list: { ...data, mine: true, permission: "edit" } });
  } catch {
    return serverError();
  }
}

export async function DELETE(_req: Request, { params }: RouteParams) {
  const auth = await requirePilot();
  if (auth instanceof NextResponse) return auth;
  const { supabase, user } = auth;
  const { id } = await params;

  try {
    const { data: list } = await supabase
      .from("todo_lists")
      .select("id")
      .eq("id", id)
      .eq("pilot_id", user.id)
      .maybeSingle();
    if (!list) {
      return NextResponse.json({ error: "That list wasn't found." }, { status: 404 });
    }
    const { error } = await supabase.from("todo_lists").delete().eq("id", id);
    if (error) throw error;
    return NextResponse.json({ ok: true });
  } catch {
    return serverError();
  }
}
