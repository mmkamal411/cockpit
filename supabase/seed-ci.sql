-- =============================================================================
-- seed-ci.sql — SYNTHETIC seed data for the cockpit-ci project ONLY.
--
-- This file contains ZERO real data. Every name is fictional
-- ("CI Pilot One", "Sample Student One"), every email uses the
-- @example.invalid domain (RFC 2606 — guaranteed to never resolve),
-- and every grade/class is made up.
--
-- PURPOSE: give the CI `rls-tests` job something to assert against after
-- the 28 schema migrations run on a FRESH cockpit-ci Supabase project.
--
-- PREREQUISITE: the two CI auth users must already exist in the project.
-- Create them in the Supabase dashboard (Authentication → Users → Add user):
--   - ci-pilot-1@example.invalid
--   - ci-pilot-2@example.invalid
-- (Or let the CI rls-tests job create them via the Auth Admin API.)
--
-- RUN: paste this whole file into the Supabase dashboard SQL editor AFTER
-- all 28 migrations and press Run. It is IDEMPOTENT — safe to re-run.
-- Expect "Success."
-- =============================================================================

do $$
declare
  v_pilot_a uuid;
  v_pilot_b uuid;
begin
  -- Resolve the pilot UUIDs from auth. The SQL editor runs as postgres, so
  -- auth.users is readable here. pilots.id references auth.users(id).
  select id into v_pilot_a from auth.users where email = 'ci-pilot-1@example.invalid';
  select id into v_pilot_b from auth.users where email = 'ci-pilot-2@example.invalid';

  if v_pilot_a is null or v_pilot_b is null then
    raise exception 'seed-ci.sql: expected auth users ci-pilot-1@example.invalid and ci-pilot-2@example.invalid — create them first (Auth → Users → Add user).';
  end if;

  -- -----------------------------------------------------------------------
  -- pilots — two fictional pilots.
  -- -----------------------------------------------------------------------
  insert into public.pilots (id, display_name, timezone) values
    (v_pilot_a, 'CI Pilot One', 'America/New_York'),
    (v_pilot_b, 'CI Pilot Two', 'America/Chicago')
  on conflict (id) do update
    set display_name = excluded.display_name,
        timezone     = excluded.timezone;

  -- -----------------------------------------------------------------------
  -- crew_members — three fictional students.
  -- Pilot A owns two; Pilot B owns one (this makes RLS isolation assertions
  -- possible: A must never see B's crew member, and vice versa).
  -- -----------------------------------------------------------------------
  insert into public.crew_members (id, pilot_id, name, birthdate, relationship) values
    ('11111111-1111-4111-8111-111111111111', v_pilot_a, 'Sample Student One', '2012-03-04', 'child'),
    ('22222222-2222-4222-8222-222222222222', v_pilot_a, 'Sample Student Two', '2014-07-19', 'child'),
    ('33333333-3333-4333-8333-333333333333', v_pilot_b, 'Sample Student Three', '2011-11-02', 'child')
  on conflict (id) do nothing;

  -- -----------------------------------------------------------------------
  -- todos — a couple of fictional tasks per pilot.
  -- -----------------------------------------------------------------------
  insert into public.todos (id, pilot_id, title, due_at, done, source) values
    ('44444444-4444-4444-8444-444444444444', v_pilot_a, 'CI fixture: renew sample library book', now() + interval '2 days', false, 'manual'),
    ('55555555-5555-4555-8555-555555555555', v_pilot_a, 'CI fixture: done sample errand', now() - interval '1 day', true, 'manual'),
    ('66666666-6666-4666-8666-666666666666', v_pilot_b, 'CI fixture: sample grocery run', now() + interval '5 days', false, 'manual')
  on conflict (id) do nothing;

  -- -----------------------------------------------------------------------
  -- crew_grade_syncs — fictional grade snapshots.
  -- One for Pilot A's first student, one for Pilot B's student.
  -- -----------------------------------------------------------------------
  insert into public.crew_grade_syncs (
    id, crew_member_id, device_name, synced_at,
    grades, gpa, due_next, pull_method
  ) values
    ('77777777-7777-4777-8777-777777777777',
     '11111111-1111-4111-8111-111111111111',
     'ci-fixture',
     now() - interval '1 hour',
     '[{"class":"Sample Math","grade":92.5,"period":"Q1"},{"class":"Sample Science","grade":88.0,"period":"Q1"}]',
     '{"weighted_gpa":3.6,"unweighted_gpa":3.5}',
     '[{"assignment":"Sample worksheet 4","due":"2099-01-05","class":"Sample Math"}]',
     'browser'),
    ('88888888-8888-4888-8888-888888888888',
     '33333333-3333-4333-8333-333333333333',
     'ci-fixture',
     now() - interval '2 hours',
     '[{"class":"Sample History","grade":79.5,"period":"Q1"}]',
     '{"weighted_gpa":3.1,"unweighted_gpa":3.0}',
     '[]',
     'browser')
  on conflict (id) do nothing;

  -- -----------------------------------------------------------------------
  -- path_to_90_checks — one fictional checkbox for Pilot A's first student.
  -- -----------------------------------------------------------------------
  insert into public.path_to_90_checks (
    id, crew_member_id, class_name, action_id, checked, checked_by
  ) values
    ('99999999-9999-4999-8999-999999999999',
     '11111111-1111-4111-8111-111111111111',
     'Sample Math', 'sample-math-missing-1', false, 'pilot')
  on conflict (id) do nothing;

  raise notice 'seed-ci.sql: seeded 2 pilots, 3 crew members, 3 todos, 2 grade syncs, 1 path check (all synthetic).';
end $$;
