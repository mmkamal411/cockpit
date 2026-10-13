/**
 * School section sources — which sync row feeds which School applet section.
 *
 * The newest crew_grade_syncs row carries the freshest grades, but
 * laptop-worker rows can be grades-only (empty due_next / mail) while the
 * 4x-daily parent pulls carry the full payload. A grades-only row must never
 * blank "This week" or "Messages".
 */

export interface SyncRow {
  grades: unknown;
  class_details: unknown;
  synced_at: string;
  gpa: unknown;
  due_next: unknown;
  attendance: unknown;
  synergy_mail: unknown;
  office365_emails: unknown;
}

const hasDue = (r: SyncRow) =>
  Array.isArray(r.due_next) && r.due_next.length > 0;
const hasMail = (r: SyncRow) =>
  (Array.isArray(r.synergy_mail) && r.synergy_mail.length > 0) ||
  (Array.isArray(r.office365_emails) && r.office365_emails.length > 0);

/**
 * The newest row wins for grades; the newest row that HAS the section wins
 * for due_next / messages (falling back to the newest row when no row has it).
 */
export function pickSectionSources(rows: SyncRow[]): {
  latest: SyncRow;
  dueSource: SyncRow;
  mailSource: SyncRow;
} {
  const latest = rows[0];
  return {
    latest,
    dueSource: rows.find(hasDue) ?? latest,
    mailSource: rows.find(hasMail) ?? latest,
  };
}
