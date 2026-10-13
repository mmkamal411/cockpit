/**
 * SSE helpers for /api/chat streaming.
 * The crystal worker currently returns buffered JSON (no upstream SSE), so
 * /api/chat emits the full reply as progressive word-chunks over a real
 * SSE connection — the client gets the live streaming feel. If the worker
 * ever streams, the route can pipe its chunks through encodeSSE unchanged.
 */

export interface StreamMeta {
  thread_id: string;
  mode: "crystal" | "fireball";
}

/** Split text into word-run chunks for progressive emission. */
export function chunkText(text: string, wordsPerChunk = 4): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const chunks: string[] = [];
  for (let i = 0; i < words.length; i += wordsPerChunk) {
    chunks.push(words.slice(i, i + wordsPerChunk).join(" "));
  }
  return chunks;
}

/** One SSE frame: `data: {...}\n\n`. */
export function encodeSSE(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

/**
 * ReadableStream of SSE frames: {delta} chunks, then a final
 * {done:true, thread_id, mode} frame. Deltas join with single spaces to
 * reassemble the original text exactly.
 */
export function createReplyStream(
  reply: string,
  meta: StreamMeta,
  wordsPerChunk = 4,
  paceMs = 12,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const chunks = chunkText(reply, wordsPerChunk);
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (let i = 0; i < chunks.length; i++) {
          controller.enqueue(encoder.encode(encodeSSE({ delta: chunks[i] })));
          if (paceMs > 0) await new Promise((r) => setTimeout(r, paceMs));
        }
        controller.enqueue(encoder.encode(encodeSSE({ done: true, ...meta })));
      } finally {
        controller.close();
      }
    },
  });
}

/** Parse one SSE frame body (`data: {...}`) — returns null when not a data frame. */
export function parseSSEFrame(frame: string): Record<string, unknown> | null {
  const line = frame.split("\n").find((l) => l.startsWith("data:"));
  if (!line) return null;
  try {
    return JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
  } catch {
    return null;
  }
}
