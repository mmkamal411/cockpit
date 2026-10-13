-- =============================================================================
-- 018_security_phase0.sql — Phase 0 security fixes (GATING for personalization)
--
-- Fixes A1 (CRITICAL), A3 (HIGH), A4 (MEDIUM) from
-- personalization-eval/00-security-threat-model.md.
--
-- A1: crew_grade_syncs was readable AND writable by the entire internet via
--     the anon key (anon SELECT using(true), anon INSERT with check(true),
--     anon-granted SECURITY DEFINER RPCs with no caller checks).
--     Fix: drop anon policies, revoke anon table grants, gate the worker
--     RPCs behind per-crew-member worker secrets, add caller checks for
--     authenticated dashboard reads.
-- A3: redeem_share_invite() trusted caller-supplied p_pilot_id and ignored
--     p_email (invite hijack). Fix: derive identity from auth.uid() + JWT
--     email server-side, enforce the invite's addressed-email binding,
--     revoke the anon grant.
-- A4: find_pilot_by_email() was an account-enumeration oracle for any
--     authenticated user. Fix: scope resolution to a list the caller owns
--     (p_list_id + ownership check); uniform null for "no account" and
--     "not your list".
--
-- NOTE on numbering: personalization-eval/09-dbadmin-schema-rls.md drafted
-- the personalization tables as "018". This security migration takes 018
-- because it GATES that build; the personalization tables move to 019.
--
-- RUN: paste into the Supabase dashboard SQL editor AFTER 017_shopping_shares.sql.
-- Idempotent: safe to re-run (drops use IF EXISTS, creates use OR REPLACE).
-- =============================================================================

create extension if not exists pgcrypto;

-- ###########################################################################
-- A1 — crew_grade_syncs lockdown
-- ###########################################################################

-- 1a. Drop the internet-readable / internet-writable anon policies.
drop policy if exists grade_syncs_anon_select on public.crew_grade_syncs;
drop policy if exists grade_syncs_anon_insert on public.crew_grade_syncs;

-- 1b. Revoke the direct anon table grants (belt and suspenders: with the
--     policies gone, anon has no path to the table at all).
revoke all on public.crew_grade_syncs from anon;

-- The steward (crew owner) and live-grantee policies from 002 stay exactly
-- as they are — authenticated pilots can only touch rows for crew members
-- they own or hold a live grades-scoped grant for:
--   grade_syncs_steward_all, grade_syncs_grantee_select  (unchanged)

-- ---------------------------------------------------------------------------
-- 1c. Worker secrets: laptops and the ParentVUE fallback authenticate with a
--     per-crew-member secret instead of the bare anon key. Secrets are stored
--     as bcrypt hashes; only SECURITY DEFINER functions (and service_role)
--     can read this table — never anon/authenticated directly.
-- ---------------------------------------------------------------------------
create table if not exists public.crew_sync_worker_secrets (
  crew_member_id uuid primary key references public.crew_members(id) on delete cascade,
  secret_hash    text not null,
  created_at     timestamptz not null default now(),
  revoked_at     timestamptz
);

comment on table public.crew_sync_worker_secrets is
  'Per-crew-member worker secrets (bcrypt hashes). Workers present the secret to rpc_push_crew_grade_sync / rpc_get_latest_crew_grade_sync. Rotate via rotate_crew_worker_secret().';

alter table public.crew_sync_worker_secrets enable row level security;
alter table public.crew_sync_worker_secrets force row level security;
-- No policies and no grants to anon/authenticated: only service_role and
-- SECURITY DEFINER functions touch this table.

-- ---------------------------------------------------------------------------
-- 1d. rotate_crew_worker_secret — steward-only secret rotation.
--     Generates a 256-bit hex secret, stores the bcrypt hash, revokes the
--     previous secret, and returns the PLAINTEXT ONCE. The steward saves it
--     in the worker's sync-config.json (never in git, never in chat).
-- ---------------------------------------------------------------------------
create or replace function public.rotate_crew_worker_secret(p_crew_member_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  -- Caller must be the steward (pilot who owns the crew_members row).
  if auth.uid() is null
     or not exists (
       select 1 from public.crew_members cm
       where cm.id = p_crew_member_id and cm.pilot_id = auth.uid()
     ) then
    raise exception 'rotate_crew_worker_secret: not authorized';
  end if;

  v_secret := encode(gen_random_bytes(32), 'hex');

  insert into public.crew_sync_worker_secrets (crew_member_id, secret_hash, revoked_at)
  values (p_crew_member_id, crypt(v_secret, gen_salt('bf')), null)
  on conflict (crew_member_id) do update
    set secret_hash = excluded.secret_hash,
        created_at  = now(),
        revoked_at  = null;

  return v_secret;
end;
$$;

comment on function public.rotate_crew_worker_secret(uuid) is
  'Steward-only: (re)generates the worker secret for a crew member and returns the plaintext ONCE. Save it in the worker sync-config.json.';

revoke all on function public.rotate_crew_worker_secret(uuid) from public, anon;
grant execute on function public.rotate_crew_worker_secret(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 1e. Harden rpc_push_crew_grade_sync: workers must present the
--     per-crew-member secret inside p_data (key: worker_secret).
--     service_role callers (server-side jobs) bypass the secret check.
--     The secret is NEVER stored — the insert uses an explicit column list.
-- ---------------------------------------------------------------------------
create or replace function public.rpc_push_crew_grade_sync(
  p_data jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  v_crew_member_id uuid;
  v_secret text;
  v_is_service_role boolean;
begin
  v_crew_member_id := (p_data->>'crew_member_id')::uuid;
  if v_crew_member_id is null then
    raise exception 'rpc_push_crew_grade_sync: p_data.crew_member_id is required';
  end if;

  v_is_service_role := coalesce(auth.jwt()->>'role', '') = 'service_role';
  if not v_is_service_role then
    v_secret := p_data->>'worker_secret';
    if v_secret is null or not exists (
      select 1 from public.crew_sync_worker_secrets s
      where s.crew_member_id = v_crew_member_id
        and s.revoked_at is null
        and crypt(v_secret, s.secret_hash) = s.secret_hash
    ) then
      raise exception 'rpc_push_crew_grade_sync: invalid worker credentials';
    end if;
  end if;

  insert into public.crew_grade_syncs (
    crew_member_id, device_name, synced_at,
    grades, gpa, due_next, past_periods,
    synergy_mail, office365_emails,
    class_details, ctls_syllabi,
    attendance, ctls_announcements, ctls_upcoming,
    zero_guard_flags, pull_method
  ) values (
    v_crew_member_id,
    coalesce(p_data->>'device_name', 'unknown'),
    coalesce((p_data->>'synced_at')::timestamptz, now()),
    coalesce(p_data->'grades', '[]'::jsonb),
    coalesce(p_data->'gpa', '{}'::jsonb),
    coalesce(p_data->'due_next', '[]'::jsonb),
    coalesce(p_data->'past_periods', '[]'::jsonb),
    coalesce(p_data->'synergy_mail', '[]'::jsonb),
    coalesce(p_data->'office365_emails', '[]'::jsonb),
    coalesce(p_data->'class_details', '[]'::jsonb),
    coalesce(p_data->'ctls_syllabi', '{}'::jsonb),
    coalesce(p_data->'attendance', '{}'::jsonb),
    coalesce(p_data->'ctls_announcements', '[]'::jsonb),
    coalesce(p_data->'ctls_upcoming', '[]'::jsonb),
    coalesce(p_data->'zero_guard_flags', '[]'::jsonb),
    coalesce(p_data->>'pull_method', 'browser')
  )
  returning id into new_id;

  return new_id;
end;
$$;

comment on function public.rpc_push_crew_grade_sync(jsonb) is
  'Workers push one grade-sync snapshot. Requires p_data.worker_secret (per-crew-member secret from rotate_crew_worker_secret) unless called as service_role. The secret is never stored.';

-- Grant unchanged (workers call with the anon key + secret):
grant execute on function public.rpc_push_crew_grade_sync(jsonb) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1f. Harden rpc_get_latest_crew_grade_sync: three caller paths.
--     - service_role: full access (server-side jobs).
--     - authenticated: must be the steward or a live grades-scoped grantee,
--       else '{}' (no existence oracle).
--     - anon (workers): must present the per-crew-member worker secret,
--       else '{}'.
-- ---------------------------------------------------------------------------
create or replace function public.rpc_get_latest_crew_grade_sync(
  p_crew_member_id uuid,
  p_worker_secret text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
  v_caller uuid := auth.uid();
  v_is_service_role boolean := coalesce(auth.jwt()->>'role', '') = 'service_role';
  v_authorized boolean := false;
begin
  if v_is_service_role then
    v_authorized := true;
  elsif v_caller is not null then
    -- Authenticated dashboard path: steward or live grades-scoped grantee.
    v_authorized := exists (
      select 1 from public.crew_members cm
      where cm.id = p_crew_member_id and cm.pilot_id = v_caller
    ) or exists (
      select 1 from public.crew_access_grants g
      where g.crew_member_id   = p_crew_member_id
        and g.grantee_pilot_id = v_caller
        and g.revoked_at is null
        and coalesce((g.scope ->> 'grades')::boolean, false)
    );
  else
    -- Anon worker path: per-crew-member secret required.
    v_authorized := p_worker_secret is not null and exists (
      select 1 from public.crew_sync_worker_secrets s
      where s.crew_member_id = p_crew_member_id
        and s.revoked_at is null
        and crypt(p_worker_secret, s.secret_hash) = s.secret_hash
    );
  end if;

  if not v_authorized then
    return '{}'::jsonb;
  end if;

  select to_jsonb(s) into result
  from public.crew_grade_syncs s
  where s.crew_member_id = p_crew_member_id
  order by s.synced_at desc
  limit 1;

  return coalesce(result, '{}'::jsonb);
end;
$$;

comment on function public.rpc_get_latest_crew_grade_sync(uuid, text) is
  'Latest grade-sync row as JSON, or {}. Callers: service_role (jobs), authenticated steward/live grantee (dashboard), anon + worker secret (worker zero-guard). Unauthorized callers get {} — never an existence oracle.';

-- Drop the old single-arg grant signature note: the new (uuid, text) overload
-- replaces it; revoke the old one explicitly to avoid a lingering overload.
drop function if exists public.rpc_get_latest_crew_grade_sync(uuid);

grant execute on function public.rpc_get_latest_crew_grade_sync(uuid, text) to anon, authenticated;

-- ###########################################################################
-- A3 — redeem_share_invite: server-side identity, email binding, no anon
-- ###########################################################################

-- Drop the vulnerable 3-param overload (caller-supplied identity).
drop function if exists public.redeem_share_invite(text, uuid, text);

create or replace function public.redeem_share_invite(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inv record;
  v_pilot_id uuid := auth.uid();
  v_email text := lower(auth.jwt()->>'email');
begin
  -- Redeem requires a signed-in pilot (the /invite page signs users in first).
  if v_pilot_id is null or v_email is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  -- The invite's addressed email must match the signed-in pilot's email.
  -- This binding was previously accepted-and-ignored; now it is enforced.
  select i.id as invite_id, i.share_id, i.expires_at, i.accepted_at,
         s.list_id, s.shared_with_pilot_id, s.permission,
         l.name as list_name
    into inv
  from public.share_invites i
  join public.shopping_list_shares s on s.id = i.share_id
  join public.shopping_lists l on l.id = s.list_id
  where i.token_hash = p_token_hash
    and lower(s.shared_with_email) = v_email;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if inv.expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if inv.accepted_at is not null then
    -- Already redeemed: only the original redeemer gets a pass-through.
    if inv.shared_with_pilot_id = v_pilot_id then
      return jsonb_build_object('ok', true, 'already', true,
        'list_id', inv.list_id, 'list_name', inv.list_name,
        'permission', inv.permission);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'accepted');
  end if;

  update public.shopping_list_shares
    set shared_with_pilot_id = v_pilot_id
    where id = inv.share_id
      and (shared_with_pilot_id is null or shared_with_pilot_id = v_pilot_id);

  update public.share_invites
    set accepted_at = now()
    where id = inv.invite_id;

  return jsonb_build_object('ok', true,
    'list_id', inv.list_id, 'list_name', inv.list_name,
    'permission', inv.permission);
end;
$$;

comment on function public.redeem_share_invite(text) is
  'Redeem a single-use share invite. Identity comes from auth.uid() + JWT email server-side; the invite addressed-email binding is enforced. Signed-in pilots only.';

revoke all on function public.redeem_share_invite(text) from public, anon;
grant execute on function public.redeem_share_invite(text) to authenticated;

-- ###########################################################################
-- A4 — find_pilot_by_email: scope the oracle to lists the caller owns
-- ###########################################################################

-- Drop the unscoped oracle.
drop function if exists public.find_pilot_by_email(text);

create or replace function public.find_pilot_by_email(p_email text, p_list_id uuid)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  -- Resolves an email to a pilot id ONLY in the context of a shopping list
  -- the caller owns (the share-creation flow). Returns null uniformly for
  -- "no Cockpit account" and "not your list" — no enumeration signal.
  select p.id from public.pilots p
  where lower(p.email) = lower(nullif(trim(p_email), ''))
    and exists (
      select 1 from public.shopping_lists l
      where l.id = p_list_id
        and l.pilot_id = auth.uid()
    )
  limit 1;
$$;

comment on function public.find_pilot_by_email(text, uuid) is
  'Share-creation helper: resolve an invitee email to a pilot id, but ONLY for a list the caller owns. Returns null uniformly otherwise. Not a general email oracle.';

revoke all on function public.find_pilot_by_email(text, uuid) from public, anon;
grant execute on function public.find_pilot_by_email(text, uuid) to authenticated;
