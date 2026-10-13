import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPilotId, unauthorized } from "@/lib/crew/auth";

/**
 * GET /api/crew/members — roster of the pilot's crew members.
 * RLS (`crew_members_pilot_all`) scopes to the signed-in pilot.
 */
export async function GET() {
  const pilotId = await getPilotId();
  if (!pilotId) {
    return NextResponse.json(unauthorized(), { status: 401 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crew_members")
    .select("id, name, birthdate, relationship, created_at")
    .order("created_at", { ascending: true });

  if (error) {
    console.error(
      JSON.stringify({
        route: "GET /api/crew/members",
        operation: "select crew_members",
        error: error.message,
      }),
    );
    return NextResponse.json(
      { error: "Couldn't load your crew right now. Try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({ members: data });
}

interface AddMemberBody {
  name?: string;
  birthdate?: string;
  relationship?: string;
}

/**
 * POST /api/crew/members — add a crew member.
 * Body: { name, birthdate (YYYY-MM-DD), relationship? }.
 * pilot_id comes from the session — never from the client.
 */
export async function POST(request: NextRequest) {
  const pilotId = await getPilotId();
  if (!pilotId) {
    return NextResponse.json(unauthorized(), { status: 401 });
  }

  let body: AddMemberBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "We couldn't read that request. Try again." },
      { status: 400 },
    );
  }

  const name = (body.name ?? "").trim();
  if (!name) {
    return NextResponse.json(
      { error: "Give your crew member a name so Crystal knows who they are." },
      { status: 400 },
    );
  }
  if (!body.birthdate) {
    return NextResponse.json(
      { error: "Add a birthdate — it helps Crystal get the details right." },
      { status: 400 },
    );
  }

  // Validate the birthdate parses as a real date.
  const parsed = new Date(body.birthdate);
  if (Number.isNaN(parsed.getTime())) {
    return NextResponse.json(
      { error: "That birthdate doesn't look right. Try YYYY-MM-DD." },
      { status: 400 },
    );
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("crew_members")
    .insert({
      pilot_id: pilotId,
      name,
      birthdate: body.birthdate,
      relationship: body.relationship?.trim() || "child",
    })
    .select("id, name, birthdate, relationship, created_at")
    .single();

  if (error) {
    console.error(
      JSON.stringify({
        route: "POST /api/crew/members",
        operation: "insert crew_members",
        error: error.message,
      }),
    );
    return NextResponse.json(
      { error: "Couldn't add them right now. Try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({ member: data }, { status: 201 });
}
