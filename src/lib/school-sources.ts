/**
 * src/lib/school-sources.ts
 * Server-side helpers for the school calendar + bell schedule feature.
 *
 * District-agnostic: the pilot saves links to any school's public calendar
 * and bell schedule pages; we fetch them server-side, strip them down to
 * safe content with a whitelist sanitizer (no new dependencies), and store
 * the result as snapshots for in-app rendering.
 */

const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const MAX_URL_LENGTH = 2048;
const FETCH_TIMEOUT_MS = 20_000;
const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2 MB — school pages are small.

export interface FetchSourceResult {
  ok: boolean;
  html?: string;
  error?: string;
}

/**
 * Validate a pilot-supplied source URL. Returns a plain-English error when
 * invalid, or null when the URL is acceptable.
 */
export function validateSourceUrl(url: string): string | null {
  const trimmed = (url ?? "").trim();
  if (!trimmed) return "That link is empty. Paste the school's page link and try again.";
  if (trimmed.length > MAX_URL_LENGTH)
    return "That link is too long. Paste the shorter link the school publishes.";
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return "That doesn't look like a web link. Copy the full link from the school's website (it starts with http) and try again.";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return "That link doesn't start with http or https. Only ordinary web pages can be saved here.";
  }
  return null;
}

/**
 * Fetch a school page server-side with a 20s timeout and a desktop user
 * agent. Follows redirects, accepts only http(s), rejects non-2xx.
 * Errors are plain English for the pilot.
 */
export async function fetchSourcePage(url: string): Promise<FetchSourceResult> {
  const problem = validateSourceUrl(url);
  if (problem) return { ok: false, error: problem };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url.trim(), {
      redirect: "follow",
      headers: {
        "User-Agent": DESKTOP_UA,
        Accept: "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      return {
        ok: false,
        error:
          res.status === 404
            ? "The school's page didn't answer — that link goes nowhere. Check the link on the school's website and try again."
            : "The school's page didn't answer. Check the link and try again.",
      };
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (!/html/i.test(contentType)) {
      return {
        ok: false,
        error:
          "That link doesn't open a web page (it looks like a file). Upload the file directly below instead — a photo or PDF works.",
      };
    }
    const text = await res.text();
    if (text.length > MAX_BODY_BYTES) {
      return {
        ok: false,
        error: "That page is too large to show here. Try the school's simpler calendar or bell schedule page.",
      };
    }
    return { ok: true, html: text };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      return {
        ok: false,
        error: "The school's page took too long to answer. Check the link and try again.",
      };
    }
    return {
      ok: false,
      error: "We couldn't reach the school's page right now. Check the link and try again.",
    };
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// Whitelist HTML sanitizer (no new dependencies).
// ---------------------------------------------------------------------------

/** Tags whose whole subtree (content included) is removed. */
const DROP_WITH_CONTENT = new Set([
  "script", "style", "iframe", "object", "embed", "noscript", "template",
  "nav", "header", "footer", "aside", // page chrome, not content
  "form", "select", "textarea", "button",
]);

/** Standalone/void tags to drop entirely (inputs, links, meta). */
const DROP_TAGS = new Set(["link", "meta", "input"]);

/** Tags we keep. Everything else has its tag dropped but inner text kept. */
const KEEP_TAGS = new Set([
  "p", "div", "span", "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "table", "thead", "tbody", "tfoot", "tr", "th", "td",
  "caption", "a", "strong", "em", "b", "i", "u", "small", "br", "hr",
  "img", "figure", "figcaption", "dl", "dt", "dd", "blockquote", "pre",
]);

/** The only attributes we keep. */
const KEEP_ATTRS = new Set(["href", "src", "alt", "title", "colspan", "rowspan", "scope"]);

function dropElementWithContent(html: string, tag: string): string {
  // Remove <tag ...>...</tag> including content, case-insensitive.
  const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, "gi");
  let prev = "";
  let next = html;
  // Repeat for nested same-tag elements.
  while (next !== prev) {
    prev = next;
    next = next.replace(re, "");
  }
  return next;
}

function resolveUrl(value: string, baseUrl: string): string | null {
  const v = value.trim();
  if (!v) return null;
  try {
    const resolved = new URL(v, baseUrl);
    if (resolved.protocol === "http:" || resolved.protocol === "https:") return resolved.href;
    return null;
  } catch {
    return null;
  }
}

/**
 * Strip a school page down to safe, renderable content:
 * - drops scripts/styles/forms/navigation and all HTML comments
 * - keeps only a whitelist of content tags
 * - keeps only href/src/alt/title/colspan/rowspan/scope attributes
 *   (so on* handlers and style attributes can never survive)
 * - rewrites relative href/src to absolute against baseUrl
 * - drops javascript:/data: URIs (http/https only)
 * Wraps the result in <div class="school-source-content">.
 */
export function sanitizeHtml(raw: string, baseUrl: string): string {
  if (!raw) return '<div class="school-source-content"></div>';

  // 1. Strip HTML comments.
  let html = raw.replace(/<!--[\s\S]*?-->/g, "");

  // 2. Drop whole subtrees: scripts, styles, forms, navigation chrome.
  for (const tag of DROP_WITH_CONTENT) html = dropElementWithContent(html, tag);
  // 3. Drop standalone tags (link, meta, input) — paired or self-closing.
  for (const tag of DROP_TAGS) {
    html = html.replace(new RegExp(`<${tag}\\b[^>]*?/?>`, "gi"), "");
    html = dropElementWithContent(html, tag);
  }

  // 4. Walk remaining tags: keep whitelisted ones with cleaned attributes,
  //    drop the tag (keep inner text) for anything else.
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9-]*)\b([^<>]*)>/g;
  html = html.replace(tagRe, (full, name: string, attrStr: string) => {
    const tag = name.toLowerCase();
    const isClose = full.startsWith("</");

    if (isClose) {
      return KEEP_TAGS.has(tag) ? `</${tag}>` : "";
    }
    if (!KEEP_TAGS.has(tag)) return "";

    const attrs: string[] = [];
    const attrRe =
      /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`>]+)))?/g;
    let m: RegExpExecArray | null;
    while ((m = attrRe.exec(attrStr)) !== null) {
      const attrName = m[1].toLowerCase();
      if (!KEEP_ATTRS.has(attrName)) continue; // drops on*, style, class, etc.
      const value = m[2] ?? m[3] ?? m[4] ?? "";
      if (attrName === "href" || attrName === "src") {
        const resolved = resolveUrl(value, baseUrl);
        if (!resolved) continue; // drops javascript:/data:/unparseable URIs
        attrs.push(`${attrName}="${escapeAttr(resolved)}"`);
      } else {
        attrs.push(`${attrName}="${escapeAttr(value)}"`);
      }
    }
    return attrs.length > 0 ? `<${tag} ${attrs.join(" ")}>` : `<${tag}>`;
  });

  return `<div class="school-source-content">${html}</div>`;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/** "Source: cobbk12.org ↗" attribution helper — the bare hostname. */
export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// ---------------------------------------------------------------------------
// Calendar-likeness validation: never treat a homepage / link farm as a
// school calendar. The district homepage answers 200 with a full template
// ("Find it Fast" quick links etc.) and zero real dates — without this check
// that chrome gets stored and rendered as the "calendar".
// ---------------------------------------------------------------------------

/** Plain-English rejection when a saved page isn't a school calendar. */
export const NOT_A_CALENDAR_MESSAGE =
  "That page doesn't look like a school calendar — try the calendar page itself, not the district homepage.";

function textOf(html: string): string {
  return (
    html
      // Client-rendered template placeholders ({{...}}) are code, not dates.
      .replace(/\{\{[\s\S]*?\}\}/g, " ")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]*>/g, " ")
      .replace(/&(amp|lt|gt|quot|nbsp);/g, " ")
      .replace(/\s+/g, " ")
  );
}

const MONTH_WORDS =
  "(january|february|march|april|may|june|july|august|september|october|november|december" +
  "|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)";

/** Count date-like tokens (October 20, 10/20, 2026-10-20) in page text. */
function countDateTokens(text: string): number {
  const monthDay = new RegExp(
    `\\b${MONTH_WORDS}\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?\\b`,
    "gi",
  );
  const numeric = /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g;
  const iso = /\b\d{4}-\d{2}-\d{2}\b/g;
  return (
    (text.match(monthDay) ?? []).length +
    (text.match(numeric) ?? []).length +
    (text.match(iso) ?? []).length
  );
}

function countLinks(html: string): number {
  return (html.match(/<a\b[^>]*href/gi) ?? []).length;
}

/**
 * Heuristic: does this HTML look like a school calendar page rather than a
 * homepage / link farm? True when the text carries several date-like tokens.
 * A district homepage's link farm has dozens of links and ~zero real dates.
 * This is a backstop only — the parser's real-event check decides first.
 */
export function pageLooksLikeCalendar(html: string): boolean {
  if (!html) return false;
  const text = textOf(html);
  const dates = countDateTokens(text);
  if (dates >= 5) return true;
  const links = countLinks(html);
  if (links >= 25 && dates < 3) return false; // link farm
  return dates >= 3;
}

/** Plain-English rejection when a saved page isn't a bell schedule. */
export const NOT_A_BELL_MESSAGE =
  "That page doesn't look like a bell schedule — try the school's bell schedule page itself, not the district homepage.";

/** Count time-like tokens (07:10, 8:20 AM, 9:13am) in page text. */
function countTimeTokens(text: string): number {
  return (text.match(/\b\d{1,2}:\d{2}\s*(?:am|pm)?\b/gi) ?? []).length;
}

/**
 * Heuristic: does this HTML look like a bell schedule page rather than a
 * homepage / link farm? True when the text carries several time-like tokens.
 * A district homepage's link farm has dozens of links and ~zero real times.
 * This is a backstop only — the parser's structured-period check decides first.
 */
export function pageLooksLikeBell(html: string): boolean {
  if (!html) return false;
  const text = textOf(html);
  const times = countTimeTokens(text);
  if (times >= 8) return true;
  const links = countLinks(html);
  if (links >= 25 && times < 4) return false; // link farm
  return times >= 4;
}
