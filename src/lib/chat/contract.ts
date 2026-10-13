/**
 * Canonical app ↔ Crystal-worker chat contract — version 2.
 *
 * This module is the single source of truth for the context bundle the app
 * sends the Crystal worker on every chat turn (POST /api/chat → worker /chat).
 *
 * The v2 bundle carries the pilot's own situational context only. It NEVER
 * carries crew/child signals: locked founder decision (2026-10-13) excludes
 * crew/child signals from everything the app sends to the worker, and the
 * validator below rejects any bundle containing child-related fields LOUDLY
 * (ContractViolationError) instead of silently forwarding them.
 *
 * See CONTRACT.md (same directory) for the wire format, the per-field privacy
 * inventory with sign-off, and the worker-side changes this contract requires.
 *
 * This module is dependency-free on purpose: it can be copied verbatim into
 * the Crystal worker (d-dash-app/workers/crystal/src/) for server-side
 * validation there, where the same rule applies — reject unknown/missing
 * fields loudly, never silently.
 */

export const CONTRACT_VERSION = 2 as const;

export type Persona = "crystal" | "fireball";

/**
 * Context bundle the app sends the worker with every chat turn.
 *
 * Classification summary (full inventory in CONTRACT.md):
 * - pilot.name / pilot.timezone: pilot identity (display name only, never email)
 * - now: technical (model's "today")
 * - weather / agenda / todos / nudges: pilot-owned content, situational
 */
export interface ChatContextBundle {
  /** Contract version — the worker rejects bundles whose version it doesn't know. */
  context_version: typeof CONTRACT_VERSION;
  pilot: { name: string | null; timezone: string | null };
  /** ISO timestamp — the model's "today". */
  now: string;
  /** One-line current conditions, e.g. "72°F, Sunny in Marietta (high 78°, low 61°)". */
  weather?: string;
  /** Today's agenda lines, ≤12, e.g. "9:30 AM — Dentist @ Main St". */
  agenda?: string[];
  /** Open todos, ≤12, due-date sorted, e.g. "Buy milk (due 2026-10-14)". */
  todos?: string[];
  /** Active (non-dismissed) nudges, ≤8, e.g. "bill/high: Electric due — …". */
  nudges?: string[];
}

export interface WorkerChatMessage {
  role: "user" | "assistant";
  text: string;
}

export interface WorkerChatRequest {
  messages: WorkerChatMessage[];
  context: ChatContextBundle;
  mode: Persona;
}

export interface WorkerChatResponse {
  reply: string;
  persona: Persona;
}

/** The ONLY fields that may leave the app inside a context bundle. */
const BUNDLE_KEYS = new Set([
  "context_version",
  "pilot",
  "now",
  "weather",
  "agenda",
  "todos",
  "nudges",
]);

/**
 * Thrown when the outbound bundle (or an inbound worker envelope) violates
 * the contract. Callers log it with structured server-side logs and show the
 * pilot a plain-English error — never the field names or internals.
 */
export class ContractViolationError extends Error {
  readonly code = "CONTRACT_VIOLATION";
  readonly details: Record<string, unknown>;
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ContractViolationError";
    this.details = details;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoTimestamp(value: unknown): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  const t = Date.parse(value);
  return Number.isFinite(t);
}

function cleanStringList(
  value: unknown,
  field: string,
  maxLen: number,
): string[] {
  if (!Array.isArray(value)) {
    throw new ContractViolationError(`${field} must be a list`, { field });
  }
  return value.map((item, i) => {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new ContractViolationError(`${field}[${i}] must be a non-empty string`, {
        field,
        index: i,
      });
    }
    return item.trim().slice(0, maxLen);
  });
}

/**
 * Validate a context bundle and return a whitelisted wire copy.
 *
 * Loud by design: unknown fields (e.g. a re-added `crew` block carrying
 * child names), missing required fields, or type mismatches throw
 * ContractViolationError instead of being silently dropped or forwarded.
 * The returned object contains ONLY contract fields — nothing else can
 * leak onto the wire, whatever the builder above produced.
 */
export function toWireContext(bundle: unknown): ChatContextBundle {
  if (!isRecord(bundle)) {
    throw new ContractViolationError("context must be an object", {});
  }
  const unknownKeys = Object.keys(bundle).filter((k) => !BUNDLE_KEYS.has(k));
  if (unknownKeys.length > 0) {
    throw new ContractViolationError("context has fields outside the contract", {
      unknownKeys,
    });
  }
  if (bundle.context_version !== CONTRACT_VERSION) {
    throw new ContractViolationError("context_version must be 2", {
      got: bundle.context_version ?? null,
    });
  }
  const pilot = bundle.pilot;
  if (!isRecord(pilot)) {
    throw new ContractViolationError("context.pilot must be an object", {});
  }
  const unknownPilotKeys = Object.keys(pilot).filter(
    (k) => k !== "name" && k !== "timezone",
  );
  if (unknownPilotKeys.length > 0) {
    throw new ContractViolationError("context.pilot has fields outside the contract", {
      unknownKeys: unknownPilotKeys,
    });
  }
  if (pilot.name !== null && typeof pilot.name !== "string") {
    throw new ContractViolationError("context.pilot.name must be a string or null", {});
  }
  if (pilot.timezone !== null && typeof pilot.timezone !== "string") {
    throw new ContractViolationError("context.pilot.timezone must be a string or null", {});
  }
  if (!isIsoTimestamp(bundle.now)) {
    throw new ContractViolationError("context.now must be an ISO timestamp", {});
  }

  const wire: ChatContextBundle = {
    context_version: CONTRACT_VERSION,
    pilot: {
      name: pilot.name === null ? null : (pilot.name as string).slice(0, 120),
      timezone: pilot.timezone === null ? null : (pilot.timezone as string).slice(0, 64),
    },
    now: bundle.now as string,
  };
  if (bundle.weather !== undefined) {
    if (typeof bundle.weather !== "string" || bundle.weather.trim().length === 0) {
      throw new ContractViolationError("context.weather must be a non-empty string", {});
    }
    wire.weather = bundle.weather.trim().slice(0, 300);
  }
  if (bundle.agenda !== undefined) {
    wire.agenda = cleanStringList(bundle.agenda, "context.agenda", 400);
  }
  if (bundle.todos !== undefined) {
    wire.todos = cleanStringList(bundle.todos, "context.todos", 400);
  }
  if (bundle.nudges !== undefined) {
    wire.nudges = cleanStringList(bundle.nudges, "context.nudges", 400);
  }
  return wire;
}

function toWireMessages(messages: unknown): WorkerChatMessage[] {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new ContractViolationError("messages must be a non-empty list", {});
  }
  return messages.map((m, i) => {
    if (
      !isRecord(m) ||
      (m.role !== "user" && m.role !== "assistant") ||
      typeof m.text !== "string" ||
      m.text.trim().length === 0
    ) {
      throw new ContractViolationError(`messages[${i}] must be {role: "user"|"assistant", text}`, {
        index: i,
      });
    }
    return { role: m.role, text: m.text.trim().slice(0, 4000) };
  });
}

function toWireMode(mode: unknown): Persona {
  if (mode === "crystal" || mode === "fireball") return mode;
  throw new ContractViolationError('mode must be "crystal" or "fireball"', {
    got: typeof mode === "string" ? mode : typeof mode,
  });
}

/** Build the validated wire envelope the app POSTs to the worker. */
export function toWireRequest(
  messages: unknown,
  bundle: unknown,
  mode: unknown,
): WorkerChatRequest {
  return {
    messages: toWireMessages(messages),
    context: toWireContext(bundle),
    mode: toWireMode(mode),
  };
}

/**
 * Validate the worker's reply envelope. The reply text is what matters; an
 * unknown persona label falls back to the requested mode rather than
 * breaking the turn.
 */
export function toWireResponse(data: unknown, requestedMode: Persona): WorkerChatResponse {
  if (!isRecord(data)) {
    throw new ContractViolationError("worker response must be an object", {});
  }
  const reply =
    typeof data.reply === "string" && data.reply.trim().length > 0
      ? data.reply.trim()
      : "";
  if (!reply) {
    throw new ContractViolationError("worker response has no usable reply", {});
  }
  const persona =
    data.persona === "crystal" || data.persona === "fireball"
      ? data.persona
      : requestedMode;
  return { reply, persona };
}
