/**
 * graph-mail.ts — Microsoft Graph mail provider (server only).
 *
 * Pulls school emails from a pilot's Microsoft 365 inbox via /me/messages
 * and maps them onto the crew_grade_syncs.office365_emails shape the
 * School applet already renders:
 *   [{ preview, sender, subject, date }]
 *
 * District-agnostic: no Cobb/portal assumptions. The sync reads the pilot's
 * own inbox and keeps messages that carry school signals (teacher, school,
 * .edu senders, grade/homework/report-card subjects). Everything else stays
 * out — the Messages section is for school mail, not a second inbox.
 *
 * Resilience: date-windowed (never a full re-pull), page-size capped, Graph
 * 429s honored via Retry-After with exponential backoff, 403s surfaced as a
 * distinct permission error so the caller can explain "email permission not
 * granted" instead of crashing. Tokens are never logged.
 */

export interface GraphEmailAddress {
  name?: string;
  address?: string;
}

export interface GraphMessage {
  id?: string;
  subject?: string;
  bodyPreview?: string;
  receivedDateTime?: string;
  from?: { emailAddress?: GraphEmailAddress };
  sender?: { emailAddress?: GraphEmailAddress };
  isRead?: boolean;
}

/** The shape stored on crew_grade_syncs.office365_emails. */
export interface SchoolEmail {
  preview: string;
  sender: string;
  subject: string;
  date: string;
}

/** Mail.Read is the delegated Graph permission the mail sync needs. */
export const MAIL_READ_SCOPE = "Mail.Read";

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

// School signals, kept deliberately generic (any district, any country).
// Matches sender names/addresses and subject lines.
const SCHOOL_SENDER_SIGNALS =
  /(teacher|principal|vice principal|counselor|counsellor|school|district|academy|attendance office|\.edu\b|k12|powerschool|infinite campus|parentvue|studentvue)/i;
const SCHOOL_SUBJECT_SIGNALS =
  /(grade|report card|progress report|homework|assignment|missing work|absence|tardy|detention|parent.?teacher|conference|field trip|school|principal|counselor|syllabus|exam|test score|quarter|semester)/i;

/**
 * A message counts as school mail when the sender looks school-ish or the
 * subject carries a school signal. Boring personal mail never matches.
 */
export function isSchoolEmail(msg: GraphMessage): boolean {
  const from = msg.from?.emailAddress ?? msg.sender?.emailAddress;
  const senderText = `${from?.name ?? ""} ${from?.address ?? ""}`.trim();
  if (senderText && SCHOOL_SENDER_SIGNALS.test(senderText)) return true;
  return SCHOOL_SUBJECT_SIGNALS.test(msg.subject ?? "");
}

function senderLabel(msg: GraphMessage): string {
  const from = msg.from?.emailAddress ?? msg.sender?.emailAddress;
  return (from?.name ?? "").trim() || (from?.address ?? "").trim();
}

/**
 * Map one Graph message onto the office365_emails row shape.
 * Returns null when the message has nothing worth storing.
 */
export function mapGraphMessage(msg: GraphMessage): SchoolEmail | null {
  const subject = (msg.subject ?? "").trim();
  const preview = (msg.bodyPreview ?? "").trim();
  const sender = senderLabel(msg);
  if (!subject && !preview) return null;
  return {
    preview: preview.slice(0, 280),
    sender,
    subject: subject.slice(0, 200),
    date: msg.receivedDateTime ?? "",
  };
}

/** Distinct error for "the grant doesn't include Mail.Read" (Graph 403). */
export class GraphMailPermissionError extends Error {
  constructor() {
    super(
      "Microsoft didn't allow reading email — the Outlook email permission isn't granted yet.",
    );
    this.name = "GraphMailPermissionError";
  }
}

export interface MailFetchOptions {
  /** Days of inbox history to scan. Default 14. */
  daysBack?: number;
  /** Page size per Graph call. Default 50 (Graph max for messages). */
  pageSize?: number;
  /** Max school emails to keep. Default 25. */
  maxEmails?: number;
  /** Max Graph pages to walk before stopping. Default 10. */
  maxPages?: number;
}

const DEFAULTS: Required<MailFetchOptions> = {
  daysBack: 14,
  pageSize: 50,
  maxEmails: 25,
  maxPages: 10,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch one Graph page, honoring 429 rate limits with Retry-After backoff
 * (capped). Throws GraphMailPermissionError on 403, Error otherwise.
 */
async function fetchMailPage(url: string, accessToken: string): Promise<{
  value: GraphMessage[];
  nextLink: string | null;
}> {
  const maxAttempts = 4;
  let attempt = 0;
  for (;;) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (res.status === 429 && attempt < maxAttempts - 1) {
      const retryAfter = Number(res.headers.get("Retry-After") ?? "0");
      const waitMs = Math.min(
        (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2000) *
          2 ** attempt,
        30000,
      );
      attempt += 1;
      await sleep(waitMs);
      continue;
    }
    if (res.status === 403) throw new GraphMailPermissionError();
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const msg = (body as { error?: { message?: string } }).error?.message;
      throw new Error(
        msg ? `Couldn't read Outlook email: ${msg}` : "Couldn't read Outlook email right now.",
      );
    }
    const page = (await res.json()) as {
      value?: GraphMessage[];
      "@odata.nextLink"?: string;
    };
    return { value: page.value ?? [], nextLink: page["@odata.nextLink"] ?? null };
  }
}

/**
 * Pull school emails from the inbox: newest first, date-windowed, with the
 * school-signal filter applied as pages arrive. Stops early once enough
 * school emails are found — personal mail is never fetched past what's
 * needed to fill the quota.
 */
export async function fetchSchoolMail(
  accessToken: string,
  options: MailFetchOptions = {},
): Promise<SchoolEmail[]> {
  const { daysBack, pageSize, maxEmails, maxPages } = { ...DEFAULTS, ...options };
  const since = new Date(Date.now() - daysBack * 24 * 60 * 60 * 1000).toISOString();
  const params = new URLSearchParams({
    $top: String(Math.min(Math.max(pageSize, 1), 50)),
    $orderby: "receivedDateTime desc",
    $filter: `receivedDateTime ge ${since}`,
    $select: "id,subject,bodyPreview,receivedDateTime,from,sender",
  });
  let next: string | null = `${GRAPH_BASE}/me/messages?${params}`;
  const out: SchoolEmail[] = [];
  const seen = new Set<string>();
  let pages = 0;
  while (next && pages < maxPages && out.length < maxEmails) {
    const { value, nextLink } = await fetchMailPage(next, accessToken);
    pages += 1;
    for (const msg of value) {
      const id = msg.id ?? "";
      if (id && seen.has(id)) continue;
      if (id) seen.add(id);
      if (!isSchoolEmail(msg)) continue;
      const mapped = mapGraphMessage(msg);
      if (mapped) out.push(mapped);
      if (out.length >= maxEmails) break;
    }
    next = nextLink;
  }
  return out;
}
