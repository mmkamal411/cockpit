-- =============================================================================
-- 034_pilot_row_trigger.sql
-- Cockpit — guarantee the pilots row exists, in the database, not the app.
--
-- ROOT CAUSE (new-user gap hunt, 2026-10-13):
-- `public.pilots` is the root of the app's FK tree: chat_threads, todos,
-- bills, crew_members, health_*, calendar_connections, shopping_*,
-- subscriptions, nudges, cockpit_layouts, pilot_integrations and
-- nudge_preferences all carry `pilot_id references public.pilots(id)`.
-- The ONLY writer of pilots rows is the auth callback's upsert, wrapped in
-- a try/catch that swallows every failure silently. When that upsert fails
-- (deploy skew vs a migration, a transient error, any reason at all), the
-- pilot is left with an auth.users row but NO pilots row, and EVERY later
-- insert FK-fails: chat thread creation dies ("Couldn't open a
-- conversation"), todos/bills/health inserts die, crew member creation dies.
-- The RLS insert policy itself (pilots_insert_own, 001) is fine — the
-- fragility is having a single, silent, app-side writer.
--
-- This migration moves pilots-row creation into the database where it
-- cannot be skipped or swallowed:
--   1. handle_new_pilot() trigger on auth.users (AFTER INSERT) — every new
--      signup gets a pilots row automatically, idempotent, RLS-independent
--      (SECURITY DEFINER runs as postgres).
--   2. One-time backfill for auth.users rows that already exist without a
--      pilots row (pilots who signed up while the callback was the only
--      writer). REVIEW NOTE: this is the only statement in this file that
--      writes user rows — drop it if you want a stricter no-data-touch run.
--   3. Idempotent guard re-creating 001's pilots RLS policies if the live
--      DB ever drifted from the repo (insert/update/select/delete own).
--
-- The auth callback's upsert stays as-is (harmless duplicate path, keeps
-- the email backfill + share-claim behavior); the trigger is the guarantee.
--
-- RUN: paste into the Supabase dashboard SQL editor (project: cockpit).
-- Idempotent: safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Trigger: every new auth.users row gets a pilots row.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_pilot()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.pilots (id, email, created_at)
  values (new.id, nullif(new.email, ''), now())
  on conflict (id) do update
    -- Never clobber an email the callback already backfilled; only fill
    -- the gap when the row somehow exists without one.
    set email = coalesce(public.pilots.email, excluded.email);
  return new;
end;
$$;

comment on function public.handle_new_pilot() is
  'Auth trigger: creates the pilots row for every new signup (idempotent). The database — not the app callback — is the authoritative pilots-row writer.';

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_pilot();

-- ---------------------------------------------------------------------------
-- 2. Backfill: pilots rows for signups that predate the trigger.
--    REVIEW: the only data-writing statement in this file. It inserts ONLY
--    missing root rows (id/email from auth.users) — no existing row is
--    modified. Safe to skip if you prefer a strict schema-only run.
-- ---------------------------------------------------------------------------
insert into public.pilots (id, email, created_at)
select u.id, nullif(u.email, ''), coalesce(u.created_at, now())
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
