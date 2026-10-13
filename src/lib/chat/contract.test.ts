/**
 * Unit tests for src/lib/chat/contract.ts — the canonical app↔worker contract.
 * Run: node src/lib/chat/contract.test.ts   (Node ≥ 22 strips types natively)
 */
import {
  CONTRACT_VERSION,
  ContractViolationError,
  toWireContext,
  toWireRequest,
  toWireResponse,
} from "./contract.ts";

let passed = 0;
let failed = 0;

function ok(name: string): void {
  passed++;
  console.log(`  ok  ${name}`);
}
function fail(name: string, extra: unknown): void {
  failed++;
  console.log(`  FAIL ${name}\n    ${JSON.stringify(extra)}`);
}
function eq(actual: unknown, expected: unknown, name: string): void {
  if (JSON.stringify(actual) === JSON.stringify(expected)) ok(name);
  else fail(name, { expected, actual });
}
function throwsViolation(fn: () => unknown, name: string): void {
  try {
    fn();
    fail(name, "did not throw");
  } catch (err) {
    if (err instanceof ContractViolationError) ok(name);
    else fail(name, `wrong error type: ${String(err)}`);
  }
}

const goodBundle = {
  context_version: 2,
  pilot: { name: "Meheldi", timezone: "America/New_York" },
  now: "2026-10-13T18:56:00.000Z",
  weather: "72°F, Sunny in Marietta (high 78°, low 61°)",
  agenda: ["9:30 AM — Dentist @ Main St"],
  todos: ["Buy milk (due 2026-10-14)"],
  nudges: ["bill/high: Electric due — $142"],
};
const goodMessages = [{ role: "user", text: "hello" }];

console.log("toWireContext — happy path");
const wire = toWireContext(structuredClone(goodBundle));
eq(wire, goodBundle, "valid bundle passes through unchanged");
eq(CONTRACT_VERSION, 2, "contract version is 2");

console.log("toWireContext — loud rejection (never silent)");
throwsViolation(
  () => toWireContext({ ...structuredClone(goodBundle), crew: "Children linked: X (child)" }),
  "P0: crew/child field rejected loudly",
);
throwsViolation(
  () => toWireContext({ ...structuredClone(goodBundle), mystery: 1 }),
  "unknown top-level field rejected",
);
throwsViolation(
  () => toWireContext({ context_version: 2, now: "2026-10-13T18:56:00.000Z" }),
  "missing pilot rejected",
);
throwsViolation(
  () => toWireContext({ ...structuredClone(goodBundle), context_version: 1 }),
  "wrong context_version rejected",
);
throwsViolation(
  () => toWireContext({ ...structuredClone(goodBundle), now: "not-a-date" }),
  "non-ISO now rejected",
);
throwsViolation(
  () => toWireContext({ ...structuredClone(goodBundle), agenda: ["ok", 42] }),
  "non-string agenda item rejected",
);
throwsViolation(
  () => toWireContext({ ...structuredClone(goodBundle), pilot: { name: "x", timezone: "y", email: "a@b.c" } }),
  "unknown pilot field rejected",
);
throwsViolation(() => toWireContext(null), "null bundle rejected");
throwsViolation(() => toWireContext("bundle"), "string bundle rejected");

console.log("toWireContext — whitelisting (defense in depth)");
const wireMinimal = toWireContext({
  context_version: 2,
  pilot: { name: null, timezone: null },
  now: "2026-10-13T18:56:00.000Z",
});
eq(Object.keys(wireMinimal).sort(), ["context_version", "now", "pilot"], "minimal bundle has exactly the contract keys");

console.log("toWireRequest — envelope");
const req = toWireRequest(structuredClone(goodMessages), structuredClone(goodBundle), "fireball");
eq(req.mode, "fireball", "mode passes through");
eq(req.messages, goodMessages, "messages pass through");
eq(req.context, goodBundle, "context passes through");
throwsViolation(
  () => toWireRequest(structuredClone(goodMessages), structuredClone(goodBundle), "muse"),
  "legacy mode value rejected",
);
throwsViolation(() => toWireRequest([], structuredClone(goodBundle), "crystal"), "empty messages rejected");
throwsViolation(
  () => toWireRequest([{ role: "pookie", text: "hi" }], structuredClone(goodBundle), "crystal"),
  "legacy pookie role rejected",
);

console.log("toWireResponse — worker envelope");
eq(
  toWireResponse({ reply: " hi ", persona: "fireball" }, "crystal"),
  { reply: "hi", persona: "fireball" },
  "reply trimmed, worker persona honored",
);
eq(
  toWireResponse({ reply: "hi", persona: "bogus" }, "fireball"),
  { reply: "hi", persona: "fireball" },
  "unknown persona falls back to requested mode",
);
eq(
  toWireResponse({ reply: "hi" }, "crystal"),
  { reply: "hi", persona: "crystal" },
  "missing persona falls back to requested mode",
);
throwsViolation(() => toWireResponse({ reply: "   " }, "crystal"), "blank reply rejected");
throwsViolation(() => toWireResponse({ persona: "crystal" }, "crystal"), "missing reply rejected");
throwsViolation(() => toWireResponse(null, "crystal"), "null envelope rejected");

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
