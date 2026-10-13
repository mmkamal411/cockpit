/**
 * Bill scan — on-device OCR + field extraction for the "Scan a bill" feature.
 *
 * EPHEMERAL CONTRACT: the bill photo is read on this device with Tesseract.js
 * (client-side WebAssembly) and is NEVER uploaded, POSTed, saved to disk, or
 * written to any database or storage. The image lives only as an in-memory
 * object URL for the duration of the OCR pass; URL.revokeObjectURL() is called
 * immediately after the worker finishes (and on cancel). No pixel data and no
 * image bytes ever leave this module — only the handful of text guesses in the
 * form below are returned.
 */

export interface ScannedBillFields {
  /** Payee name, e.g. "Georgia Power". */
  name?: string;
  /** Amount as a plain numeric string, e.g. "87.40". */
  amount?: string;
  /** Due date as YYYY-MM-DD for the date input. */
  dueDate?: string;
}

const MONTHS: Record<string, number> = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sept: 9, sep: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** True only for a real calendar date (rejects 13/45/2026, Feb 30, …). */
function toISODate(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || year < 1900 || year > 2100) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${year}-${m}-${d}`;
}

const DUE_LABEL = /due|pay by|payment due|please pay|amount due/i;

function isDatey(s: string): boolean {
  return /\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}/.test(s);
}

function parseMoney(raw: string): number | null {
  const cleaned = raw.replace(/[$,\s]/g, "");
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n <= 0 || n > 1000000) return null;
  // Keep cents precision to 2.
  return Math.round(n * 100) / 100;
}

/**
 * Extract the bill total. Strategy: find every $X.XX pattern, prefer ones on
 * lines that say what you owe ("due", "total", "amount due") over other
 * figures ("balance", account numbers), and take the largest in that tier —
 * on real bills the total due is almost always the biggest dollar figure on
 * the page. Dates and phone numbers can't match (cents are required).
 */
export function extractAmount(text: string): string | undefined {
  const lines = text.split(/\r?\n/);
  const moneyRe = /\$?\s*\d[\d,]*\.\d{2}/g;
  let bestDue: number | null = null;
  let bestTotal: number | null = null;
  let bestAny: number | null = null;

  for (const line of lines) {
    const dueLabeled = DUE_LABEL.test(line);
    const totalLabeled = /\btotal\b|amount due/i.test(line);
    moneyRe.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = moneyRe.exec(line)) !== null) {
      const idx = m.index;
      const before = line.slice(Math.max(0, idx - 1), idx);
      const after = line.slice(idx + m[0].length, idx + m[0].length + 1);
      // Skip anything embedded in a longer digit run (dates like 03.15.2026).
      if (/[\d]/.test(before) || /[\d]/.test(after)) continue;
      const n = parseMoney(m[0]);
      if (n === null) continue;
      if (dueLabeled) bestDue = Math.max(bestDue ?? 0, n);
      else if (totalLabeled) bestTotal = Math.max(bestTotal ?? 0, n);
      bestAny = Math.max(bestAny ?? 0, n);
    }
  }

  const best = bestDue ?? bestTotal ?? bestAny;
  if (best === null) return undefined;
  return best.toFixed(2);
}

/**
 * Extract the payee: the first plausible line of the page. Skips amounts,
 * dates, and boilerplate-ish header words. Tolerant — returns undefined
 * rather than a guess when nothing looks like a name.
 */
export function extractName(text: string): string | undefined {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length >= 3);
  const headerNoise = /^(statement|invoice|bill|account|page|remit|customer|service|payment)\b/i;
  for (const line of lines) {
    if (isDatey(line)) continue;
    if (/^[\d\s$.,/+-]+$/.test(line)) continue; // numbers-only line
    if (headerNoise.test(line) && /statement|invoice|bill/i.test(line) && line.length < 24)
      continue;
    const alpha = line.replace(/[^A-Za-z]/g, "");
    if (alpha.length < 3) continue;
    // Strip trailing junk like "LLC." is fine, but drop separator-only tails.
    const name = line.replace(/[\s\-–—|]{2,}$/, "").trim();
    return name.length > 60 ? name.slice(0, 60).trim() : name;
  }
  return undefined;
}

interface DateCandidate {
  iso: string;
  labeled: boolean;
}

function collectDates(text: string): DateCandidate[] {
  const out: DateCandidate[] = [];
  const seen = new Set<string>();
  const now = new Date();
  const thisYear = now.getFullYear();

  const push = (iso: string | null, labeled: boolean) => {
    if (!iso || seen.has(iso)) return;
    seen.add(iso);
    out.push({ iso, labeled });
  };

  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const labeled = DUE_LABEL.test(line);

    // Numeric: MM/DD/YYYY or MM-DD-YY (US-style; bills are US documents).
    const numRe = /(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/g;
    let m: RegExpExecArray | null;
    while ((m = numRe.exec(line)) !== null) {
      let [month, day, year] = [Number(m[1]), Number(m[2]), Number(m[3])];
      if (m[3].length === 2) year = year >= 70 ? 1900 + year : 2000 + year;
      // Ambiguity: if month > 12 but day <= 12, swap.
      if (month > 12 && day <= 12) [month, day] = [day, month];
      push(toISODate(year, month, day), labeled);
    }

    // Month-name: "March 5, 2026" / "Mar 5 2026" / "due March 5".
    const monthNames = Object.keys(MONTHS).join("|");
    const nameRe = new RegExp(
      `\\b(${monthNames})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`,
      "gi",
    );
    while ((m = nameRe.exec(line)) !== null) {
      const month = MONTHS[m[1].toLowerCase()];
      const day = Number(m[2]);
      const year = m[3] ? Number(m[3]) : thisYear;
      let iso = toISODate(year, month, day);
      if (iso && !m[3]) {
        // Year-less date already long past → roll to next year.
        const diffDays = (new Date(iso).getTime() - now.getTime()) / 86400000;
        if (diffDays < -120) iso = toISODate(year + 1, month, day);
      }
      push(iso, labeled);
    }
  }
  return out;
}

/**
 * Extract the due date. Prefers dates sitting next to "due"/"pay by" wording;
 * among candidates takes the latest one still within a sane billing window —
 * the due date normally comes after the statement date on the page.
 */
export function extractDueDate(text: string): string | undefined {
  const candidates = collectDates(text);
  if (candidates.length === 0) return undefined;
  const now = new Date();
  const within = (iso: string) => {
    const days = (new Date(iso).getTime() - now.getTime()) / 86400000;
    return days >= -400 && days <= 400;
  };
  const sane = candidates.filter((c) => within(c.iso));
  const pool = sane.length > 0 ? sane : candidates;
  const labeled = pool.filter((c) => c.labeled);
  const pickFrom = labeled.length > 0 ? labeled : pool;
  // Latest first; labeled preferred by pool choice above.
  pickFrom.sort((a, b) => (a.iso < b.iso ? 1 : -1));
  return pickFrom[0]?.iso;
}

/**
 * Run all extractors. Never throws — a failed parse just yields undefined for
 * that field (tolerant: partial reads are normal, not errors).
 */
export function extractBillFields(text: string): ScannedBillFields {
  const out: ScannedBillFields = {};
  try {
    const name = extractName(text);
    if (name) out.name = name;
    const amount = extractAmount(text);
    if (amount) out.amount = amount;
    const dueDate = extractDueDate(text);
    if (dueDate) out.dueDate = dueDate;
  } catch {
    // Never let a parse error bubble up to the UI.
  }
  return out;
}

/**
 * A live OCR engine. Created (and its WASM payload downloaded) only when the
 * user confirms a scan — see the dynamic import below.
 */
export interface BillReader {
  /** Recognize text from an in-memory object URL. Resolves "" if cancelled. */
  read(imageUrl: string): Promise<string>;
  /** Abort immediately and tear the engine down. Safe to call twice. */
  cancel(): void;
}

/**
 * Create the on-device OCR engine. The dynamic import is the lazy-load gate:
 * tesseract.js (and its WASM blob) never enters the initial bundle — this
 * function is only called after the user taps "I understand — scan the bill".
 */
export async function createBillReader(): Promise<BillReader> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng");
  let cancelled = false;
  let terminated = false;
  const terminate = async () => {
    if (terminated) return;
    terminated = true;
    await worker.terminate();
  };
  return {
    async read(imageUrl: string): Promise<string> {
      if (cancelled) return "";
      const {
        data: { text },
      } = await worker.recognize(imageUrl);
      return cancelled ? "" : (text ?? "");
    },
    cancel() {
      cancelled = true;
      void terminate();
    },
  };
}
