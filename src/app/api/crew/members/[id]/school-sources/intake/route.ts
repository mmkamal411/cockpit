import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPilotId, unauthorized } from "@/lib/crew/auth";
import { getOwnedCrewMemberId } from "@/lib/crew/member-access";
import { validateSourceUrl } from "@/lib/school-sources";
import {
  processSources,
  summarizeOutcomes,
  type SourceJob,
} from "@/lib/school-source-pipeline";

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
      route: "api/crew/members/[id]/school-sources/intake",
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

function cleanBellSchedules(value: unknown): { bells: BellSchedule[]; error?: string } {
  if (value === undefined) return { bells: [] };
  if (!Array.isArray(value)) {
    return {
      bells: [],
      error: "The bell schedules didn't come through right. Try again.",
    };
  }
  if (value.length > MAX_BELL_SCHEDULES) {
    return {
      bells: [],
      error: `You can save up to ${MAX_BELL_SCHEDULES} bell schedules.`,
    };
  }
  const bells: BellSchedule[] = [];
  for (const entry of value as BellScheduleInput[]) {
    const url = typeof entry?.url === "string" ? entry.url.trim() : "";
    if (!url) continue; // skip blank rows
    const problem = validateSourceUrl(url);
    if (problem) return { bells: [], error: `Bell schedule link: ${problem}` };
    const label =
      typeof entry?.label === "string" && entry.label.trim()
        ? entry.label.trim()
        : "Bell schedule";
    bells.push({ label, url });
  }
  return { bells };
}

function bellSchedulesOf(value: unknown): BellSchedule[] {
  if (!Array.isArray(value)) return [];
  return (value as BellScheduleInput[])
    .filter((b) => b && typeof b.url === "string" && (b.url as string).trim())
    .map((b) => ({
      label:
        typeof b.label === "string" && b.label.trim() ? b.label.trim() : "Bell schedule",
      url: (b.url as string).trim(),
    }));
}

/**
 * POST /api/crew/members/[id]/school-sources/intake
 * Save the pilot's school links AND immediately verify + fetch + parse them.
 * Body: { district?, calendar_url?, bell_schedules?: [{label, url}] }
 *
 * Returns per-source results:
 *   { url, label, kind, verified, parsed, message, eventCount?, scheduleCount?, periodCount? }
 * verified = the page answered; parsed = digital output was stored.
 * Every message is plain English.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const pilotId = await getPilotId();
  if (!pilotId) return NextResponse.json(unauthorized(), { status: 401 });
  const { id: crewMemberId } = await params;

  let body: {
    district?: unknown;
    calendar_url?: unknown;
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

  let calendarUrl: string | null | undefined;
  if (body.calendar_url !== undefined) {
    if (typeof body.calendar_url === "string" && body.calendar_url.trim()) {
      const problem = validateSourceUrl(body.calendar_url);
      if (problem) {
        return NextResponse.json({ error: `Calendar link: ${problem}` }, { status: 400 });
      }
      calendarUrl = body.calendar_url.trim();
    } else {
      calendarUrl = null;
    }
  }

  const { bells, error: bellsError } = cleanBellSchedules(body.bell_schedules);
  if (bellsError) return NextResponse.json({ error: bellsError }, { status: 400 });

  const supabase = await createClient();
  const ownedId = await getOwnedCrewMemberId(supabase, crewMemberId, pilotId);
  if (!ownedId) return notFound();

  // Merge with the saved row so omitted fields keep their values.
  const { data: existing, error: existingError } = await supabase
    .from("crew_school_sources")
    .select("district, calendar_source_url, bell_schedules")
    .eq("crew_member_id", ownedId)
    .single();
  if (existingError && existingError.code !== "PGRST116") {
    logError("select existing sources", existingError);
    return NextResponse.json(
      { error: "We couldn't load the saved school links. Try again." },
      { status: 500 },
    );
  }

  const finalDistrict = body.district !== undefined ? district : (existing?.district ?? null);
  const finalCalendarUrl =
    calendarUrl !== undefined ? calendarUrl : (existing?.calendar_source_url ?? null);
  const finalBells = body.bell_schedules !== undefined ? bells : bellSchedulesOf(existing?.bell_schedules);

  const { data: sources, error: upsertError } = await supabase
    .from("crew_school_sources")
    .upsert(
      {
        crew_member_id: ownedId,
        district: finalDistrict,
        calendar_source_url: finalCalendarUrl,
        bell_schedules: finalBells,
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

  // Verify + fetch + parse every saved URL.
  const jobs: SourceJob[] = [];
  if (finalCalendarUrl) {
    jobs.push({ kind: "calendar", label: "", url: finalCalendarUrl });
  }
  for (const bell of finalBells) {
    jobs.push({ kind: "bell", label: bell.label, url: bell.url });
  }

  let results: Awaited<ReturnType<typeof processSources>> = [];
  try {
    results = await processSources(supabase, ownedId, jobs);
  } catch (err) {
    logError("process sources", err);
    return NextResponse.json(
      { error: "The links were saved, but checking them hit a problem. Try the refresh button." },
      { status: 500 },
    );
  }

  const { check_status, check_note } = summarizeOutcomes(results);
  const { error: updateError } = await supabase
    .from("crew_school_sources")
    .update({
      last_checked_at: new Date().toISOString(),
      check_status,
      check_note,
      updated_at: new Date().toISOString(),
    })
    .eq("crew_member_id", ownedId);
  if (updateError) {
    logError("update check status", updateError);
  }

  return NextResponse.json({
    ok: true,
    sources: { ...sources, bell_schedules: bellSchedulesOf(sources.bell_schedules) },
    results,
  });
}
