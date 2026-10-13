-- =============================================================================
-- 030_child_login_consent.sql
-- Cockpit — child login + consent (Phase C, child education UX).
--
-- NOTE: this file supersedes 028_child_login_consent.sql, which was renamed to 030
-- before it was ever run. Every statement below is idempotent (IF NOT EXISTS
-- / CREATE OR REPLACE / pg_policies-guarded DO blocks), so running this
-- after a partial 028 attempt is safe.
--
--   * pilots.child_crew_member_id — the crew profile this pilot claimed.
--     Set = this pilot IS the child (13+). Null = ordinary pilot.
--   * pilots.birthdate — self-attested at claim time; mismatches with the
--     steward's recorded birthdate are logged to consent_events.
--   * link_codes.created_by / redeemed_by — audit who minted and who claimed.
--   * crew_access_grants.cooling_off_until / revoke_requested_at / revoked_by —
--     7-day cooling-off when a steward ends sharing for a 13–15 child.
--     During cooling-off revoked_at stays NULL, so every existing
--     `revoked_at is null` access check keeps working unchanged.
--   * consent_events — the consent audit timeline (code → claim → scopes →
--     revokes), readable by the steward and the linked child.
--   * RLS: the linked child may read their own crew profile, grade syncs,
--     Path-to-90 checks, check-ins, and grants; the steward may read a
--     child's SHARED-channel check-ins only ("Just for me" stays private —
--     the consent screen promises this, so the schema enforces it).
--   * RPCs: preview_link_code (what the claim page shows before sign-in),
--     redeem_link_code (atomic claim: mark used → link pilot → consent
--     grant → audit events). Both SECURITY DEFINER so the not-yet-linked
--     child can validate a code without RLS blocking them.
--
-- RUN: paste into the Supabase dashboard SQL editor (project: cockpit)
-- AFTER 029_class_manual_missing.sql. Expect "Success. No rows returned."
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. pilots — child link + self-attested birthdate.
-- ---------------------------------------------------------------------------
alter table public.pilots
  add column if not exists child_crew_member_id uuid
    references public.crew_members(id) on delete set null,
  add column if not exists birthdate date;

comment on column public.pilots.child_crew_member_id is
  'Set when a 13+ pilot claims a crew profile via link code. A non-null value means this pilot IS the child.';
comment on column public.pilots.birthdate is
  'Self-attested birthdate from the claim flow. Compared against crew_members.birthdate; mismatches are logged to consent_events.';

create index if not exists idx_pilots_child_crew_member
  on public.pilots (child_crew_member_id)
  where child_crew_member_id is not null;

-- ---------------------------------------------------------------------------
-- 2. link_codes — audit columns.
-- ---------------------------------------------------------------------------
alter table public.link_codes
  add column if not exists created_by uuid references public.pilots(id),
  add column if not exists redeemed_by uuid references public.pilots(id);

comment on column public.link_codes.created_by is
  'Steward pilot who minted the code.';
comment on column public.link_codes.redeemed_by is
  'Pilot who redeemed the code (the child).';

-- ---------------------------------------------------------------------------
-- 3. crew_access_grants — cooling-off support for 13–15 steward revokes.
-- ---------------------------------------------------------------------------
alter table public.crew_access_grants
  add column if not exists cooling_off_until timestamptz,
  add column if not exists revoke_requested_at timestamptz,
  add column if not exists revoked_by text
    check (revoked_by in ('crew_member', 'steward', 'grantee'));

comment on column public.crew_access_grants.cooling_off_until is
  '13–15 tier: steward-initiated revokes take effect only after this timestamp (7 days). Access continues until then; revoked_at stays NULL during the wait.';
comment on column public.crew_access_grants.revoke_requested_at is
  'When the revoke was requested (cooling-off start).';
comment on column public.crew_access_grants.revoked_by is
  'Who revoked the grant. Only the granter may revoke — except the 13–15 steward cooling-off path.';

-- ---------------------------------------------------------------------------
-- 4. consent_events — the consent audit timeline.
-- ---------------------------------------------------------------------------
create table if not exists public.consent_events (
  id             uuid    primary key default gen_random_uuid(),
  crew_member_id uuid    not null references public.crew_members(id) on delete cascade,
  -- Pilot who did it (the child, or the steward for cooling-off actions).
  actor_pilot_id uuid    references public.pilots(id) on delete set null,
  event          text    not null check (event in (
                   'code_generated', 'code_redeemed', 'consent_granted',
                   'consent_declined', 'scope_changed', 'access_paused',
                   'access_revoked', 'access_restored', 'revoke_undone',
                   'birthdate_mismatch', 'tier_changed_18'
                 )),
  detail         jsonb   not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

comment on table public.consent_events is
  'Consent audit timeline. Every code, claim, scope change, and revoke lands here. Rendered as a timeline on the Sharing screen — never raw.';

create index if not exists idx_consent_events_crew
  on public.consent_events (crew_member_id, created_at desc);

alter table public.consent_events enable row level security;
-- (force RLS only if not already forced — harmless to repeat)
do $$
begin
  alter table public.consent_events force row level security;
exception when others then null;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Policies (all guarded — safe to re-run).
-- ---------------------------------------------------------------------------

-- 5a. consent_events reads: steward + linked child.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'consent_events' and policyname = 'consent_events_steward_read') then
    create policy consent_events_steward_read on public.consent_events
      for select using (
        crew_member_id in (
          select cm.id from public.crew_members cm where cm.pilot_id = auth.uid()
        )
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'consent_events' and policyname = 'consent_events_child_read') then
    create policy consent_events_child_read on public.consent_events
      for select using (
        crew_member_id in (
          select p.child_crew_member_id from public.pilots p where p.id = auth.uid()
        )
      );
  end if;
  -- 5b. consent_events writes: the steward or the linked child may log events
  -- for their own crew profile (API routes write here on code/revoke actions).
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'consent_events' and policyname = 'consent_events_write') then
    create policy consent_events_write on public.consent_events
      for insert with check (
        crew_member_id in (
          select cm.id from public.crew_members cm where cm.pilot_id = auth.uid()
        )
        or crew_member_id in (
          select p.child_crew_member_id from public.pilots p where p.id = auth.uid()
        )
      );
  end if;
end $$;

grant select, insert on public.consent_events to authenticated;

-- 5c. Child-self RLS: the linked child reads their own school life.
-- (Permissive policies — they OR with the existing steward/grantee rules.)
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'crew_members' and policyname = 'crew_members_child_self_select') then
    create policy crew_members_child_self_select on public.crew_members
      for select using (
        id in (
          select p.child_crew_member_id from public.pilots p where p.id = auth.uid()
        )
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'crew_grade_syncs' and policyname = 'grade_syncs_child_self_select') then
    create policy grade_syncs_child_self_select on public.crew_grade_syncs
      for select using (
        crew_member_id in (
          select p.child_crew_member_id from public.pilots p where p.id = auth.uid()
        )
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'path_to_90_checks' and policyname = 'path_checks_child_self') then
    create policy path_checks_child_self on public.path_to_90_checks
      for all
      using (
        crew_member_id in (
          select p.child_crew_member_id from public.pilots p where p.id = auth.uid()
        )
      )
      with check (
        crew_member_id in (
          select p.child_crew_member_id from public.pilots p where p.id = auth.uid()
        )
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'checkins' and policyname = 'checkins_child_self') then
    create policy checkins_child_self on public.checkins
      for all
      using (
        crew_member_id in (
          select p.child_crew_member_id from public.pilots p where p.id = auth.uid()
        )
      )
      with check (
        crew_member_id in (
          select p.child_crew_member_id from public.pilots p where p.id = auth.uid()
        )
      );
  end if;
end $$;

-- 5d. The child reads and manages their own consent grants.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'crew_access_grants' and policyname = 'grants_child_self_read') then
    create policy grants_child_self_read on public.crew_access_grants
      for select using (
        crew_member_id in (
          select p.child_crew_member_id from public.pilots p where p.id = auth.uid()
        )
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'crew_access_grants' and policyname = 'grants_child_self_insert') then
    create policy grants_child_self_insert on public.crew_access_grants
      for insert with check (
        granted_by = 'crew_member'
        and crew_member_id in (
          select p.child_crew_member_id from public.pilots p where p.id = auth.uid()
        )
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'crew_access_grants' and policyname = 'grants_child_self_update') then
    create policy grants_child_self_update on public.crew_access_grants
      for update
      using (
        granted_by = 'crew_member'
        and crew_member_id in (
          select p.child_crew_member_id from public.pilots p where p.id = auth.uid()
        )
      )
      with check (
        crew_member_id in (
          select p.child_crew_member_id from public.pilots p where p.id = auth.uid()
        )
      );
  end if;
end $$;

-- 5e. Steward reads the child's SHARED check-ins (D1 shared default, D3 full
-- text for 13–15). "Just for me" rows stay child-only.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public'
                 and tablename = 'checkins' and policyname = 'checkins_steward_read_shared') then
    create policy checkins_steward_read_shared on public.checkins
      for select using (
        channel = 'shared'
        and crew_member_id in (
          select cm.id from public.crew_members cm where cm.pilot_id = auth.uid()
        )
      );
  end if;
end $$;

-- 5f. Tighten the broad Phase-B steward policy (which also exposed the
-- PRIVATE channel) to shared-only — the consent screen promises "just for
-- me" stays private, so the schema must enforce it. Only replaces the broad
-- version; a no-op if the policy was already tightened or never created.
do $$
declare
  v_qual text;
begin
  select p.qual into v_qual from pg_policies p
    where p.schemaname = 'public'
      and p.tablename = 'checkins'
      and p.policyname = 'checkins_steward_all';
  if v_qual is not null and v_qual not like '%channel%' then
    drop policy checkins_steward_all on public.checkins;
    create policy checkins_steward_shared_all on public.checkins
      for all
      using (
        channel = 'shared'
        and auth.uid() = (
          select cm.pilot_id from public.crew_members cm
          where cm.id = checkins.crew_member_id
        )
      )
      with check (
        channel = 'shared'
        and auth.uid() = (
          select cm.pilot_id from public.crew_members cm
          where cm.id = checkins.crew_member_id
        )
      );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6. Helper: effective grant access, cooling-off aware.
-- ---------------------------------------------------------------------------
create or replace function public.grant_is_active(g public.crew_access_grants)
returns boolean
language sql
stable
as $$
  select g.revoked_at is null
     or (g.cooling_off_until is not null and g.cooling_off_until > now());
$$;

comment on function public.grant_is_active(public.crew_access_grants) is
  'True when a grant currently allows access: not revoked, or still inside a 13–15 cooling-off window.';

-- ---------------------------------------------------------------------------
-- 7. preview_link_code — what the claim page shows before sign-in.
-- ---------------------------------------------------------------------------
create or replace function public.preview_link_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code record;
  v_member record;
  v_steward_name text;
begin
  if p_code is null or p_code !~ '^[0-9]{6}$' then
    return jsonb_build_object('valid', false, 'reason', 'invalid');
  end if;

  select lc.* into v_code
    from public.link_codes lc
    where lc.code = p_code and lc.used_at is null
    order by lc.created_at desc
    limit 1;

  if v_code.id is null then
    return jsonb_build_object('valid', false, 'reason', 'invalid');
  end if;

  if v_code.expires_at < now() then
    return jsonb_build_object('valid', false, 'reason', 'expired');
  end if;

  select cm.* into v_member
    from public.crew_members cm where cm.id = v_code.crew_member_id;
  if v_member.id is null then
    return jsonb_build_object('valid', false, 'reason', 'invalid');
  end if;

  select p.display_name into v_steward_name
    from public.pilots p where p.id = v_member.pilot_id;

  return jsonb_build_object(
    'valid', true,
    'crew_member_name', v_member.name,
    'steward_name', coalesce(nullif(v_steward_name, ''), 'Your parent'),
    'birthdate', v_member.birthdate,
    'expires_at', v_code.expires_at
  );
end;
$$;

comment on function public.preview_link_code(text) is
  'Claim-page preview for a 6-digit link code. Safe to call pre-auth: returns names + tier info only, never the code.';

grant execute on function public.preview_link_code(text) to authenticated, anon;

-- ---------------------------------------------------------------------------
-- 8. redeem_link_code — atomic claim.
-- ---------------------------------------------------------------------------
create or replace function public.redeem_link_code(p_code text, p_birthdate date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_pilot record;
  v_code record;
  v_member record;
  v_effective_birthdate date;
  v_age int;
  v_mismatch boolean := false;
begin
  if v_caller is null then
    return jsonb_build_object('ok', false, 'reason', 'not_signed_in');
  end if;

  select pl.* into v_pilot from public.pilots pl where pl.id = v_caller;
  if v_pilot.id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_pilot');
  end if;
  if v_pilot.child_crew_member_id is not null then
    return jsonb_build_object('ok', false, 'reason', 'already_linked');
  end if;

  if p_code is null or p_code !~ '^[0-9]{6}$' then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  select lc.* into v_code
    from public.link_codes lc
    where lc.code = p_code and lc.used_at is null
    order by lc.created_at desc
    limit 1
    for update;
  if v_code.id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if v_code.expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  select cm.* into v_member
    from public.crew_members cm where cm.id = v_code.crew_member_id;
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  -- Birthdate: the steward's record wins; the child's attestation fills gaps.
  -- A mismatch is logged, never blocking — the steward's record is the anchor.
  v_effective_birthdate := coalesce(v_member.birthdate, p_birthdate);
  if v_effective_birthdate is null then
    return jsonb_build_object('ok', false, 'reason', 'need_birthdate');
  end if;
  if v_member.birthdate is not null and p_birthdate is not null
     and v_member.birthdate <> p_birthdate then
    v_mismatch := true;
  end if;

  v_age := date_part('year', age(v_effective_birthdate))::int;
  if v_age < 13 then
    -- Defense in depth: the invite button is already gated under 13.
    return jsonb_build_object('ok', false, 'reason', 'under13');
  end if;

  -- 1. Consume the code.
  update public.link_codes
    set used_at = now(), redeemed_by = v_caller
    where id = v_code.id;

  -- 2. Link the pilot to the crew profile.
  update public.pilots
    set child_crew_member_id = v_member.id,
        birthdate = v_effective_birthdate
    where id = v_caller;

  -- 3. The child's consent grant to the steward (grades + attendance +
  --    check-ins; health stays off; Crystal chats are never in scope).
  insert into public.crew_access_grants
    (crew_member_id, granted_by, grantee_pilot_id, scope)
  values
    (v_member.id, 'crew_member', v_member.pilot_id,
     '{"grades": true, "attendance": true, "checkins": true, "health": false}'::jsonb)
  on conflict (crew_member_id, grantee_pilot_id) do update
    set scope = excluded.scope,
        granted_by = 'crew_member',
        granted_at = now(),
        revoked_at = null,
        revoke_requested_at = null,
        cooling_off_until = null,
        revoked_by = null;

  -- 4. Audit events.
  insert into public.consent_events (crew_member_id, actor_pilot_id, event, detail)
  values
    (v_member.id, v_caller, 'code_redeemed',
     jsonb_build_object('code_id', v_code.id)),
    (v_member.id, v_caller, 'consent_granted',
     jsonb_build_object('scope', jsonb_build_object(
       'grades', true, 'attendance', true, 'checkins', true, 'health', false)));

  if v_mismatch then
    insert into public.consent_events (crew_member_id, actor_pilot_id, event, detail)
    values
      (v_member.id, v_caller, 'birthdate_mismatch',
       jsonb_build_object('recorded', v_member.birthdate, 'attested', p_birthdate));
  end if;

  return jsonb_build_object(
    'ok', true,
    'crew_member_id', v_member.id,
    'crew_member_name', v_member.name,
    'age', v_age,
    'birthdate_mismatch', v_mismatch
  );
end;
$$;

comment on function public.redeem_link_code(text, date) is
  'Atomic child claim: consume code → link pilot → write consent grant → audit. Enforces the 13+ floor; logs birthdate mismatches.';

grant execute on function public.redeem_link_code(text, date) to authenticated;

grant usage on all sequences in schema public to authenticated;
