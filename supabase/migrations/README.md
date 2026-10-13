# Cockpit — Supabase migrations

The VM can't reach Supabase (sandbox egress blocks `*.supabase.co`), so migrations
are written as SQL files here and run by Mehedi in the Supabase dashboard SQL editor.

Project: **cockpit** — `https://hwnesewathbnfvoxtbqh.supabase.co`

## Run order

1. `001_pilot_foundation.sql` — pilot-first foundation schema (8 tables, RLS, grants).
2. Future migrations go here as `002_*.sql`, `003_*.sql`, … — always in numeric order,
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
