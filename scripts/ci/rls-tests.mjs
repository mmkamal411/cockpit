// scripts/ci/rls-tests.mjs — Row-Level Security assertions against the
// cockpit-ci Supabase project (synthetic data only).
//
// Zero npm dependencies (global fetch + node builtins only).
//
// Env (from the GitHub `ci` environment — never commit these):
//   CI_SUPABASE_URL               e.g. https://xyzcompany.supabase.co
//   CI_SUPABASE_ANON_KEY          publishable/anon key of cockpit-ci
//   CI_SUPABASE_SERVICE_ROLE_KEY  service_role key of cockpit-ci
//
// What it does:
//   1. Creates two synthetic auth users (ci-pilot-1/2@example.invalid) via
//      the Auth Admin API (service_role), signs each in for a user JWT.
//   2. Seeds the same synthetic fixtures as supabase/seed-ci.sql via
//      service_role REST inserts (kept in sync with that file by hand).
//   3. Runs 9 PASS/FAIL assertions covering the post-018 (security phase 0)
//      expectations: anon lockdown of crew_grade_syncs + pilots, pilot
//      self-access, cross-pilot isolation, worker-secret RPC hardening.
//   4. Cleans up the created auth users (best effort — cascade deletes the
//      pilot rows and everything under them).
//
// Exit code 0 only when every check passes. Key values are never logged;
// only the last 4 characters are shown in the config summary.
//
// NOTE: this cannot run until the cockpit-ci project exists (see
// docs/CI-SECRETS.md "what the browser operator must do").
import { randomBytes } from "node:crypto";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const URL = process.env.CI_SUPABASE_URL;
const ANON_KEY = process.env.CI_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.CI_SUPABASE_SERVICE_ROLE_KEY;

const PILOT_A_EMAIL = "ci-pilot-1@example.invalid";
const PILOT_B_EMAIL = "ci-pilot-2@example.invalid";

// Synthetic fixture UUIDs — MUST match supabase/seed-ci.sql.
const CREW_A1 = "11111111-1111-4111-8111-111111111111";
const CREW_A2 = "22222222-2222-4222-8222-222222222222";
const CREW_B1 = "33333333-3333-4333-8333-333333333333";
const TODO_A1 = "44444444-4444-4444-8444-444444444444";
const TODO_A2 = "55555555-5555-4555-8555-555555555555";
const TODO_B1 = "66666666-6666-4666-8666-666666666666";
const SYNC_A1 = "77777777-7777-4777-8777-777777777777";
const SYNC_B1 = "88888888-8888-4888-8888-888888888888";
const CHECK_A1 = "99999999-9999-4999-8999-999999999999";

const mask = (s) => (typeof s !== "string" || s.length <= 4 ? "****" : `…${s.slice(-4)}`);

// ---------------------------------------------------------------------------
// Tiny Supabase REST helper
// ---------------------------------------------------------------------------
async function call(path, { method = "GET", key, bearer = key, body, prefer } = {}) {
  const headers = {
    apikey: key,
    Authorization: `Bearer ${bearer}`,
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(`${URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON body (e.g. empty 201) */
  }
  return { status: res.status, text, json };
}

const rest = (table, opts) => call(`/rest/v1/${table}${opts?.query ?? ""}`, opts);

// ---------------------------------------------------------------------------
// Assertion harness
// ---------------------------------------------------------------------------
let passed = 0;
let failed = 0;
const failures = [];

function check(name, ok, detail = "") {
  if (ok) {
    passed++;
    console.log(`PASS  ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// Anon access is denied when PostgREST says 401/403, or when it returns 200
// with zero rows (policy filters everything out).
function anonDenied({ status, json }) {
  if (status === 401 || status === 403) return true;
  return status === 200 && Array.isArray(json) && json.length === 0;
}

// ---------------------------------------------------------------------------
// Auth: create (or reuse) synthetic users, then sign them in for JWTs
// ---------------------------------------------------------------------------
async function findUserByEmail(email) {
  const { status, json } = await call("/auth/v1/admin/users?per_page=1000", {
    method: "GET",
    key: SERVICE_KEY,
  });
  if (status !== 200 || !Array.isArray(json?.users)) return null;
  return json.users.find((u) => u.email === email) ?? null;
}

async function ensureUser(email) {
  const password = randomBytes(18).toString("hex");
  const { status, json } = await call("/auth/v1/admin/users", {
    method: "POST",
    key: SERVICE_KEY,
    body: { email, password, email_confirm: true, user_metadata: { ci_fixture: true } },
  });
  if (status === 200 || status === 201) return { id: json.id, email, password };
  // Already exists (re-run after a partial cleanup)? Reuse it.
  if (status === 422) {
    const existing = await findUserByEmail(email);
    if (existing) return { id: existing.id, email, password };
  }
  throw new Error(`could not create CI user ${email}: HTTP ${status} ${String(json?.msg ?? json?.message ?? "").slice(0, 120)}`);
}

async function signIn({ email, password }) {
  const { status, json } = await call("/auth/v1/token?grant_type=password", {
    method: "POST",
    key: ANON_KEY,
    bearer: ANON_KEY,
    body: { email, password },
  });
  if (status !== 200 || !json?.access_token) {
    throw new Error(`sign-in failed for ${email}: HTTP ${status}`);
  }
  return json.access_token;
}

async function deleteUser(id) {
  await call(`/auth/v1/admin/users/${id}`, { method: "DELETE", key: SERVICE_KEY });
}

// ---------------------------------------------------------------------------
// Seed: same synthetic fixtures as supabase/seed-ci.sql (upserted, so
// re-runs after a failed cleanup do not blow up).
// ---------------------------------------------------------------------------
async function seed(userA, userB) {
  const upsert = "resolution=merge-duplicates";
  const rows = [
    rest("pilots?on_conflict=id", {
      method: "POST", key: SERVICE_KEY, prefer: upsert,
      body: [
        { id: userA.id, display_name: "CI Pilot One", timezone: "America/New_York" },
        { id: userB.id, display_name: "CI Pilot Two", timezone: "America/Chicago" },
      ],
    }),
    rest("crew_members?on_conflict=id", {
      method: "POST", key: SERVICE_KEY, prefer: upsert,
      body: [
        { id: CREW_A1, pilot_id: userA.id, name: "Sample Student One", birthdate: "2012-03-04", relationship: "child" },
        { id: CREW_A2, pilot_id: userA.id, name: "Sample Student Two", birthdate: "2014-07-19", relationship: "child" },
        { id: CREW_B1, pilot_id: userB.id, name: "Sample Student Three", birthdate: "2011-11-02", relationship: "child" },
      ],
    }),
    rest("todos?on_conflict=id", {
      method: "POST", key: SERVICE_KEY, prefer: upsert,
      body: [
        { id: TODO_A1, pilot_id: userA.id, title: "CI fixture: renew sample library book", done: false, source: "manual" },
        { id: TODO_A2, pilot_id: userA.id, title: "CI fixture: done sample errand", done: true, source: "manual" },
        { id: TODO_B1, pilot_id: userB.id, title: "CI fixture: sample grocery run", done: false, source: "manual" },
      ],
    }),
    rest("crew_grade_syncs?on_conflict=id", {
      method: "POST", key: SERVICE_KEY, prefer: upsert,
      body: [
        {
          id: SYNC_A1, crew_member_id: CREW_A1, device_name: "ci-fixture",
          grades: [{ class: "Sample Math", grade: 92.5, period: "Q1" }],
          gpa: { weighted_gpa: 3.6 }, pull_method: "browser",
        },
        {
          id: SYNC_B1, crew_member_id: CREW_B1, device_name: "ci-fixture",
          grades: [{ class: "Sample History", grade: 79.5, period: "Q1" }],
          gpa: { weighted_gpa: 3.1 }, pull_method: "browser",
        },
      ],
    }),
    rest("path_to_90_checks?on_conflict=id", {
      method: "POST", key: SERVICE_KEY, prefer: upsert,
      body: [
        { id: CHECK_A1, crew_member_id: CREW_A1, class_name: "Sample Math", action_id: "sample-math-missing-1", checked: false, checked_by: "pilot" },
      ],
    }),
  ];
  for (const p of rows) {
    const { status } = await p;
    if (status !== 200 && status !== 201) {
      throw new Error(`seed insert failed: HTTP ${status}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  if (!URL || !ANON_KEY || !SERVICE_KEY) {
    console.error(
      "rls-tests: missing env. Need CI_SUPABASE_URL, CI_SUPABASE_ANON_KEY, CI_SUPABASE_SERVICE_ROLE_KEY."
    );
    process.exit(2);
  }
  console.log(`rls-tests → ${URL} (anon ${mask(ANON_KEY)}, service_role ${mask(SERVICE_KEY)})`);

  const userA = await ensureUser(PILOT_A_EMAIL);
  const userB = await ensureUser(PILOT_B_EMAIL);
  console.log(`CI users ready: A=${userA.id} B=${userB.id}`);

  try {
    await seed(userA, userB);
    const jwtA = await signIn(userA);
    const jwtB = await signIn(userB);
    const as = (jwt) => ({ key: ANON_KEY, bearer: jwt });

    // 1. service_role sanity: the project is reachable and readable.
    {
      const r = await rest("pilots?select=id", { key: SERVICE_KEY });
      check(
        "service_role can read pilots (project reachable)",
        r.status === 200 && Array.isArray(r.json) && r.json.length >= 2,
        `HTTP ${r.status}, rows=${Array.isArray(r.json) ? r.json.length : "?"}`
      );
    }

    // 2. Post-018: anon can no longer SELECT crew_grade_syncs.
    {
      const r = await rest("crew_grade_syncs?select=id&limit=1", { key: ANON_KEY });
      check("anon crew_grade_syncs SELECT denied-or-empty (018 A1)", anonDenied(r), `HTTP ${r.status}`);
    }

    // 3. Anon can never SELECT pilots (001 grants authenticated only).
    {
      const r = await rest("pilots?select=id&limit=1", { key: ANON_KEY });
      check("anon pilots SELECT denied-or-empty", anonDenied(r), `HTTP ${r.status}`);
    }

    // 4. Pilot A reads their own pilot row.
    {
      const r = await rest("pilots?select=id", as(jwtA));
      check(
        "pilot A SELECTs own pilot row",
        r.status === 200 && Array.isArray(r.json) && r.json.length === 1 && r.json[0].id === userA.id,
        `HTTP ${r.status}, rows=${JSON.stringify(r.json)?.slice(0, 80)}`
      );
    }

    // 5. Pilot A cannot read pilot B's row (RLS isolation).
    {
      const r = await rest(`pilots?select=id&id=eq.${userB.id}`, as(jwtA));
      check(
        "pilot A cannot SELECT pilot B's row",
        r.status === 200 && Array.isArray(r.json) && r.json.length === 0,
        `HTTP ${r.status}, rows=${r.json?.length ?? "?"}`
      );
    }

    // 6. Pilot A reads exactly their own 2 crew members.
    {
      const r = await rest("crew_members?select=id,pilot_id", as(jwtA));
      const ok =
        r.status === 200 &&
        Array.isArray(r.json) &&
        r.json.length === 2 &&
        r.json.every((c) => c.pilot_id === userA.id);
      check("pilot A SELECTs own 2 crew members only", ok, `HTTP ${r.status}, rows=${r.json?.length ?? "?"}`);
    }

    // 7. Pilot A reads only their own crew's grade syncs.
    {
      const r = await rest("crew_grade_syncs?select=id,crew_member_id", as(jwtA));
      const ok =
        r.status === 200 &&
        Array.isArray(r.json) &&
        r.json.length >= 1 &&
        r.json.every((s) => s.crew_member_id === CREW_A1 || s.crew_member_id === CREW_A2);
      check("pilot A SELECTs only own crew's grade syncs", ok, `HTTP ${r.status}, rows=${r.json?.length ?? "?"}`);
    }

    // 8. Pilot B reads exactly their own 1 crew member (mirror isolation).
    {
      const r = await rest("crew_members?select=id,pilot_id", as(jwtB));
      const ok =
        r.status === 200 &&
        Array.isArray(r.json) &&
        r.json.length === 1 &&
        r.json[0].pilot_id === userB.id;
      check("pilot B SELECTs own 1 crew member only", ok, `HTTP ${r.status}, rows=${r.json?.length ?? "?"}`);
    }

    // 9. Post-018 worker-secret hardening: anon calling
    // rpc_get_latest_crew_grade_sync without a secret gets '{}' (never data).
    {
      const r = await call("/rest/v1/rpc/rpc_get_latest_crew_grade_sync", {
        method: "POST",
        key: ANON_KEY,
        body: { p_crew_member_id: CREW_A1 },
      });
      check(
        "anon RPC get-latest without worker secret returns {} (018 A1)",
        r.status === 200 && r.json !== null && typeof r.json === "object" && Object.keys(r.json).length === 0,
        `HTTP ${r.status}, body=${r.text.slice(0, 80)}`
      );
    }
  } finally {
    // Best-effort cleanup: deleting the auth users cascades to pilots,
    // crew members, todos, syncs, and checks.
    try {
      await deleteUser(userA.id);
      await deleteUser(userB.id);
      console.log("cleanup: CI users deleted");
    } catch (e) {
      console.log(`cleanup: best-effort user delete failed (${e.message}) — safe to ignore`);
    }
  }

  console.log(`\nrls-tests: ${passed} passed, ${failed} failed`);
  if (failures.length) console.log(`failed checks: ${failures.join("; ")}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(`rls-tests: fatal — ${e.message}`);
  process.exit(2);
});
