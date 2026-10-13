import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPilotId, unauthorized } from "@/lib/crew/auth";

type Db = Awaited<ReturnType<typeof createClient>>;

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    /relation .* does not exist/i.test(error.message ?? "")
  );
}

async function access(
  crewMemberId: string,
  pilotId: string,
): Promise<{ read: boolean; write: boolean; db: Db }> {
  const db = await createClient();
  const { data: member } = await db
    .from("crew_members")
    .select("id, pilot_id")
    .eq("id", crewMemberId)
    .single();
  if (member?.pilot_id === pilotId) return { read: true, write: true, db };
  const { data: grant } = await db
    .from("crew_access_grants")
    .select("id, scope")
    .eq("crew_member_id", crewMemberId)
    .eq("grantee_pilot_id", pilotId)
    .is("revoked_at", null)
    .limit(1)
    .single();
  const scope = (grant?.scope ?? {}) as Record<string, unknown>;
  return { read: !!grant && scope.grades === true, write: false, db };
}

const SELECT_COLS = "id, class_name, title, category, added_by, created_at";

/**
 * GET /api/crew/members/[id]/manual-missing?class=<name>
 * Manually logged missing assignments for one class.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const pilotId = await getPilotId();
  if (!pilotId) return NextResponse.json(unauthorized(), { status: 401 });
  const { id: crewMemberId } = await params;
  const className = request.nextUrl.searchParams.get("class") ?? "";

  const { read, db } = await access(crewMemberId, pilotId);
  if (!read) {
    return NextResponse.json(
      { error: "Couldn't find that crew member." },
      { status: 404 },
    );
  }

  let query = db
    .from("class_manual_missing")
    .select(SELECT_COLS)
    .eq("crew_member_id", crewMemberId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (className.trim()) query = query.eq("class_name", className.trim());

  const { data, error } = await query;
  if (error) {
    if (isMissingTable(error)) return NextResponse.json({ items: [], unavailable: true });
    return NextResponse.json(
      { error: "Couldn't load logged items. Try again." },
      { status: 500 },
    );
  }
  return NextResponse.json({ items: data });
}

/**
 * POST /api/crew/members/[id]/manual-missing
 * Log a missing assignment the sync doesn't show. Body: { class_name, title, category? }.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const pilotId = await getPilotId();
  if (!pilotId) return NextResponse.json(unauthorized(), { status: 401 });
  const { id: crewMemberId } = await params;

  let body: { class_name?: string; title?: string; category?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "We couldn't read that request. Try again." },
      { status: 400 },
    );
  }

  const { write, db } = await access(crewMemberId, pilotId);
  if (!write) {
    return NextResponse.json(
      { error: "Couldn't find that crew member." },
      { status: 404 },
    );
  }

  const className = (body.class_name ?? "").trim();
  const title = (body.title ?? "").trim().slice(0, 120);
  if (!className || !title) {
    return NextResponse.json(
      { error: "Give the missing work a name so it can join the plan." },
      { status: 400 },
    );
  }

  const { data, error } = await db
    .from("class_manual_missing")
    .insert({
      crew_member_id: crewMemberId,
      class_name: className,
      title,
      category: body.category?.trim() || null,
      added_by: "pilot",
    })
    .select(SELECT_COLS)
    .single();

  if (error) {
    if (isMissingTable(error)) {
      return NextResponse.json(
        { error: "The logger isn't switched on yet — the school tables are still being set up. Try again in a bit." },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: "Couldn't log that. Try again." },
      { status: 500 },
    );
  }
  return NextResponse.json({ item: data });
}

/**
 * DELETE /api/crew/members/[id]/manual-missing?id=<item id>
 * Remove a logged item (e.g. it got turned in).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const pilotId = await getPilotId();
  if (!pilotId) return NextResponse.json(unauthorized(), { status: 401 });
  const { id: crewMemberId } = await params;
  const itemId = request.nextUrl.searchParams.get("id") ?? "";

  const { write, db } = await access(crewMemberId, pilotId);
  if (!write || !itemId) {
    return NextResponse.json(
      { error: "Couldn't find that item." },
      { status: 404 },
    );
  }

  const { error } = await db
    .from("class_manual_missing")
    .delete()
    .eq("id", itemId)
    .eq("crew_member_id", crewMemberId);
  if (error) {
    return NextResponse.json(
      { error: "Couldn't remove that. Try again." },
      { status: 500 },
    );
  }
  return NextResponse.json({ ok: true });
}
