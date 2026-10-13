import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPilotId, unauthorized } from "@/lib/crew/auth";
import { getOwnedCrewMemberId } from "@/lib/crew/member-access";
import { validateSourceUrl } from "@/lib/school-sources";

const MAX_BELL_SCHEDULES = 5;

interface BellScheduleInput {
  label?: string;
  url?: string;
}

interface BellSchedule {
  label: string;
  url: string;
}

function logError(operation: string, error: unknown) {
  console.error(
    JSON.stringify({
      route: "api/crew/members/[id]/school-sources",
      operation,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
}

function notFound() {
  return NextResponse.json(
    { error: "Couldn't find that crew member." },
    { status: 404 },
  );
}

/**
 * GET /api/crew/members/[id]/school-sources
 * The pilot's saved calendar + bell schedule links for a crew member,
 * plus the last fetch state of each linked page.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const pilotId = await getPilotId();
  if (!pilotId) return NextResponse.json(unauthorized(), { status: 401 });
  const { id: crewMemberId } = await params;

  const supabase = await createClient();
  const ownedId = await getOwnedCrewMemberId(supabase, crewMemberId, pilotId);
  if (!ownedId) return notFound();

  const { data: sources, error: sourcesError } = await supabase
    .from("crew_school_sources")
    .select(
      "id, crew_member_id, district, calendar_source_url, bell_schedules, last_checked_at, check_status, check_note, created_at, updated_at",
    )
    .eq("crew_member_id", ownedId)
    .single();
  if (sourcesError && sourcesError.code !== "PGRST116") {
    logError("select sources", sourcesError);
    return NextResponse.json(
      { error: "We couldn't load the school links. Try again." },
      { status: 500 },
    );
  }

  const { data: snapshots, error: snapshotsError } = await supabase
    .from("crew_school_source_snapshots")
    .select("kind, label, url, fetched_at, status, error_note, parsed_at, parse_status, parse_note")
    .eq("crew_member_id", ownedId);
  if (snapshotsError) {
    logError("select snapshots", snapshotsError);
    return NextResponse.json(
      { error: "We couldn't load the school links. Try again." },
      { status: 500 },
    );
  }

  const rows = Array.isArray(snapshots) ? snapshots : [];
  const calendarRow = rows.find((r) => r.kind === "calendar") ?? null;

  // Real calendar rows (parsed district calendar or manually loaded events)
  // — the Calendar section prefers these over any scraped page HTML. A
  // missing table (migration not run yet) is not fatal: the section falls
  // back to its honest empty state.
  let calendarEvents: Array<{
    title: string;
    event_date: string;
    end_date: string | null;
    location: string | null;
    description: string | null;
  }> = [];
  try {
    const { data: eventRows, error: eventsError } = await supabase
      .from("crew_school_calendar_events")
      .select("title, event_date, end_date, location, description")
      .eq("crew_member_id", ownedId)
      .order("event_date", { ascending: true })
      .limit(100);
    if (!eventsError && Array.isArray(eventRows)) {
      calendarEvents = eventRows.filter(
        (e): e is (typeof calendarEvents)[number] =>
          !!e && typeof e.title === "string" && typeof e.event_date === "string",
      );
    } else if (eventsError) {
      logError("select calendar events", eventsError);
    }
  } catch (err) {
    logError("select calendar events", err);
  }

  return NextResponse.json({
    sources: sources
      ? { ...sources, bell_schedules: bellSchedulesOf(sources.bell_schedules) }
      : null,
    snapshots: {
      calendar: snapshotSummary(calendarRow),
      bells: rows
        .filter((r) => r.kind === "bell")
        .map((r) => snapshotSummary(r)),
    },
    calendar_events: calendarEvents,
  });
}

function bellSchedulesOf(value: unknown): BellSchedule[] {
  if (!Array.isArray(value)) return [];
  return (value as BellScheduleInput[])
    .filter((b) => b && typeof b.url === "string" && b.url.trim())
    .map((b) => ({
      label: typeof b.label === "string" && b.label.trim() ? b.label.trim() : "Bell schedule",
      url: (b.url as string).trim(),
    }));
}

function snapshotSummary(row: Record<string, unknown> | null) {
  if (!row) return null;
  return {
    label: typeof row.label === "string" ? row.label : "",
    url: typeof row.url === "string" ? row.url : "",
    fetched_at: (row.fetched_at as string | null) ?? null,
    status: typeof row.status === "string" ? row.status : "pending",
    error_note: (row.error_note as string | null) ?? null,
    parsed_at: (row.parsed_at as string | null) ?? null,
    parse_status: typeof row.parse_status === "string" ? row.parse_status : "pending",
    parse_note: (row.parse_note as string | null) ?? null,
  };
}

/**
 * PUT /api/crew/members/[id]/school-sources
 * Save the pilot's school links. Body:
 *   { district?, calendar_source_url?, bell_schedules?: [{label, url}] }
 * Empty strings become null. At most 5 bell schedules. Every URL is validated.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const pilotId = await getPilotId();
  if (!pilotId) return NextResponse.json(unauthorized(), { status: 401 });
  const { id: crewMemberId } = await params;

  let body: {
    district?: unknown;
    calendar_source_url?: unknown;
    bell_schedules?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "We couldn't read that request. Try again." },
      { status: 400 },
    );
  }

  const district =
    typeof body.district === "string" && body.district.trim()
      ? body.district.trim()
      : null;

  let calendar_source_url: string | null = null;
  if (typeof body.calendar_source_url === "string" && body.calendar_source_url.trim()) {
    const problem = validateSourceUrl(body.calendar_source_url);
    if (problem) {
      return NextResponse.json({ error: `Calendar link: ${problem}` }, { status: 400 });
    }
    calendar_source_url = body.calendar_source_url.trim();
  }

  const bell_schedules: BellSchedule[] = [];
  if (body.bell_schedules !== undefined) {
    if (!Array.isArray(body.bell_schedules)) {
      return NextResponse.json(
        { error: "The bell schedules didn't come through right. Try again." },
        { status: 400 },
      );
    }
    if (body.bell_schedules.length > MAX_BELL_SCHEDULES) {
      return NextResponse.json(
        { error: `You can save up to ${MAX_BELL_SCHEDULES} bell schedules.` },
        { status: 400 },
      );
    }
    for (const entry of body.bell_schedules as BellScheduleInput[]) {
      const url = typeof entry?.url === "string" ? entry.url.trim() : "";
      if (!url) continue; // skip blank rows
      const problem = validateSourceUrl(url);
      if (problem) {
        return NextResponse.json({ error: `Bell schedule link: ${problem}` }, { status: 400 });
      }
      const label =
        typeof entry?.label === "string" && entry.label.trim()
          ? entry.label.trim()
          : "Bell schedule";
      bell_schedules.push({ label, url });
    }
  }

  const supabase = await createClient();
  const ownedId = await getOwnedCrewMemberId(supabase, crewMemberId, pilotId);
  if (!ownedId) return notFound();

  const { data: sources, error: upsertError } = await supabase
    .from("crew_school_sources")
    .upsert(
      {
        crew_member_id: ownedId,
        district,
        calendar_source_url,
        bell_schedules,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "crew_member_id" },
    )
    .select(
      "id, crew_member_id, district, calendar_source_url, bell_schedules, last_checked_at, check_status, check_note, created_at, updated_at",
    )
    .single();

  if (upsertError || !sources) {
    logError("upsert sources", upsertError);
    return NextResponse.json(
      { error: "We couldn't save those links. Try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    sources: { ...sources, bell_schedules: bellSchedulesOf(sources.bell_schedules) },
  });
}
