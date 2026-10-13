/**
 * src/lib/school-source-pipeline.ts
 * Shared verify + fetch + parse pipeline for school calendar / bell schedule
 * sources. Used by the intake and refresh routes (and the upload route for
 * PDFs with a text layer).
 *
 * District-agnostic: every message is plain English, never names a district.
 *
 * Parser wiring: the digital parsers live in ./school-source-parsers, owned
 * by the parsing squad. They are loaded with a dynamic import so this module
 * compiles and runs before that file lands; until it does, pages are
 * verified and snapshotted and honestly marked parse_status='pending'.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchSourcePage,
  sanitizeHtml,
  validateSourceUrl,
} from "@/lib/school-sources";

// ---------------------------------------------------------------------------
// Parser interface (mirrors src/lib/school-source-parsers.ts, parsing squad).
// ---------------------------------------------------------------------------

export interface DigitalCalendarEvent {
  title: string;
  /** ISO date string (YYYY-MM-DD). */
  date: string;
  endDate?: string;
  location?: string;
  description?: string;
}

export interface DigitalBellPeriod {
  name: string;
  /** "7:20 AM" style; parsers decide the display format. */
  start: string;
  end: string;
}

export interface DigitalBellSchedule {
  label: string;
  periods: DigitalBellPeriod[];
}

export type ParserConfidence = "high" | "medium" | "low";

export interface ParsedPage<T> {
  ok: boolean;
  data: T;
  confidence: ParserConfidence;
  warnings: string[];
  error?: string;
}

export interface SchoolSourceParsers {
  parseCalendarPage(
    html: string,
    url: string,
  ): ParsedPage<DigitalCalendarEvent[]> | Promise<ParsedPage<DigitalCalendarEvent[]>>;
  parseBellSchedulePage(
    html: string,
    url: string,
  ): ParsedPage<DigitalBellSchedule[]> | Promise<ParsedPage<DigitalBellSchedule[]>>;
}

/**
 * Load the parsing squad's module. Returns null when it isn't on the tree
 * yet — callers must mark the snapshot parse_status='pending' and say so in
 * plain English. Never throws.
 */
export async function loadParsers(): Promise<SchoolSourceParsers | null> {
  try {
    // Non-literal specifier on purpose: tsc must not fail before the parsing
    // squad's file exists, and the bundler turns this into a lazy chunk that
    // simply isn't there until they land it.
    const specifier = "./school-source-parsers";
    const mod = (await import(specifier)) as Partial<SchoolSourceParsers>;
    if (
      typeof mod.parseCalendarPage === "function" &&
      typeof mod.parseBellSchedulePage === "function"
    ) {
      return mod as SchoolSourceParsers;
    }
    return null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Pipeline
// ---------------------------------------------------------------------------

export type SourceKind = "calendar" | "bell";

export interface SourceJob {
  kind: SourceKind;
  label: string;
  url: string;
  /** Pre-fetched HTML (upload flow). When omitted the URL is fetched. */
  html?: string;
}

export interface SourceOutcome {
  kind: string;
  label: string;
  url: string;
  /** The page answered 2xx with a body. */
  verified: boolean;
  /** Digital output was produced and stored. */
  parsed: boolean;
  /** Plain-English summary for the pilot. */
  message: string;
  eventCount?: number;
  scheduleCount?: number;
  periodCount?: number;
}

export function validateJobUrl(url: string): string | null {
  return validateSourceUrl(url);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isRealDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function cleanText(value: unknown, maxLen: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed.length > maxLen ? trimmed.slice(0, maxLen) : trimmed;
}

function parseStatusFor(
  result: ParsedPage<unknown> | null,
): { status: "pending" | "ok" | "partial" | "error"; note: string } {
  if (!result) {
    return {
      status: "pending",
      note: "The reading tools aren't installed yet — this page is saved and will be read automatically once they are.",
    };
  }
  if (!result.ok) {
    return {
      status: "error",
      note:
        result.error ||
        "We couldn't make sense of this page. The saved copy is still here to read.",
    };
  }
  const warnings = (result.warnings ?? []).filter(Boolean).join(" ");
  switch (result.confidence) {
    case "high":
      return {
        status: "ok",
        note: warnings || "Read cleanly.",
      };
    case "medium":
      return {
        status: "partial",
        note:
          warnings ||
          "Read most of it, but some parts were unclear — the saved copy is here to double-check.",
      };
    default:
      return {
        status: "error",
        note:
          warnings ||
          "We couldn't read this page confidently. The saved copy is still here to read.",
      };
  }
}

interface SnapshotWrite {
  content_html: string | null;
  fetched_at: string;
  status: "ok" | "error";
  error_note: string | null;
  parsed_json: unknown;
  parsed_at: string | null;
  parse_status: "pending" | "ok" | "partial" | "error";
  parse_note: string | null;
}

async function storeCalendarEvents(
  supabase: SupabaseClient,
  crewMemberId: string,
  sourceUrl: string,
  events: DigitalCalendarEvent[],
): Promise<number> {
  const rows = [];
  for (const event of events) {
    const title = cleanText(event?.title, 300);
    const date = typeof event?.date === "string" ? event.date.trim() : "";
    if (!title || !isRealDate(date)) continue;
    const endDate =
      typeof event?.endDate === "string" && isRealDate(event.endDate.trim())
        ? event.endDate.trim()
        : null;
    rows.push({
      crew_member_id: crewMemberId,
      title,
      event_date: date,
      end_date: endDate,
      location: cleanText(event?.location, 300),
      description: cleanText(event?.description, 2000),
      source_url: sourceUrl,
    });
  }

  // Replace the member's events with this fresh parse (only called after a
  // successful parse, so a failed refresh never wipes good data).
  const { error: deleteError } = await supabase
    .from("crew_school_calendar_events")
    .delete()
    .eq("crew_member_id", crewMemberId);
  if (deleteError) throw deleteError;

  if (rows.length === 0) return 0;
  // Insert in small batches; a single bad row shouldn't sink the batch.
  const BATCH = 100;
  let stored = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error: insertError } = await supabase
      .from("crew_school_calendar_events")
      .insert(rows.slice(i, i + BATCH));
    if (insertError) throw insertError;
    stored += Math.min(BATCH, rows.length - i);
  }
  return stored;
}

async function processGroup(
  supabase: SupabaseClient,
  crewMemberId: string,
  group: { kind: SourceKind; url: string; jobs: SourceJob[] },
  parsers: SchoolSourceParsers | null,
): Promise<SourceOutcome[]> {
  const now = new Date().toISOString();
  const firstJob = group.jobs[0];

  // 1. Fetch (once per unique URL) — the honest verify step: 2xx + a body.
  let html: string | undefined = firstJob.html;
  let fetchError: string | null = null;
  if (html === undefined) {
    const fetched = await fetchSourcePage(group.url);
    if (!fetched.ok || !fetched.html) {
      fetchError = fetched.error ?? "The school's page didn't answer.";
    } else {
      html = fetched.html;
    }
  }

  const write: SnapshotWrite = {
    content_html: null,
    fetched_at: now,
    status: fetchError ? "error" : "ok",
    error_note: fetchError,
    parsed_json: null,
    parsed_at: null,
    parse_status: "pending",
    parse_note: fetchError,
  };

  let outcome: Omit<SourceOutcome, "kind" | "label" | "url">;

  if (fetchError || html === undefined) {
    write.parse_note = fetchError;
    outcome = {
      verified: false,
      parsed: false,
      message: fetchError ?? "The school's page didn't answer.",
    };
  } else {
    write.content_html = sanitizeHtml(html, group.url);
    let parsedJson: unknown = null;
    let parsedAt: string | null = null;
    let eventCount = 0;
    let scheduleCount = 0;
    let periodCount = 0;

    if (!parsers) {
      const pending = parseStatusFor(null);
      write.parse_status = pending.status;
      write.parse_note = pending.note;
    } else {
      try {
        if (group.kind === "calendar") {
          const result = await parsers.parseCalendarPage(html, group.url);
          const mapped = parseStatusFor(result);
          write.parse_status = mapped.status;
          write.parse_note = mapped.note;
          if (result.ok && Array.isArray(result.data)) {
            parsedJson = result.data;
            parsedAt = now;
            if (mapped.status === "ok" || mapped.status === "partial") {
              eventCount = await storeCalendarEvents(
                supabase,
                crewMemberId,
                group.url,
                result.data,
              );
            }
          }
        } else {
          const result = await parsers.parseBellSchedulePage(html, group.url);
          const mapped = parseStatusFor(result);
          write.parse_status = mapped.status;
          write.parse_note = mapped.note;
          if (result.ok && Array.isArray(result.data)) {
            parsedJson = result.data;
            parsedAt = now;
            scheduleCount = result.data.length;
            periodCount = result.data.reduce(
              (sum, s) => sum + (Array.isArray(s?.periods) ? s.periods.length : 0),
              0,
            );
          }
        }
      } catch (err) {
        write.parse_status = "error";
        write.parse_note =
          err instanceof Error && err.message
            ? `The reader hit a problem: ${err.message}. The saved copy is still here to read.`
            : "The reader hit a problem. The saved copy is still here to read.";
      }
    }

    write.parsed_json = parsedJson;
    write.parsed_at = parsedAt;

    const parsed = write.parse_status === "ok" || write.parse_status === "partial";
    outcome = {
      verified: true,
      parsed,
      message: parsed
        ? group.kind === "calendar"
          ? `Saved and read — ${eventCount} ${eventCount === 1 ? "event" : "events"} found.`
          : `Saved and read — ${scheduleCount} ${scheduleCount === 1 ? "schedule" : "schedules"}, ${periodCount} ${periodCount === 1 ? "period" : "periods"}.`
        : write.parse_note ?? "Saved, but we couldn't read it yet.",
      ...(group.kind === "calendar" ? { eventCount } : { scheduleCount, periodCount }),
    };
  }

  // 2. One snapshot row per (kind, label) — labels sharing a URL (e.g. Daily
  //    + WEB on one bell page) each get the same verified parse output.
  const outcomes: SourceOutcome[] = [];
  for (const job of group.jobs) {
    const { error: snapshotError } = await supabase
      .from("crew_school_source_snapshots")
      .upsert(
        {
          crew_member_id: crewMemberId,
          kind: job.kind,
          label: job.label,
          url: job.url,
          ...write,
        },
        { onConflict: "crew_member_id,kind,label" },
      );
    if (snapshotError) {
      outcomes.push({
        kind: job.kind,
        label: job.label,
        url: job.url,
        verified: outcome.verified,
        parsed: false,
        message: "The page was read, but we couldn't save it. Try again.",
      });
    } else {
      outcomes.push({ kind: job.kind, label: job.label, url: job.url, ...outcome });
    }
  }
  return outcomes;
}

/**
 * Verify + fetch + parse a set of source jobs. Jobs sharing the same
 * (kind, url) are fetched once; every label still gets its own snapshot row.
 */
export async function processSources(
  supabase: SupabaseClient,
  crewMemberId: string,
  jobs: SourceJob[],
): Promise<SourceOutcome[]> {
  const parsers = await loadParsers();
  const groups = new Map<string, { kind: SourceKind; url: string; jobs: SourceJob[] }>();
  for (const job of jobs) {
    const key = `${job.kind}::${job.url}`;
    const existing = groups.get(key);
    if (existing) existing.jobs.push(job);
    else groups.set(key, { kind: job.kind, url: job.url, jobs: [job] });
  }
  const outcomes: SourceOutcome[] = [];
  for (const group of groups.values()) {
    outcomes.push(...(await processGroup(supabase, crewMemberId, group, parsers)));
  }
  return outcomes;
}

export function summarizeOutcomes(outcomes: SourceOutcome[]): {
  check_status: "ok" | "stale" | "broken";
  check_note: string;
} {
  const total = outcomes.length;
  if (total === 0) {
    return {
      check_status: "stale",
      check_note: "No links saved yet. Add the school's calendar or bell schedule links first.",
    };
  }
  const okCount = outcomes.filter((o) => o.verified).length;
  const parsedCount = outcomes.filter((o) => o.parsed).length;
  const check_status =
    okCount === total ? "ok" : okCount === 0 ? "broken" : "stale";
  let check_note: string;
  if (okCount === total) {
    check_note =
      parsedCount === total
        ? `Checked ${total} ${total === 1 ? "link" : "links"} just now — all saved and read.`
        : `Checked ${total} ${total === 1 ? "link" : "links"} just now — all saved, ${total - parsedCount} still waiting to be read.`;
  } else if (okCount === 0) {
    check_note = `Checked ${total} ${total === 1 ? "link" : "links"} just now — none of them answered. Check the links on the school's website and try again.`;
  } else {
    const broken = outcomes
      .filter((o) => !o.verified)
      .map((o) => o.label || "calendar")
      .join(", ");
    check_note = `Checked ${total} links just now — ${okCount} worked, ${total - okCount} didn't (${broken}). Check ${total - okCount === 1 ? "that link" : "those links"} on the school's website and try again.`;
  }
  return { check_status, check_note };
}

// ---------------------------------------------------------------------------
// Upload flow: a pilot photo/PDF of a school page becomes a kind='upload'
// snapshot. PDFs with a text layer are parsed; images (and PDFs without a
// text layer) are stored honestly as parse_status='pending' — we never claim
// a parse that didn't happen.
// ---------------------------------------------------------------------------

export interface UploadInput {
  supabase: SupabaseClient;
  crewMemberId: string;
  /** What the uploaded page shows. */
  pageKind: "calendar" | "bell";
  label: string;
  storagePath: string;
  /** Sanitized <pre>-wrapped text for PDFs with a text layer; null otherwise. */
  contentHtml: string | null;
  /** True when the file is a photo (never parseable here). */
  isPhoto: boolean;
}

export interface UploadOutcome {
  parsed: boolean;
  message: string;
  eventCount?: number;
  scheduleCount?: number;
  periodCount?: number;
}

export async function processUpload(input: UploadInput): Promise<UploadOutcome> {
  const { supabase, crewMemberId, pageKind, label, storagePath, contentHtml, isPhoto } = input;
  const now = new Date().toISOString();
  const url = `storage://school-source-uploads/${storagePath}`;

  let parseStatus: "pending" | "ok" | "partial" | "error" = "pending";
  let parseNote: string;
  let parsedJson: unknown = null;
  let parsedAt: string | null = null;
  let eventCount = 0;
  let scheduleCount = 0;
  let periodCount = 0;

  if (isPhoto || !contentHtml) {
    parseNote = isPhoto
      ? "Image saved — text reading isn't available yet, so this one needs a human look."
      : "This PDF looks like scanned images — there's no text to read, so it needs a human look.";
  } else {
    const parsers = await loadParsers();
    if (!parsers) {
      const pending = parseStatusFor(null);
      parseStatus = pending.status;
      parseNote = pending.note;
    } else {
      try {
        if (pageKind === "calendar") {
          const result = await parsers.parseCalendarPage(contentHtml, url);
          const mapped = parseStatusFor(result);
          parseStatus = mapped.status;
          parseNote = `Read from the PDF's text layer. ${mapped.note}`;
          if (result.ok && Array.isArray(result.data)) {
            parsedJson = result.data;
            parsedAt = now;
            if (parseStatus === "ok" || parseStatus === "partial") {
              eventCount = await storeCalendarEvents(supabase, crewMemberId, url, result.data);
            }
          }
        } else {
          const result = await parsers.parseBellSchedulePage(contentHtml, url);
          const mapped = parseStatusFor(result);
          parseStatus = mapped.status;
          parseNote = `Read from the PDF's text layer. ${mapped.note}`;
          if (result.ok && Array.isArray(result.data)) {
            parsedJson = result.data;
            parsedAt = now;
            scheduleCount = result.data.length;
            periodCount = result.data.reduce(
              (sum, s) => sum + (Array.isArray(s?.periods) ? s.periods.length : 0),
              0,
            );
          }
        }
      } catch {
        parseStatus = "error";
        parseNote = "The reader hit a problem with this file. The saved copy is still here.";
      }
    }
  }

  const { error: snapshotError } = await supabase
    .from("crew_school_source_snapshots")
    .upsert(
      {
        crew_member_id: crewMemberId,
        kind: "upload",
        label,
        url,
        content_html: contentHtml,
        fetched_at: now,
        status: "ok",
        error_note: null,
        parsed_json: parsedJson,
        parsed_at: parsedAt,
        parse_status: parseStatus,
        parse_note: parseNote,
      },
      { onConflict: "crew_member_id,kind,label" },
    );
  if (snapshotError) throw snapshotError;

  const parsed = parseStatus === "ok" || parseStatus === "partial";
  return {
    parsed,
    message: parsed
      ? pageKind === "calendar"
        ? `Saved and read — ${eventCount} ${eventCount === 1 ? "event" : "events"} found.`
        : `Saved and read — ${scheduleCount} ${scheduleCount === 1 ? "schedule" : "schedules"}, ${periodCount} ${periodCount === 1 ? "period" : "periods"}.`
      : parseNote,
    ...(pageKind === "calendar" ? { eventCount } : { scheduleCount, periodCount }),
  };
}

// ---------------------------------------------------------------------------
// Best-effort PDF text-layer extraction (upload route). No dependencies:
// inflates FlateDecode streams with DecompressionStream and pulls the text
// shown by Tj / TJ operators. Returns null when there's no usable text
// layer (e.g. a scanned-image PDF) — the caller must say so honestly.
// ---------------------------------------------------------------------------

function decodePdfString(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    if (b === 0x5c && i + 1 < bytes.length) {
      const n = bytes[++i];
      if (n === 0x6e) out += "\n"; // \n
      else if (n === 0x72) out += "\r"; // \r
      else if (n === 0x74) out += "\t"; // \t
      else if (n >= 0x30 && n <= 0x37) {
        // octal escape: up to 3 digits
        let code = n - 0x30;
        for (let k = 0; k < 2 && i + 1 < bytes.length; k++) {
          const d = bytes[i + 1];
          if (d >= 0x30 && d <= 0x37) {
            code = code * 8 + (d - 0x30);
            i++;
          } else break;
        }
        out += String.fromCharCode(code);
      } else out += String.fromCharCode(n);
    } else {
      out += String.fromCharCode(b);
    }
  }
  return out;
}

function extractTextFromContentStream(data: Uint8Array): string {
  // Latin-1 decode is enough for operator scanning; actual glyph text comes
  // from the string operands below.
  const text = String.fromCharCode(...data.slice(0, Math.min(data.length, 4_000_000)));
  const parts: string[] = [];
  // (literal) Tj  |  <hex> Tj  |  [(lit) 12 <hex>] TJ
  const re = /(?:\((?:\\.|[^\\()])*\)|<[0-9a-fA-F\s]+>)\s*(?:Tj|TJ|')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const token = m[0];
    const opIdx = Math.max(token.lastIndexOf("Tj"), token.lastIndexOf("TJ"), token.lastIndexOf("'"));
    const raw = token.slice(0, opIdx).trim();
    if (raw.startsWith("(")) {
      const inner = raw.slice(1, raw.lastIndexOf(")"));
      const bytes = new Uint8Array(inner.length);
      for (let i = 0; i < inner.length; i++) bytes[i] = inner.charCodeAt(i) & 0xff;
      parts.push(decodePdfString(bytes));
    } else if (raw.startsWith("[")) {
      // TJ array: keep string elements, skip kerning numbers.
      const strRe = /\((?:\\.|[^\\()])*\)|<[0-9a-fA-F\s]+>/g;
      let s: RegExpExecArray | null;
      while ((s = strRe.exec(raw)) !== null) {
        const el = s[0];
        if (el.startsWith("(")) {
          const inner = el.slice(1, -1);
          const bytes = new Uint8Array(inner.length);
          for (let i = 0; i < inner.length; i++) bytes[i] = inner.charCodeAt(i) & 0xff;
          parts.push(decodePdfString(bytes));
        } else {
          const hex = el.slice(1, -1).replace(/\s+/g, "");
          let decoded = "";
          for (let i = 0; i + 1 < hex.length; i += 2) {
            decoded += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
          }
          parts.push(decoded);
        }
      }
    } else if (raw.startsWith("<")) {
      const hex = raw.slice(1, raw.lastIndexOf(">")).replace(/\s+/g, "");
      let decoded = "";
      for (let i = 0; i + 1 < hex.length; i += 2) {
        decoded += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
      }
      parts.push(decoded);
    }
  }
  return parts.join(" ");
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array | null> {
  try {
    // Cast through unknown: TS DOM libs type DecompressionStream loosely.
    const DS = (globalThis as unknown as {
      DecompressionStream?: new (format: string) => TransformStream<Uint8Array, Uint8Array>;
    }).DecompressionStream;
    if (!DS) return null;
    const ds = new DS("deflate");
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();
    const chunks: Uint8Array[] = [];
    const pump = (async () => {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
    })();
    await writer.write(data);
    await writer.close();
    await pump;
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.length;
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Pull the text layer out of a PDF, best-effort. Returns the extracted text,
 * or null when the PDF has no usable text (scanned images) or can't be read.
 */
export async function extractPdfTextLayer(pdf: Uint8Array): Promise<string | null> {
  try {
    if (pdf.length < 5) return null;
    const header = String.fromCharCode(...pdf.slice(0, 5));
    if (header !== "%PDF-") return null;

    const latin = (b: Uint8Array) => {
      // Chunked to avoid spread-arg limits on large buffers.
      let s = "";
      for (let i = 0; i < b.length; i += 8192) {
        s += String.fromCharCode(...b.slice(i, i + 8192));
      }
      return s;
    };

    // Byte-accurate stream slicing (regex on the decoded text would corrupt
    // offsets for binary streams).
    const bytes = pdf;
    const marker = new TextEncoder().encode("stream");
    const endMarker = new TextEncoder().encode("endstream");
    const parts: string[] = [];
    let pos = 0;
    while (pos < bytes.length) {
      const start = indexOfBytes(bytes, marker, pos);
      if (start < 0) break;
      let dataStart = start + marker.length;
      if (bytes[dataStart] === 0x0d && bytes[dataStart + 1] === 0x0a) dataStart += 2;
      else if (bytes[dataStart] === 0x0a || bytes[dataStart] === 0x0d) dataStart += 1;
      const end = indexOfBytes(bytes, endMarker, dataStart);
      if (end < 0) break;
      let dataEnd = end;
      if (bytes[dataEnd - 2] === 0x0d && bytes[dataEnd - 1] === 0x0a) dataEnd -= 2;
      else if (bytes[dataEnd - 1] === 0x0a || bytes[dataEnd - 1] === 0x0d) dataEnd -= 1;
      const raw = bytes.slice(dataStart, dataEnd);
      // The stream dictionary sits just before "stream"; page content streams
      // are FlateDecode (or uncompressed). Skip image/font streams.
      const dictPeek = latin(bytes.slice(Math.max(0, start - 300), start));
      const isFlate = /\/FlateDecode/.test(dictPeek);
      const looksLikeContent =
        isFlate || /BT[\s\S]{0,400}Tj/.test(latin(raw.slice(0, 4000)));
      if (looksLikeContent) {
        const inflated = isFlate ? await inflateRaw(raw) : raw;
        if (inflated) {
          const extracted = extractTextFromContentStream(inflated);
          if (extracted.trim()) parts.push(extracted);
        }
      }
      pos = end + endMarker.length;
    }

    const joined = parts.join("\n").replace(/[ \t]+/g, " ").trim();
    // A real text layer reads like words; below this it's noise or nothing.
    if (joined.replace(/[^A-Za-z]/g, "").length < 200) return null;
    return joined;
  } catch {
    return null;
  }
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array, from: number): number {
  outer: for (let i = from; i + needle.length <= haystack.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/** Escape text for the <pre> wrapper used when a PDF text layer is parsed. */
export function escapeHtmlText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
