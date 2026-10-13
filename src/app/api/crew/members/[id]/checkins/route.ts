import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPilotId, unauthorized } from "@/lib/crew/auth";

/** True when Supabase says the table doesn't exist yet (migration pending). */
function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return (
    error.code === "42P01" ||
    /relation .* does not exist/i.test(error.message ?? "")
  );
}

type AccessRole = "steward" | "child" | null;

/**
 * Who may touch a crew member's check-ins: the steward pilot, or the linked
 * child pilot themselves (Phase C — the child owns their check-in).
 * RLS (checkins_steward_shared_all / checkins_child_self) enforces the
 * channel rules underneath; this just decides who gets past the door.
 */
async function accessFor(
  crewMemberId: string,
  pilotId: string,
): Promise<{ role: AccessRole; supabase: Awaited<ReturnType<typeof createClient>> }> {
  const supabase = await createClient();
  const { data: member } = await supabase
    .from("crew_members")
    .select("id, pilot_id")
    .eq("id", crewMemberId)
    .single();
  if (!member) return { role: null, supabase };
  if (member.pilot_id === pilotId) return { role: "steward", supabase };
  const { data: pilot } = await supabase
    .from("pilots")
    .select("child_crew_member_id")
    .eq("id", pilotId)
    .single();
  if ((pilot?.child_crew_member_id as string | null) === crewMemberId) {
    return { role: "child", supabase };
  }
  return { role: null, supabase };
}

/**
 * GET /api/crew/members/[id]/checkins?class=<name>&days=<n>
 * Recent check-ins for a crew member (optionally one class). Reads shared +
 * private channels — the caller decides what to render by channel.
 * Returns { checkins: [], unavailable: true } when the table doesn't exist yet.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const pilotId = await getPilotId();
  if (!pilotId) return NextResponse.json(unauthorized(), { status: 401 });
  const { id: crewMemberId } = await params;
  const className = request.nextUrl.searchParams.get("class") ?? "";
  const days = Math.min(90, Math.max(1, Number(request.nextUrl.searchParams.get("days")) || 14));

  const { role, supabase } = await accessFor(crewMemberId, pilotId);
  if (!role) {
    return NextResponse.json(
      { error: "Couldn't find that crew member." },
      { status: 404 },
    );
  }

  const since = new Date(Date.now() - days * 86_400_000)
    .toISOString()
    .slice(0, 10);
  let query = supabase
    .from("checkins")
    .select(
      "id, class_name, checkin_date, worked_on, confusing, due_next, note, channel, created_by, created_at",
    )
    .eq("crew_member_id", crewMemberId)
    .gte("checkin_date", since)
    .order("checkin_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(60);
  if (className.trim()) query = query.eq("class_name", className.trim());

  const { data, error } = await query;
  if (error) {
    if (isMissingTable(error)) {
      return NextResponse.json({ checkins: [], unavailable: true });
    }
    return NextResponse.json(
      { error: "Couldn't load check-ins. Try again." },
      { status: 500 },
    );
  }
  return NextResponse.json({ checkins: data });
}

interface CheckinBody {
  class_name?: string;
  worked_on?: string[];
  confusing?: string[];
  due_next?: string[];
  note?: string;
  channel?: string;
}

const clean = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.filter((x) => typeof x === "string" && x.trim()).map((x) => x.trim()).slice(0, 12)
    : [];

/**
 * POST /api/crew/members/[id]/checkins
 * Save one check-in. Channel defaults to "shared" (D1: shared by default,
 * "Just for me" is opt-in). Text is optional — chips-only saves are fine.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const pilotId = await getPilotId();
  if (!pilotId) return NextResponse.json(unauthorized(), { status: 401 });
  const { id: crewMemberId } = await params;

  let body: CheckinBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "We couldn't read that check-in. Try again." },
      { status: 400 },
    );
  }

  const { role, supabase } = await accessFor(crewMemberId, pilotId);
  if (!role) {
    return NextResponse.json(
      { error: "Couldn't find that crew member." },
      { status: 404 },
    );
  }

  const workedOn = clean(body.worked_on);
  const confusing = clean(body.confusing);
  const dueNext = clean(body.due_next);
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : "";
  const channel = body.channel === "private" ? "private" : "shared";

  if (workedOn.length === 0 && confusing.length === 0 && dueNext.length === 0 && !note) {
    return NextResponse.json(
      { error: "Tap at least one chip or write a line — anything counts." },
      { status: 400 },
    );
  }

  const { data, error } = await supabase
    .from("checkins")
    .insert({
      crew_member_id: crewMemberId,
      class_name: body.class_name?.trim() || null,
      checkin_date: new Date().toISOString().slice(0, 10),
      worked_on: workedOn,
      confusing,
      due_next: dueNext,
      note: note || null,
      channel,
      created_by: role === "child" ? "crew" : "pilot",
    })
    .select(
      "id, class_name, checkin_date, worked_on, confusing, due_next, note, channel, created_by, created_at",
    )
    .single();

  if (error) {
    if (isMissingTable(error)) {
      return NextResponse.json(
        { error: "Check-ins aren't switched on yet — the school tables are still being set up. Your words are safe here; try again in a bit." },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { error: "Couldn't save that check-in. Try again." },
      { status: 500 },
    );
  }
  return NextResponse.json({ checkin: data });
}
