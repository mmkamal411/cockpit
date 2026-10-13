-- =============================================================================
-- 039_fix_crew_rls_recursion.sql — URGENT FIX
-- Cockpit — break the infinite RLS recursion between crew_members and
-- crew_access_grants introduced by 036.
--
-- ROOT CAUSE:
--   036 added policy crew_members_grantee_select on crew_members:
--       USING (EXISTS (select 1 from crew_access_grants ...))
--   001's grants_steward_manage policy on crew_access_grants contains:
--       USING (auth.uid() = (select cm.pilot_id from crew_members ...))
--   Every SELECT on crew_members now evaluates grantee_select -> queries
--   crew_access_grants -> evaluates steward_manage -> queries crew_members
--   -> INFINITE RECURSION. PostgreSQL aborts the query, PostgREST returns
--   500, and GET /api/crew/members (plus every other route touching
--   crew_members: classes, class-detail, link-code, path-to-90, grade syncs,
--   link_codes) broke the moment 036 was applied (~17:12 EDT 2026-10-13).
--   Symptom: {"error":"Couldn't load your crew right now. Try again."} and
--   the entire Family/School surface disappearing from the app.
--
-- FIX:
--   Replace the policy's direct EXISTS subquery with a SECURITY DEFINER
--   helper that checks crew_access_grants bypassing RLS. The helper runs as
--   the function owner so the grant check never re-enters RLS evaluation,
--   breaking the cycle. auth.uid() still returns the CALLER's id inside a
--   SECURITY DEFINER function (it reads the JWT), so the security semantic
--   is unchanged: a pilot sees a crew member's row iff they steward it or
--   hold a live (unrevoked) grant.
--
--   App behavior is unchanged: GET /api/crew/members already merges granted
--   members via the my_granted_crew() RPC; this policy covers direct reads.
--
-- RUN: paste into the Supabase dashboard SQL editor (project: cockpit).
-- Expect "Success. No rows returned." Idempotent: safe to re-run.
-- VERIFY: select polname from pg_policies
--           where schemaname='public' and tablename='crew_members';
--         Expect crew_members_pilot_all + crew_members_grantee_select.
-- =============================================================================

-- Helper: live-grant check that bypasses RLS (breaks the recursion cycle).
create or replace function public.has_live_crew_grant(p_crew_member_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.crew_access_grants g
    where g.crew_member_id = p_crew_member_id
      and g.grantee_pilot_id = auth.uid()
      and g.revoked_at is null
  );
$$;

comment on function public.has_live_crew_grant(uuid) is
  'RLS helper (039): checks live crew_access_grants bypassing RLS to break the crew_members<->crew_access_grants policy recursion cycle introduced by 036. auth.uid() still reflects the caller.';

-- Replace the recursive policy with the non-recursive version.
drop policy if exists crew_members_grantee_select on public.crew_members;

create policy crew_members_grantee_select on public.crew_members
  for select to authenticated
  using (public.has_live_crew_grant(crew_members.id));
