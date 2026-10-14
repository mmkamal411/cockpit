/**
 * Sync Data Review — pure logic for the "what did the sync actually collect"
 * view (shared by the review API route and the client component).
 *
 * Reads two crew_grade_syncs rows (latest + previous), normalizes the known
 * fields into a field inventory, and diffs latest-vs-previous so the view
 * can badge what's new or changed. Empty fields get an honest reason:
 * "not-collected" (the workers never gather it), "failed-this-pull" (the
 * previous pull had it, this one came back empty), or "no-new-data".
 */

export interface GradeItem {
  name: string;
  grade: number | null;
  letter: string | null;
  gapTo90: number | null;
  teacher: string | null;
}

export interface CategoryInfo {
  name: string;
  weight: number | null;
  average: number | null;
}

export interface ClassCategoryInfo {
  className: string;
  categories: CategoryInfo[];
}

export interface AssignmentItem {
  title: string;
  className: string | null;
  due: string | null;
  score: string | null;
  status: string | null;
  category: string | null;
}

export interface TitledItem {
  title: string;
  date: string | null;
  className: string | null;
}

export interface MailItem {
  source: "synergy" | "outlook";
  sender: string | null;
  subject: string | null;
  preview: string | null;
  date: string | null;
}

export interface PastPeriod {
  period: string;
  value: string | null;
}

export interface SyllabusEntry {
  className: string;
  url: string | null;
}

/** Everything the review view renders, normalized from one sync row. */
export interface SyncSnapshot {
  syncedAt: string | null;
  pullMethod: string | null;
  deviceName: string | null;
  grades: GradeItem[];
  categories: ClassCategoryInfo[];
  gpa: Record<string, string>;
  attendance: Record<string, string>;
  dueNext: { assignment: string; due: string | null; className: string | null }[];
  announcements: TitledItem[];
  ctlsUpcoming: TitledItem[];
  synergyMail: MailItem[];
  outlookMail: MailItem[];
  pastPeriods: PastPeriod[];
  syllabi: SyllabusEntry[];
  zeroGuardFlags: string[];
  missing: AssignmentItem[];
  upcomingAssignments: AssignmentItem[];
  graded: AssignmentItem[];
  /** Parent-pipeline rows report a bare missing count per class instead of assignments. */
  missingCountFallback: number | null;
}

// ---------------------------------------------------------------------------
// Primitive helpers
// ---------------------------------------------------------------------------

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = parseFloat(value.replace("%", ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/** Cobb County letter scale: A 90+, B 80+, C 74+, D 70+, F below. */
function letterFor(grade: number | null): string | null {
  if (grade === null) return null;
  if (grade >= 90) return "A";
  if (grade >= 80) return "B";
  if (grade >= 74) return "C";
  if (grade >= 70) return "D";
  return "F";
}

function normName(name: string): string {
  return name.trim().toLowerCase();
}

/** Parse a sync due-date string ("10/16/2026", "10/16") into a local Date. */
function parseSyncDate(due: string | null | undefined): Date | null {
  if (!due) return null;
  const trimmed = due.trim();
  const m = trimmed.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (!m) {
    const t = Date.parse(trimmed);
    return Number.isNaN(t) ? null : new Date(t);
  }
  const month = parseInt(m[1], 10);
  const day = parseInt(m[2], 10);
  let year = m[3] ? parseInt(m[3], 10) : new Date().getFullYear();
  if (year < 100) year += 2000;
  const d = new Date(year, month - 1, day);
  if (Number.isNaN(d.getTime()) || d.getMonth() !== month - 1) return null;
  if (!m[3]) {
    // No year given: school dates belong to this school year, so a date more
    // than a month in the past must mean next year.
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (d.getTime() < startOfToday.getTime() - 30 * 86_400_000) {
      d.setFullYear(d.getFullYear() + 1);
    }
  }
  return d;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

// ---------------------------------------------------------------------------
// Sanitizer — one sync row -> SyncSnapshot
// ---------------------------------------------------------------------------

interface RawClassDetail {
  class?: unknown;
  name?: unknown;
  teacher?: unknown;
  categories?: unknown;
  assignments?: unknown;
  recent_items?: unknown;
  missing?: unknown;
  missing_count?: unknown;
}

function sanitizeGradeItem(g: unknown, teacherByClass: Map<string, string>): GradeItem | null {
  if (!isRecord(g)) return null;
  const name = toText(g.class ?? g.name);
  if (!name) return null;
  const grade = toNumber(g.grade);
  return {
    name,
    grade,
    letter: toText(g.letter) ?? letterFor(grade),
    gapTo90: grade === null ? null : Math.max(0, 90 - grade),
    teacher: teacherByClass.get(normName(name)) ?? null,
  };
}

function sanitizeCategories(detail: RawClassDetail): ClassCategoryInfo | null {
  const name = toText(detail.class ?? detail.name);
  if (!name || !isRecord(detail.categories)) return null;
  const categories: CategoryInfo[] = [];
  for (const [catName, raw] of Object.entries(detail.categories)) {
    if (isRecord(raw)) {
      categories.push({
        name: catName,
        weight: toNumber(raw.weight ?? raw.weight_percent ?? raw.pct),
        average: toNumber(raw.average ?? raw.avg ?? raw.score ?? raw.grade),
      });
    } else {
      const n = toNumber(raw);
      if (n !== null) categories.push({ name: catName, weight: n, average: null });
    }
  }
  return { className: name, categories };
}

/**
 * Parent-pipeline rows carry graded work as display strings like
 * "Quiz 3.1 (Week 09): 30.00% (10/01)". Best-effort parse back into items.
 */
function parseRecentItem(s: string, className: string): AssignmentItem | null {
  const trimmed = s.trim();
  if (!trimmed) return null;
  const m = trimmed.match(/^(.*?):\s*([\d.]+%?)\s*(?:\((\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\))?$/);
  if (!m) return { title: trimmed, className, due: null, score: null, status: null, category: null };
  return {
    title: m[1].trim(),
    className,
    due: m[3] ?? null,
    score: m[2],
    status: null,
    category: null,
  };
}

function sanitizeAssignment(a: unknown, className: string): AssignmentItem | null {
  if (!isRecord(a)) return null;
  const title = toText(a.title ?? a.assignment ?? a.name);
  if (!title) return null;
  const scoreRaw = a.score ?? a.percent;
  return {
    title,
    className,
    due: toText(a.due),
    score: scoreRaw == null ? null : toText(scoreRaw),
    status: toText(a.status),
    category: toText(a.category),
  };
}

function sanitizeTitledItem(e: unknown): TitledItem | null {
  if (!isRecord(e)) return null;
  const title = toText(e.title ?? e.assignment ?? e.subject);
  if (!title) return null;
  return {
    title,
    date: toText(e.date ?? e.due),
    className: toText(e.class ?? e.className),
  };
}

function sanitizeMailItem(e: unknown, source: "synergy" | "outlook"): MailItem | null {
  if (!isRecord(e)) return null;
  return {
    source,
    sender: toText(e.sender),
    subject: toText(e.subject),
    preview: toText(e.preview),
    date: toText(e.date),
  };
}

/** Missing = explicitly flagged missing, or past due with no score yet. */
function isMissing(a: AssignmentItem): boolean {
  if (a.status && /missing/i.test(a.status)) return true;
  const d = parseSyncDate(a.due);
  if (!d) return false;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return a.score === null && d.getTime() < startOfToday.getTime();
}

/** Upcoming = due today or later with no score yet. */
function isUpcoming(a: AssignmentItem): boolean {
  const d = parseSyncDate(a.due);
  if (!d) return false;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return a.score === null && d.getTime() >= startOfToday.getTime();
}

export function sanitizeSyncSnapshot(row: unknown): SyncSnapshot {
  const r = isRecord(row) ? row : {};
  const empty: SyncSnapshot = {
    syncedAt: typeof r.synced_at === "string" ? r.synced_at : null,
    pullMethod: toText(r.pull_method),
    deviceName: toText(r.device_name),
    grades: [],
    categories: [],
    gpa: {},
    attendance: {},
    dueNext: [],
    announcements: [],
    ctlsUpcoming: [],
    synergyMail: [],
    outlookMail: [],
    pastPeriods: [],
    syllabi: [],
    zeroGuardFlags: [],
    missing: [],
    upcomingAssignments: [],
    graded: [],
    missingCountFallback: null,
  };

  const details: RawClassDetail[] = Array.isArray(r.class_details)
    ? (r.class_details as RawClassDetail[])
    : [];
  const teacherByClass = new Map<string, string>();
  for (const d of details) {
    const key = normName(toText(d.class ?? d.name) ?? "");
    const teacher = toText(d.teacher);
    if (key && teacher) teacherByClass.set(key, teacher);
  }

  const grades: GradeItem[] = [];
  if (Array.isArray(r.grades)) {
    for (const g of r.grades) {
      const item = sanitizeGradeItem(g, teacherByClass);
      if (item) grades.push(item);
    }
  }
  empty.grades = grades;

  // Per-class: categories, assignments (missing / upcoming / graded).
  let missingFallbackTotal: number | null = null;
  const bumpMissingFallback = (v: unknown) => {
    const n = toNumber(v);
    if (n !== null) missingFallbackTotal = (missingFallbackTotal ?? 0) + n;
  };
  for (const d of details) {
    const className = toText(d.class ?? d.name) ?? "Unknown class";
    const catInfo = sanitizeCategories(d);
    if (catInfo && catInfo.categories.length > 0) empty.categories.push(catInfo);
    bumpMissingFallback(d.missing);
    bumpMissingFallback(d.missing_count);

    const rawAssignments = Array.isArray(d.assignments) ? d.assignments : [];
    const items: AssignmentItem[] = [];
    for (const a of rawAssignments) {
      const item = sanitizeAssignment(a, className);
      if (item) items.push(item);
    }
    for (const item of items) {
      if (isMissing(item)) empty.missing.push(item);
      else if (isUpcoming(item)) empty.upcomingAssignments.push(item);
      else if (item.score !== null) empty.graded.push(item);
    }
    // Parent-pipeline shape: recent_items display strings ("Quiz 3.1 (Week 09):
    // 30.00% (10/01)") stand in for the graded-work list — keep them as graded
    // by provenance rather than re-classifying bare titles.
    if (Array.isArray(d.recent_items)) {
      for (const s of d.recent_items) {
        if (typeof s === "string") {
          const item = parseRecentItem(s, className);
          if (item) empty.graded.push(item);
        }
      }
    }
  }
  empty.missingCountFallback = missingFallbackTotal;

  if (isRecord(r.gpa)) {
    for (const [k, v] of Object.entries(r.gpa)) {
      const t = toText(v);
      if (t) empty.gpa[k] = t;
    }
  }
  if (isRecord(r.attendance)) {
    for (const [k, v] of Object.entries(r.attendance)) {
      const t = toText(v);
      if (t) empty.attendance[k] = t;
    }
  }

  // due_next titles can key as `assignment` (laptop workers) or `title`
  // (ParentVUE fallback pull) — read every key.
  if (Array.isArray(r.due_next)) {
    for (const e of r.due_next) {
      if (!isRecord(e)) continue;
      const assignment = toText(e.assignment ?? e.title ?? e.name);
      if (!assignment) continue;
      empty.dueNext.push({
        assignment,
        due: toText(e.due),
        className: toText(e.class ?? e.className),
      });
    }
  }

  if (Array.isArray(r.ctls_announcements)) {
    for (const e of r.ctls_announcements) {
      const item = sanitizeTitledItem(e);
      if (item) empty.announcements.push(item);
    }
  }
  if (Array.isArray(r.ctls_upcoming)) {
    for (const e of r.ctls_upcoming) {
      const item = sanitizeTitledItem(e);
      if (item) empty.ctlsUpcoming.push(item);
    }
  }
  if (Array.isArray(r.synergy_mail)) {
    for (const e of r.synergy_mail) {
      const item = sanitizeMailItem(e, "synergy");
      if (item) empty.synergyMail.push(item);
    }
  }
  if (Array.isArray(r.office365_emails)) {
    for (const e of r.office365_emails) {
      const item = sanitizeMailItem(e, "outlook");
      if (item) empty.outlookMail.push(item);
    }
  }
  if (Array.isArray(r.past_periods)) {
    for (const e of r.past_periods) {
      if (!isRecord(e)) continue;
      const period = toText(e.period ?? e.name);
      if (!period) continue;
      empty.pastPeriods.push({ period, value: toText(e.value ?? e.grade) });
    }
  }
  if (isRecord(r.ctls_syllabi)) {
    for (const [className, v] of Object.entries(r.ctls_syllabi)) {
      if (isRecord(v)) {
        empty.syllabi.push({ className, url: toText(v.url) });
      } else {
        const url = toText(v);
        empty.syllabi.push({ className, url });
      }
    }
  }
  if (Array.isArray(r.zero_guard_flags)) {
    for (const f of r.zero_guard_flags) {
      const t = typeof f === "string" ? f : isRecord(f) ? toText(f.flag ?? f.message) : null;
      if (t) empty.zeroGuardFlags.push(t);
    }
  }

  return empty;
}

// ---------------------------------------------------------------------------
// Diffs — latest vs previous
// ---------------------------------------------------------------------------

export type ItemChange = "new" | "removed" | "changed";

export interface GradeChange {
  name: string;
  kind: ItemChange;
  from: number | null;
  to: number | null;
}

export function diffGrades(cur: GradeItem[], prev: GradeItem[]): GradeChange[] {
  const prevByName = new Map(prev.map((g) => [normName(g.name), g]));
  const curByName = new Map(cur.map((g) => [normName(g.name), g]));
  const out: GradeChange[] = [];
  for (const g of cur) {
    const p = prevByName.get(normName(g.name));
    if (!p) out.push({ name: g.name, kind: "new", from: null, to: g.grade });
    else if (p.grade !== g.grade) out.push({ name: g.name, kind: "changed", from: p.grade, to: g.grade });
  }
  for (const g of prev) {
    if (!curByName.has(normName(g.name))) {
      out.push({ name: g.name, kind: "removed", from: g.grade, to: null });
    }
  }
  return out;
}

export interface KeyChange {
  key: string;
  kind: ItemChange;
  from: string | null;
  to: string | null;
}

export function diffKeyed(cur: Record<string, string>, prev: Record<string, string>): KeyChange[] {
  const out: KeyChange[] = [];
  for (const [k, v] of Object.entries(cur)) {
    if (!(k in prev)) out.push({ key: k, kind: "new", from: null, to: v });
    else if (prev[k] !== v) out.push({ key: k, kind: "changed", from: prev[k], to: v });
  }
  for (const k of Object.keys(prev)) {
    if (!(k in cur)) out.push({ key: k, kind: "removed", from: prev[k], to: null });
  }
  return out;
}

export interface TitleChange {
  title: string;
  kind: "new" | "removed";
}

export function diffTitled(cur: { title: string }[], prev: { title: string }[]): TitleChange[] {
  const norm = (t: string) => t.trim().toLowerCase();
  const prevSet = new Set(prev.map((i) => norm(i.title)));
  const curSet = new Set(cur.map((i) => norm(i.title)));
  const out: TitleChange[] = [];
  for (const i of cur) {
    if (!prevSet.has(norm(i.title))) out.push({ title: i.title, kind: "new" });
  }
  for (const i of prev) {
    if (!curSet.has(norm(i.title))) out.push({ title: i.title, kind: "removed" });
  }
  return out;
}

export interface CategoryChange {
  className: string;
  category: string;
  field: "weight" | "average";
  from: number | null;
  to: number | null;
}

export function diffCategories(cur: ClassCategoryInfo[], prev: ClassCategoryInfo[]): CategoryChange[] {
  const out: CategoryChange[] = [];
  const prevByClass = new Map(prev.map((c) => [normName(c.className), c]));
  for (const c of cur) {
    const p = prevByClass.get(normName(c.className));
    if (!p) continue;
    const prevByCat = new Map(p.categories.map((x) => [normName(x.name), x]));
    for (const cat of c.categories) {
      const pc = prevByCat.get(normName(cat.name));
      if (!pc) continue;
      if (pc.weight !== cat.weight) {
        out.push({ className: c.className, category: cat.name, field: "weight", from: pc.weight, to: cat.weight });
      }
      if (pc.average !== cat.average) {
        out.push({ className: c.className, category: cat.name, field: "average", from: pc.average, to: cat.average });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Empty-state honesty
// ---------------------------------------------------------------------------

export type EmptyKind = "not-collected" | "failed-this-pull" | "no-new-data";

/**
 * Fields the workers never meaningfully gather (checked-in worker code
 * hardcodes them empty, or no pipeline emits them). Everything else the
 * workers DO attempt — so empty-now + had-data = this pull failed, and
 * empty-now + never-had = no new data.
 */
const NEVER_COLLECTED: ReadonlySet<string> = new Set([
  "gpa",
  "attendance",
  "categories",
  "outlook",
  "syllabi",
]);

export type ReviewField =
  | "grades"
  | "categories"
  | "gpa"
  | "attendance"
  | "assignments"
  | "due_next"
  | "announcements"
  | "synergy"
  | "outlook"
  | "calendar"
  | "past_periods"
  | "syllabi";

export function emptyKind(
  field: ReviewField,
  hasNow: boolean,
  hadBefore: boolean,
): EmptyKind | null {
  if (hasNow) return null;
  if (NEVER_COLLECTED.has(field)) return "not-collected";
  return hadBefore ? "failed-this-pull" : "no-new-data";
}

/**
 * Plain-English reason a category is empty. Grandmother test: no jargon,
 * no internal metaphors, and it says what to expect next.
 */
export function emptyReasonCopy(field: ReviewField, kind: EmptyKind): string {
  switch (field) {
    case "grades":
      return kind === "failed-this-pull"
        ? "This pull came back without any classes — the last one had grades. Worth re-running the sync or checking the school login."
        : "No grades in this pull yet. The first successful school sync fills this in.";
    case "categories":
      return "Not collected yet — the sync pulls overall class grades, but not the weight-and-average breakdown inside each gradebook. That wiring isn't built.";
    case "gpa":
      return "Not collected yet — ParentVUE shows GPA, but the sync doesn't read it yet.";
    case "attendance":
      return "Not collected yet — ParentVUE tracks absences and tardies, but the sync doesn't read them yet.";
    case "assignments":
      return kind === "failed-this-pull"
        ? "This pull came back with no assignment detail — the last one had some. The next sync usually restores it."
        : "No assignment detail in this pull. It appears when a sync carries per-class assignments.";
    case "due_next":
      return kind === "failed-this-pull"
        ? "This pull came back with no upcoming work — the last one had some."
        : "Nothing upcoming in this pull — no dated assignments were picked up.";
    case "announcements":
      return kind === "failed-this-pull"
        ? "This pull came back with no announcements — the last one carried some."
        : "No announcements in this pull — the school feed hasn't surfaced any through the sync.";
    case "synergy":
      return kind === "failed-this-pull"
        ? "This pull came back with no portal messages — the last one had some."
        : "No portal messages in this pull — nothing new from the school portal.";
    case "outlook":
      return "Not collected yet — the school-email connection isn't built, so there's nothing to pull.";
    case "calendar":
      return kind === "failed-this-pull"
        ? "This pull came back with no calendar dates — the last one had some."
        : "No calendar dates in this pull — no dated school events were picked up.";
    case "past_periods":
      return "No past grading periods in this pull — they show up when a sync carries grading-period history.";
    case "syllabi":
      return "Not collected yet — the sync doesn't read course syllabi.";
  }
}

// ---------------------------------------------------------------------------
// Pipeline / freshness labels
// ---------------------------------------------------------------------------

/** Plain-English pipeline name from pull_method + device_name. */
export function friendlyPipeline(
  pullMethod: string | null,
  deviceName: string | null,
): string {
  const d = (deviceName ?? "").toLowerCase();
  if (/win/.test(d)) return "Windows laptop";
  if (/mac|darwin/.test(d) || d === "laptop") return "MacBook";
  if (/parent/.test(d)) return "ParentVUE pull (this station)";
  if (/browser/.test(d)) return "Browser task";
  const method = (pullMethod ?? "").toLowerCase();
  if (method === "api") return deviceName ? `Mobile API (${deviceName})` : "Mobile API";
  if (method === "browser") return deviceName ? `Browser pull (${deviceName})` : "Browser pull";
  return deviceName ?? "Unknown source";
}

/** Hours between now and a synced_at timestamp, or null when unknown. */
export function hoursSince(syncedAt: string | null): number | null {
  if (!syncedAt) return null;
  const ms = Date.parse(syncedAt);
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.round((Date.now() - ms) / 3600000));
}

/** "3 hours ago" / "just now" / "2 days ago" freshness wording. */
export function freshnessLine(hours: number | null): string {
  if (hours === null) return "Last pull time unknown";
  if (hours < 1) return "Last pulled just now";
  if (hours === 1) return "Last pulled 1 hour ago";
  if (hours < 24) return `Last pulled ${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "Last pulled 1 day ago" : `Last pulled ${days} days ago`;
}

/** Human key label: "weighted_gpa" -> "Weighted gpa". */
export function prettyKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
