# Phase 0 — Security & Integrity Fixes — Code Complete (2026-10-13)

Phase 0 of the personalization stack build is **code-complete**. All fixes are
implemented, reviewed, and green: **207/207 tests pass**, `tsc` + `eslint` clean.

Phase 0 gates everything after it: no personalization data flows until these
fixes are live. Code is done; three Meheldi-side steps remain before the gate
closes (listed at the bottom).

## What was fixed

**A1 (CRITICAL) — `crew_grade_syncs` anon access.** Dropped the anon RLS
policies, revoked the anon grant on `rpc_get_latest_crew_grade_sync`, added an
`authenticated` caller check. Workers now authenticate per crew member via
`crew_sync_worker_secrets` + `rotate_crew_worker_secret()`; the push RPC
requires `p_data.worker_secret`, the get-latest RPC checks steward/grantee/
secret. Laptop + ParentVUE scripts updated to send the secret.
(Migration `018_security_phase0.sql`, commit `0c10bda`.)

**A2 (HIGH) — Calendar refresh tokens.** Envelope-encrypted with AES-256-GCM
(`src/lib/token-crypto.ts`); key from `CALENDAR_TOKEN_KEY` env, fail-closed.

**A3 (HIGH) — `redeem_share_invite`.** Now uses `auth.uid()` / JWT email,
requires email match, anon grant revoked. `/invite/[token]` updated to the
1-param signature.

**A4 (MEDIUM) — `find_pilot_by_email`.** Inlined into the share-creation RPC
with an ownership check (`find_pilot_by_email(p_email, p_list_id)` verifies
the caller owns the list; uniform null otherwise). Shares route updated.

**A5 (MEDIUM) — Admin `view-as`.** Requires **both** auth layers
(`requireAdminBothLayers` = `ADMIN_EMAILS` allowlist + `is_admin` DB RPC),
fail-closed, plain-English 403.

**W1 (HIGH) — Crystal worker `/chat` + `/quiz` auth.** App attaches
`Authorization: Bearer <CRYSTAL_WORKER_SECRET>` server-side, fail-closed when
unset; zero client-direct worker URL hits. Worker-side v2 contract + 400s
staged in the d-dash repo (`phase0/w1-worker-secret-auth`).

**C1 (HIGH) — Context contract v2.** Canonical `src/lib/chat/contract.ts` +
`CONTRACT.md` field inventory. **P0 fixed: child names/relationships are no
longer sent to the worker.** Loud `ContractViolationError` guards on
violations.

**Test hygiene.** Fixed extensionless imports (`bills/logic.test.ts`,
`health/glucose.test.ts`, `subscriptions/logic.test.ts`, `nudges/producers`
sources) so the whole suite runs under plain Node. Resolved the smoke-test
URL mismatch: `https://cockpit-10c.pages.dev` is canonical.

## Verification

- Coordinator re-audit 2026-10-13: all five (A1–A5) verified in code.
- `npm test`: 207/207 green. `tsc` + `eslint` clean.
- Living checklist: `PERSONALIZATION-PROGRESS.md` (Phase 0 section).

## Still needed from Meheldi (the gate doesn't close without these)

1. **Run migration `018_security_phase0.sql`** in the Supabase SQL editor,
   then re-verify anon denial.
2. **Set `CALENDAR_TOKEN_KEY`** in Cloudflare Pages env vars before calendar
   OAuth goes live.
3. **Set `CRYSTAL_WORKER_SECRET`** as a wrangler secret and **redeploy the
   Crystal worker** (v2 contract).
