-- =============================================================================
-- 033_school_digital_schedules.sql
-- Cockpit — digital (parsed) school calendar + bell schedule storage.
--
-- Extends 031 (never edits it):
-- 1. crew_school_source_snapshots gains parsed_json / parsed_at /
--    parse_status / parse_note, and kind gains 'upload' (pilot photo/PDF).
-- 2. New table crew_school_calendar_events — the parsed, district-agnostic
--    calendar events (title + date range), one row per event.
-- 3. New private storage bucket school-source-uploads for pilot uploads,
--    with steward RLS mirroring the 031 policy pattern.
--
-- Numbered 033 because 032 is taken by 032_watchdog_sync_staleness.sql.
-- District-agnostic throughout: nothing here names any school or district.
--
-- RUN: paste into the Supabase dashboard SQL editor (project: cockpit)
-- Expect "Success. No rows returned."
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Parse-output columns on crew_school_source_snapshots.
-- ---------------------------------------------------------------------------
alter table public.crew_school_source_snapshots
  add column if not exists parsed_json jsonb,
  add column if not exists parsed_at timestamptz,
  add column if not exists parse_note text;

-- parse_status needs its check; add via a guarded block so re-runs are safe.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'crew_school_source_snapshots'
      and column_name = 'parse_status'
  ) then
    alter table public.crew_school_source_snapshots
      add column parse_status text not null default 'pending'
      check (parse_status in ('pending','ok','partial','error'));
  end if;
end $$;

comment on column public.crew_school_source_snapshots.parsed_json is
  'Digital parse output: calendar events array or bell schedule array (see parse_status).';
comment on column public.crew_school_source_snapshots.parse_status is
  'Parse health: pending (not attempted / waiting on tooling), ok, partial, error.';

-- 'upload' joins 'calendar'/'bell' as a snapshot kind (pilot photo/PDF).
alter table public.crew_school_source_snapshots
  drop constraint if exists crew_school_source_snapshots_kind_check;
alter table public.crew_school_source_snapshots
  add constraint crew_school_source_snapshots_kind_check
  check (kind in ('calendar','bell','upload'));

-- ---------------------------------------------------------------------------
-- 2. crew_school_calendar_events — parsed calendar events, district-agnostic.
-- ---------------------------------------------------------------------------
create table if not exists public.crew_school_calendar_events (
  id             uuid primary key default gen_random_uuid(),
  crew_member_id uuid not null references public.crew_members(id) on delete cascade,
  title          text not null,
  event_date     date not null,
  end_date       date,
  location       text,
  description    text,
  source_url     text,
  created_at     timestamptz not null default now()
);

comment on table public.crew_school_calendar_events is
  'Parsed school calendar events per crew member (district-agnostic digital output).';

create index if not exists crew_school_calendar_events_member_date
  on public.crew_school_calendar_events (crew_member_id, event_date);

alter table public.crew_school_calendar_events enable row level security;
alter table public.crew_school_calendar_events force row level security;

-- The steward pilot manages their own crew member's calendar events
-- (same pattern as the 031 steward policies).
drop policy if exists crew_school_calendar_events_steward_all
  on public.crew_school_calendar_events;
create policy crew_school_calendar_events_steward_all
  on public.crew_school_calendar_events
  for all
  using (
    auth.uid() = (
      select cm.pilot_id from public.crew_members cm
      where cm.id = crew_school_calendar_events.crew_member_id
    )
  )
  with check (
    auth.uid() = (
      select cm.pilot_id from public.crew_members cm
      where cm.id = crew_school_calendar_events.crew_member_id
    )
  );

grant select, insert, update, delete on public.crew_school_calendar_events to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Private storage bucket for pilot photo/PDF uploads of school pages.
--    Object paths are "<crew_member_id>/<file>" so the policy below can
--    verify stewardship from the path itself.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('school-source-uploads', 'school-source-uploads', false)
on conflict (id) do nothing;

drop policy if exists school_source_uploads_steward_all on storage.objects;
create policy school_source_uploads_steward_all on storage.objects
  for all
  using (
    bucket_id = 'school-source-uploads'
    and name ~ '^[0-9a-fA-F-]{36}/'
    and auth.uid() = (
      select cm.pilot_id from public.crew_members cm
      where cm.id = substring(name from 1 for 36)::uuid
    )
  )
  with check (
    bucket_id = 'school-source-uploads'
    and name ~ '^[0-9a-fA-F-]{36}/'
    and auth.uid() = (
      select cm.pilot_id from public.crew_members cm
      where cm.id = substring(name from 1 for 36)::uuid
    )
  );
