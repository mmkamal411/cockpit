/**
 * worker-call — small server-side helper for one-shot Crystal calls that
 * don't belong to a chat thread (e.g. task breakdown).
 *
 * Builds the same wire envelope as /api/chat (contract v2) and POSTs it to
 * the crystal worker. Server-only: holds the worker secret, never imported
 * from client components.
 */

import { CONTRACT_VERSION, toWireResponse } from "./contract";

const CRYSTAL_URL = (
  process.env.CRYSTAL_URL ||
  process.env.NEXT_PUBLIC_CRYSTAL_URL ||
  process.env.NEXT_PUBLIC_POOKIE_TUTOR_URL ||
  "https://crystal.mehedikamal.workers.dev"
).replace(/\/$/, "");

/** Shared secret for the crystal worker (server-side only — never NEXT_PUBLIC). */
const CRYSTAL_SECRET = process.env.CRYSTAL_WORKER_SECRET;

const WORKER_TIMEOUT_MS = 30000;

export class WorkerDown extends Error {}

/**
 * Ask Crystal one question. Returns the reply text.
 * Throws WorkerDown when the worker is unreachable, misconfigured, or
 * returns a malformed envelope.
 */
export async function askCrystal(prompt: string, timezone?: string | null): Promise<string> {
  if (!CRYSTAL_SECRET) {
    throw new WorkerDown("CRYSTAL_WORKER_SECRET is not set");
  }
  const body = {
    messages: [{ role: "user", text: prompt.slice(0, 4000) }],
    context: {
      context_version: CONTRACT_VERSION,
      pilot: { name: null, timezone: timezone ?? null },
      now: new Date().toISOString(),
    },
    mode: "crystal",
  };
  const workerUrl = `${CRYSTAL_URL}/chat`;
  let res: Response;
  try {
    res = await fetch(workerUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CRYSTAL_SECRET}`,
      },
      signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
      body: JSON.stringify(body),
    });
  } catch (err) {
    // The worker never answered: network error or the 30s timeout fired.
    console.error(
      JSON.stringify({
        level: "error",
        event: "chat_worker_unreachable",
        route: "askCrystal",
        url: workerUrl,
        timeout_ms: WORKER_TIMEOUT_MS,
        reason: err instanceof Error ? err.name : typeof err,
        detail: err instanceof Error ? err.message.slice(0, 200) : null,
        at: new Date().toISOString(),
      }),
    );
    throw new WorkerDown("worker unreachable");
  }
  if (!res.ok) {
    // The worker answered with an error (e.g. 502 {error:"ai_error"} from
    // the Workers AI call). Keep the worker's own detail for diagnosis.
    let workerDetail: string | null = null;
    try {
      const errBody = (await res.json()) as { error?: unknown; detail?: unknown };
      const detail =
        typeof errBody?.detail === "string"
          ? errBody.detail
          : typeof errBody?.error === "string"
            ? errBody.error
            : null;
      workerDetail = detail?.slice(0, 300) ?? null;
    } catch {
      workerDetail = null;
    }
    console.error(
      JSON.stringify({
        level: "error",
        event: "chat_worker_error",
        route: "askCrystal",
        url: workerUrl,
        status: res.status,
        worker_detail: workerDetail,
        at: new Date().toISOString(),
      }),
    );
    throw new WorkerDown(`worker ${res.status}`);
  }
  const data: unknown = await res.json().catch(() => null);
  try {
    return toWireResponse(data, "crystal").reply;
  } catch {
    throw new WorkerDown("worker returned a malformed reply");
  }
}
