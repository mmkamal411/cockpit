"use client";

import { useState } from "react";

/**
 * Shared UI + client logic for the school-sources intake feature.
 *
 * Used by the add-child flow (step 2) and the crew member detail editor.
 * Everything here is UI-only: the intake / upload endpoints live on the
 * backend (POST intake accepts { district?, calendar_url?, bell_schedules?:
 * [{label,url}] } and returns { ok, sources, results }; the upload endpoint
 * takes multipart { file, kind, label } and stores photo/PDF in the
 * `school-source-uploads` bucket).
 * Per-source results look like
 * { url, label, kind, verified, parsed, message, eventCount?, scheduleCount?,
 *   periodCount? } — `parsed` is a boolean; the parsed payload itself is
 * served by the content endpoint (parsed / parse_status / parse_note).
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** One label+URL row in the bell-schedule repeater. */
export interface BellRowInput {
  label: string;
  url: string;
}

export type SourceCheckState =
  | "idle"
  | "verifying"
  | "uploading"
  | "saved"
  | "error";

/** Inline per-source status shown under the field it belongs to. */
export interface SourceCheck {
  /** Stable key: "calendar" | "bell-<n>" | "upload-<n>". */
  key: string;
  kind: "calendar" | "bell" | "upload";
  /** Plain-English label used in status messages. */
  label: string;
  url?: string;
  fileName?: string;
  /** The actual file, kept so a failed upload can be retried. */
  file?: File;
  /** For uploads: what kind of page the file holds. */
  uploadKind?: "calendar" | "bell";
  /**
   * For fallback uploads: the key of the failed calendar/bell check this
   * file stands in for. Lets the parent collapse the right upload UI on save.
   */
  fallbackFor?: string;
  state: SourceCheckState;
  /** Plain-English detail shown under the status. */
  message?: string;
}

/** One item to verify+parse: either a URL or an uploaded file. */
export interface IntakeItem {
  key: string;
  kind: "calendar" | "bell" | "upload";
  label: string;
  url?: string;
  file?: File;
  /** For uploads: what kind of page the file holds. */
  uploadKind?: "calendar" | "bell";
}

/** One per-source result from the intake / refresh endpoints. */
export interface IntakeSourceResult {
  url: string;
  label?: string;
  kind?: string;
  verified: boolean;
  /**
   * Digital output was produced and stored (boolean). The parsed payload
   * itself is served by the content endpoint, not here.
   */
  parsed: boolean;
  message?: string | null;
  eventCount?: number;
  scheduleCount?: number;
  periodCount?: number;
}

/** One parsed bell-schedule period. */
export interface BellPeriod {
  name: string;
  start: string;
  end: string;
}

export const MAX_BELL_ROWS = 5;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// ---------------------------------------------------------------------------
// Client-side helpers
// ---------------------------------------------------------------------------

/** Plain-English file validation for the photo/PDF upload. Returns the error or null. */
export function validateUploadFile(file: File): string | null {
  const isImage = file.type.startsWith("image/");
  const isPdf = file.type === "application/pdf";
  if (!isImage && !isPdf)
    return "That file won't work — please choose a photo or a PDF.";
  if (file.size > MAX_UPLOAD_BYTES)
    return "That file is too big — please keep it under 10 MB.";
  return null;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function intakeResultsOf(json: unknown): IntakeSourceResult[] {
  if (Array.isArray(json)) return json as IntakeSourceResult[];
  if (json && typeof json === "object") {
    const o = json as Record<string, unknown>;
    for (const k of ["results", "sources", "items"]) {
      if (Array.isArray(o[k])) return o[k] as IntakeSourceResult[];
    }
  }
  return [];
}

async function readJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

/**
 * POST the URL intake. Returns `notFound: true` when the endpoint isn't
 * deployed yet so the caller can fall back to the plain save route.
 */
export async function postSourceIntake(
  memberId: string,
  body: {
    district?: string | null;
    calendar_url: string | null;
    bell_schedules: { label: string; url: string }[];
  },
): Promise<{ notFound: boolean; results: IntakeSourceResult[] }> {
  const res = await fetch(
    `/api/crew/members/${memberId}/school-sources/intake`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (res.status === 404) return { notFound: true, results: [] };
  const json = await readJson(res);
  if (!res.ok) {
    const msg =
      json && typeof json === "object" && typeof (json as { error?: unknown }).error === "string"
        ? (json as { error: string }).error
        : "The school-links check didn't go through. Try again.";
    throw new Error(msg);
  }
  return { notFound: false, results: intakeResultsOf(json) };
}

/** Upload one file; the endpoint stores it and reports plain-English status. */
export async function uploadSourceFile(
  memberId: string,
  file: File,
  label: string,
  kind: "calendar" | "bell",
): Promise<{
  notFound: boolean;
  result: { verified: boolean; parsed: boolean; message?: string | null } | null;
}> {
  const form = new FormData();
  form.append("file", file);
  form.append("label", label);
  form.append("kind", kind);
  const res = await fetch(
    `/api/crew/members/${memberId}/school-sources/upload`,
    { method: "POST", body: form },
  );
  if (res.status === 404) return { notFound: true, result: null };
  const json = await readJson(res);
  if (!res.ok) {
    const msg =
      json && typeof json === "object" && typeof (json as { error?: unknown }).error === "string"
        ? (json as { error: string }).error
        : "The upload didn't go through. Try again.";
    throw new Error(msg);
  }
  const o =
    json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  return {
    notFound: false,
    result: {
      verified: o.ok === true,
      parsed: o.parsed === true,
      message: typeof o.message === "string" ? o.message : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Parsed-result normalization (defensive: the parser may shape data loosely)
// ---------------------------------------------------------------------------

/** Pull a readable period list out of a bell `parsed` payload.
 * Handles DigitalBellSchedule[] ({label, periods:[{name,start,end}]}) as well
 * as bare period arrays or {periods:[...]}. Defensive: unknown shapes yield []. */
export function normalizeBellPeriods(parsed: unknown): BellPeriod[] {
  if (!parsed || typeof parsed !== "object") return [];
  const o = parsed as Record<string, unknown>;
  let schedules: unknown[];
  if (Array.isArray(parsed)) schedules = parsed;
  else if (Array.isArray(o.schedules)) schedules = o.schedules;
  else schedules = [parsed];
  const out: BellPeriod[] = [];
  const multi = schedules.length > 1;
  for (const s of schedules) {
    if (!s || typeof s !== "object") continue;
    const sched = s as Record<string, unknown>;
    // A bare period object (not wrapped in a schedule).
    const looksLikePeriod =
      typeof sched.name === "string" || typeof sched.start === "string";
    const periods = looksLikePeriod
      ? [sched]
      : Array.isArray(sched.periods)
        ? sched.periods
        : [];
    const schedLabel = asString(sched.label);
    for (const p of periods) {
      if (!p || typeof p !== "object") continue;
      const r = p as Record<string, unknown>;
      const name = asString(r.name ?? r.label ?? r.period ?? r.title);
      const start = asString(r.start ?? r.start_time ?? r.begin ?? r.from);
      const end = asString(r.end ?? r.end_time ?? r.finish ?? r.to);
      if (!name && !start && !end) continue;
      out.push({
        name:
          multi && schedLabel
            ? `${schedLabel} · ${name || "Period"}`
            : name || "Period",
        start,
        end,
      });
    }
  }
  return out;
}

/** Count the events in a calendar `parsed` payload (DigitalCalendarEvent[]). */
export function countCalendarEvents(parsed: unknown): number | null {
  if (!parsed) return null;
  if (Array.isArray(parsed)) return parsed.length;
  if (typeof parsed === "object") {
    const o = parsed as Record<string, unknown>;
    if (Array.isArray(o.events)) return o.events.length;
    const n = o.event_count ?? o.events_saved ?? o.total_events ?? o.count;
    if (typeof n === "number" && Number.isFinite(n))
      return Math.max(0, Math.round(n));
  }
  return null;
}

/** Pull the calendar event count / summary out of a `parsed` payload. */
export function normalizeCalendarSummary(parsed: unknown): {
  eventCount: number | null;
  summary: string | null;
} {
  const eventCount = countCalendarEvents(parsed);
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    const o = parsed as Record<string, unknown>;
    return { eventCount, summary: asString(o.summary ?? o.note) || null };
  }
  return { eventCount, summary: null };
}

// ---------------------------------------------------------------------------
// Intake runner: uploads + verify+parse with per-source status callbacks
// ---------------------------------------------------------------------------

const LINK_ERROR_FALLBACK =
  "We couldn't open that link. Check it in your browser and try again.";

export interface RunIntakeOptions {
  memberId: string;
  district?: string | null;
  items: IntakeItem[];
  /** Patch one check's state/message. */
  onCheck: (key: string, patch: Partial<SourceCheck>) => void;
  /**
   * Plain-save fallback used when the intake endpoint isn't deployed yet.
   * Receives the full URL payload so nothing the user typed is lost.
   */
  legacySave: (payload: {
    district: string | null;
    calendar_url: string | null;
    bell_schedules: { label: string; url: string }[];
  }) => Promise<void>;
}

/**
 * Runs the intake for a set of items: uploads files first, then POSTs the
 * URL intake. Updates each source's check inline; never throws — every
 * failure lands on the failing source as a plain-English message with a
 * retry path.
 */
export async function runSourceIntake(opts: RunIntakeOptions): Promise<void> {
  const { memberId, items, onCheck, legacySave } = opts;
  const district = opts.district ?? null;

  const urlItems = items.filter((i) => i.kind !== "upload");
  const fileItems = items.filter((i) => i.kind === "upload" && i.file);

  // 1. Uploads — one at a time so each file gets its own status.
  for (const item of fileItems) {
    const file = item.file as File;
    onCheck(item.key, { state: "uploading", message: undefined });
    try {
      const { notFound, result } = await uploadSourceFile(
        memberId,
        file,
        item.label,
        item.uploadKind ?? "calendar",
      );
      if (notFound) {
        onCheck(item.key, {
          state: "error",
          message:
            "Uploads aren't switched on yet — the link fields still work, and you can add this file later.",
        });
        continue;
      }
      if (result && result.verified) {
        onCheck(item.key, {
          state: "saved",
          message: result.message ?? "Uploaded.",
        });
      } else {
        onCheck(item.key, {
          state: "error",
          message:
            (result && result.message) ||
            "We couldn't read that file. A clear photo of the printed page works best.",
        });
      }
    } catch (e) {
      onCheck(item.key, {
        state: "error",
        message:
          e instanceof Error ? e.message : "The upload didn't go through. Try again.",
      });
    }
  }

  // 2. URL intake.
  if (urlItems.length === 0) return;
  const cal = urlItems.find((i) => i.kind === "calendar");
  const bells = urlItems.filter((i) => i.kind === "bell");
  const payload = {
    district,
    calendar_url: cal?.url ?? null,
    bell_schedules: bells.map((b) => ({ label: b.label, url: b.url ?? "" })),
  };
  try {
    const { notFound, results } = await postSourceIntake(memberId, payload);
    if (notFound) {
      // The intake endpoint isn't deployed yet — save the links the old way
      // so nothing the user typed is lost.
      try {
        await legacySave(payload);
        for (const item of urlItems) {
          onCheck(item.key, {
            state: "saved",
            message:
              "Saved. The automatic link-check isn't available yet — open the link in your browser to confirm it works.",
          });
        }
      } catch (e) {
        for (const item of urlItems) {
          onCheck(item.key, {
            state: "error",
            message:
              e instanceof Error
                ? e.message
                : "Couldn't save those links. Try again.",
          });
        }
      }
      return;
    }
    const byUrl = new Map<string, IntakeSourceResult>();
    for (const r of results) {
      if (r && typeof r.url === "string") byUrl.set(r.url, r);
    }
    for (const item of urlItems) {
      const result = item.url ? byUrl.get(item.url) : undefined;
      if (!result) {
        onCheck(item.key, {
          state: "error",
          message: LINK_ERROR_FALLBACK,
        });
        continue;
      }
      if (result.verified) {
        onCheck(item.key, {
          state: "saved",
          message: result.message ?? "Saved — the link opened fine.",
        });
      } else {
        onCheck(item.key, {
          state: "error",
          message: result.message ?? LINK_ERROR_FALLBACK,
        });
      }
    }
  } catch (e) {
    for (const item of urlItems) {
      onCheck(item.key, {
        state: "error",
        message:
          e instanceof Error
            ? e.message
            : "We couldn't check those links. Try again.",
      });
    }
  }
}

// ---------------------------------------------------------------------------
// UI pieces
// ---------------------------------------------------------------------------

/** Small inline spinner used for pending states. */
export function Spinner({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-2" role="status">
      <svg
        aria-hidden="true"
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        className="animate-spin text-neon-green"
      >
        <circle
          cx="12"
          cy="12"
          r="9"
          stroke="currentColor"
          strokeOpacity="0.25"
          strokeWidth="3"
        />
        <path
          d="M21 12a9 9 0 0 0-9-9"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </svg>
      {label && <span className="text-sm text-stardust">{label}</span>}
    </span>
  );
}

const INPUT_CLASS =
  "w-full rounded-xl border border-line bg-panel-2/60 px-4 py-2.5 text-sm text-star placeholder:text-dim focus:border-neon-green/60 focus:outline-none disabled:opacity-50";

/** Repeatable bell-schedule label+URL rows (max 5). */
export function BellScheduleRows({
  rows,
  onChange,
  disabled,
  idPrefix,
}: {
  rows: BellRowInput[];
  onChange: (rows: BellRowInput[]) => void;
  disabled?: boolean;
  idPrefix: string;
}) {
  function update(i: number, field: "label" | "url", value: string) {
    onChange(rows.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));
  }
  function addRow() {
    if (rows.length < MAX_BELL_ROWS) onChange([...rows, { label: "", url: "" }]);
  }
  function removeRow(i: number) {
    onChange(rows.filter((_, idx) => idx !== i));
  }
  return (
    <div className="space-y-2">
      <p
        id={`${idPrefix}-bell-heading`}
        className="text-xs font-medium text-stardust"
      >
        Bell schedule links
      </p>
      {rows.map((row, i) => (
        <div
          key={i}
          className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_2fr_auto] sm:items-center"
        >
          <div>
            <label
              htmlFor={`${idPrefix}-bell-label-${i}`}
              className="mb-1 block text-xs text-dim sm:sr-only"
            >
              Bell schedule {i + 1} label
            </label>
            <input
              id={`${idPrefix}-bell-label-${i}`}
              value={row.label}
              onChange={(e) => update(i, "label", e.target.value)}
              placeholder={i === 0 ? "Daily" : "Late start"}
              autoComplete="off"
              disabled={disabled}
              className={INPUT_CLASS}
            />
          </div>
          <div>
            <label
              htmlFor={`${idPrefix}-bell-url-${i}`}
              className="mb-1 block text-xs text-dim sm:sr-only"
            >
              Bell schedule {i + 1} link
            </label>
            <input
              id={`${idPrefix}-bell-url-${i}`}
              value={row.url}
              onChange={(e) => update(i, "url", e.target.value)}
              placeholder="https://www.yourschooldistrict.org/bell-schedule"
              autoComplete="off"
              inputMode="url"
              disabled={disabled}
              className={INPUT_CLASS}
            />
          </div>
          {rows.length > 1 ? (
            <button
              type="button"
              onClick={() => removeRow(i)}
              aria-label={`Remove bell schedule ${i + 1}`}
              disabled={disabled}
              className="rounded-lg border border-line bg-panel-2/60 px-2.5 py-2 text-sm text-dim transition-colors hover:text-red-400 disabled:opacity-50 sm:self-end"
            >
              ✕
            </button>
          ) : (
            <span aria-hidden="true" className="hidden w-[37px] sm:block" />
          )}
        </div>
      ))}
      {rows.length < MAX_BELL_ROWS && (
        <button
          type="button"
          onClick={addRow}
          disabled={disabled}
          className="text-xs font-medium text-neon-green transition-opacity hover:opacity-80 disabled:opacity-50"
        >
          + Add another
        </button>
      )}
    </div>
  );
}

/** Conditional fallback upload, revealed under a failed URL source only
 * (URL-first intake: uploads appear when a link couldn't be read, never
 * alongside the link fields). Scoped to a single kind — no kind toggle.
 * Photo/PDF picker + picked-file list with remove; the parent validates via
 * validateUploadFile and uploads through onUpload. */
export function SourceFallbackUpload({
  kind,
  onUpload,
  disabled,
  idPrefix,
  error,
}: {
  /** Which page the upload stands in for — sets the plain-English copy. */
  kind: "calendar" | "bell";
  /** Called with the picked files when the user confirms the upload. */
  onUpload: (files: File[]) => void;
  disabled?: boolean;
  idPrefix: string;
  error?: string;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const inputId = `${idPrefix}-fallback-upload`;
  function add(picked: File[]) {
    if (picked.length > 0) setFiles((prev) => [...prev, ...picked]);
  }
  function remove(i: number) {
    setFiles((prev) => prev.filter((_, idx) => idx !== i));
  }
  return (
    <div className="rounded-xl border border-neon-amber/30 bg-neon-amber/5 px-4 py-3">
      <p className="text-xs font-medium text-neon-amber">
        The link didn&apos;t work — upload instead
      </p>
      <p
        id={`${inputId}-hint`}
        className="mt-1 text-xs leading-relaxed text-stardust"
      >
        {kind === "calendar"
          ? "This page loads its events with JavaScript, so we couldn't read it. Snap a photo of the printed calendar or upload the PDF instead."
          : "We couldn't read the bell schedule page. Snap a photo of the printed schedule or upload the PDF instead."}
      </p>
      <label
        htmlFor={inputId}
        className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-panel-2/60 px-4 py-2.5 text-sm font-medium text-stardust transition-colors hover:text-star focus-within:border-neon-green/60"
      >
        <svg
          aria-hidden="true"
          width="15"
          height="15"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
          <circle cx="12" cy="13" r="4" />
        </svg>
        Upload a photo or PDF
        <input
          id={inputId}
          type="file"
          accept="image/*,application/pdf"
          multiple
          disabled={disabled}
          aria-describedby={`${inputId}-hint`}
          className="sr-only"
          onChange={(e) => {
            add(Array.from(e.target.files ?? []));
            // Reset so the same file can be picked again after removal.
            e.target.value = "";
          }}
        />
      </label>
      {files.length > 0 && (
        <ul className="mt-2 space-y-1.5" aria-label="Files to upload">
          {files.map((file, i) => (
            <li
              key={`${file.name}-${file.size}-${i}`}
              className="flex items-center justify-between gap-2 rounded-xl border border-line bg-panel px-3 py-2 text-sm"
            >
              <span className="min-w-0 truncate text-stardust">
                {file.name}
                <span className="ml-2 text-xs text-dim">
                  {(file.size / 1024).toFixed(0)} KB
                </span>
              </span>
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label={`Remove ${file.name}`}
                disabled={disabled}
                className="shrink-0 rounded-lg px-2 py-1 text-xs text-dim transition-colors hover:text-red-400 disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
      {files.length > 0 && (
        <button
          type="button"
          onClick={() => onUpload(files)}
          disabled={disabled}
          className="mt-2 rounded-xl border border-neon-green/40 bg-neon-green/10 px-4 py-2 text-sm font-medium text-neon-green transition-colors hover:bg-neon-green/20 disabled:opacity-50"
        >
          Upload {files.length === 1 ? "file" : `${files.length} files`}
        </button>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-neon-amber">
          {error}
        </p>
      )}
    </div>
  );
}

/** One per-source status line: verifying → saved / couldn't-read + retry. */
export function SourceCheckRow({
  check,
  onRetry,
  retrying,
}: {
  check: SourceCheck;
  onRetry?: () => void;
  retrying?: boolean;
}) {
  if (check.state === "idle") return null;
  const pending = check.state === "verifying" || check.state === "uploading";
  const ok = check.state === "saved";
  const failed = check.state === "error";
  return (
    <div
      role={failed ? "alert" : "status"}
      className={`rounded-xl border px-4 py-2.5 text-sm ${
        ok
          ? "border-neon-green/30 bg-neon-green/5 text-neon-green"
          : failed
            ? "border-neon-amber/30 bg-neon-amber/5 text-neon-amber"
            : "border-line bg-panel-2/60 text-stardust"
      }`}
    >
      <p className="font-medium">{check.label}</p>
      {pending ? (
        <div className="mt-1">
          <Spinner
            label={
              check.state === "uploading"
                ? "Uploading…"
                : "Reading the school's page…"
            }
          />
        </div>
      ) : (
        <>
          {check.message && <p className="mt-0.5 text-xs leading-relaxed">{check.message}</p>}
          {failed && onRetry && (
            <button
              type="button"
              onClick={onRetry}
              disabled={retrying}
              className="mt-2 rounded-lg border border-neon-amber/40 bg-neon-amber/10 px-3 py-1.5 text-xs font-medium text-neon-amber transition-colors hover:bg-neon-amber/20 disabled:opacity-50"
            >
              {retrying ? "Trying again…" : "Try again"}
            </button>
          )}
        </>
      )}
    </div>
  );
}

/** Parsed bell schedule rendered as a readable period table. */
export function ParsedBellTable({
  periods,
  label,
}: {
  periods: BellPeriod[];
  label?: string;
}) {
  if (periods.length === 0) return null;
  return (
    <div className="rounded-xl border border-neon-green/20 bg-panel-2/60 px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-dim">
        What we read{label ? ` — ${label}` : ""}
      </p>
      <table className="mt-2 w-full border-collapse text-sm">
        <thead>
          <tr className="text-left text-xs text-dim">
            <th scope="col" className="pb-1 pr-3 font-medium">
              Period
            </th>
            <th scope="col" className="pb-1 pr-3 font-medium">
              Starts
            </th>
            <th scope="col" className="pb-1 font-medium">
              Ends
            </th>
          </tr>
        </thead>
        <tbody>
          {periods.map((p, i) => (
            <tr key={i} className="border-t border-line/60 text-stardust">
              <td className="py-1.5 pr-3 text-star">{p.name}</td>
              <td className="py-1.5 pr-3">{p.start || "—"}</td>
              <td className="py-1.5">{p.end || "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "Calendar: 24 events saved" note for a parsed calendar source. */
export function ParsedCalendarNote({
  eventCount,
  summary,
}: {
  eventCount: number | null;
  summary: string | null;
}) {
  if (eventCount === null && !summary) return null;
  return (
    <div
      role="status"
      className="rounded-xl border border-neon-green/20 bg-panel-2/60 px-4 py-3"
    >
      <p className="text-sm text-star">
        {eventCount !== null
          ? `Calendar: ${eventCount} ${eventCount === 1 ? "event" : "events"} saved`
          : "Calendar saved"}
        {summary ? <span className="text-stardust"> — {summary}</span> : null}
      </p>
    </div>
  );
}
