# RCA: Grade-sync push outage — `crypt()` unresolvable (2026-10-13)

| Field | Value |
|---|---|
| Date | 2026-10-13 |
| Severity | High — all grade-sync writes failed |
| Duration | ~15 min (17:12–17:27 EDT) |
| Detected by | Human-supervised cron run (~3 min); automated systems missed it entirely |
| Fixed by | `ALTER EXTENSION pgcrypto SET SCHEMA public;` (one-time DB state) |
| Status | Mitigated. **Not structurally fixed** — see §8 L-0. |

## 1. Summary

Migration `035_restore_worker_secret_check.sql` recreated `rpc_push_crew_grade_sync(jsonb)`
with `SET search_path = public` and an unqualified `crypt()` call. The `pgcrypto`
extension was installed in the `extensions` schema, not `public`, so every worker push
failed with `function crypt(text, text) does not exist` (42883). All three push paths —
the parent ParentVUE pipeline, the Windows laptop worker, and the MacBook worker —
were down for ~15 minutes. The 5 PM pull fetched data fine but could not write it;
the payload was staged locally and the next scheduled sync landed normally after the fix.

A check run at 17:03 ("pgcrypto is already installed, 039 not needed") was **true but
insufficient**: it verified *existence*, not *resolvability under the function's
search_path*. Installed ≠ callable. That misreading is the direct reason the outage
happened.

## 2. Timeline (EDT)

| Time | Event |
|---|---|
| 17:03 | Note recorded: "pgcrypto already installed, 039 not needed." Check was existence-only. |
| 17:12 | Migrations 034/035/036 applied via Supabase SQL editor (browser task). Editor reported "Success"; function-existence verification passed. |
| ~17:15 | `parent-sync-5pm` cron: ParentVUE pull succeeded, DB write failed — `rpc_push_crew_grade_sync` → `function crypt(text, text) does not exist`; direct anon INSERT → 401. Cron reported "SUPABASE WRITE FAILED — INGESTION PIPELINE DOWN". |
| 17:18 | Pipeline declared down; diagnosis started. |
| 17:26 | `sync-health-monitor` ran mid-outage and reported **HEALTHY** (see §7). |
| 17:27 | `ALTER EXTENSION pgcrypto SET SCHEMA public;` executed; push path probe-verified restored. |
| 18:27 | Migration 039 (RLS recursion fix, separate incident) applied + verified. |

## 3. Root cause — chain of causation

1. **035** (`~/workspace/sql-runs/035_restore_worker_secret_check.sql:24`) defines
   `public.rpc_push_crew_grade_sync(p_data jsonb)` as `SECURITY DEFINER` with
   `set search_path = public` (line 30), and calls `crypt(v_secret, s.secret_hash)`
   unqualified (line 52).
2. On the cockpit project, `pgcrypto` was installed in the **`extensions`** schema
   (Supabase's default for dashboard-installed extensions). Unqualified `crypt()`
   under `search_path = public` therefore resolved to nothing → 42883 at runtime.
3. Every migration that installs pgcrypto uses bare
   `create extension if not exists pgcrypto;` — **no `WITH SCHEMA` clause anywhere
   in the repo** (001:13, 002:17, 003:37, 007:26, 008:16, 010:12, 012:12, 014:18,
   017:26, 018:30, 028:24, 031:17, 037:29). The schema the extension lands in depends
   on the installing session's search_path — invisible, session-dependent state.
4. The fix (`ALTER EXTENSION pgcrypto SET SCHEMA public`) is **live DB state, not
   code**: no migration records it. A rebuild from these files re-creates the outage
   verbatim. This is the systemic defect (§8 L-0).

The same exposure exists in three sibling functions, all `SECURITY DEFINER` +
`SET search_path = public` + unqualified `crypt()`/`gen_salt()`: 018's
`rotate_crew_worker_secret`, 018's `rpc_push_crew_grade_sync`, and 018's
`rpc_get_latest_crew_grade_sync`.

## 4. Why the 17:03 check failed

The check asked the wrong question. `pg_extension` lists an extension **regardless of
schema**, and `create extension if not exists` is a no-op when the extension exists
*anywhere*. The necessary check is **resolvability, not existence**: for every
unqualified function call in the migration body, confirm the function is visible on
the new function's own `SET search_path`.

The check that would have caught it (run *before* applying 035):

```sql
select p.proname, n.nspname as actual_schema
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where p.proname in ('crypt','gen_salt','gen_random_uuid');
-- crypt | extensions  ≠  public  →  STOP. Schema-qualify the call
-- (extensions.crypt(...)) or ALTER EXTENSION pgcrypto SET SCHEMA public; first.
```

A functional complement: after `CREATE OR REPLACE`, exercise the **anon caller path**
of each changed function — only the anon path executes `crypt()` in these RPCs, so a
service_role/editor probe would have passed while workers failed.

## 5. Why it wasn't caught before apply

- The migration applied with "Success" — DDL success says nothing about runtime
  resolvability.
- Verification asserted *existence* ("RPC present") and never *behavior under the
  caller's actual context* (search_path at runtime, anon caller path).
- Migrations go **straight from paste-to-production**; the standing "staging first"
  rule covers the app, not migrations. `ci-migrations/` exists but lags prod and is
  not a gate.
- The 17:03 correction created false confidence: a true statement ("installed")
  was treated as answering a different question ("usable").

## 6. Dependency graph (worker → RPC → extension → schema)

Live state after the 17:27 fix:

```
parentvue_pull.py ─┐
dawson-windows-sync.py ─┼─→ POST /rest/v1/rpc/rpc_push_crew_grade_sync
dawson-macbook-sync.py ─┘       (anon key + worker_secret)
parentvue-laptop-sync.py ─┘
                        → public.rpc_push_crew_grade_sync(jsonb)
                          [035, SECURITY DEFINER, search_path=public]
                          → crypt(v_secret, s.secret_hash)   ← pgcrypto MUST be in public
                          → public.crew_sync_worker_secrets  (secret gate; RLS-forced)
                          → INSERT public.crew_grade_syncs   (anon table grants revoked by 018 §1b)
```

Per-worker notes (from `~/workspace/cockpit-sync`):

- **parent** (`parent/parentvue_pull.py`): RPC is the only write path (no fallback).
  Payload keys are whitelisted by a hardcoded `RPC_PAYLOAD_KEYS` list — unknown keys
  are silently stripped. Secrets from env only.
- **windows/macbook** (`dawson-*-sync.py`): on RPC failure they fall back to a direct
  anon INSERT — **dead since 018 revoked anon grants** (401s). Worse, `do_sync()`
  **ignores the push return value**, so a failed push still logs "Sync complete",
  marks the health row `success`, and heartbeats `sync_status='ok'`. Silent
  false-success.
- **mac hourly** (`parentvue/parentvue-laptop-sync.py`, the actually-deployed Mac
  worker): retries 3×, stages payloads to disk — but its payload contains **no
  `worker_secret` key at all**, so post-035 every Mac push raises
  `invalid worker credentials`. On push failure the heartbeat never runs, leaving
  `sync_status='syncing'` forever (poisoned freshness signal).

Related: `rpc_get_latest_crew_grade_sync(uuid, text)` (zero-guard reads) also calls
`crypt()`, but anon callers without a secret short-circuit to `'{}'` *before*
`crypt()` executes — which is why the monitor probe "did not error, but empty"
during the outage while pushes 500'd. The workers' own zero-guard
(`fetch_previous_grades()` via direct anon GET) 401s post-018 and silently returns
`[]`, so the guard is currently a no-op.

## 7. Detection gap

| Scenario | Time to detect |
|---|---|
| A sync run in flight (what happened) | ~3 min — and only because a human-supervised cron was mid-run |
| 035 applied at a quiet hour | **Up to 36 hours** — `cockpit-sync-watchdog` B1 staleness threshold is 36h; its B2b "pushes that never land" check is unimplemented; it left zero incident records |
| `sync-health-monitor` | Reported **HEALTHY mid-outage**: 12h/14h staleness thresholds (data was 3–4h old), and its RPC probe short-circuits before `crypt()` |

Compounding: the laptop workers record push failures as `success` (health rows) and
`ok` (heartbeat), so downstream consumers actively see green. **No automated system
tests the worker→RPC→extension write path.**

## 8. Latent dependencies found (ranked)

Each item: file/line, assumption, failure mode, blast radius.

- **L-0 CRITICAL — pgcrypto never schema-pinned (systemic).** 13 migrations use bare
  `create extension if not exists pgcrypto;`; unqualified `crypt()`/`gen_salt()`
  callers at 018:97, 018:145, 018:231, 035:52. Assumption: extension lives in
  `public`. Failure: any rebuild/reinstall re-breaks all four functions exactly like
  today. Blast radius: all grade-sync pushes, secret rotation, zero-guard reads.
  Fix: one migration with `create extension if not exists pgcrypto with schema
  public;` (or guarded `alter extension ... set schema public;`).
  *Verify live:* `select e.extname, n.nspname from pg_extension e join pg_namespace n
  on n.oid=e.extnamespace where e.extname='pgcrypto';` → must be `public`.
- **L-1 HIGH — RLS recursion class.** Fixed by 039, but one bad policy away from
  recurring. Full audit of every policy × subquery found the current set CLEAN
  (all grant-checks now go through definer helpers or direct comparisons).
  Guard: any future policy referencing `crew_members`/`crew_access_grants` must use a
  definer helper; add a CI check. See the companion doc
  `2026-10-13-rls-recursion-rca.md`.
- **L-2 HIGH — Mac hourly worker sends no `worker_secret`.** `parentvue-laptop-sync.py`
  `build_payload()` has no secret key → post-035 every push raises
  `invalid worker credentials`. **VERIFY LIVE** via Mac `parentvue-sync.log`.
- **L-3 HIGH — no evidence `rotate_crew_worker_secret()` was ever run for Dawson's
  crew id.** If `crew_sync_worker_secrets` has no live row, ALL workers fail even with
  crypt fixed. **VERIFY LIVE** the table + deployed `sync-config.json` secrets.
- **L-4 MEDIUM — laptop workers record false success** (§6): ignored return value +
  dead INSERT fallback + `ok` heartbeat on failed push.
- **L-5 MEDIUM — zero-guard read broken post-018** (§6): anon GET 401s, returns `[]`,
  guard never flags.
- **L-6 MEDIUM — `CREATE OR REPLACE` silently dropped the secret gate once.**
  022's column-add rewrite of `rpc_push_crew_grade_sync` replaced 018's hardened body
  with the unhardened one; 035 was the repair. Any future rewrite carries the same
  risk. Mitigation: single-source the gate (definer helper `assert_worker_secret`)
  or a post-deploy assertion.
  *Verify live:* `pg_get_functiondef('public.rpc_push_crew_grade_sync(jsonb)'::regprocedure)`
  must contain the secret check; an anon call with a bogus secret must raise, not insert.
- **L-7 MEDIUM — 018 dropped RPC overloads** (`rpc_get_latest_crew_grade_sync(uuid)`,
  `redeem_share_invite(text,uuid,text)`, `find_pilot_by_email(text)`): stale callers
  get 42883. Grep app/workers for old arities.
- **L-8 MEDIUM — 038's partial index hard-fails if 038 runs before 037** (references
  `reminder_at`/`deleted_at`, both added by 037). Migrations run by human discipline
  in the SQL editor — ordering is not enforced.
- **L-9 MEDIUM — CRON-SPEC reporting doesn't cover push failures**; watchdog B2b
  unimplemented.
- **L-10 MEDIUM — Mac heartbeat poisoned**: push failure leaves `sync_status='syncing'`
  forever (no `"error"` branch).
- **L-11 LOW — trigger functions without `SET search_path`** (`bills_touch_updated_at`,
  `subscriptions_touch_updated_at`, `touch_updated_at`): one-line hardening each.
- **L-12 LOW — `ensure_crew_member` keeps default PUBLIC execute grant** (benign:
  anon callers fail on FK, no leak).
- **L-13 LOW — constraint-name assumptions in DO blocks** (023 drops any
  provider-flavored check constraint by ILIKE; 037 assumes pre-existing
  `share_invites` rows have `share_id` set).
- **Process findings:** **two `039_*.sql` files** exist in `sql-runs/` (the obsolete
  `039_pgcrypto_extension.sql` must NOT be run — rename it
  `039_pgcrypto_extension.SUPERSEDED-DO-NOT-RUN.sql`); **no applied-migrations
  ledger** exists (back-fill before the next migration); the 17:27 fix itself is
  unrecorded as a file.

Explicitly checked and clear: no migration uses `http_get`/pg_net/supabase_vault/
pg_trgm (the pgsql-http lesson applies to future work only); all SECURITY DEFINER
functions pin `search_path = public`; `gen_random_uuid()` column defaults are
DDL-bound and immune to search_path issues.

## 9. Prevention plan

### 9a. Pre-apply checklist (run in the SQL editor BEFORE each migration)

Rule of thumb: **"Installed ≠ resolvable. Defined ≠ non-recursive."**

```sql
-- C1: EXTENSION SCHEMA REALITY CHECK
select e.extname, n.nspname as schema
from pg_extension e join pg_namespace n on n.oid = e.extnamespace
order by e.extname;

-- C2: RESOLVABILITY under the migration's own search_path (use its SET value)
select p.proname, n.nspname as actual_schema
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where p.proname in ('crypt','gen_salt','gen_random_uuid');
-- actual_schema must intersect the function's SET search_path, else STOP.

-- C3: RLS RECURSION — list the new policies' expressions, then each referenced
-- table's own policies; a cycle exists if A→B and B→A.
select schemaname, tablename, polname, pg_get_expr(polqual, polrelid) as expression
from pg_policies where schemaname='public'
  and tablename in ('crew_members','crew_access_grants','link_codes','pilots');

-- C4: OBJECT EXISTENCE — every table the migration touches must exist
select to_regclass('public.crew_grade_syncs'),
       to_regclass('public.crew_sync_worker_secrets'),
       to_regclass('public.crew_access_grants'),
       to_regclass('public.link_codes');  -- append per migration; all non-NULL

-- C5: FUNCTION REPLACEMENT GUARD — diff the live body before CREATE OR REPLACE
select prosrc from pg_proc
where pronamespace='public'::regnamespace and proname='rpc_push_crew_grade_sync';

-- C6: search_path pinned on every function the migration creates/replaces
select proname, proconfig from pg_proc
where pronamespace='public'::regnamespace
  and proname in ('rpc_push_crew_grade_sync','redeem_link_code','my_granted_crew','has_live_crew_grant');
-- proconfig must show search_path explicitly.
```

(C7: duplicate-numbering check — run locally: `ls ~/workspace/sql-runs/ | grep -c "^NNN_"`.)

### 9b. Post-apply verification protocol

Immediate (0–5 min, SQL editor):

```sql
-- P1: the worker-push path resolves crypt() (not just "function exists")
select rpc_get_latest_crew_grade_sync('91ea2b85-45c9-4f84-96c1-2829d30e5eb6'::uuid, null);
-- P2: canary push through the exact worker code path (test crew id + test secret)
select rpc_push_crew_grade_sync(jsonb_build_object(
  'crew_member_id','<test-crew-uuid>','worker_secret','<test-secret>',
  'device_name','migration-canary','grades','[]'::jsonb));
-- P3: no RLS recursion on the known-cyclic surfaces (must return, not 500)
select count(*) from public.crew_members;
select count(*) from public.crew_access_grants;
-- P4: secret gate intact — call P2 WITHOUT worker_secret: must raise
-- 'invalid worker credentials', NOT silently insert.
```

Within 15–30 min: expect worker pushes to land in `crew_grade_syncs`; absence > 90
min is a failure signal. After any migration touching push RPCs, check the watchdog
log on its next run.

Detection speed with this protocol: extension-resolution failures < 2 min (P2),
RLS recursion < 1 min (P3), silent gate drops only via adversarial P4.

### 9c. Structural fixes (effort × risk, recommended order)

| Order | Fix | Effort | Risk reduction |
|---|---|---|---|
| 1 | Pre-apply checklist as `~/workspace/sql-runs/PRE_APPLY_CHECKLIST.md` | S | M |
| 2 | Numbering hygiene + `LEDGER.md` (one line per migration: applied-to-cockpit / applied-to-ci / notes); rename the obsolete 039 file | S | M |
| 3 | Nightly DB health probe cron (canary `crypt()` under `search_path=public`, canary push with dedicated test row+secret, P3 counts, `my_granted_crew()` happy path; alert via the watchdog's channel) | S | M |
| 4 | Hardening migration `040_harden_extension_paths.sql`: `ALTER EXTENSION pgcrypto SET SCHEMA public` (+ uuid-ossp), explicit `SET search_path` on the three trigger functions (L-11). Safe: transactional, sub-second lock; document the deviation from Supabase's `extensions`-schema default so a future reinstall doesn't silently revert it | S | **L — biggest single blast-radius cut** |
| 5 | Repo lint script (`scripts/lint-migration.py`) on every new migration: (a) unqualified extension-function calls under fixed search_path (flags 035 exactly); (b) `CREATE EXTENSION` without schema pinning (flags the 13 pgcrypto sites + obsolete 039); (c) policy-expression → table reference graph with 2-cycle detection against `policy-edges.json` (flags 036 exactly); (d) bare `http_get`/`net.*` assumptions (pgsql-http vs pg_net); (e) `CREATE OR REPLACE` on known security-gated functions requires a `-- LINT-OK` review comment | M | M |
| 6 | CI-canary flow: apply to cockpit-ci first, run §9b against CI, gate = all green for ≥ 2 worker push cycles (or 60 min) before production; then update LEDGER.md | M | L |
| 7 | Apply-runner script (runs C1–C6 automatically, CI gate, LEDGER.md append) replacing paste-into-editor | L | M |

Also fix the worker-side defects found: make `do_sync()` honor the push return
value (L-4), migrate zero-guard reads to `rpc_get_latest_crew_grade_sync()` (L-5),
add `worker_secret` to the Mac worker payload + an `"error"` heartbeat branch
(L-2/L-10), and add push-failure reporting to CRON-SPEC (L-9).

### 9d. Live verification bundle (run in the SQL editor)

```sql
select e.extname, n.nspname from pg_extension e
join pg_namespace n on n.oid=e.extnamespace where e.extname='pgcrypto';           -- L-0: public
select public.rpc_get_latest_crew_grade_sync('91ea2b85-45c9-4f84-96c1-2829d30e5eb6'::uuid, null); -- L-0: {} not 42883
select public.rpc_push_crew_grade_sync('{"crew_member_id":"91ea2b85-45c9-4f84-96c1-2829d30e5eb6","worker_secret":"bogus"}'::jsonb); -- L-6: must RAISE
select polname, pg_get_expr(polqual, polrelid) from pg_policies
where schemaname='public' and tablename='crew_members';                          -- L-1: definer helper, no raw subquery
select proname, pg_get_function_arguments(oid) from pg_proc
where pronamespace='public'::regnamespace
and proname in ('rpc_get_latest_crew_grade_sync','redeem_share_invite','find_pilot_by_email','rpc_push_crew_grade_sync'); -- L-7
select indexname from pg_indexes where schemaname='public' and tablename='todos'
and indexname='idx_todos_reminder_due';                                          -- L-8
select proname, proconfig from pg_proc
where proname in ('bills_touch_updated_at','subscriptions_touch_updated_at','touch_updated_at'); -- L-11
```

## 10. Related incidents

- `2026-10-13-rls-recursion-rca.md` — the same-day RLS policy recursion outage
  (migration 036): same root pattern of "migration looks harmless, breaks production
  silently," same prevention plan family.

---
*Investigated by an RCA team (DB, sync-pipeline, and reliability experts) on
2026-10-13. All findings grounded in the migration files; items needing live
confirmation are marked VERIFY LIVE.*
