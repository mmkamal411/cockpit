import { NextResponse } from "next/server";
import { requirePilot, serverError } from "@/lib/api-auth";

/**
 * GET /api/todo-lists — the pilot's lists, own + shared with them.
 * POST /api/todo-lists — create a list. Body: { name, color? }
 */

interface ListBody {
  name?: unknown;
  color?: unknown;
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

export async function GET() {
  const auth = await requirePilot();
  if (auth instanceof NextResponse) return auth;
  const { supabase, user } = auth;

  try {
    const { data: own, error: ownErr } = await supabase
      .from("todo_lists")
      .select("id, name, color, position, created_at, updated_at")
      .eq("pilot_id", user.id)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });
    if (ownErr) throw ownErr;

    // Shared-with-me lists come through todo_list_shares.
    const { data: shareRows, error: shareErr } = await supabase
      .from("todo_list_shares")
      .select(
        "permission, todo_lists!inner(id, name, color, position, created_at, updated_at, pilot_id)",
      )
      .eq("shared_with_pilot_id", user.id);
    if (shareErr) throw shareErr;

    const lists = [
      ...((own ?? []) as unknown[]).map((l) => ({
        ...(l as Record<string, unknown>),
        mine: true,
        permission: "edit" as const,
      })),
      ...((shareRows ?? []) as unknown[]).map((r) => ({
        ...((r as Record<string, unknown>).todo_lists as Record<string, unknown>),
        mine: false,
        permission: (r as Record<string, unknown>).permission as "view" | "edit",
      })),
    ];

    return NextResponse.json({ lists });
  } catch {
    return serverError();
  }
}

export async function POST(req: Request) {
  const auth = await requirePilot();
  if (auth instanceof NextResponse) return auth;
  const { supabase, user } = auth;

  try {
    const body = (await req.json().catch(() => ({}))) as ListBody;
    const name = cleanName(body.name);
    if (!name) {
      return NextResponse.json({ error: "Give the list a name first." }, { status: 400 });
    }

    const { data, error } = await supabase
      .from("todo_lists")
      .insert({
        pilot_id: user.id,
        name,
        color: cleanColor(body.color),
      })
      .select("id, name, color, position, created_at, updated_at")
      .single();
    if (error) throw error;

    return NextResponse.json({ list: { ...data, mine: true, permission: "edit" } }, { status: 201 });
  } catch {
    return serverError();
  }
}
