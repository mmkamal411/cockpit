import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type {
  CalendarEvent,
  HandledItem,
  NudgeItem,
  SchoolItem,
  TodayBriefing,
  TodoItem,
} from "@/lib/today-types";

export const dynamic = "force-dynamic";

/**
 * GET /api/today — the pilot's Today briefing.
 *
 * READ-ONLY aggregation over every source that can ask for the pilot's
 * attention today: overdue todos, today's calendar, todos due today,
 * active nudges, and crew school items. Each source is isolated in its own
 * try/catch — one failing source degrades to an empty section plus a
 * warning instead of breaking the whole briefing.
 */

const UNAUTH_MESSAGE = "You need to be signed in to see today's briefing.";

interface TodoRow {
  id: string;
  title: string;
  done: boolean;
  due_at: string | null;
  created_at: string;
}

interface NudgeRow {
  id: string;
  kind: string;
  title: string;
  detail: string | null;
}

interface SyncRow {
  synced_at: string;
  due_next: unknown;
}

interface CrewMemberRow {
  id: string;
  name: string;
}

/** Start/end of the pilot's local day as epoch ms (timezone-aware). */
function dayRange(now: Date, timeZone: string): { startMs: number; endMs: number; date: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));
  const approx = Date.UTC(year, month - 1, day);
  // Offset between the pilot's local midnight and UTC at that instant.
  const asLocal = new Date(new Date(approx).toLocaleString("en-US", { timeZone })).getTime();
  const startMs = approx - (asLocal - approx);
  return {
    startMs,
    endMs: startMs + 86_400_000,
    date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
  };
}

function toTodo(row: TodoRow): TodoItem {
  return {
    id: row.id,
    text: row.title,
    done: row.done,
    dueAt: row.due_at ? Date.parse(row.due_at) : null,
    createdAt: Date.parse(row.created_at) || Date.now(),
  };
}

export async function GET() {
  const warnings: string[] = [];

  let supabase: Awaited<ReturnType<typeof createClient>>;
  try {
    supabase = await createClient();
  } catch {
    return NextResponse.json(
      { error: "Today's briefing is unavailable right now. Please try again in a moment." },
      { status: 503 },
    );
  }

  let user;
  try {
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {
    user = null;
  }
  if (!user) {
    return NextResponse.json({ error: UNAUTH_MESSAGE }, { status: 401 });
  }
  const pilotId = user.id;

  // Pilot timezone for day boundaries; fall back to UTC on any failure.
  let timeZone = "UTC";
  try {
    const { data } = await supabase.from("pilots").select("timezone").eq("id", pilotId).single();
    if (data?.timezone) timeZone = data.timezone;
  } catch {
    // Keep the UTC fallback.
  }

  const now = new Date();
  const { startMs, endMs, date } = dayRange(now, timeZone);

  const briefing: TodayBriefing = {
    date,
    sections: { overdue: [], schedule: [], dueToday: [], nudges: [], school: [], handled: [] },
    counts: { overdue: 0, dueToday: 0, events: 0, nudges: 0, school: 0, handled: 0 },
    warnings,
  };

  // --- Todos: overdue + due today + handled (single fetch, split client-side) ---
  try {
    const { data, error } = await supabase
      .from("todos")
      .select("id,title,done,due_at,created_at")
      .eq("pilot_id", pilotId)
      .order("due_at", { ascending: true, nullsFirst: false })
      .limit(500);
    if (error) throw error;
    const rows = (data ?? []) as TodoRow[];
    for (const row of rows) {
      const dueAt = row.due_at ? Date.parse(row.due_at) : null;
      if (row.done) {
        briefing.sections.handled.push({ id: row.id, text: row.title, kind: "todo" } as HandledItem);
      } else if (dueAt !== null && dueAt < startMs) {
        briefing.sections.overdue.push(toTodo(row));
      } else if (dueAt !== null && dueAt >= startMs && dueAt < endMs) {
        briefing.sections.dueToday.push(toTodo(row));
      }
    }
  } catch {
    warnings.push("Your task list couldn't be read right now — it may be back on the next refresh.");
  }

  // --- Calendar: the table may not exist yet (Team A). Never crash on it. ---
  try {
    const { data, error } = await supabase
      .from("calendar_events")
      .select("id,title,start_at,end_at")
      .eq("pilot_id", pilotId)
      .gte("start_at", new Date(startMs).toISOString())
      .lt("start_at", new Date(endMs).toISOString())
      .order("start_at", { ascending: true })
      .limit(100);
    if (error) throw error;
    briefing.sections.schedule = ((data ?? []) as Array<{
      id: string;
      title: string;
      start_at: string;
      end_at: string;
    }>).map<CalendarEvent>((row) => ({
      id: row.id,
      title: row.title,
      startAt: Date.parse(row.start_at),
      endAt: Date.parse(row.end_at),
    }));
  } catch {
    // Calendar isn't built yet — this is expected, not an error.
  }

  // --- Nudges: active = not dismissed and due to surface today or overdue ---
  try {
    const { data, error } = await supabase
      .from("nudges")
      .select("id,kind,title,detail")
      .eq("pilot_id", pilotId)
      .is("dismissed_at", null)
      .or(`scheduled_for.is.null,scheduled_for.lt.${new Date(endMs).toISOString()}`)
      .order("scheduled_for", { ascending: true, nullsFirst: true })
      .limit(50);
    if (error) throw error;
    briefing.sections.nudges = ((data ?? []) as NudgeRow[]).map<NudgeItem>((row) => ({
      id: row.id,
      text: row.detail ? `${row.title} — ${row.detail}` : row.title,
      kind: row.kind,
    }));
  } catch {
    warnings.push("Your proactive nudges couldn't be read right now.");
  }

  // --- School: latest sync per crew member, due_next items due today ---
  try {
    const { data: members, error: membersError } = await supabase
      .from("crew_members")
      .select("id,name")
      .eq("pilot_id", pilotId);
    if (membersError) throw membersError;
    const crew = (members ?? []) as CrewMemberRow[];
    for (const member of crew) {
      try {
        const { data: syncs, error: syncError } = await supabase
          .from("crew_grade_syncs")
          .select("synced_at,due_next")
          .eq("crew_member_id", member.id)
          .order("synced_at", { ascending: false })
          .limit(1);
        if (syncError) throw syncError;
        const sync = (syncs ?? [])[0] as SyncRow | undefined;
        const items = Array.isArray(sync?.due_next) ? (sync?.due_next as Array<Record<string, unknown>>) : [];
        for (const item of items) {
          const rawDue =
            item.due_date ?? item.due ?? item.date ?? item.due_at ?? item.dueAt ?? null;
          const dueAt =
            typeof rawDue === "number"
              ? rawDue
              : typeof rawDue === "string"
                ? Date.parse(rawDue)
                : null;
          if (dueAt === null || Number.isNaN(dueAt) || dueAt < startMs || dueAt >= endMs) continue;
          const title =
            typeof item.title === "string"
              ? item.title
              : typeof item.name === "string"
                ? item.name
                : "School item";
          const className = typeof item.class === "string" ? item.class : null;
          briefing.sections.school.push({
            crewMemberId: member.id,
            crewMemberName: member.name,
            text: className ? `${className}: ${title}` : title,
            dueAt,
          } as SchoolItem);
        }
      } catch {
        // One crew member's sync failing must not hide the others.
      }
    }
  } catch {
    warnings.push("Crew school items couldn't be read right now.");
  }

  // --- Handled nudges: dismissed today fold into "Handled" too ---
  try {
    const { data, error } = await supabase
      .from("nudges")
      .select("id,title")
      .eq("pilot_id", pilotId)
      .gte("dismissed_at", new Date(startMs).toISOString())
      .lt("dismissed_at", new Date(endMs).toISOString())
      .limit(50);
    if (error) throw error;
    for (const row of (data ?? []) as Array<{ id: string; title: string }>) {
      briefing.sections.handled.push({ id: row.id, text: row.title, kind: "nudge" });
    }
  } catch {
    // Nudges already warned above; dismissed ones are optional garnish.
  }

  briefing.counts = {
    overdue: briefing.sections.overdue.length,
    dueToday: briefing.sections.dueToday.length,
    events: briefing.sections.schedule.length,
    nudges: briefing.sections.nudges.length,
    school: briefing.sections.school.length,
    handled: briefing.sections.handled.length,
  };

  return NextResponse.json(briefing, {
    headers: { "Cache-Control": "private, max-age=30" },
  });
}
