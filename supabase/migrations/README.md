# Cockpit — Supabase migrations

The VM can't reach Supabase (sandbox egress blocks `*.supabase.co`), so migrations
are written as SQL files here and run by Mehedi in the Supabase dashboard SQL editor.

Project: **cockpit** — `https://hwnesewathbnfvoxtbqh.supabase.co`

## Run order

1. `001_pilot_foundation.sql` — pilot-first foundation schema (8 tables, RLS, grants).
2. `002_crew_grade_syncs.sql` — `crew_grade_syncs` grade-sync snapshots keyed to
   `crew_members`, plus `rpc_push_crew_grade_sync`, `rpc_get_latest_crew_grade_sync`,
   and the `ensure_crew_member` onboarding helper.
3. Future migrations go here as `003_*.sql`, … — always in numeric order,
   one file per change, never edit a file after it has been run.

## What Mehedi clicks (dashboard)

1. Open [supabase.com](https://supabase.com) → sign in (GitHub) → open the
   **cockpit** project (`hwnesewathbnfvoxtbqh`).
2. Left sidebar → **SQL Editor** → **New query**.
3. Open `supabase/migrations/001_pilot_foundation.sql` in this repo, copy the
   **entire file**, paste into the query box.
4. Press **Run** (or Ctrl/Cmd+Enter). Expect "Success. No rows returned."
5. Verify — paste and run this in a second query:

```sql
-- All 8 tables exist with RLS on and the authenticated role granted:
select tablename as "table",
       rowsecurity as "rls_on"
from pg_tables
where schemaname = 'public'
  and tablename in ('pilots','pilot_integrations','crew_members',
                    'crew_access_grants','crew_school_links',
                    'todos','nudges','cockpit_layouts')
order by tablename;

-- Policies per table (expect 4 on pilots, 1 on most, 2 on crew_access_grants):
select tablename, count(*) as policies
from pg_policies
where schemaname = 'public'
group by tablename
order by tablename;
```

`rls_on` should be `true` on all 8 rows.

## Migration 002 — grade syncs (run after 001)

Same click path as 001, but paste `002_crew_grade_syncs.sql` instead.

Verify — run this in a second query:

```sql
-- crew_grade_syncs exists with RLS on:
select tablename as "table",
       rowsecurity as "rls_on"
from pg_tables
where schemaname = 'public'
  and tablename = 'crew_grade_syncs';

-- Policies on crew_grade_syncs (expect 4:
-- steward_all, grantee_select, anon_insert, anon_select):
select policyname, roles, cmd
from pg_policies
where schemaname = 'public'
  and tablename = 'crew_grade_syncs'
order by policyname;

-- RPCs + helper exist and are granted:
select p.proname as "function",
       array_agg(r.grantee::text) as "granted_to"
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
left join information_schema.role_routine_grants r
  on r.routine_schema = 'public' and r.routine_name = p.proname
where n.nspname = 'public'
  and p.proname in ('rpc_push_crew_grade_sync',
                    'rpc_get_latest_crew_grade_sync',
                    'ensure_crew_member')
group by p.proname
order by p.proname;
```

Add Dawson as a crew member — sign in to the app first (the pilot row is
created at signup), then run this in the SQL editor **while signed in**:

```sql
select public.ensure_crew_member('Dawson Kamal', '2011-07-23');
```

Save the returned UUID — that is the `crew_member_id` the sync workers put
in their `sync-config.json`. Running it twice is safe (idempotent by name).

## RPC port/drop vs the old Dawson sync project (dead)

- **Ported:** `rpc_push_crew_grade_sync(p_crew_member_id, p_data)` (was
  `rpc_push_studentvue_sync(p_data)`, now keyed by crew UUID, not name) and
  `rpc_get_latest_crew_grade_sync(p_crew_member_id)` (was
  `rpc_get_latest_studentvue_sync(p_student_name)`).
- **Dropped:** `rpc_claim_sync`, `rpc_finish_sync`, `rpc_append_sync_log`,
  `rpc_worker_heartbeat` — these served the old project's `sync_requests`
  coordination queue, which is not being rebuilt. The new flow is simpler:
  workers push snapshots directly on their schedule.
- **Dropped:** `rpc_upsert_dashboard_content` — dead already; it wrote to the
  retired `daily_content` table (the old worker itself stopped calling it).

## Old data

The old Supabase project (`qtzvunuqbnikvgttidco`) is dead and unreachable —
historical `studentvue_syncs` rows cannot be recovered from here. If history
matters, the MacBook may still hold local copies (`~/dawson-sync/sync.log`,
`runs.jsonl`); nothing from the old project was migrated.

## Notes

- **Auto-expose is OFF** in this project, so the app reaches tables only through
  the explicit `GRANT ... TO authenticated` lines in the migration. If a future
  table isn't visible to the app, it forgot its grant.
- **Automatic RLS is ON** in the project settings; the migration still says
  `enable row level security` explicitly so nothing depends on a setting.
- `pilots.id` references `auth.users(id)` — a pilot row is created at signup.
- `crew_access_grants` enforces the child-is-authority model: the grantee can
  **read** their own grants but can never insert/update/delete — only the
  granter (child or steward) can revoke.
- `crew_school_links.username_ref` holds a Secure Vault reference only —
  raw passwords never go in the database.
