/**
 * mail-sync.ts — Outlook school-email sync orchestration (server only).
 *
 * Reuses the existing Outlook token infrastructure from ./calendar-outlook
 * (decryptToken + refresh flow) — there is exactly one token store. The
 * mail sync:
 *
 *   1. Loads the pilot's outlook calendar_connections row.
 *   2. Checks granted_scopes for Mail.Read. A legacy grant (authorized
 *      before Mail.Read existed, or with NULL scopes) is flagged
 *      needs_reconsent and never hits Graph — the connect route always
 *      asks consent, so one reconnect fixes it.
 *   3. Refreshes the access token via refreshOutlookAccessToken().
 *   4. Pulls school mail via ./graph-mail (date-windowed, 429-aware).
 *   5. Pushes a mail-only snapshot to crew_grade_syncs through
 *      rpc_push_crew_grade_sync (pull_method='graph-mail'). The snapshot
 *      carries grades: [] so the classes feed's "newest row with grades"
 *      logic never picks it, while the messages feed's "newest row with
 *      mail" logic picks it up — the exact shape mergeMessages reads.
 *
 * A Graph 403 (Mail.Read not granted in Azure or not consented) is a
 * distinct 'permission_missing' outcome with a plain-English message —
 * never a crash. The row keeps its status; the next sync retries.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { refreshOutlookAccessToken } from "@/lib/calendar-outlook";
import {
  fetchSchoolMail,
  GraphMailPermissionError,
  MAIL_READ_SCOPE,
  type SchoolEmail,
} from "@/lib/graph-mail";

export type MailSyncOutcome =
  | "synced"
  | "needs_reconsent"
  | "permission_missing"
  | "no_crew_member"
  | "error";

export interface MailSyncResult {
  connectionId: string;
  accountEmail: string | null;
  outcome: MailSyncOutcome;
  emails: number;
  /** Plain-English explanation when outcome isn't 'synced'. */
  message: string | null;
}

interface OutlookConnectionRow {
  id: string;
  pilot_id: string;
  provider: string;
  provider_account_email: string | null;
  refresh_token_enc: string | null;
  granted_scopes: string[] | null;
  status: string;
}

function scopesOf(row: OutlookConnectionRow): string[] {
  return Array.isArray(row.granted_scopes) ? row.granted_scopes : [];
}

/**
 * Sync school mail for one Outlook connection into a crew member's
 * grade-sync snapshot stream. `db` must be a service-role client for the
 * rpc push (the RPC's worker-secret check is bypassed for service_role).
 */
export async function syncOutlookMailConnection(
  connectionId: string,
  crewMemberId: string,
  db: SupabaseClient,
): Promise<MailSyncResult> {
  const base = { connectionId, accountEmail: null as string | null, emails: 0 };

  const { data: conn, error: connErr } = await db
    .from("calendar_connections")
    .select("id, pilot_id, provider, provider_account_email, refresh_token_enc, granted_scopes, status")
    .eq("id", connectionId)
    .eq("provider", "outlook")
    .single<OutlookConnectionRow>();
  if (connErr || !conn) {
    return { ...base, outcome: "error", message: "Couldn't find that Outlook connection." };
  }
  const accountEmail = conn.provider_account_email;

  // Scope gate: no Mail.Read in the stored grant -> ask for reconsent.
  // NULL granted_scopes = connected before scopes were persisted (pre-040).
  if (!scopesOf(conn).includes(MAIL_READ_SCOPE)) {
    await db
      .from("calendar_connections")
      .update({ status: "needs_reconsent" })
      .eq("id", conn.id);
    return {
      ...base,
      accountEmail,
      outcome: "needs_reconsent",
      message:
        "Your Outlook connection was set up before school email access existed. Reconnect it and approve email access to start syncing school mail.",
    };
  }

  let accessToken: string;
  try {
    accessToken = await refreshOutlookAccessToken(conn, db);
  } catch (e) {
    return {
      ...base,
      accountEmail,
      outcome: "error",
      message: e instanceof Error ? e.message : "Couldn't refresh the Outlook connection.",
    };
  }

  let emails: SchoolEmail[];
  try {
    emails = await fetchSchoolMail(accessToken);
  } catch (e) {
    if (e instanceof GraphMailPermissionError) {
      return {
        ...base,
        accountEmail,
        outcome: "permission_missing",
        message:
          "Microsoft didn't allow reading email. If you approved email access when connecting, your admin still needs to add the Mail.Read permission to the Crystal app in Azure — then reconnect.",
      };
    }
    await db
      .from("calendar_connections")
      .update({ status: "error" })
      .eq("id", conn.id);
    return {
      ...base,
      accountEmail,
      outcome: "error",
      message: e instanceof Error ? e.message : "Couldn't read Outlook email right now.",
    };
  }

  const now = new Date().toISOString();
  const { error: pushErr } = await db.rpc("rpc_push_crew_grade_sync", {
    p_data: {
      crew_member_id: crewMemberId,
      device_name: "cockpit-cloud",
      synced_at: now,
      grades: [],
      office365_emails: emails,
      pull_method: "graph-mail",
    },
  });
  if (pushErr) {
    await db
      .from("calendar_connections")
      .update({ status: "error" })
      .eq("id", conn.id);
    return {
      ...base,
      accountEmail,
      outcome: "error",
      emails: emails.length,
      message: "Pulled the school mail but couldn't save it. It will retry on the next sync.",
    };
  }

  await db
    .from("calendar_connections")
    .update({ status: "active", last_mail_sync_at: now })
    .eq("id", conn.id);

  return {
    ...base,
    accountEmail,
    outcome: "synced",
    emails: emails.length,
    message: null,
  };
}

/**
 * Resolve which crew member a pilot's mailbox syncs for: the requested
 * member when it belongs to the pilot, otherwise their first-added crew
 * member. Returns null when the pilot has no crew members (normal — the
 * pilot may not have children).
 */
export async function resolveMailCrewMember(
  db: SupabaseClient,
  pilotId: string,
  requestedId?: string,
): Promise<string | null> {
  if (requestedId) {
    const { data } = await db
      .from("crew_members")
      .select("id")
      .eq("id", requestedId)
      .eq("pilot_id", pilotId)
      .single<{ id: string }>();
    return data?.id ?? null;
  }
  const { data } = await db
    .from("crew_members")
    .select("id")
    .eq("pilot_id", pilotId)
    .order("created_at", { ascending: true })
    .limit(1)
    .single<{ id: string }>();
  return data?.id ?? null;
}

/**
 * Sync school mail for every outlook connection of one pilot
 * (status active or needs_reconsent). One bad connection never blocks the
 * rest. `db` must be a service-role client.
 */
export async function syncPilotOutlookMail(
  pilotId: string,
  crewMemberId: string,
  db: SupabaseClient,
): Promise<MailSyncResult[]> {
  const { data: connections, error } = await db
    .from("calendar_connections")
    .select("id")
    .eq("pilot_id", pilotId)
    .eq("provider", "outlook")
    .in("status", ["active", "needs_reconsent"]);
  if (error) throw new Error("Couldn't load your Outlook connections.");
  const results: MailSyncResult[] = [];
  for (const c of (connections ?? []) as Array<{ id: string }>) {
    results.push(await syncOutlookMailConnection(c.id, crewMemberId, db));
  }
  return results;
}
