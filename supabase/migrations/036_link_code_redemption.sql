-- =============================================================================
-- 036_link_code_redemption.sql
-- Cockpit — complete the child-linking loop: link-code REDEMPTION.
--
-- GAP FOUND (new-user gap hunt, 2026-10-13):
-- Migration 008 created public.link_codes ("redeemed by the child") and the
-- app has POST /api/crew/members/[id]/link-code to MINT a 6-digit code —
-- but nothing redeemed it. Consequences, all verified in the repo:
--   * RLS link_codes_steward_all lets ONLY the steward read code rows, so a
--     child entering the code in a form could never validate it via RLS.
--   * No API route, no RPC, and no app code anywhere INSERTed into
--     crew_access_grants — the entire grant machinery was schema-only.
--   * GET /api/crew/members is scoped by crew_members_pilot_all
--     (auth.uid() = pilot_id), so a child signing in with their own Gmail
--     sees ZERO crew members and can never reach
--     /api/crew/members/[id]/classes — even though those routes already
--     honor grants. This is why dawsonkamal@gmail.com "can't see his
--     classes": the roster query is the break point, and no linking flow
--     exists to bridge his pilot to his crew_members row.
--
-- This migration supplies the DB-side half of the fix (the app side is
-- POST /api/crew/link-codes/claim + the Crew applet's claim panel):
--   1. redeem_link_code(p_code) — SECURITY DEFINER, the ONE redemption
--      path. Validates the 6-digit code (unused, unexpired), stamps it
--      single-use (race-safe: only the first claimer wins), and inserts the
--      crew_access_grants row with granted_by = 'crew_member' (the child is
--      the access authority) and scope {"grades": true, "school": true},
--      which is exactly what the RLS grantee rules and the classes/sync
--      routes check. Idempotent re-claim revives a revoked grant (a freshly
--      minted code is a re-invite), never duplicates. Returns
--      {ok, crew_member_id, already}. Error cases NEVER distinguish
--      invalid / expired / used (all 'invalid') — the code is a Bearer <redacted>
--      (6 digits, 15-min expiry, single use): possession authorizes the
--      link, same model as share invite tokens.
--   2. my_granted_crew() — SECURITY DEFINER: rows of crew members the
--      caller is linked to via a live grant (roster discovery), as jsonb.
--   3. crew_members_grantee_select — lets a pilot with a LIVE grant see that
--      crew member's roster row, so GET /api/crew/members discovers it.
--      SELECT-only: steward-only writes (incl. DELETE) are unchanged.
--
-- RUN: paste into the Supabase dashboard SQL editor (project: cockpit).
-- Idempotent: create or replace + drop/create policy are safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. redeem_link_code — the child claims their crew membership.
--    The code is a Bearer <redacted> (6 digits, 15-min expiry, single use):
--    possession authorizes the link, same model as share invite tokens.
-- ---------------------------------------------------------------------------
create or replace function public.redeem_link_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pilot_id      uuid := auth.uid();
  v_code          text;
  v_crew_member_id uuid;
  v_steward_id    uuid;
  v_claimed       integer := 0;
  v_already       boolean := false;
begin
  -- Redemption requires a signed-in pilot. (Anonymous callers get 'invalid'
  -- rather than an existence signal; the code space is only 10^6.)
  if v_pilot_id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  -- Normalize: digits only, exactly 6. Any other shape is 'invalid' — never
  -- an existence oracle.
  v_code := regexp_replace(coalesce(p_code, ''), '[^0-9]', '', 'g');
  if length(v_code) <> 6 then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  -- Latest live code wins (the mint route invalidates older ones first,
  -- but several rows can briefly coexist).
  select lc.crew_member_id, cm.pilot_id
    into v_crew_member_id, v_steward_id
  from public.link_codes lc
  join public.crew_members cm on cm.id = lc.crew_member_id
  where lc.code = v_code
    and lc.used_at is null
    and lc.expires_at > now()
  order by lc.created_at desc
  limit 1;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  -- The steward never needs a grant to their own crew member.
  if v_steward_id = v_pilot_id then
    return jsonb_build_object('ok', false, 'reason', 'already_steward');
  end if;

  -- Single-use: stamp the code. Only the first claimer wins the race;
  -- a concurrent second claim finds zero rows and gets 'invalid'.
  update public.link_codes
    set used_at = now()
    where code = v_code
      and crew_member_id = v_crew_member_id
      and used_at is null;
  get diagnostics v_claimed = row_count;
  if v_claimed = 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  -- Did this pilot already hold a live grant (e.g. re-linking a device)?
  select exists (
    select 1 from public.crew_access_grants g
    where g.crew_member_id = v_crew_member_id
      and g.grantee_pilot_id = v_pilot_id
      and g.revoked_at is null
  ) into v_already;

  -- The child is the access authority: granted_by = 'crew_member'.
  -- Grades + school scope unlocks classes + latest sync + path-to-90, which
  -- is what the RLS grantee rules and the /classes + /sync routes check.
  -- On conflict: revive a previously revoked grant (a freshly minted code
  -- is a re-invite); never duplicate.
  insert into public.crew_access_grants
    (crew_member_id, granted_by, grantee_pilot_id, scope)
  values
    (v_crew_member_id, 'crew_member', v_pilot_id,
     '{"grades": true, "school": true}'::jsonb)
  on conflict (crew_member_id, grantee_pilot_id) do update
    set revoked_at = null,
        scope = excluded.scope,
        granted_at = now();

  return jsonb_build_object(
    'ok', true,
    'crew_member_id', v_crew_member_id,
    'already', v_already
  );
end;
$$;

comment on function public.redeem_link_code(text) is
  'Child links their own login to a crew member via a 6-digit steward-minted code (single use, 15-min expiry). Creates the crew_access_grants row (granted_by=crew_member, grades+school scope); revives a revoked grant on re-invite. Errors never distinguish invalid/expired/used. Signed-in pilots only.';

revoke all on function public.redeem_link_code(text) from public, anon;
grant execute on function public.redeem_link_code(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. my_granted_crew() — crew members linked TO the caller via live grants.
--    Rows of crew members the caller is linked to via a live grant. RLS on
--    crew_members is steward-only, so the roster read also needs a definer.
-- ---------------------------------------------------------------------------
create or replace function public.my_granted_crew()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    return '[]'::jsonb;
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id',           cm.id,
        'name',         cm.name,
        'birthdate',    cm.birthdate,
        'relationship', cm.relationship,
        'created_at',   cm.created_at
      )
      order by cm.created_at
    )
    from public.crew_access_grants g
    join public.crew_members cm on cm.id = g.crew_member_id
    where g.grantee_pilot_id = v_caller
      and g.revoked_at is null
  ), '[]'::jsonb);
end;
$$;

comment on function public.my_granted_crew() is
  'Crew members the caller may see through a live access grant (steward-owned rows RLS would otherwise hide).';

revoke all on function public.my_granted_crew() from public, anon;
grant execute on function public.my_granted_crew() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Roster discovery: a pilot holding a LIVE grant sees that crew member.
--    SELECT-only — steward-only insert/update/delete are untouched, so e.g.
--    DELETE /api/crew/members/[id] still 404s (via RLS) for grantees.
-- ---------------------------------------------------------------------------
drop policy if exists crew_members_grantee_select on public.crew_members;
create policy crew_members_grantee_select on public.crew_members
  for select to authenticated
  using (
    exists (
      select 1 from public.crew_access_grants g
      where g.crew_member_id = crew_members.id
        and g.grantee_pilot_id = auth.uid()
        and g.revoked_at is null
    )
  );
