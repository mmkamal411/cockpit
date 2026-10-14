/**
 * Unit tests for src/lib/auth/ensure-pilot.ts — lazy pilots-row provisioning.
 * Run: node src/lib/auth/ensure-pilot.test.ts   (Node ≥ 22 strips types natively)
 */
import { ensurePilot } from "./ensure-pilot.ts";

let passed = 0;
let failed = 0;

function ok(cond: boolean, name: string, extra?: unknown): void {
  if (cond) {
    passed++;
    console.log(`  ok  ${name}`);
  } else {
    failed++;
    console.log(
      `  FAIL ${name}` + (extra !== undefined ? `\n    detail: ${JSON.stringify(extra)}` : ""),
    );
  }
}

// Silence the structured server-side error log during the failure-path test.
const realError = console.error;
console.error = () => {};

function mockClient(upsertImpl: (row: unknown, opts: unknown) => Promise<{ error: unknown }>) {
  const calls: { row: unknown; opts: unknown }[] = [];
  return {
    calls,
    client: {
      from: () => ({
        upsert: (row: unknown, opts: unknown) => {
          calls.push({ row, opts });
          return upsertImpl(row, opts);
        },
      }),
    },
  };
}

console.log("ensurePilot — success path");
{
  const m = mockClient(async () => ({ error: null }));
  const res = await ensurePilot(m.client as never, "uid-1", "Sabah@Example.com");
  ok(res.ok === true, "returns ok:true on upsert success", res);
  ok(m.calls.length === 1, "upserts exactly once", m.calls.length);
  ok(
    (m.calls[0].row as { id: string }).id === "uid-1" &&
      (m.calls[0].row as { email: string }).email === "sabah@example.com",
    "upserts id + lowercased email",
    m.calls[0].row,
  );
  ok(
    (m.calls[0].opts as { onConflict: string }).onConflict === "id",
    "upserts onConflict=id",
    m.calls[0].opts,
  );
}

console.log("ensurePilot — no email");
{
  const m = mockClient(async () => ({ error: null }));
  const res = await ensurePilot(m.client as never, "uid-2", null);
  ok(res.ok === true, "returns ok:true without email", res);
  ok(!("email" in (m.calls[0].row as object)), "omits email key when null", m.calls[0].row);
}

console.log("ensurePilot — failure path (fail LOUD, never throw)");
{
  const m = mockClient(async () => ({ error: new Error("23503 FK violation") }));
  const res = await ensurePilot(m.client as never, "uid-3", "x@y.z");
  ok(res.ok === false, "returns ok:false on upsert error", res);
  if (!res.ok) {
    ok(
      typeof res.message === "string" &&
        res.message.length > 0 &&
        /sign out and sign back in/i.test(res.message),
      "message is plain English with a recovery path",
      res.message,
    );
  }
}

console.log("ensurePilot — client throws");
{
  const m = mockClient(async () => {
    throw new Error("network down");
  });
  let threw = false;
  let res: unknown = null;
  try {
    res = await ensurePilot(m.client as never, "uid-4", null);
  } catch {
    threw = true;
  }
  ok(!threw, "never throws", { threw });
  ok((res as { ok: boolean }).ok === false, "returns ok:false when client throws", res);
}

console.error = realError;
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
