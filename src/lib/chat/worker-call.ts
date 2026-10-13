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
  let res: Response;
  try {
    res = await fetch(`${CRYSTAL_URL}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${CRYSTAL_SECRET}`,
      },
      signal: AbortSignal.timeout(WORKER_TIMEOUT_MS),
      body: JSON.stringify(body),
    });
  } catch {
    throw new WorkerDown("worker unreachable");
  }
  if (!res.ok) throw new WorkerDown(`worker ${res.status}`);
  const data: unknown = await res.json().catch(() => null);
  try {
    return toWireResponse(data, "crystal").reply;
  } catch {
    throw new WorkerDown("worker returned a malformed reply");
  }
}
