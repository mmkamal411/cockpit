-- =============================================================================
-- 032_watchdog_sync_staleness.sql
-- Cockpit — read-only staleness RPC for the sync watchdog.
--
-- Context: 018_security_phase0 revoked all anon access to crew_grade_syncs
-- (anon SELECT policy dropped). The cockpit-sync-watchdog lost its only
-- read path and now silently skips the B1 staleness check on every run —
-- a blind health monitor.
--
-- This migration restores the watchdog's eyes with the least-privilege
-- path, following the 2026-10-06 precedent (SECURITY DEFINER RPC +
-- public anon key, no service_role on the VM):
--
--   rpc_watchdog_sync_staleness()
--     -> table(pull_method text, last_synced_at timestamptz)
--
-- Returns one row per pull_method: the latest synced_at across ALL crew
-- members. Deliberately timestamps-only: no crew_member_id, no grades, no
-- assignment payloads — nothing a caller can use to identify a pilot or
-- read their data. Enough to answer "is fresh data landing?" and nothing
-- more.
--
-- SECURITY DEFINER so anon callers get exactly this aggregate and nothing
-- else. No RLS policy change on crew_grade_syncs itself.
--
-- RUN: paste into the Supabase dashboard SQL editor (project: cockpit)
-- Expect "Success. No rows returned."
-- Verify: select * from public.rpc_watchdog_sync_staleness();
-- =============================================================================

create or replace function public.rpc_watchdog_sync_staleness()
returns table (
  pull_method    text,
  last_synced_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select
    s.pull_method::text            as pull_method,
    max(s.synced_at)               as last_synced_at
  from public.crew_grade_syncs s
  group by s.pull_method
  order by last_synced_at desc;
end;
$$;

comment on function public.rpc_watchdog_sync_staleness() is
  'Read-only staleness aggregate for the sync watchdog: latest synced_at per pull_method, timestamps only. No crew or grade data exposed.';

-- The watchdog (and any health tooling) calls this with the public anon key.
grant execute on function public.rpc_watchdog_sync_staleness() to anon, authenticated;
