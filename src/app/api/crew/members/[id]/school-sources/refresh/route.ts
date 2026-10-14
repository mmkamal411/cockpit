import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPilotId, unauthorized } from "@/lib/crew/auth";
import { getOwnedCrewMemberId } from "@/lib/crew/member-access";
import {
  processSources,
  summarizeOutcomes,
  type SourceJob,
} from "@/lib/school-source-pipeline";

function logError(operation: string, error: unknown) {
  console.error(
    JSON.stringify({
      route: "api/crew/members/[id]/school-sources/refresh",
      operation,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
}

interface BellSchedule {
  label: string;
  url: string;
}

function bellSchedulesOf(value: unknown): BellSchedule[] {
  if (!Array.isArray(value)) return [];
  return (value as { label?: unknown; url?: unknown }[])
    .filter((b) => b && typeof b.url === "string" && (b.url as string).trim())
    .map((b) => ({
      label:
        typeof b.label === "string" && b.label.trim() ? b.label.trim() : "Bell schedule",
      url: (b.url as string).trim(),
    }));
}

/**
 * POST /api/crew/members/[id]/school-sources/refresh
 * Re-fetch the saved calendar page + each bell schedule server-side,
 * sanitize them, store snapshots, run the digital parsers, and record the
 * links' health on the sources row.
 */
export async function POST(
  _request: NextRequest,
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

  const { data: sources, error: sourcesError } = await supabase
    .from("crew_school_sources")
    .select("calendar_source_url, bell_schedules")
    .eq("crew_member_id", ownedId)
    .single();
  if (sourcesError || !sources) {
    if (sourcesError && sourcesError.code !== "PGRST116") {
      logError("select sources", sourcesError);
    }
    return NextResponse.json(
      { error: "No school links are saved for this crew member yet. Add the school's calendar or bell schedule links first." },
      { status: 404 },
    );
  }

  const jobs: SourceJob[] = [];
  if (sources.calendar_source_url) {
    jobs.push({ kind: "calendar", label: "", url: sources.calendar_source_url });
  }
  for (const bell of bellSchedulesOf(sources.bell_schedules)) {
    jobs.push({ kind: "bell", label: bell.label, url: bell.url });
  }

  let results: Awaited<ReturnType<typeof processSources>>;
  try {
    results = await processSources(supabase, ownedId, jobs);
  } catch (err) {
    logError("process sources", err);
    return NextResponse.json(
      { error: "Checking those links hit a problem. Try again." },
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
    // Snapshots saved fine; don't fail the whole refresh over the status row.
  }

  return NextResponse.json({ ok: true, results });
}
