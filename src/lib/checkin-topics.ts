/**
 * Check-in → guidance wiring.
 *
 * `extractTopicsFromCheckin` pulls the meaningful topics out of a child's
 * check-in text; `flaggedTopics` reads the last 7 days of check-ins and
 * returns the topics to tag onto Path-to-90 actions as "You flagged this".
 * This is the wiring Meheldi demanded: check-in text must feed the plan,
 * not sit in a database unread.
 */

const STOPWORDS = new Set([
  "the", "and", "for", "with", "that", "this", "from", "have", "has",
  "had", "were", "was", "are", "but", "not", "you", "your", "about",
  "like", "just", "really", "very", "didn", "don", "doesn", "could",
  "would", "should", "there", "their", "what", "when", "which", "how",
  "because", "thing", "things", "stuff", "quiz", "test", "homework",
  "class", "today", "tomorrow", "chapter", "assignment",
]);

export interface CheckinRow {
  confusing?: string | null;
  note?: string | null;
  due_next?: string | null;
  worked_on?: string | null;
  created_at?: string | null;
}

/**
 * Extract candidate topics from free text: lowercase words ≥4 chars,
 * minus stopwords, minus duplicates. Returns up to 8 topics.
 */
export function extractTopicsFromCheckin(text: string): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (w.length >= 4 && !STOPWORDS.has(w) && !seen.has(w)) {
      seen.add(w);
      out.push(w);
      if (out.length >= 8) break;
    }
  }
  return out;
}

/** Combine a check-in row's free-text fields into one searchable blob. */
export function checkinText(row: CheckinRow): string {
  return [row.confusing, row.note, row.due_next, row.worked_on]
    .filter(Boolean)
    .join(" ");
}

/**
 * Topics flagged over the last 7 days of check-ins, most-recent first.
 * Feed these into `buildPathActions({ flaggedTopics })` and tag matching
 * actions with "You flagged this".
 */
export function flaggedTopics(checkins: CheckinRow[], limit = 6): string[] {
  const cutoff = Date.now() - 7 * 86_400_000;
  const ranked = new Map<string, number>();
  for (const row of checkins) {
    const ts = row.created_at ? new Date(row.created_at).getTime() : Date.now();
    if (Number.isNaN(ts) || ts < cutoff) continue;
    for (const t of extractTopicsFromCheckin(checkinText(row))) {
      ranked.set(t, Math.max(ranked.get(t) ?? 0, ts));
    }
  }
  return [...ranked.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([t]) => t);
}
