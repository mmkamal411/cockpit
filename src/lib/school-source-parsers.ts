/**
 * school-source-parsers.ts
 *
 * District-agnostic parsers that turn public school web pages into structured
 * data for Cockpit's school-sources intake:
 *
 *   - parseCalendarPage     -> DigitalCalendarEvent[] (district calendar pages)
 *   - parseBellSchedulePage -> DigitalBellSchedule[]  (bell-schedule pages; one
 *                              page can hold several schedules, e.g. "Daily"
 *                              and "WEB", so this returns an array)
 *
 * Principles:
 *   - Zero dependencies: pure TypeScript, regex + string scanning only.
 *   - Never fabricate: every returned row comes from text found on the page.
 *     When nothing parseable is found the result is ok:false with a
 *     plain-English error, never invented data.
 *   - Honest confidence: "high" only for structured sources (JSON-LD event
 *     blocks, HTML tables with recognizable headers); "medium" for heuristic
 *     matches (text lists, markdown pipe tables); "low" for guesses
 *     (definition lists, unlabeled sections). Uncertainties go in warnings[].
 *   - Times normalize to 24-hour HH:MM. A time with no AM/PM marker gets the
 *     school-day heuristic (7-11 -> AM, 12 -> noon, 1-6 -> PM) and a warning.
 *   - Dates normalize to YYYY-MM-DD. A date with no year is placed in the
 *     school year (August-July) containing today, America/New_York, with a
 *     warning.
 */

export interface DigitalCalendarEvent {
  title: string;
  date: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  location?: string;
  description?: string;
}

export interface BellPeriod {
  name: string;
  start: string; // HH:MM 24-hour
  end: string; // HH:MM 24-hour
}

export interface DigitalBellSchedule {
  label: string;
  periods: BellPeriod[];
  sourceNote?: string;
}

export interface ParseResult<T> {
  ok: boolean;
  data: T;
  confidence: "high" | "medium" | "low";
  warnings: string[];
  error?: string;
}

// ---------------------------------------------------------------------------
// Shared text utilities
// ---------------------------------------------------------------------------

const ENTITY_MAP: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&nbsp;": " ",
  "&ndash;": "\u2013",
  "&mdash;": "\u2014",
};

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&(amp|lt|gt|quot|nbsp|ndash|mdash);/g, (m) => ENTITY_MAP[m] ?? m);
}

/** Remove script/style blocks so their code never leaks into text strategies. */
function removeScriptAndStyle(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "\n")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "\n");
}

/** Strip HTML tags to plain text, preserving line breaks at block boundaries. */
function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|tr|h[1-6]|section|article|dd|dt|td|th)>/gi, "\n")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/[ \t\f\v\u00a0]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n");
}

/** Remove markdown emphasis/formatting characters from a heading or label. */
function cleanLabel(raw: string): string {
  return stripTags(raw)
    .replace(/[*_~`#]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Time normalization -> HH:MM (24-hour)
// ---------------------------------------------------------------------------

const TIME_WITH_MARKER_RE = /(\d{1,2})(?::(\d{2}))?\s*([ap])\.?\s*m\.?/i;
const BARE_TIME_RE = /(\d{1,2}):(\d{2})/;

interface NormalizedTime {
  time: string;
  guessedAmPm: boolean;
}

/**
 * Normalize one time token to 24-hour HH:MM.
 * With an AM/PM marker the conversion is exact. Without a marker we apply the
 * school-day heuristic: 7-11 -> morning, 12 -> noon, 1-6 -> afternoon, and
 * flag guessedAmPm so callers can warn. Returns null when not a real time.
 */
function normalizeTime(raw: string): NormalizedTime | null {
  const text = raw.trim();
  if (!text) return null;

  let hour: number;
  let minute: number;
  let guessed = false;

  const marked = text.match(TIME_WITH_MARKER_RE);
  if (marked) {
    hour = parseInt(marked[1], 10);
    minute = marked[2] ? parseInt(marked[2], 10) : 0;
    const isPm = marked[3].toLowerCase() === "p";
    if (isPm && hour < 12) hour += 12;
    if (!isPm && hour === 12) hour = 0;
  } else {
    const bare = text.match(BARE_TIME_RE);
    if (!bare) return null;
    hour = parseInt(bare[1], 10);
    minute = parseInt(bare[2], 10);
    guessed = true;
    if (hour >= 13 && hour <= 23) {
      // Already 24-hour; keep.
    } else if (hour === 12) {
      // Noon.
    } else if (hour >= 7 && hour <= 11) {
      // Morning.
    } else if (hour >= 1 && hour <= 6) {
      hour += 12; // Afternoon.
    } else {
      return null; // 0 or >23 is not a school time.
    }
  }

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return {
    time: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    guessedAmPm: guessed,
  };
}

/**
 * Split a cell that holds a time range ("7:25 AM - 8:15 AM", "7:25\u20138:15",
 * "7:25 to 8:15") into its parts. A lone hyphen only splits before a digit so
 * names like "Q Block" are never torn apart.
 */
function splitTimeRange(cell: string): string[] {
  return cell
    .split(/\s*(?:\u2013|\u2014|\bto\b|-(?=\d))\s*/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** True when the text contains at least one recognizable time token. */
function containsTimeToken(text: string): boolean {
  return TIME_WITH_MARKER_RE.test(text) || BARE_TIME_RE.test(text);
}

// ---------------------------------------------------------------------------
// Date normalization -> YYYY-MM-DD
// ---------------------------------------------------------------------------

const MONTH_PATTERN =
  "(january|february|march|april|may|june|july|august|september|october|november|december" +
  "|sept|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)";

const MONTH_NUMBERS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8,
  sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

interface NormalizedDate {
  ymd: string;
  yearInferred: boolean;
}

function nyParts(d: Date): { y: number; m: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "numeric",
  }).formatToParts(d);
  const get = (type: string): number =>
    parseInt(parts.find((p) => p.type === type)?.value ?? "0", 10);
  return { y: get("year"), m: get("month") };
}

/**
 * Place a month-only date in the school year (August-July) containing `ref`.
 * An August date seen in October belongs to the current school year; a March
 * date seen in October belongs to the coming spring.
 */
function inferSchoolYear(month: number, ref: Date): number {
  const { y, m } = nyParts(ref);
  if (month >= 8) return m >= 8 ? y : y - 1;
  return m >= 8 ? y + 1 : y;
}

function buildDate(year: number, month: number, day: number, yearInferred: boolean): NormalizedDate | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const check = new Date(Date.UTC(year, month - 1, day));
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day
  ) {
    return null; // e.g. February 30.
  }
  const ymd =
    `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { ymd, yearInferred };
}

/** Parse a date string to YYYY-MM-DD. Returns null when unparseable. */
function parseDateToYMD(raw: string, ref: Date): NormalizedDate | null {
  const s = raw.trim();
  let m: RegExpMatchArray | null;

  // ISO: 2026-10-13 or 2026-10-13T07:30:00
  m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return buildDate(parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10), false);

  // US numeric: 10/13/2026
  m = s.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (m) {
    let year = parseInt(m[3], 10);
    if (year < 100) year += year < 50 ? 2000 : 1900;
    return buildDate(year, parseInt(m[1], 10), parseInt(m[2], 10), false);
  }

  // "October 13, 2026" / "Oct 13 2026"
  m = s.match(new RegExp(`\\b${MONTH_PATTERN}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})`, "i"));
  if (m) {
    const month = MONTH_NUMBERS[m[1].toLowerCase()];
    if (month) return buildDate(parseInt(m[3], 10), month, parseInt(m[2], 10), false);
  }

  // "13 October 2026"
  m = s.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_PATTERN}\\.?,?\\s+(\\d{4})`, "i"));
  if (m) {
    const month = MONTH_NUMBERS[m[2].toLowerCase()];
    if (month) return buildDate(parseInt(m[4], 10), month, parseInt(m[1], 10), false);
  }

  // Month + day, no year -> school-year rollover (America/New_York).
  m = s.match(new RegExp(`\\b${MONTH_PATTERN}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?!\\s*,?\\s*\\d{4})`, "i"));
  if (m) {
    const month = MONTH_NUMBERS[m[1].toLowerCase()];
    if (month) return buildDate(inferSchoolYear(month, ref), month, parseInt(m[2], 10), true);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Calendar parsing
// ---------------------------------------------------------------------------

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function jsonLdToEvent(obj: Record<string, unknown>, ref: Date): DigitalCalendarEvent | null {
  const title = asString(obj["name"]) ?? asString(obj["headline"]);
  const startRaw = asString(obj["startDate"]);
  if (!title || !startRaw) return null;
  const start = parseDateToYMD(startRaw, ref);
  if (!start) return null;

  const event: DigitalCalendarEvent = {
    title: title.trim().slice(0, 200),
    date: start.ymd,
  };

  const endRaw = asString(obj["endDate"]);
  if (endRaw) {
    const end = parseDateToYMD(endRaw, ref);
    if (end && end.ymd !== event.date) event.endDate = end.ymd;
  }

  const location = obj["location"];
  const locationName =
    typeof location === "string"
      ? location
      : location && typeof location === "object"
        ? asString((location as Record<string, unknown>)["name"])
        : undefined;
  if (locationName) event.location = locationName.trim().slice(0, 200);

  const description = asString(obj["description"]);
  if (description) event.description = description.trim().slice(0, 500);

  return event;
}

function walkJsonLd(node: unknown, ref: Date, out: DigitalCalendarEvent[]): void {
  if (Array.isArray(node)) {
    for (const item of node) walkJsonLd(item, ref, out);
    return;
  }
  if (!node || typeof node !== "object") return;
  const obj = node as Record<string, unknown>;

  const typeValue = obj["@type"];
  const types = Array.isArray(typeValue) ? typeValue : [typeValue];
  if (types.some((t) => typeof t === "string" && t.toLowerCase() === "event")) {
    const event = jsonLdToEvent(obj, ref);
    if (event) out.push(event);
  }

  // Common containers that nest events.
  for (const key of ["@graph", "itemListElement", "subEvent", "mainEntity"]) {
    if (obj[key] !== undefined) walkJsonLd(obj[key], ref, out);
  }
}

/** Strategy 1 (high confidence): schema.org Event blocks in JSON-LD. */
function extractJsonLdEvents(html: string, ref: Date): DigitalCalendarEvent[] {
  const events: DigitalCalendarEvent[] = [];
  const scriptRe = /<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(html)) !== null) {
    let data: unknown;
    try {
      data = JSON.parse(m[1]);
    } catch {
      continue; // Malformed block: skip, don't fail the whole page.
    }
    walkJsonLd(data, ref, events);
  }
  return events;
}

/**
 * Strategy 2 (medium): <time datetime="..."> elements. The title is the
 * nearest readable text before the tag — heuristic, so medium confidence.
 */
function extractTimeTagEvents(html: string, ref: Date): DigitalCalendarEvent[] {
  const events: DigitalCalendarEvent[] = [];
  const timeRe = /<time\b[^>]*datetime=["']([^"']+)["'][^>]*>/gi;
  let m: RegExpExecArray | null;
  while ((m = timeRe.exec(html)) !== null) {
    const parsed = parseDateToYMD(m[1], ref);
    if (!parsed) continue;
    const before = stripTags(html.slice(Math.max(0, m.index - 400), m.index));
    const lines = before.split("\n").filter((l) => l.length >= 3);
    const title = (lines[lines.length - 1] ?? "").replace(/\s+/g, " ").trim().slice(0, 140);
    if (!title) continue;
    events.push({ title, date: parsed.ymd });
  }
  return events;
}

const DATE_RANGE_RE = new RegExp(
  `\\b(${MONTH_PATTERN})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*[\u2013\u2014-]\\s*(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})`,
  "i",
);

/**
 * Strategy 3 (medium): plain-text lines that contain a date. Covers rendered
 * event lists (Finalsite/Blackboard-style) and text fetches. Lines that are
 * JS template placeholders ({{...}}) are skipped outright.
 */
function extractTextListEvents(text: string, ref: Date): { events: DigitalCalendarEvent[]; yearInferred: boolean } {
  const events: DigitalCalendarEvent[] = [];
  let yearInferred = false;

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.length < 4 || line.length > 300) continue;
    if (/{{|}}/.test(line) || /\b(aitm|vm)\./.test(line)) continue; // JS app shell, not an event.

    let dateText: string | null = null;
    let start: NormalizedDate | null = null;
    let end: NormalizedDate | null = null;

    const range = line.match(DATE_RANGE_RE);
    if (range) {
      const month = MONTH_NUMBERS[range[1].toLowerCase()];
      const year = parseInt(range[4], 10);
      if (month) {
        dateText = range[0];
        start = buildDate(year, month, parseInt(range[2], 10), false);
        end = buildDate(year, month, parseInt(range[3], 10), false);
      }
    } else {
      // Find the first parseable date substring in the line.
      const candidates = line.match(
        new RegExp(
          `\\d{4}-\\d{1,2}-\\d{1,2}|\\b\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}\\b|\\b${MONTH_PATTERN}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}|\\b\\d{1,2}(?:st|nd|rd|th)?\\s+${MONTH_PATTERN}\\.?,?\\s+\\d{4}|\\b${MONTH_PATTERN}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`,
          "i",
        ),
      );
      if (candidates) {
        dateText = candidates[0];
        start = parseDateToYMD(dateText, ref);
      }
    }

    if (!dateText || !start) continue;
    if (start.yearInferred || (end && end.yearInferred)) yearInferred = true;

    const title = line
      .replace(dateText, " ")
      .replace(/[*_~`]+/g, "")
      .replace(/^[\s\-*•|–—:;.,]+/, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 140);
    if (title.length < 3) continue;

    const event: DigitalCalendarEvent = { title, date: start.ymd };
    if (end && end.ymd !== event.date) event.endDate = end.ymd;
    events.push(event);
  }

  return { events, yearInferred };
}

function finalizeEvents(events: DigitalCalendarEvent[], warnings: string[]): DigitalCalendarEvent[] {
  const seen = new Set<string>();
  const unique: DigitalCalendarEvent[] = [];
  for (const event of events) {
    const key = `${event.title.toLowerCase()}|${event.date}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(event);
  }
  unique.sort((a, b) =>
    a.date < b.date ? -1 : a.date > b.date ? 1 : a.title.localeCompare(b.title),
  );
  if (unique.length > 500) {
    warnings.push(`Found ${unique.length} events; keeping the first 500 by date.`);
  }
  return unique.slice(0, 500);
}

/** True when the page looks like an unrendered JS app shell (Angular/React/Vue templates). */
function looksLikeTemplateShell(text: string): boolean {
  return /{{[^}]{1,80}}}/.test(text);
}

export function parseCalendarPage(html: string, url: string): ParseResult<DigitalCalendarEvent[]> {
  const warnings: string[] = [];
  const ref = new Date();

  if (!html || !html.trim()) {
    return {
      ok: false,
      data: [],
      confidence: "low",
      warnings,
      error: "The page came back empty, so there was nothing to read.",
    };
  }

  // Strategy 1: structured JSON-LD (high confidence).
  const jsonLdEvents = extractJsonLdEvents(html, ref);

  // Strategy 2: <time datetime> elements (medium).
  const timeTagEvents = jsonLdEvents.length === 0 ? extractTimeTagEvents(html, ref) : [];

  // Strategy 3: plain-text lines with dates (medium). Script/style content is
  // removed first so code (e.g. JSON-LD source) can't become fake events.
  const text = stripTags(removeScriptAndStyle(html));
  const { events: textEvents, yearInferred } = extractTextListEvents(text, ref);

  const events = finalizeEvents([...jsonLdEvents, ...timeTagEvents, ...textEvents], warnings);

  if (events.length === 0) {
    const error = looksLikeTemplateShell(text)
      ? "This calendar page loads its events with JavaScript, so there were no events in the page for us to read. We did not invent any."
      : `We couldn't find any calendar events on this page (${url}). Its layout may not be one we recognize yet.`;
    return { ok: false, data: [], confidence: "low", warnings, error };
  }

  let confidence: ParseResult<DigitalCalendarEvent[]>["confidence"] = "medium";
  if (jsonLdEvents.length > 0 && timeTagEvents.length === 0 && textEvents.length === 0) {
    confidence = "high";
  }
  if (yearInferred) {
    warnings.push(
      "Some dates had no year on the page; they were placed in the current school year (Aug\u2013Jul, America/New_York).",
    );
  }
  if (timeTagEvents.length > 0) {
    warnings.push(
      "Some events were matched from <time> tags to nearby text; titles are best-effort.",
    );
  }
  if (jsonLdEvents.length === 0 && textEvents.length > 0) {
    warnings.push("Events were read from plain page text; titles and dates are best-effort.");
  }

  return { ok: true, data: events, confidence, warnings };
}

// ---------------------------------------------------------------------------
// Bell-schedule parsing
// ---------------------------------------------------------------------------

interface PageSection {
  label: string;
  start: number;
  end: number;
}

/**
 * Split the page into sections at headings (HTML h1-h6 or markdown # lines).
 * Text before the first heading becomes its own unlabeled section so
 * heading-less pages still parse as one schedule.
 */
function splitSections(source: string): PageSection[] {
  const heads: { label: string; index: number; end: number }[] = [];

  const htmlHeadRe = /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi;
  let m: RegExpExecArray | null;
  while ((m = htmlHeadRe.exec(source)) !== null) {
    heads.push({ label: cleanLabel(m[1]), index: m.index, end: m.index + m[0].length });
  }

  const mdHeadRe = /^#{1,6}\s+(.+?)\s*$/gm;
  while ((m = mdHeadRe.exec(source)) !== null) {
    heads.push({ label: cleanLabel(m[1]), index: m.index, end: m.index + m[0].length });
  }

  heads.sort((a, b) => a.index - b.index);

  const sections: PageSection[] = [];
  if (heads.length === 0) {
    sections.push({ label: "", start: 0, end: source.length });
  } else {
    if (heads[0].index > 0) sections.push({ label: "", start: 0, end: heads[0].index });
    heads.forEach((h, i) => {
      sections.push({
        label: h.label,
        start: h.end,
        end: i + 1 < heads.length ? heads[i + 1].index : source.length,
      });
    });
  }
  return sections;
}

interface RawTable {
  header: string[] | null;
  rows: string[][];
  kind: "html" | "markdown";
}

function splitPipeRow(line: string): string[] {
  const cells = line.trim().split("|").map((c) => stripTags(c).trim());
  if (cells.length > 0 && cells[0] === "") cells.shift();
  if (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
  return cells;
}

function isPipeRow(line: string): boolean {
  const t = line.trim();
  return t.startsWith("|") && t.split("|").length >= 3;
}

function isSeparatorRow(line: string): boolean {
  const cells = splitPipeRow(line);
  return cells.length > 0 && cells.every((c) => /^:?-+:?$/.test(c));
}

/** Extract HTML <table>s and markdown pipe tables from a chunk of the page. */
function extractTables(chunk: string): RawTable[] {
  const tables: RawTable[] = [];

  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  let tm: RegExpExecArray | null;
  while ((tm = tableRe.exec(chunk)) !== null) {
    const body = tm[1];
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    const rows: { cells: string[]; hasTh: boolean }[] = [];
    let rm: RegExpExecArray | null;
    while ((rm = rowRe.exec(body)) !== null) {
      const rowHtml = rm[1];
      const cellRe = /<(t[hd])\b[^>]*>([\s\S]*?)<\/t[hd]>/gi;
      const cells: string[] = [];
      let hasTh = false;
      let cm: RegExpExecArray | null;
      while ((cm = cellRe.exec(rowHtml)) !== null) {
        if (cm[1].toLowerCase() === "th") hasTh = true;
        cells.push(stripTags(cm[2]).trim());
      }
      if (cells.length > 0) rows.push({ cells, hasTh });
    }
    if (rows.length === 0) continue;
    const first = rows[0];
    const headerLooksReal =
      first.hasTh ||
      first.cells.some((c) =>
        /(period|block|class|session|course|start|begin|from|end|finish|dismiss|time|name|label)/i.test(c),
      );
    tables.push({
      header: headerLooksReal ? first.cells : null,
      rows: (headerLooksReal ? rows.slice(1) : rows).map((r) => r.cells),
      kind: "html",
    });
  }

  const lines = chunk.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!isPipeRow(lines[i])) continue;
    // The separator row may sit a blank line or two below the header
    // (common in text extractions of rendered tables).
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === "") j++;
    if (j >= lines.length || !isSeparatorRow(lines[j])) continue;
    const header = splitPipeRow(lines[i]);
    const rows: string[][] = [];
    j++;
    while (j < lines.length) {
      if (lines[j].trim() === "") {
        j++;
        continue;
      }
      if (!isPipeRow(lines[j]) || isSeparatorRow(lines[j])) break;
      rows.push(splitPipeRow(lines[j]));
      j++;
    }
    if (rows.length > 0) tables.push({ header, rows, kind: "markdown" });
    i = j - 1;
  }

  return tables;
}

interface ColumnMap {
  name: number;
  start: number;
  end: number; // may equal start when one column holds a range
}

const NAME_HEADER_RE = /(period|block|class|session|course|name|label|title)/i;
const START_HEADER_RE = /(start|begin|from|arrival|open)/i;
const END_HEADER_RE = /(end|finish|dismiss|clos)/i;
const DURATION_HEADER_RE = /(min|duration|length)/i;

function timeColumnScore(rows: string[][], col: number): number {
  let hits = 0;
  let total = 0;
  for (const row of rows) {
    const cell = row[col] ?? "";
    if (!cell.trim()) continue;
    total++;
    if (containsTimeToken(cell)) hits++;
  }
  return total === 0 ? 0 : hits / total;
}

/**
 * Work out which columns hold the period name, start time, and end time.
 * Prefers header wording ("Period", "Start", "End" in any phrasing); falls
 * back to content shape (columns that mostly look like times). Duration
 * columns ("(63 min)") are always excluded.
 */
function mapColumns(header: string[] | null, rows: string[][]): ColumnMap | null {
  const width = Math.max(header?.length ?? 0, ...rows.map((r) => r.length));
  if (width === 0) return null;

  let name = -1;
  let start = -1;
  let end = -1;

  if (header) {
    header.forEach((cell, i) => {
      if (DURATION_HEADER_RE.test(cell)) return;
      if (NAME_HEADER_RE.test(cell) && name === -1) name = i;
      else if (START_HEADER_RE.test(cell) && start === -1) start = i;
      else if (END_HEADER_RE.test(cell) && end === -1) end = i;
    });
  }

  if (start === -1 || end === -1) {
    // Content-based fallback: the two most time-like columns are start/end.
    const scores = Array.from({ length: width }, (_, i) => timeColumnScore(rows, i));
    const timeCols = scores
      .map((score, i) => ({ score, i }))
      .filter((c) => c.score >= 0.5)
      .sort((a, b) => b.score - a.score || a.i - b.i);
    if (timeCols.length === 0) return null;
    if (start === -1) start = timeCols[0].i;
    if (end === -1) end = timeCols.length > 1 ? timeCols[1].i : timeCols[0].i;
  }

  if (name === -1) {
    // First column that doesn't look like times.
    for (let i = 0; i < width; i++) {
      if (i !== start && i !== end && timeColumnScore(rows, i) < 0.5) {
        name = i;
        break;
      }
    }
    if (name === -1) name = 0;
  }

  return { name, start, end };
}

interface TableParse {
  periods: BellPeriod[];
  structured: boolean; // true when headers were recognized (not guessed)
  guessedAmPm: boolean;
  skippedRows: number;
  boilerplateStripped: number; // rows whose label came from boilerplate stripping
}

function parseTable(table: RawTable): TableParse {
  const result: TableParse = { periods: [], structured: false, guessedAmPm: false, skippedRows: 0, boilerplateStripped: 0 };
  const mapping = mapColumns(table.header, table.rows);
  if (!mapping) return result;
  result.structured = table.header !== null;

  for (const row of table.rows) {
    const extracted = extractPeriodLabel(row[mapping.name] ?? "");
    if (extracted.boilerplate) result.boilerplateStripped++;
    const name = extracted.label;
    if (!name || /^\d+\s*min/i.test(name) || name.length > 80) {
      result.skippedRows++;
      continue;
    }

    let startCell = (row[mapping.start] ?? "").trim();
    let endCell = (row[mapping.end] ?? "").trim();

    if (mapping.start === mapping.end || !endCell) {
      const parts = splitTimeRange(startCell);
      if (parts.length >= 2) {
        startCell = parts[0];
        endCell = parts[parts.length - 1];
      }
    }

    const start = normalizeTime(startCell);
    const end = normalizeTime(endCell);
    if (!start || !end) {
      result.skippedRows++;
      continue;
    }
    // Times are HH:MM 24-hour, so string comparison is chronological.
    // A bell can't end before (or exactly when) it starts — such rows are
    // garbage, not data.
    if (end.time <= start.time) {
      result.skippedRows++;
      continue;
    }

    if (start.guessedAmPm || end.guessedAmPm) result.guessedAmPm = true;
    result.periods.push({ name, start: start.time, end: end.time });
  }

  return result;
}

/** Definition lists: <dt>Period 1</dt><dd>8:00 AM to 8:30 AM</dd> (low confidence). */
function parseDefinitionLists(chunk: string): TableParse {
  const result: TableParse = { periods: [], structured: false, guessedAmPm: false, skippedRows: 0, boilerplateStripped: 0 };
  const dlRe = /<dl\b[^>]*>([\s\S]*?)<\/dl>/gi;
  let dm: RegExpExecArray | null;
  while ((dm = dlRe.exec(chunk)) !== null) {
    const pairRe = /<dt\b[^>]*>([\s\S]*?)<\/dt>\s*<dd\b[^>]*>([\s\S]*?)<\/dd>/gi;
    let pm: RegExpExecArray | null;
    while ((pm = pairRe.exec(dm[1])) !== null) {
      const extracted = extractPeriodLabel(stripTags(pm[1]));
      if (extracted.boilerplate) result.boilerplateStripped++;
      const name = extracted.label;
      const ddText = stripTags(pm[2]);
      if (!name || name.length > 80) {
        result.skippedRows++;
        continue;
      }
      const tokens = ddText.match(
        new RegExp(`${TIME_WITH_MARKER_RE.source}|${BARE_TIME_RE.source}`, "gi"),
      ) ?? [];
      let startRaw = tokens[0] ?? "";
      let endRaw = tokens[1] ?? "";
      if (!endRaw) {
        const parts = splitTimeRange(ddText);
        if (parts.length >= 2) {
          startRaw = parts[0];
          endRaw = parts[parts.length - 1];
        }
      }
      const start = normalizeTime(startRaw);
      const end = normalizeTime(endRaw);
      if (!start || !end) {
        result.skippedRows++;
        continue;
      }
      // Times are HH:MM 24-hour, so string comparison is chronological.
      // A bell can't end before (or exactly when) it starts.
      if (end.time <= start.time) {
        result.skippedRows++;
        continue;
      }
      if (start.guessedAmPm || end.guessedAmPm) result.guessedAmPm = true;
      result.periods.push({ name, start: start.time, end: end.time });
    }
  }
  return result;
}

/** Phrases that mark a cell as page boilerplate rather than a period name. */
const BOILERPLATE_PHRASES = ["takes place on", "please see below", "schedule"];

/**
 * Extract the real period label from a table cell that may contain page
 * boilerplate. Founder report 2026-10-13: cells like
 * "MASTER SCHEDULE takes place on Monday, Tuesday, and Wednesday each week.
 *  Please see below. - 1ST PERIOD HR" were swallowed whole as period names.
 * When boilerplate is detected, the actual label is taken after the last
 * " - " / " – " / ":" separator; otherwise the cell is returned trimmed.
 */
function extractPeriodLabel(raw: string): { label: string; boilerplate: boolean } {
  const cell = raw.replace(/\s+/g, " ").trim();
  const lower = cell.toLowerCase();
  const boilerplate = BOILERPLATE_PHRASES.some((p) => lower.includes(p));
  if (!boilerplate) return { label: cell, boilerplate: false };
  const separators = [" - ", " \u2013 ", ":"];
  let cut = -1;
  let cutLen = 0;
  for (const sep of separators) {
    const i = cell.lastIndexOf(sep);
    if (i > cut) {
      cut = i;
      cutLen = sep.length;
    }
  }
  if (cut < 0) return { label: cell, boilerplate: true };
  return { label: cell.slice(cut + cutLen).trim(), boilerplate: true };
}

/** "Daily Bell Schedule" -> "Daily"; "WEB" stays "WEB". */
function scheduleLabel(raw: string, fallback: string): string {
  const cleaned = raw.replace(/\s+(bell\s+)?schedules?$/i, "").trim();
  return cleaned || fallback;
}

export function parseBellSchedulePage(html: string, url: string): ParseResult<DigitalBellSchedule[]> {
  const warnings: string[] = [];

  if (!html || !html.trim()) {
    return {
      ok: false,
      data: [],
      confidence: "low",
      warnings,
      error: "The page came back empty, so there was nothing to read.",
    };
  }

  const sections = splitSections(html);
  const schedules: DigitalBellSchedule[] = [];
  let weakest: ParseResult<DigitalBellSchedule[]>["confidence"] = "high";
  let scheduleIndex = 0;

  for (const section of sections) {
    const chunk = html.slice(section.start, section.end);
    const parses: TableParse[] = extractTables(chunk).map(parseTable);
    parses.push(parseDefinitionLists(chunk));

    const periods: BellPeriod[] = [];
    let structured = false;
    let guessedAmPm = false;
    let skippedRows = 0;
    let boilerplateStripped = 0;
    for (const p of parses) {
      periods.push(...p.periods);
      structured = structured || (p.periods.length > 0 && p.structured);
      guessedAmPm = guessedAmPm || p.guessedAmPm;
      skippedRows += p.skippedRows;
      boilerplateStripped += p.boilerplateStripped;
    }

    if (periods.length === 0) continue;

    if (periods.length < 2) {
      const where = section.label ? ` under "${section.label}"` : "";
      warnings.push(
        `Found only one readable period${where}; a bell schedule needs at least two, so it was skipped.`,
      );
      continue;
    }

    scheduleIndex++;
    const label = scheduleLabel(section.label, `Schedule ${scheduleIndex}`);
    if (!section.label) {
      warnings.push(
        `"${label}": no heading found near the schedule, so it was numbered in page order.`,
      );
    }

    periods.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));

    let confidence: ParseResult<DigitalBellSchedule[]>["confidence"] = structured
      ? "high"
      : parses.some((p) => p.periods.length > 0 && p.structured === false && chunk.includes("<dl"))
        ? "low"
        : "medium";
    if (confidence === "medium") weakest = weakest === "high" ? "medium" : weakest;
    if (confidence === "low") weakest = "low";

    // More than 30% of the rows were dropped as garbage or needed
    // boilerplate stripping: the page shape is suspect, so the "WHAT WE
    // READ" preview must not present what survived as fully trustworthy.
    const attempted = periods.length + skippedRows;
    const flagged = skippedRows + boilerplateStripped;
    if (attempted > 0 && flagged / attempted > 0.3) {
      confidence = confidence === "high" ? "medium" : "low";
      if (confidence === "medium") weakest = weakest === "high" ? "medium" : weakest;
      if (confidence === "low") weakest = "low";
      warnings.push(
        `"${label}": some bell times looked odd, so we left them out — check the school's page.`,
      );
    }

    if (guessedAmPm) {
      warnings.push(
        `"${label}": times had no AM/PM on the page; assumed school-day hours (7\u201311 AM, 12 noon, 1\u20136 PM).`,
      );
    }
    if (skippedRows > 0) {
      warnings.push(`"${label}": skipped ${skippedRows} table row(s) that didn't look like periods.`);
    }

    schedules.push({
      label,
      periods,
      sourceNote: `Parsed from ${url}`,
    });
  }

  if (schedules.length === 0) {
    return {
      ok: false,
      data: [],
      confidence: "low",
      warnings,
      error:
        "We couldn't find a bell schedule on this page. It may load its schedule with JavaScript or use a layout we don't recognize yet.",
    };
  }

  return { ok: true, data: schedules, confidence: weakest, warnings };
}
