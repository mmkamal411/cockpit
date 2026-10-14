import { strict as assert } from "node:assert";
import {
  fetchSchoolMail,
  GraphMailPermissionError,
  isSchoolEmail,
  mapGraphMessage,
  type GraphMessage,
} from "./graph-mail.ts";

function msg(over: Partial<GraphMessage> = {}): GraphMessage {
  return {
    id: "m1",
    subject: "Progress report",
    bodyPreview: "Your child's grades",
    receivedDateTime: "2026-10-12T10:00:00Z",
    from: { emailAddress: { name: "Kathryn Thomason", address: "kthomason@cobbk12.org" } },
    ...over,
  };
}

// --- mapping ---------------------------------------------------------------

{
  const mapped = mapGraphMessage(msg());
  assert.ok(mapped);
  assert.equal(mapped.sender, "Kathryn Thomason");
  assert.equal(mapped.subject, "Progress report");
  assert.equal(mapped.preview, "Your child's grades");
  assert.equal(mapped.date, "2026-10-12T10:00:00Z");
}

{
  // Falls back to the address when no display name.
  const mapped = mapGraphMessage(msg({ from: { emailAddress: { address: "office@school.edu" } } }));
  assert.ok(mapped);
  assert.equal(mapped.sender, "office@school.edu");
}

{
  // Empty message -> nothing worth storing.
  assert.equal(mapGraphMessage(msg({ subject: "", bodyPreview: "" })), null);
}

{
  // Long previews/subjects are trimmed to sane storage sizes.
  const mapped = mapGraphMessage(msg({ subject: "x".repeat(500), bodyPreview: "y".repeat(900) }));
  assert.ok(mapped);
  assert.ok(mapped.subject.length <= 200);
  assert.ok(mapped.preview.length <= 280);
}

// --- school-signal filter (district-agnostic) --------------------------------

{
  assert.ok(isSchoolEmail(msg()), "teacher sender");
  assert.ok(
    isSchoolEmail(msg({ from: { emailAddress: { address: "noreply@district.edu" } } })),
    ".edu sender",
  );
  assert.ok(
    isSchoolEmail(msg({ from: { emailAddress: { name: "Amazon", address: "a@amazon.com" } }, subject: "Report card is ready" })),
    "school subject",
  );
  assert.ok(!isSchoolEmail(msg({
    from: { emailAddress: { name: "Delta", address: "deals@delta.com" } },
    subject: "Your trip to Miami",
    bodyPreview: "Boarding pass",
  })), "personal mail rejected");
}

// --- fetch: paging, filter, caps ---------------------------------------------

type Handler = (url: string) => Promise<Response>;

function stubFetch(handler: Handler): () => void {
  const orig = globalThis.fetch;
  globalThis.fetch = handler as typeof globalThis.fetch;
  return () => {
    globalThis.fetch = orig;
  };
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

const schoolMsg = (id: string): GraphMessage =>
  msg({ id, from: { emailAddress: { name: "School Office", address: "office@school.edu" } } });
const personalMsg = (id: string): GraphMessage =>
  msg({
    id,
    subject: "Receipt",
    bodyPreview: "Thanks for your order",
    from: { emailAddress: { name: "Store", address: "orders@store.com" } },
  });

{
  const seen: string[] = [];
  const restore = stubFetch(async (url) => {
    seen.push(url);
    return jsonResponse({ value: [schoolMsg("a"), personalMsg("b"), schoolMsg("c")] });
  });
  try {
    const out = await fetchSchoolMail("tok", { maxEmails: 10 });
    assert.equal(out.length, 2, "only school mail kept");
    assert.equal(out[0].sender, "School Office");
    const first = seen[0];
    assert.ok(first.includes("%24select="), "selects fields");
    assert.ok(first.includes("%24filter="), "date-windowed");
    assert.ok(first.includes("%24top="), "page size set");
  } finally {
    restore();
  }
}

{
  // Pagination + maxEmails cap: stops fetching once quota is full.
  let calls = 0;
  const restore = stubFetch(async () => {
    calls += 1;
    return jsonResponse({
      value: [schoolMsg(`s${calls}-1`), schoolMsg(`s${calls}-2`)],
      "@odata.nextLink": "https://graph.microsoft.com/next",
    });
  });
  try {
    const out = await fetchSchoolMail("tok", { maxEmails: 3 });
    assert.equal(out.length, 3);
    assert.ok(calls <= 2, `stopped early after ${calls} page(s)`);
  } finally {
    restore();
  }
}

{
  // 429 with Retry-After is honored, then the page is retried.
  let calls = 0;
  const restore = stubFetch(async () => {
    calls += 1;
    if (calls === 1) return jsonResponse({ error: { message: "throttled" } }, 429, { "Retry-After": "0" });
    return jsonResponse({ value: [schoolMsg("ok")] });
  });
  try {
    const out = await fetchSchoolMail("tok");
    assert.equal(calls, 2);
    assert.equal(out.length, 1);
  } finally {
    restore();
  }
}

{
  // 403 -> distinct permission error (graceful "not granted" path).
  const restore = stubFetch(async () =>
    jsonResponse({ error: { code: "ErrorAccessDenied", message: "Access denied" } }, 403),
  );
  try {
    await assert.rejects(() => fetchSchoolMail("tok"), GraphMailPermissionError);
  } finally {
    restore();
  }
}

{
  // Dedupes repeated message ids across pages.
  const restore = stubFetch(async () => jsonResponse({ value: [schoolMsg("dup"), schoolMsg("dup")] }));
  try {
    const out = await fetchSchoolMail("tok");
    assert.equal(out.length, 1);
  } finally {
    restore();
  }
}

console.log("graph-mail.test.ts: all assertions passed");
