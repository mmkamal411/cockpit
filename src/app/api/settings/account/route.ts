import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getPilotId, unauthorized } from "@/lib/crew/auth";

const GRACE_DAYS = 30;

/**
 * GET /api/settings/account
 * Account status: whether a deletion is pending and when the grace period ends.
 */
export async function GET() {
  try {
    const pilotId = await getPilotId();
    if (!pilotId) return NextResponse.json(unauthorized(), { status: 401 });

    const supabase = await createClient();
    const { data, error } = await supabase
      .from("pilots")
      .select("deletion_requested_at")
      .eq("id", pilotId)
      .maybeSingle();
    if (error) throw error;

    const requestedAt = data?.deletion_requested_at as string | null;
    return NextResponse.json({
      deletion_requested_at: requestedAt,
      grace_days: GRACE_DAYS,
      erase_date: requestedAt
        ? new Date(new Date(requestedAt).getTime() + GRACE_DAYS * 86400000).toISOString()
        : null,
    });
  } catch {
    return NextResponse.json(
      { error: "Couldn't check your account status right now." },
      { status: 500 },
    );
  }
}

/**
 * DELETE /api/settings/account
 * The DangerZone. Body: { confirm: string } — must equal the pilot's email.
 * Does NOT erase immediately: sets deletion_requested_at, and the account is
 * erased 30 days later. Signing in again before then cancels the deletion.
 *
 * POST /api/settings/account { action: "cancel" } — cancel a pending deletion.
 */
export async function DELETE(req: Request) {
  try {
    const pilotId = await getPilotId();
    if (!pilotId) return NextResponse.json(unauthorized(), { status: 401 });

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    const email = (user?.email ?? "").toLowerCase();

    const body = await req.json().catch(() => ({}));
    const confirm = String(body.confirm ?? "").trim().toLowerCase();
    if (!email || confirm !== email) {
      return NextResponse.json(
        { error: "Type your sign-in email exactly to confirm. Nothing was changed." },
        { status: 400 },
      );
    }

    const eraseDate = new Date(Date.now() + GRACE_DAYS * 86400000);
    const { error } = await supabase
      .from("pilots")
      .update({ deletion_requested_at: new Date().toISOString() })
      .eq("id", pilotId);
    if (error) throw error;

    return NextResponse.json({
      ok: true,
      erase_date: eraseDate.toISOString(),
      grace_days: GRACE_DAYS,
    });
  } catch (e) {
    console.error(
      JSON.stringify({
        route: "DELETE /api/settings/account",
        operation: "request deletion",
        error: e instanceof Error ? e.message : String(e),
      }),
    );
    return NextResponse.json(
      { error: "Couldn't start the deletion right now. Try again." },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  try {
    const pilotId = await getPilotId();
    if (!pilotId) return NextResponse.json(unauthorized(), { status: 401 });

    const body = await req.json().catch(() => ({}));
    if (body.action !== "cancel") {
      return NextResponse.json({ error: "Nothing to do." }, { status: 400 });
    }

    const supabase = await createClient();
    const { error } = await supabase
      .from("pilots")
      .update({ deletion_requested_at: null })
      .eq("id", pilotId);
    if (error) throw error;
    return NextResponse.json({ ok: true, cancelled: true });
  } catch {
    return NextResponse.json(
      { error: "Couldn't cancel the deletion right now. Try again." },
      { status: 500 },
    );
  }
}
