-- =============================================================================
-- 031_crew_school_sources.sql
-- Cockpit — school calendar + bell schedule sources (district-agnostic).
--
-- 1. crew_school_sources — one row per crew member: the district name, the
--    district calendar page URL, and a small list of bell schedule links
--    (e.g. daily bell, WEB enrichment block). The pilot can add links for
--    any school district — nothing here is Cobb-specific.
-- 2. crew_school_source_snapshots — sanitized HTML snapshots of each linked
--    page, fetched server-side so the dashboard can render the calendar and
--    bell schedules in-app without a browser leaving Cockpit.
--
-- RUN: paste into the Supabase dashboard SQL editor (project: cockpit)
-- Expect "Success. No rows returned."
-- =============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. crew_school_sources — the pilot-configured link set per crew member.
-- ---------------------------------------------------------------------------
create table public.crew_school_sources (
  id                uuid    primary key default gen_random_uuid(),
  crew_member_id    uuid    not null references public.crew_members(id) on delete cascade unique,
  district          text,
  calendar_source_url text,
  -- Array of {label, url}: bell schedule links the pilot saves.
  bell_schedules    jsonb   not null default '[]',
  last_checked_at   timestamptz,
  -- Health of the links from the last refresh: ok / stale / broken.
  check_status      text    check (check_status in ('ok', 'stale', 'broken')),
  check_note        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

comment on table public.crew_school_sources is
  'Pilot-configured school calendar + bell schedule links per crew member (district-agnostic).';

alter table public.crew_school_sources enable row level security;
alter table public.crew_school_sources force row level security;

-- The steward pilot manages their own crew member's school sources.
create policy crew_school_sources_steward_all on public.crew_school_sources
  for all
  using (
    auth.uid() = (
      select cm.pilot_id from public.crew_members cm
      where cm.id = crew_school_sources.crew_member_id
    )
  )
  with check (
    auth.uid() = (
      select cm.pilot_id from public.crew_members cm
      where cm.id = crew_school_sources.crew_member_id
    )
  );

grant select, insert, update, delete on public.crew_school_sources to authenticated;

-- ---------------------------------------------------------------------------
-- 2. crew_school_source_snapshots — sanitized fetched page snapshots.
-- ---------------------------------------------------------------------------
create table public.crew_school_source_snapshots (
  id             uuid    primary key default gen_random_uuid(),
  crew_member_id uuid    not null references public.crew_members(id) on delete cascade,
  -- 'calendar' for the district calendar page, 'bell' for each bell schedule.
  kind           text    not null check (kind in ('calendar', 'bell')),
  label          text    not null default '',
  url            text    not null,
  content_html   text,
  fetched_at     timestamptz,
  status         text    not null default 'pending' check (status in ('pending', 'ok', 'error')),
  error_note     text,
  created_at     timestamptz not null default now(),

  unique (crew_member_id, kind, label)
);

comment on table public.crew_school_source_snapshots is
  'Sanitized HTML snapshots of school calendar + bell schedule pages, fetched server-side.';

alter table public.crew_school_source_snapshots enable row level security;
alter table public.crew_school_source_snapshots force row level security;

-- The steward pilot manages their own crew member's snapshots.
create policy crew_school_source_snapshots_steward_all on public.crew_school_source_snapshots
  for all
  using (
    auth.uid() = (
      select cm.pilot_id from public.crew_members cm
      where cm.id = crew_school_source_snapshots.crew_member_id
    )
  )
  with check (
    auth.uid() = (
      select cm.pilot_id from public.crew_members cm
      where cm.id = crew_school_source_snapshots.crew_member_id
    )
  );

grant select, insert, update, delete on public.crew_school_source_snapshots to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Seed: Dawson Kamal's Cobb County calendar + Walton bell schedule links.
--    Guarded — only upserts when the crew member row actually exists.
-- ---------------------------------------------------------------------------
insert into public.crew_school_sources (
  crew_member_id, district, calendar_source_url, bell_schedules
)
select
  '91ea2b85-45c9-4f84-96c1-2829d30e5eb6'::uuid,
  'Cobb County School District',
  'https://www.cobbk12.org/page/calendars',
  '[{"label":"Daily","url":"https://www.cobbk12.org/walton/bell-schedule"},{"label":"WEB","url":"https://www.cobbk12.org/walton/walton-enrichment-block-web"}]'::jsonb
where exists (
  select 1 from public.crew_members
  where id = '91ea2b85-45c9-4f84-96c1-2829d30e5eb6'::uuid
)
on conflict (crew_member_id) do update set
  district            = excluded.district,
  calendar_source_url = excluded.calendar_source_url,
  bell_schedules      = excluded.bell_schedules,
  updated_at          = now();

-- ---------------------------------------------------------------------------
-- 4. Widen the nudges kind check: the weekly freshness script inserts
--    nudges with kind='school' when a school's calendar or bell schedule
--    links go stale. 001 only allows meeting/bill/credit/homework/grocery/
--    travel/health. This only widens the allowed set — existing rows unaffected.
-- ---------------------------------------------------------------------------
alter table public.nudges drop constraint if exists nudges_kind_check;
alter table public.nudges add constraint nudges_kind_check
  check (kind in ('meeting','bill','credit','homework','grocery','travel','health','school'));
