-- =============================================================================
-- 034_auth_users_pilot_provisioning.sql
-- Provision the pilots row from auth.users at signup, in the database.
--
-- WHY THIS EXISTS (2026-10-13 new-user gap hunt):
-- The app-side pilots upsert in /auth/callback ran with the anon key inside
-- a try/catch that swallowed failures SILENTLY. Any failure there (network
-- blip, RLS hiccup, PostgREST error) left a new user with NO pilots row,
-- and the app kept going: /home only checks the auth session, not the row.
-- Then EVERY pilot_id-keyed insert failed on the foreign key to pilots(id)
-- (chat_threads, todos, nudges, bills, shopping_lists, health_logs,
-- calendar_connections, subscriptions, crew_members, ...) — which is why a
-- fresh user saw "Couldn't open a conversation. Try again in a moment." on
-- every chat message, and why a grantee whose row was missing broke the
-- steward's crew_access_grants insert (grantee_pilot_id FK), hiding classes.
--
-- A trigger on auth.users cannot fail silently and cannot be skipped by app
-- code: the auth.users insert happens inside GoTrue before any app code
-- runs. The /auth/callback upsert stays as the email-backfill path.
--
-- RUN: paste into the Supabase dashboard SQL editor (cockpit project).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Trigger function. SECURITY DEFINER, created by the dashboard's postgres
--    superuser, so it bypasses RLS on public.pilots even though that table
--    has FORCE ROW LEVEL SECURITY. It can only ever insert the NEW user's
--    OWN id (taken from NEW, not from any caller), so there is no privilege
--    escalation: no caller input reaches the insert.
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

-- ---------------------------------------------------------------------------
-- 2. The trigger itself.
-- ---------------------------------------------------------------------------
drop trigger if exists trg_provision_pilot_on_signup on auth.users;

create trigger trg_provision_pilot_on_signup
  after insert on auth.users
  for each row
  execute function public.handle_new_auth_user();

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
