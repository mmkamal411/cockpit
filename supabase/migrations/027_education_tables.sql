-- =============================================================================
-- 027_education_tables.sql
-- Cockpit — child education UX tables.
--
--   school_schedules  — bell schedules, district-keyed (Walton, Cobb, etc.)
--   district_calendars — district calendar events (no-school days, etc.)
--   class_resources   — per-class resources (links + uploads, 13 types)
--   pilot_settings    — JSONB settings store (7 instrument stations)
--
-- NOTE: checkins table is defined in 027_checkins_class_resources.sql (Phase B)
-- and is intentionally NOT redefined here to avoid a schema collision.
--
-- DECISIONS APPLIED (Meheldi 2026-10-13 12:26 EDT):
--   D1: check-in VISIBLE by default (shared); private opt-in exists
--   D2: safety floor for 13-17 (handled in app code, not schema)
--   D3: full check-in text visible to parent for 13-15
--   D4: School tab on child add (handled in app code)
--   D5: link-code only for v1 (link_codes table already exists in 008)
--
-- RUN: paste into Supabase SQL editor (project: cockpit / hwnesewathbnfvoxtbqh)
-- AFTER 026_health_steps.sql. Expect "Success. No rows returned."
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. school_schedules — bell schedules, district-keyed.
--    One row per (district_key, schedule_type, period).
--    The NOW strip reads the current period from this table.
-- ---------------------------------------------------------------------------
create table public.school_schedules (
  id            uuid    primary key default gen_random_uuid(),
  -- District key (e.g. 'walton', 'cobb') — NOT Cobb-only, district-agnostic.
  district_key  text    not null,
  -- 'daily' or 'web' (or other schedule types per district).
  schedule_type text    not null default 'daily',
  -- Period name (e.g. '1st', '2nd', 'Lunch A').
  period_name   text    not null,
  -- Period order for sorting.
  period_order  int     not null default 0,
  -- HH:MM 24h local time.
  start_time    text    not null,
  end_time      text    not null,
  created_at    timestamptz not null default now(),
  unique (district_key, schedule_type, period_name)
);

comment on table public.school_schedules is
  'Bell schedules, district-keyed. The NOW strip reads the current period from here.';

-- Seed: Walton High School daily schedule (from cobbk12.org, verified 2026-10-13).
-- Times are approximate — the NOW strip treats these as guidance, not gospel.
insert into public.school_schedules (district_key, schedule_type, period_name, period_order, start_time, end_time) values
  ('walton', 'daily', '1st', 1, '08:20', '09:50'),
  ('walton', 'daily', '2nd', 2, '09:57', '11:27'),
  ('walton', 'daily', '3rd', 3, '11:34', '13:34'),
  ('walton', 'daily', '4th', 4, '13:41', '15:11')
on conflict (district_key, schedule_type, period_name) do nothing;

-- RLS: readable by all authenticated pilots (reference data, not personal).
alter table public.school_schedules enable row level security;
create policy school_schedules_read_all on public.school_schedules
  for select using (auth.role() = 'authenticated');

-- ---------------------------------------------------------------------------
-- 2. district_calendars — district calendar events.
--    Powers the "This week" section + nudge suppression on no-school days.
-- ---------------------------------------------------------------------------
create table public.district_calendars (
  id            uuid    primary key default gen_random_uuid(),
  district_key  text    not null,
  -- Event name (e.g. 'Fall Break', 'Early Release').
  event_name    text    not null,
  -- Event date (single-day) or range start.
  event_date    date    not null,
  -- Optional range end (null = single day).
  end_date      date,
  -- Category: 'no_school', 'early_release', 'holiday', 'event'.
  category      text    not null default 'event'
    check (category in ('no_school', 'early_release', 'holiday', 'event')),
  created_at    timestamptz not null default now()
);

comment on table public.district_calendars is
  'District calendar events. Drives "This week" + nudge suppression on no-school days.';

alter table public.district_calendars enable row level security;
create policy district_calendars_read_all on public.district_calendars
  for select using (auth.role() = 'authenticated');

-- 3. checkins — SKIPPED: defined in 027_checkins_class_resources.sql (Phase B).
--    That file's schema is canonical (API built against it). This file does
--    not redefine it to avoid a collision.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 4. class_resources — per-class resources (links + uploads).
--    13 types: khan, youtube, quizlet, kahoot, blooket, desmos, deltamath,
--    ap_classroom, clever, ebook, cheat_sheet, game, other.
-- ---------------------------------------------------------------------------
create table public.class_resources (
  id             uuid    primary key default gen_random_uuid(),
  crew_member_id uuid    not null references public.crew_members(id) on delete cascade,
  pilot_id       uuid    not null references public.pilots(id) on delete cascade,
  -- Class name as the sync worker reports it (e.g. 'Geometry').
  class_name     text    not null,
  -- Unit tag (e.g. 'Unit 3: Triangles').
  unit_tag       text,
  -- Resource type (13 types + other).
  resource_type  text    not null default 'other'
    check (resource_type in (
      'khan', 'youtube', 'quizlet', 'kahoot', 'blooket', 'desmos',
      'deltamath', 'ap_classroom', 'clever', 'ebook', 'cheat_sheet',
      'game', 'other'
    )),
  title          text    not null,
  -- URL (for link-type resources) or storage path (for uploads).
  url            text,
  storage_path   text,
  -- 'link' or 'upload'.
  input_kind     text    not null default 'link'
    check (input_kind in ('link', 'upload')),
  -- Usage loop: "used it" / "helpful" taps feed Path-to-90, sink stale.
  used_count     int     not null default 0,
  helpful_count  int     not null default 0,
  -- Who added it: 'parent', 'child', or 'crystal' (curated).
  added_by       text    not null default 'parent'
    check (added_by in ('parent', 'child', 'crystal')),
  -- Child uploads are private-by-default (per plan §5).
  is_private     boolean not null default false,
  created_at     timestamptz not null default now()
);

comment on table public.class_resources is
  'Per-class resources (links + uploads). Usage loop taps feed Path-to-90. Child uploads private-by-default.';

alter table public.class_resources enable row level security;
create policy class_resources_pilot_all on public.class_resources
  for all using (auth.uid() = pilot_id) with check (auth.uid() = pilot_id);
grant select, insert, update, delete on public.class_resources to authenticated;

-- ---------------------------------------------------------------------------
-- 5. pilot_settings — JSONB settings store (7 instrument stations).
--    One row per (pilot, namespace). Namespaces: profile, connections,
--    alerts, crystal, cockpit, family, privacy.
-- ---------------------------------------------------------------------------
create table public.pilot_settings (
  pilot_id   uuid    not null references public.pilots(id) on delete cascade,
  namespace  text    not null
    check (namespace in (
      'profile', 'connections', 'alerts', 'crystal',
      'cockpit', 'family', 'privacy'
    )),
  settings   jsonb   not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (pilot_id, namespace)
);

comment on table public.pilot_settings is
  'Pilot settings, one row per (pilot, namespace). 7 namespaces = 7 instrument stations.';

alter table public.pilot_settings enable row level security;
create policy pilot_settings_pilot_all on public.pilot_settings
  for all using (auth.uid() = pilot_id) with check (auth.uid() = pilot_id);
grant select, insert, update, delete on public.pilot_settings to authenticated;
