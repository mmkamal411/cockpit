import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/admin/serviceClient";
import {
  resolveMailCrewMember,
  syncPilotOutlookMail,
  type MailSyncResult,
} from "@/lib/mail-sync";

export const dynamic = "force-dynamic";

/**
 * POST /api/mail/sync/outlook
 *
 * Syncs school email from the pilot's connected Outlook accounts into the
 * crew member's school snapshot stream (crew_grade_syncs, pull_method
 * 'graph-mail'). The School applet's Messages section picks the rows up
 * automatically — same table, same office365_emails shape.
 *
 * Body (JSON, optional): { "crew_member_id": "uuid" } to sync mail for one
 * specific crew member. Defaults to the pilot's first-added crew member.
 *
 * Response 200: { ok, synced_emails, results: MailSyncResult[] } where each
 * result carries outcome 'synced' | 'needs_reconsent' | 'permission_missing'
 * | 'no_crew_member' | 'error' and a plain-English message. A connection
 * that needs reconsent never fails the whole sync.
 */
export async function POST(req: NextRequest) {
  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return NextResponse.json({ error: "Couldn't reach the database right now." }, { status: 503 });
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first, then sync your school mail." }, { status: 401 });
  }

  let db;
  try {
    db = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: "School mail sync isn't set up on this server yet." },
      { status: 503 },
    );
  }

  let requestedId: string | undefined;
  try {
    const body = await req.json().catch(() => null);
    if (body && typeof body.crew_member_id === "string" && body.crew_member_id.trim()) {
      requestedId = body.crew_member_id.trim();
    }
  } catch {
    requestedId = undefined;
  }

  const crewMemberId = await resolveMailCrewMember(db, user.id, requestedId);
  if (!crewMemberId) {
    const results: MailSyncResult[] = [];
    return NextResponse.json({
      ok: true,
      synced_emails: 0,
      results,
      message: requestedId
        ? "Couldn't find that crew member."
        : "Add a crew member first — school mail sync starts once there's someone to sync for.",
    });
  }

  let results: MailSyncResult[];
  try {
    results = await syncPilotOutlookMail(user.id, crewMemberId, db);
  } catch {
    return NextResponse.json(
      { error: "Couldn't check your Outlook connections right now. Please try again in a bit." },
      { status: 500 },
    );
  }

  if (results.length === 0) {
    return NextResponse.json({
      ok: true,
      synced_emails: 0,
      results,
      message: "No Outlook accounts connected yet. Connect one to sync school mail.",
    });
  }

  const needsReconsent = results.some((r) => r.outcome === "needs_reconsent");
  return NextResponse.json({
    ok: results.every((r) => r.outcome === "synced"),
    synced_emails: results.reduce((n, r) => n + r.emails, 0),
    needs_reconsent: needsReconsent,
    results: results.map((r) => ({
      account: r.accountEmail,
      outcome: r.outcome,
      emails: r.emails,
      message: r.message,
    })),
  });
}
