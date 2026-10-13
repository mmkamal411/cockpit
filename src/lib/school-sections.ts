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

export interface DueNextEntry {
  assignment?: string;
  /** ParentVUE fallback pulls key the title "title", not "assignment". */
  title?: string;
  name?: string;
  due?: string;
  class?: string;
}

export interface UpcomingItem {
  assignment: string;
  due: string | null;
  class: string | null;
}

/**
 * Sanitize the due_next upcoming-assignment list for the client.
 *
 * Sync workers don't all key the assignment title the same way: the
 * laptop workers write `assignment`, the ParentVUE fallback pull writes
 * `title`. Read `assignment` first, then `title`, then `name` — a row
 * whose entries use a different key must never silently blank This week.
 */
export function normalizeDueNext(dueNext: unknown): UpcomingItem[] {
  if (!Array.isArray(dueNext)) return [];
  const out: UpcomingItem[] = [];
  for (const e of dueNext as DueNextEntry[]) {
    const raw =
      typeof e.assignment === "string" && e.assignment.trim()
        ? e.assignment
        : typeof e.title === "string" && e.title.trim()
          ? e.title
          : typeof e.name === "string"
            ? e.name
            : "";
    const assignment = raw.trim();
    if (!assignment) continue;
    out.push({
      assignment,
      due: typeof e.due === "string" ? e.due.trim() : null,
      class:
        typeof e.class === "string" && e.class.trim() ? e.class.trim() : null,
    });
    if (out.length >= 60) break;
  }
  return out;
}
