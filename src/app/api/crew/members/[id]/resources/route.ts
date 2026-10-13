import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPilotId, unauthorized } from "@/lib/crew/auth";

type Db = Awaited<ReturnType<typeof createClient>>;

/** True when Supabase says the table doesn't exist yet (migration pending). */
function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    /relation .* does not exist/i.test(error.message ?? "")
  );
}

const SELECT_COLS =
  "id, class_name, unit_tag, kind, title, resource_type, url, storage_path, added_by, used_count, helpful_count, created_at";

/** Steward (parent) or a grantee with grades scope may read. */
async function reader(
  crewMemberId: string,
  pilotId: string,
): Promise<{ ok: boolean; db: Db }> {
  const db = await createClient();
  const { data: member } = await db
    .from("crew_members")
    .select("id, pilot_id")
    .eq("id", crewMemberId)
    .single();
  if (member?.pilot_id === pilotId) return { ok: true, db };
  const { data: grant } = await db
    .from("crew_access_grants")
    .select("id, scope")
    .eq("crew_member_id", crewMemberId)
    .eq("grantee_pilot_id", pilotId)
    .is("revoked_at", null)
    .limit(1)
    .single();
  const scope = (grant?.scope ?? {}) as Record<string, unknown>;
  return { ok: !!grant && scope.grades === true, db };
}

/** Writes are steward-only in v1. */
async function writer(
  crewMemberId: string,
  pilotId: string,
): Promise<{ ok: boolean; db: Db }> {
  const db = await createClient();
  const { data: member } = await db
    .from("crew_members")
    .select("id, pilot_id")
    .eq("id", crewMemberId)
    .single();
  return { ok: member?.pilot_id === pilotId, db };
}

/**
 * GET /api/crew/members/[id]/resources?class=<name>
 * Per-class resources (Links tab) + handout metadata (Files tab).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const pilotId = await getPilotId();
  if (!pilotId) return NextResponse.json(unauthorized(), { status: 401 });
  const { id: crewMemberId } = await params;
  const className = request.nextUrl.searchParams.get("class") ?? "";

  const { ok, db } = await reader(crewMemberId, pilotId);
  if (!ok) {
    return NextResponse.json(
      { error: "Couldn't find that crew member." },
      { status: 404 },
    );
  }

  let query = db
    .from("class_resources")
    .select(SELECT_COLS)
    .eq("crew_member_id", crewMemberId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (className.trim()) query = query.eq("class_name", className.trim());

  const { data, error } = await query;
  if (error) {
    if (isMissingTable(error)) {
      return NextResponse.json({ resources: [], unavailable: true });
    }
    return NextResponse.json(
      { error: "Couldn't load resources. Try again." },
      { status: 500 },
    );
  }
  return NextResponse.json({ resources: data });
}

interface ResourceBody {
  id?: string;
  class_name?: string;
  unit_tag?: string;
  kind?: string;
  title?: string;
  resource_type?: string;
  url?: string;
  storage_path?: string;
  added_by?: string;
  /** For usage-loop taps: "used" | "helpful". */
  tap?: string;
}

function validUrl(u: string): boolean {
  try {
    const p = new URL(u);
    return p.protocol === "http:" || p.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * POST /api/crew/members/[id]/resources
 * Add a resource (link or file metadata), or tap a usage loop counter.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const pilotId = await getPilotId();
  if (!pilotId) return NextResponse.json(unauthorized(), { status: 401 });
  const { id: crewMemberId } = await params;

  let body: ResourceBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "We couldn't read that request. Try again." },
      { status: 400 },
    );
  }

  const { ok, db } = await writer(crewMemberId, pilotId);
  if (!ok) {
    return NextResponse.json(
      { error: "Couldn't find that crew member." },
      { status: 404 },
    );
  }

  // Usage-loop tap: "used it" / "helpful".
  if (body.tap === "used" || body.tap === "helpful") {
    if (!body.id) {
      return NextResponse.json({ error: "Missing resource." }, { status: 400 });
    }
    const column = body.tap === "used" ? "used_count" : "helpful_count";
    const { data: row, error: readErr } = await db
      .from("class_resources")
      .select(`id, ${column}`)
      .eq("id", body.id)
      .eq("crew_member_id", crewMemberId)
      .single();
    if (readErr || !row) {
      return NextResponse.json(
        { error: "Couldn't find that resource." },
        { status: 404 },
      );
    }
    const next = ((row as Record<string, number>)[column] ?? 0) + 1;
    const { error: updErr } = await db
      .from("class_resources")
      .update({ [column]: next })
      .eq("id", body.id);
    if (updErr) {
      return NextResponse.json(
        { error: "Couldn't save that tap. Try again." },
        { status: 500 },
      );
    }
    return NextResponse.json({ ok: true, [column]: next });
  }

  const title = (body.title ?? "").trim().slice(0, 200);
  const className = (body.class_name ?? "").trim();
  const kind = body.kind === "file" ? "file" : "link";
  if (!title || !className) {
    return NextResponse.json(
      { error: "Give the resource a title so it's easy to find later." },
      { status: 400 },
    );
  }
  if (kind === "link") {
    if (!body.url || !validUrl(body.url)) {
      return NextResponse.json(
        { error: "That link doesn't look like a web address — check it and try again." },
        { status: 400 },
      );
    }
  }

  const { data, error } = await db
    .from("class_resources")
    .insert({
      crew_member_id: crewMemberId,
      class_name: className,
      unit_tag: body.unit_tag?.trim() || null,
      kind,
      title,
      resource_type: (body.resource_type ?? "other").slice(0, 40),
      url: kind === "link" ? body.url : null,
      storage_path: kind === "file" ? body.storage_path ?? null : null,
      added_by: body.added_by === "crew" ? "crew" : "pilot",
    })
    .select(SELECT_COLS)
    .single();

  if (error) {
    if (isMissingTable(error)) {
      return NextResponse.json(
        { error: "Resources aren't switched on yet — the school tables are still being set up. Try again in a bit." },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: "Couldn't save that resource. Try again." },
      { status: 500 },
    );
  }
  return NextResponse.json({ resource: data });
}

/**
 * DELETE /api/crew/members/[id]/resources?id=<resource id>
 * Remove a resource. The client also removes the stored file (best effort).
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const pilotId = await getPilotId();
  if (!pilotId) return NextResponse.json(unauthorized(), { status: 401 });
  const { id: crewMemberId } = await params;
  const resourceId = request.nextUrl.searchParams.get("id") ?? "";

  const { ok, db } = await writer(crewMemberId, pilotId);
  if (!ok) {
    return NextResponse.json(
      { error: "Couldn't find that crew member." },
      { status: 404 },
    );
  }
  if (!resourceId) {
    return NextResponse.json({ error: "Missing resource." }, { status: 400 });
  }

  const { data: row, error: readErr } = await db
    .from("class_resources")
    .select("id, storage_path")
    .eq("id", resourceId)
    .eq("crew_member_id", crewMemberId)
    .single();
  if (readErr || !row) {
    return NextResponse.json(
      { error: "Couldn't find that resource." },
      { status: 404 },
    );
  }
  const { error } = await db.from("class_resources").delete().eq("id", resourceId);
  if (error) {
    return NextResponse.json(
      { error: "Couldn't remove that resource. Try again." },
      { status: 500 },
    );
  }
  return NextResponse.json({
    ok: true,
    storage_path: (row as { storage_path: string | null }).storage_path,
  });
}
