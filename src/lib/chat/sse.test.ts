/**
 * Unit tests for src/lib/chat/sse.ts — /api/chat SSE streaming.
 * Run: node src/lib/chat/sse.test.ts   (Node ≥ 22 strips types natively)
 */
import {
  chunkText,
  encodeSSE,
  createReplyStream,
  parseSSEFrame,
} from "./sse.ts";

let passed = 0;
let failed = 0;

function eq(actual: unknown, expected: unknown, name: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passed++;
    console.log(`  ok  ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name}\n    expected: ${e}\n    actual:   ${a}`);
  }
}

console.log("chunkText");
eq(chunkText("one two three four five", 2), ["one two", "three four", "five"], "groups words");
eq(chunkText("hello", 4), ["hello"], "short text is one chunk");
eq(chunkText("", 4), [], "empty text, no chunks");
eq(chunkText("a  b   c", 4), ["a b c"], "collapses whitespace");

console.log("encodeSSE / parseSSEFrame");
eq(encodeSSE({ delta: "hi" }), 'data: {"delta":"hi"}\n\n', "frame format");
eq(parseSSEFrame('data: {"delta":"hi"}\n\n'), { delta: "hi" }, "parses data frame");
eq(parseSSEFrame(': keep-alive\n\n'), null, "ignores comment frames");
eq(parseSSEFrame('data: not-json\n\n'), null, "ignores malformed json");

console.log("createReplyStream — deltas reassemble the reply, done carries meta");
{
  const reply = "The quick brown fox jumps over the lazy dog near the river bank";
  const stream = createReplyStream(reply, { thread_id: "t1", mode: "fireball" }, 3, 0);
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";
  let done: Record<string, unknown> | null = null;
  for (;;) {
    const { value, done: closed } = await reader.read();
    if (closed) break;
    buf += decoder.decode(value, { stream: true });
    const frames = buf.split("\n\n");
    buf = frames.pop() ?? "";
    for (const f of frames) {
      const parsed = parseSSEFrame(f + "\n\n");
      if (!parsed) continue;
      if (typeof parsed["delta"] === "string") {
        text += (text ? " " : "") + (parsed["delta"] as string);
      }
      if (parsed["done"] === true) done = parsed;
    }
  }
  eq(text, reply, "reassembled text matches reply exactly");
  eq(done, { done: true, thread_id: "t1", mode: "fireball" }, "done frame carries meta");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
