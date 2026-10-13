import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPilotId, unauthorized } from "@/lib/crew/auth";
import { getOwnedCrewMemberId } from "@/lib/crew/member-access";
import { fetchSourcePage, sanitizeHtml } from "@/lib/school-sources";

function logError(operation: string, error: unknown) {
  console.error(
    JSON.stringify({
      route: "api/crew/members/[id]/school-sources/refresh",
      operation,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
}

interface SourceJob {
  kind: "calendar" | "bell";
  label: string;
  url: string;
}

interface JobResult {
  kind: string;
  label: string;
  url: string;
  status: string;
  error_note?: string;
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

function summarizeResults(results: JobResult[]): string {
  const total = results.length;
  if (total === 0) return "No links saved yet. Add the school's calendar or bell schedule links first.";
  const okCount = results.filter((r) => r.status === "ok").length;
  if (okCount === total) {
    return `Checked ${total} ${total === 1 ? "link" : "links"} just now — all good.`;
  }
  if (okCount === 0) {
    return `Checked ${total} ${total === 1 ? "link" : "links"} just now — none of them answered. Check the links on the school's website and try again.`;
  }
  const broken = results
    .filter((r) => r.status !== "ok")
    .map((r) => r.label)
    .join(", ");
  return `Checked ${total} links just now — ${okCount} worked, ${total - okCount} didn't (${broken}). Check ${total - okCount === 1 ? "that link" : "those links"} on the school's website and try again.`;
}

/**
 * POST /api/crew/members/[id]/school-sources/refresh
 * Fetch the saved calendar page + each bell schedule server-side, sanitize
 * them, store snapshots, and record the links' health on the sources row.
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

  const results: JobResult[] = [];
  for (const job of jobs) {
    const fetched = await fetchSourcePage(job.url);
    const now = new Date().toISOString();
    const status = fetched.ok ? "ok" : "error";
    const content = fetched.ok && fetched.html ? sanitizeHtml(fetched.html, job.url) : null;

    const { error: snapshotError } = await supabase
      .from("crew_school_source_snapshots")
      .upsert(
        {
          crew_member_id: ownedId,
          kind: job.kind,
          label: job.label,
          url: job.url,
          content_html: content,
          fetched_at: now,
          status,
          error_note: fetched.ok ? null : (fetched.error ?? "The school's page didn't answer."),
        },
        { onConflict: "crew_member_id,kind,label" },
      );
    if (snapshotError) {
      logError("upsert snapshot", snapshotError);
      results.push({
        kind: job.kind,
        label: job.label,
        url: job.url,
        status: "error",
        error_note: "We couldn't save that page. Try again.",
      });
      continue;
    }
    results.push({
      kind: job.kind,
      label: job.label,
      url: job.url,
      status,
      ...(status === "error" ? { error_note: fetched.error ?? "The school's page didn't answer." } : {}),
    });
  }

  const okCount = results.filter((r) => r.status === "ok").length;
  const check_status =
    okCount === results.length && results.length > 0
      ? "ok"
      : okCount === 0 && results.length > 0
        ? "broken"
        : "stale";
  const check_note = summarizeResults(results);

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
