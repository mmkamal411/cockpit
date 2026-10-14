-- =============================================================================
-- 002_crew_grade_syncs.sql
-- Cockpit — grade sync snapshots for crew members.
--
-- One row per sync, keyed to a crew_members row (not a name — names are
-- free-text device config and can be wrong; the crew member's UUID is exact).
--
-- A crew member is OPT-IN: zero rows here for a pilot with no children is
-- normal. This table never assumes anyone has a child.
--
-- RUN: paste this whole file into the Supabase dashboard SQL editor
-- (project: cockpit / hwnesewathbnfvoxtbqh) AFTER 001_pilot_foundation.sql
-- and press Run. Expect "Success. No rows returned."
-- =============================================================================

-- Random IDs for every table. pgcrypto gives us gen_random_uuid().
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. crew_grade_syncs — one row per school-data sync, per crew member.
--    Same snapshot shape as the old studentvue_syncs table (grades, gpa,
--    due_next, past_periods, synergy_mail, office365_emails, class_details,
--    ctls_syllabi) so sync workers push with minimal changes, plus the
--    newer telemetry columns (attendance, ctls_announcements, ctls_upcoming,
--    zero_guard_flags, pull_method) the workers already send.
--    Rows are append-only snapshots: the dashboard always reads the latest
--    row for a crew member, never edits old ones.
-- ---------------------------------------------------------------------------
create table public.crew_grade_syncs (
  id             uuid    primary key default gen_random_uuid(),
  -- Which crew member this snapshot belongs to. Deletes with them.
  crew_member_id uuid    not null references public.crew_members(id) on delete cascade,
  -- Which machine pushed this sync, e.g. 'laptop', 'WIN'. Free text.
  device_name    text    not null default '',
  -- When the worker ran. Defaults to insert time if the worker omits it.
  synced_at      timestamptz not null default now(),

  -- Grades: [{class, grade, period}]
  grades         jsonb   not null default '[]'::jsonb,
  -- GPA: {weighted_gpa, unweighted_gpa, cumulative_gpa}
  gpa            jsonb   not null default '{}'::jsonb,
  -- Upcoming: [{assignment, due, class}]
  due_next       jsonb   not null default '[]'::jsonb,
  -- Past grading periods: [{period, value, grades}]
  past_periods   jsonb   not null default '[]'::jsonb,
  -- Synergy in-portal mail: [{preview, subject, date}]
  synergy_mail   jsonb   not null default '[]'::jsonb,
  -- Office 365 teacher emails: [{preview, sender, subject, date}]
  office365_emails jsonb not null default '[]'::jsonb,
  -- Per-class detail: [{class, grade, categories, assignments, ...}]
  class_details  jsonb   not null default '[]'::jsonb,
  -- CTLS Learn syllabi: {class_name: {text, url}}
  ctls_syllabi   jsonb   not null default '{}'::jsonb,

  -- Attendance summary: {absences, tardies, ...}
  attendance       jsonb not null default '{}'::jsonb,
  -- CTLS Learn announcements: [{title, date, class}]
  ctls_announcements jsonb not null default '[]'::jsonb,
  -- CTLS Learn upcoming work: [{title, due, class}]
  ctls_upcoming    jsonb not null default '[]'::jsonb,
  -- Data-quality flags from the zero-guard (e.g. a grade that dropped to 0)
  zero_guard_flags jsonb not null default '[]'::jsonb,
  -- How the worker pulled: 'browser' (Playwright) or 'api' (mobile JSON API)
  pull_method    text    not null default 'browser',

  created_at     timestamptz not null default now()
);

comment on table public.crew_grade_syncs is
  'School-data sync snapshots, one row per sync, keyed to a crew member. Append-only; readers use the latest row per crew member.';
comment on column public.crew_grade_syncs.crew_member_id is
  'The crew member this snapshot belongs to. Keyed by UUID, never by name — device config names can be wrong.';

-- ---------------------------------------------------------------------------
-- Helpful indexes
-- ---------------------------------------------------------------------------
-- "Latest sync for this crew member" — the dashboard's main query.
create index idx_crew_grade_syncs_crew_synced
  on public.crew_grade_syncs (crew_member_id, synced_at desc);

-- Global recency, e.g. workers checking what the fleet last pushed.
create index idx_crew_grade_syncs_synced
  on public.crew_grade_syncs (synced_at desc);

-- =============================================================================
-- ROW LEVEL SECURITY
-- =============================================================================

alter table public.crew_grade_syncs enable row level security;

-- Force RLS even for table owners, so no role silently bypasses the rules.
alter table public.crew_grade_syncs force row level security;

-- ---------------------------------------------------------------------------
-- The steward pilot (the pilot who owns the crew_members row) manages
-- everything for their own crew member: read, write, delete.
-- ---------------------------------------------------------------------------
create policy grade_syncs_steward_all on public.crew_grade_syncs
  for all
  using (
    auth.uid() = (
      select cm.pilot_id from public.crew_members cm
      where cm.id = crew_grade_syncs.crew_member_id
    )
  )
  with check (
    auth.uid() = (
      select cm.pilot_id from public.crew_members cm
      where cm.id = crew_grade_syncs.crew_member_id
    )
  );

-- ---------------------------------------------------------------------------
-- Grantees (e.g. another parent) may READ a crew member's syncs ONLY when a
-- live grant (revoked_at IS NULL) exists whose scope includes grades.
-- scope '{}' (the default) means NO access. Grantees can never insert,
-- update, or delete — reads only.
-- ---------------------------------------------------------------------------
create policy grade_syncs_grantee_select on public.crew_grade_syncs
  for select using (
    exists (
      select 1 from public.crew_access_grants g
      where g.crew_member_id   = crew_grade_syncs.crew_member_id
        and g.grantee_pilot_id = auth.uid()
        and g.revoked_at is null
        and coalesce((g.scope ->> 'grades')::boolean, false)
    )
  );

-- ---------------------------------------------------------------------------
-- Sync workers push with the ANON key — they have no auth.uid().
-- This mirrors the old studentvue_syncs pattern (anon insert, with check true).
--
-- TRADEOFF, READ THIS: anyone holding the project's anon key (it is public
-- by design) can insert rows into this table. The foreign key guarantees the
-- crew_member_id points at a REAL crew member, but nothing stops a stranger
-- from pushing junk rows for a crew member whose UUID they know.
-- Mitigations, in order of strength:
--   1. Prefer rpc_push_crew_grade_sync() below over direct INSERT — it is
--      SECURITY DEFINER, so the anon INSERT policy can be tightened later
--      without breaking workers.
--   2. The worker's crew_member_id lives in its local sync-config.json
--      (never committed to git); it is not published anywhere.
--   3. If abuse ever appears, tighten this policy (e.g. require a worker
--      secret column match) and update the workers to match.
-- ---------------------------------------------------------------------------
create policy grade_syncs_anon_insert on public.crew_grade_syncs
  for insert to anon
  with check (true);

-- Anon can also read — workers check the last sync before pushing
-- (the zero-guard compares new grades against the previous row).
-- Same tradeoff note as above: once more pilots exist, restrict this and
-- have workers call rpc_get_latest_crew_grade_sync() instead.
create policy grade_syncs_anon_select on public.crew_grade_syncs
  for select to anon
  using (true);

-- =============================================================================
-- RPC: push one grade sync. Mirrors the old rpc_push_studentvue_sync body
-- style (one coalesce per key; unknown keys are ignored). The crew member
-- UUID travels inside p_data (key: crew_member_id) — the workers send a
-- single JSONB payload. SECURITY DEFINER so workers with only the anon
-- key can call it.
-- =============================================================================
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
begin
  v_crew_member_id := (p_data->>'crew_member_id')::uuid;
  if v_crew_member_id is null then
    raise exception 'rpc_push_crew_grade_sync: p_data.crew_member_id is required';
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
  'Workers call this to push one grade-sync snapshot. crew_member_id comes inside p_data; foreign key rejects unknown IDs.';

grant execute on function public.rpc_push_crew_grade_sync(jsonb)
  to anon, authenticated;

-- =============================================================================
-- RPC: latest sync for a crew member. Port of the old
-- rpc_get_latest_studentvue_sync, keyed by crew_member_id.
-- Returns '{}' when no sync exists yet.
-- =============================================================================
create or replace function public.rpc_get_latest_crew_grade_sync(
  p_crew_member_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  select to_jsonb(s) into result
  from public.crew_grade_syncs s
  where s.crew_member_id = p_crew_member_id
  order by s.synced_at desc
  limit 1;

  return coalesce(result, '{}'::jsonb);
end;
$$;

comment on function public.rpc_get_latest_crew_grade_sync(uuid) is
  'Returns the latest grade-sync row for a crew member as JSON, or {} when none exists. Used by the dashboard and the worker zero-guard.';

grant execute on function public.rpc_get_latest_crew_grade_sync(uuid)
  to anon, authenticated;

-- =============================================================================
-- Helper: add a crew member for the SIGNED-IN pilot (no UUID guessing).
--
-- pilots.id references auth.users(id), so a pilot row only exists after
-- signup — this function runs as the pilot (auth.uid()) and returns the
-- existing row's id if one with the same name is already there, so it is
-- safe to call twice.
--
-- EXAMPLE (run in the SQL editor AFTER signing in as Mehedi):
--   select public.ensure_crew_member('Dawson Kamal', '2011-07-23');
-- Take the returned UUID and save it in the worker's sync-config.json as
-- crew_member_id. (The app will call this itself at "add child" time, so
-- this is only needed for manual setup.)
-- =============================================================================
create or replace function public.ensure_crew_member(
  p_name         text,
  p_birthdate    date default null,
  p_relationship text default 'child'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  -- Already added? Return the existing row — onboarding stays idempotent.
  select id into v_id
  from public.crew_members
  where pilot_id = auth.uid()
    and name = p_name
  limit 1;

  if v_id is not null then
    return v_id;
  end if;

  insert into public.crew_members (pilot_id, name, birthdate, relationship)
  values (auth.uid(), p_name, p_birthdate, coalesce(p_relationship, 'child'))
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.ensure_crew_member(text, date, text) is
  'Adds a crew member to the signed-in pilot (idempotent by name). Authenticated pilots only — auth.uid() is the pilot, never a parameter.';

-- Anon has no auth.uid(), so only authenticated pilots may call this.
grant execute on function public.ensure_crew_member(text, date, text)
  to authenticated;

-- =============================================================================
-- GRANTS — auto-expose is OFF, so nothing is reachable until granted here.
-- The authenticated role gets full row-level access; RLS policies above
-- decide which rows each pilot actually sees. service_role bypasses RLS
-- for server-side jobs. Anon gets insert + select (worker pattern).
-- =============================================================================
grant select, insert, update, delete on public.crew_grade_syncs to authenticated;
grant select, insert on public.crew_grade_syncs to anon;

-- Sequences live on the tables via defaults; grant usage for completeness.
grant usage on all sequences in schema public to authenticated;
