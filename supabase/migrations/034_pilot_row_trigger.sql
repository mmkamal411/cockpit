-- =============================================================================
-- 034_pilot_row_trigger.sql
-- Cockpit — guarantee the pilots row exists, in the database, not the app.
--
-- ROOT CAUSE (new-user gap hunt, 2026-10-13):
-- `public.pilots` is the root of the app's FK tree: chat_threads, todos,
-- bills, crew_members, health_*, calendar_connections, shopping_*,
-- subscriptions, nudges, cockpit_layouts, pilot_integrations and
-- nudge_preferences all carry `pilot_id references public.pilots(id)`.
-- The ONLY writer of pilots rows was the auth callback's upsert, wrapped in
-- a try/catch that swallowed every failure silently. When that upsert failed
-- (deploy skew vs a migration, a transient error, any reason at all), the
-- pilot was left with an auth.users row but NO pilots row, and EVERY later
-- insert FK-failed: chat thread creation died ("Couldn't open a
-- conversation"), todos/bills/health inserts died, crew member creation died,
-- and a grantee whose row was missing broke the steward's
-- crew_access_grants insert (grantee_pilot_id FK), hiding classes.
--
-- This migration moves pilots-row creation into the database where it
-- cannot be skipped or swallowed:
--   1. handle_new_auth_user() trigger on auth.users (AFTER INSERT) —
--      every new signup gets a pilots row automatically, idempotent,
--      RLS-independent (SECURITY DEFINER runs as postgres). On conflict it
--      only backfills the email when the row exists without one — never
--      overwrites an email the callback already set.
--   2. One-time backfill for auth.users rows that already exist without a
--      pilots row (pilots who signed up while the callback was the only
--      writer). REVIEW NOTE: this is the only statement in this file that
--      writes user rows — drop it if you want a stricter no-data-touch run.
--   3. Idempotent guard re-creating 001's pilots RLS policies if the live
--      DB ever drifted from the repo (insert/update/select/delete own).
--
-- The auth callback's upsert stays as the email-backfill + share-claim
-- path; the trigger is the guarantee. App-side ensurePilot() (lazy path
-- in the chat routes) is the belt-and-braces repair for pre-trigger users.
--
-- RUN: paste into the Supabase dashboard SQL editor (project: cockpit).
-- Idempotent: safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Trigger: every new auth.users row gets a pilots row. SECURITY DEFINER
--    as the dashboard's postgres superuser, so it bypasses RLS on
--    public.pilots even though that table has FORCE ROW LEVEL SECURITY.
--    It can only ever insert the NEW user's OWN id (taken from NEW, not
--    from any caller), so there is no privilege escalation: no caller
--    input reaches the insert.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.pilots (id, email)
  values (NEW.id, nullif(lower(NEW.email), ''))
  on conflict (id) do update
    -- Repair path: a pre-trigger row created without an email (e.g. the old
    -- callback upsert ran before 017 added the column) gets it backfilled.
    -- Never overwrites an existing email.
    set email = excluded.email
    where public.pilots.email is null
      and excluded.email is not null;
  return NEW;
end;
$$;

comment on function public.handle_new_auth_user() is
  'Signup trigger (034): every new auth.users row gets a matching public.pilots row. SECURITY DEFINER as postgres bypasses pilots RLS; inserts only NEW.id, so no privilege escalation.';

drop trigger if exists trg_provision_pilot_on_signup on auth.users;

create trigger trg_provision_pilot_on_signup
  after insert on auth.users
  for each row
  execute function public.handle_new_auth_user();

-- ---------------------------------------------------------------------------
-- 2. Backfill: pilots rows for signups that predate the trigger.
--    REVIEW: the only data-writing statement in this file. It inserts ONLY
--    missing root rows (id/email from auth.users) — no existing row is
--    modified. Safe to skip if you prefer a strict schema-only run.
-- ---------------------------------------------------------------------------
insert into public.pilots (id, email, created_at)
select u.id, nullif(lower(u.email), ''), coalesce(u.created_at, now())
from auth.users u
where not exists (
  select 1 from public.pilots p where p.id = u.id
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Policy guard: re-create 001's pilots policies if any are missing.
--    (The callback upsert needs insert + update; select/delete restore the
--    full 001 set. No-op when the live DB already matches the repo.)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'pilots'
      and policyname = 'pilots_select_own'
  ) then
    create policy pilots_select_own on public.pilots
      for select using (auth.uid() = id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'pilots'
      and policyname = 'pilots_insert_own'
  ) then
    create policy pilots_insert_own on public.pilots
      for insert with check (auth.uid() = id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'pilots'
      and policyname = 'pilots_update_own'
  ) then
    create policy pilots_update_own on public.pilots
      for update using (auth.uid() = id) with check (auth.uid() = id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'pilots'
      and policyname = 'pilots_delete_own'
  ) then
    create policy pilots_delete_own on public.pilots
      for delete using (auth.uid() = id);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- VERIFY (second query after running):
--
-- -- Trigger exists on auth.users:
-- select tgname from pg_trigger
-- where tgrelid = 'auth.users'::regclass and not tgisinternal;
-- -- expect: trg_provision_pilot_on_signup
--
-- -- Backfill check for pre-trigger users (read-only): every auth user
-- -- should have a pilots row. Rows listed here are healed automatically
-- -- the next time that user signs in (the /auth/callback upsert retries),
-- -- or by the app's ensurePilot() lazy path on the next chat message.
-- select u.id, u.email
-- from auth.users u
-- left join public.pilots p on p.id = u.id
-- where p.id is null;
-- =============================================================================
