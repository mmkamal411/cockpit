-- =============================================================================
-- 039_rls_recursion_fix.sql
-- Cockpit — fix RLS infinite recursion between crew_members and crew_access_grants.
--
-- REGRESSION: Migration 036 added `crew_members_grantee_select` (EXISTS on
-- crew_access_grants) while 001's `grants_steward_manage` on crew_access_grants
-- subqueries crew_members — infinite recursion that makes EVERY crew query
-- fail and hides the entire Family/School surface from the app.
--
-- FIX: Grant-checks inside policies go through SECURITY DEFINER helper
-- functions that bypass RLS. auth.uid() still reads the caller's JWT inside
-- them, so the security semantic is unchanged — only the recursion is gone.
--
-- RUN: paste into the Supabase dashboard SQL editor (project: cockpit).
-- Idempotent: create or replace + drop/create policy are safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helper: does the caller hold a live grant for this crew member?
-- SECURITY DEFINER bypasses RLS — no recursion. auth.uid() is the caller.
-- ---------------------------------------------------------------------------
create or replace function public.has_live_crew_grant(p_crew_member_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  return exists (
    select 1 from public.crew_access_grants g
    where g.crew_member_id   = p_crew_member_id
      and g.grantee_pilot_id = auth.uid()
      and g.revoked_at is null
  );
end;
$$;

comment on function public.has_live_crew_grant(uuid) is
  'RLS helper: true when the caller holds a live (non-revoked) access grant for the crew member. SECURITY DEFINER to break the crew_members <-> crew_access_grants policy recursion.';

grant execute on function public.has_live_crew_grant(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Helper: does the caller hold a live grant WITH grades scope?
-- ---------------------------------------------------------------------------
create or replace function public.has_live_grades_grant(p_crew_member_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
begin
  return exists (
    select 1 from public.crew_access_grants g
    where g.crew_member_id   = p_crew_member_id
      and g.grantee_pilot_id = auth.uid()
      and g.revoked_at is null
      and coalesce((g.scope ->> 'grades')::boolean, false)
  );
end;
$$;

comment on function public.has_live_grades_grant(uuid) is
  'RLS helper: true when the caller holds a live grades-scoped grant for the crew member. SECURITY DEFINER to break policy recursion.';

grant execute on function public.has_live_grades_grant(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Rewrite crew_members_grantee_select to use the helper (no direct
-- cross-table subquery = no recursion).
-- ---------------------------------------------------------------------------
drop policy if exists crew_members_grantee_select on public.crew_members;

create policy crew_members_grantee_select on public.crew_members
  for select to authenticated
  using (
    public.has_live_crew_grant(crew_members.id)
  );

-- ---------------------------------------------------------------------------
-- Rewrite grade_syncs_grantee_select to use the helper.
-- ---------------------------------------------------------------------------
drop policy if exists grade_syncs_grantee_select on public.crew_grade_syncs;

create policy grade_syncs_grantee_select on public.crew_grade_syncs
  for select to authenticated
  using (
    public.has_live_grades_grant(crew_grade_syncs.crew_member_id)
  );
