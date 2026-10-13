import type { SupabaseClient } from "@supabase/supabase-js";

export interface AdminAuditEntry {
  /** The admin who acted (their sign-in email). */
  actorEmail: string;
  /**
   * What happened, namespaced dot notation, e.g. 'user.delete',
   * 'user.suspend', 'table.export', 'admin.impersonate_view'.
   */
  action: string;
  /** What kind of thing was acted on, e.g. 'pilot', 'crew_member', 'table'. */
  targetType?: string | null;
  /** ID of the acted-on row, as text. Null when there is no single target. */
  targetId?: string | null;
  /** Snapshot of the relevant state BEFORE the action. Redact secrets. */
  before?: unknown;
  /** Snapshot AFTER the action. Redact secrets. */
  after?: unknown;
  /** Extra context: reason, IP, confirmation id, row counts. No credentials. */
  metadata?: unknown;
}

/**
 * Insert one row into admin_audit_log. Use the admin (service-role) client.
 *
 * NEVER throws: a logging failure is written to the console but must not
 * break the admin action it was recording.
 */
export async function logAdminAction(
  client: SupabaseClient,
  entry: AdminAuditEntry,
): Promise<void> {
  try {
    const { error } = await client.from("admin_audit_log").insert({
      actor_email: entry.actorEmail,
      action: entry.action,
      target_type: entry.targetType ?? null,
      target_id: entry.targetId ?? null,
      before: entry.before ?? null,
      after: entry.after ?? null,
      metadata: entry.metadata ?? null,
    });
    if (error) {
      console.error("[admin-audit] insert failed", error);
    }
  } catch (err) {
    console.error("[admin-audit] insert threw", err);
  }
}
