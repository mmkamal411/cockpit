-- =============================================================================
-- 034_link_code_claim.sql
-- Link-code CLAIM path (the half that was missing).
--
-- The steward mints 6-digit same-room codes (008_crew_tables.sql), but there
-- was no way for anyone to CLAIM one: the mint UI promised "the other person
-- enters this code to link their profile" with no entry point anywhere. A
-- child signing in themselves (e.g. dawsonkamal@gmail.com) was stranded —
-- empty crew, no classes, no explanation.
--
-- This migration adds two SECURITY DEFINER functions, following the same
-- pattern as the shopping invite RPCs (redeem_share_invite):
--
--   claim_link_code(p_code text) -> jsonb
--     Validates a single-use 15-minute code, marks it used, and creates a
--     steward-authored grant for the caller (idempotent; re-claim restores
--     a revoked grant). Returns {ok, member{...}} or {ok:false}.
--     granted_by = 'steward': the steward who minted the code authorized the
--     share; the caller is the family member claiming it.
--     The caller CANNOT insert grants directly under RLS (grants_steward_
--     manage requires the steward), so the claim must live in a definer.
--
--   my_granted_crew() -> jsonb
--     Rows of crew members the caller is linked to via a live grant. RLS on
--     crew_members is steward-only, so the roster read also needs a definer.
--
-- Both functions are executable by the authenticated role only. A bad code
-- returns {ok:false} with NO distinction between unknown/expired/used — the
-- code itself is the secret, never an existence oracle.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- claim_link_code(p_code text)
-- ---------------------------------------------------------------------------
create or replace function public.claim_link_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller  uuid := auth.uid();
  v_code    public.link_codes%rowtype;
  v_member  public.crew_members%rowtype;
begin
  if v_caller is null then
    return jsonb_build_object('ok', false);
  end if;

  -- Normalize: digits only, exactly 6.
  p_code := regexp_replace(coalesce(p_code, ''), '[^0-9]', '', 'g');
  if length(p_code) <> 6 then
    return jsonb_build_object('ok', false);
  end if;

  select * into v_code
    from public.link_codes
   where code = p_code
     and used_at is null
     and expires_at > now()
   order by created_at desc
   limit 1;

  if v_code.id is null then
    return jsonb_build_object('ok', false);
  end if;

  select * into v_member
    from public.crew_members
   where id = v_code.crew_member_id;

  if v_member.id is null then
    return jsonb_build_object('ok', false);
  end if;

  -- The steward already owns this profile; claiming your own code is a no-op.
  if v_member.pilot_id = v_caller then
    update public.link_codes set used_at = now() where id = v_code.id;
    return jsonb_build_object('ok', false, 'already_owner', true);
  end if;

  -- Ensure the caller's pilot row exists (FK on crew_access_grants).
  insert into public.pilots (id) values (v_caller)
    on conflict (id) do nothing;

  -- Single use: burn the code before inserting the grant.
  update public.link_codes set used_at = now() where id = v_code.id;

  -- Idempotent: re-claiming restores a revoked grant instead of erroring.
  insert into public.crew_access_grants
    (crew_member_id, granted_by, grantee_pilot_id, scope)
  values
    (v_member.id, 'steward', v_caller, '{"grades": true, "school": true}'::jsonb)
  on conflict (crew_member_id, grantee_pilot_id)
    do update set
      revoked_at = null,
      scope      = excluded.scope,
      granted_at = now();

  return jsonb_build_object(
    'ok', true,
    'member', jsonb_build_object(
      'id', v_member.id,
      'name', v_member.name,
      'relationship', v_member.relationship,
      'birthdate', v_member.birthdate
    )
  );
end;
$$;

comment on function public.claim_link_code(text) is
  'Claim a 6-digit same-room link code. Burns the code, creates (or restores) a steward-authored access grant for the caller. {ok:false} for any invalid code.';

-- ---------------------------------------------------------------------------
-- my_granted_crew() — crew members linked TO the caller via live grants.
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

-- ---------------------------------------------------------------------------
-- Execute grants — authenticated only. No direct table access changes.
-- ---------------------------------------------------------------------------
revoke all on function public.claim_link_code(text) from public;
grant execute on function public.claim_link_code(text) to authenticated;

revoke all on function public.my_granted_crew() from public;
grant execute on function public.my_granted_crew() to authenticated;
