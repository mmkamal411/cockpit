import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPilotId, unauthorized } from "@/lib/crew/auth";
import { getOwnedCrewMemberId } from "@/lib/crew/member-access";
import {
  NOT_A_CALENDAR_MESSAGE,
  pageLooksLikeCalendar,
} from "@/lib/school-sources";

function logError(operation: string, error: unknown) {
  console.error(
    JSON.stringify({
      route: "api/crew/members/[id]/school-sources/content",
      operation,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
}

/**
 * GET /api/crew/members/[id]/school-sources/content?kind=calendar|bell&index=0
 * Returns a saved snapshot's sanitized HTML for in-app rendering.
 * - kind=calendar → the single calendar snapshot
 * - kind=bell&index=N → the Nth bell schedule snapshot (0-based)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const pilotId = await getPilotId();
  if (!pilotId) return NextResponse.json(unauthorized(), { status: 401 });
  const { id: crewMemberId } = await params;

  const supabase = await createClient();
  const ownedId = await getOwnedCrewMemberId(supabase, crewMemberId, pilotId);
  if (!ownedId) {
    return NextResponse.json(
      { error: "Couldn't find that crew member." },
      { status: 404 },
    );
  }

  const kind = request.nextUrl.searchParams.get("kind");
  if (kind !== "calendar" && kind !== "bell") {
    return NextResponse.json(
      { error: "That page type isn't valid. Ask for the calendar or a bell schedule." },
      { status: 400 },
    );
  }

  const index = Math.max(
    0,
    parseInt(request.nextUrl.searchParams.get("index") ?? "0", 10) || 0,
  );

  let query = supabase
    .from("crew_school_source_snapshots")
    .select("label, url, content_html, fetched_at, status, error_note, parsed_json, parsed_at, parse_status, parse_note")
    .eq("crew_member_id", ownedId)
    .eq("kind", kind)
    .order("created_at", { ascending: true });
  if (kind === "bell") query = query.range(index, index);

  const { data: rows, error: selectError } = await query;
  if (selectError) {
    logError("select snapshot", selectError);
    return NextResponse.json(
      { error: "We couldn't load that page. Try again." },
      { status: 500 },
    );
  }

  const snapshot = rows?.[0] ?? null;
  if (!snapshot) {
    return NextResponse.json({
      ok: false,
      error: "That page hasn't been saved yet. Tap Refresh to fetch it from the school's website.",
    });
  }

  if (snapshot.status === "error") {
    return NextResponse.json({
      ok: false,
      error: snapshot.error_note
        ? `We couldn't fetch that page last time: ${snapshot.error_note}`
        : "We couldn't fetch that page last time. Check the link and tap Refresh to try again.",
    });
  }

  if (snapshot.status === "pending" || !snapshot.content_html) {
    // No page chrome was stored. When the parse already ran and failed, say
    // what happened instead of pretending the fetch is still in flight —
    // a rejected page (district homepage saved as "calendar") leaves
    // content_html empty on purpose: its chrome is never rendered.
    if (snapshot.parse_status === "error" && snapshot.parse_note) {
      return NextResponse.json({ ok: false, error: snapshot.parse_note });
    }
    return NextResponse.json({
      ok: false,
      error: "That page is still being fetched. Tap Refresh, then try again in a moment.",
    });
  }

  // Legacy guard: snapshots stored before content validation existed may
  // hold a homepage link farm. A calendar snapshot whose parse failed AND
  // whose stored HTML has no date/event structure is never served — the
  // pilot gets the honest message instead of the junk links.
  if (
    kind === "calendar" &&
    snapshot.parse_status === "error" &&
    !pageLooksLikeCalendar(snapshot.content_html)
  ) {
    return NextResponse.json({ ok: false, error: NOT_A_CALENDAR_MESSAGE });
  }

  return NextResponse.json({
    ok: true,
    html: snapshot.content_html,
    url: snapshot.url,
    fetched_at: snapshot.fetched_at,
    parsed: snapshot.parsed_json ?? null,
    parsed_at: snapshot.parsed_at ?? null,
    parse_status: snapshot.parse_status ?? "pending",
    parse_note: snapshot.parse_note ?? null,
  });
}
