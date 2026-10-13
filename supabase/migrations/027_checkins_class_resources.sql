-- =============================================================================
-- 027_checkins_class_resources.sql
-- Cockpit — Phase B (child education UX).
--
-- 1. checkins — daily check-in rows (shared parent-visible channel +
--    "Just for me" private channel). D1: shared is the DEFAULT; private is
--    opt-in. D3: full check-in text visible to the parent for 13–15.
-- 2. class_resources — per-class Links tab: 13 resource types, unit-tagged,
--    kind file|link, usage loop ("used it / helpful" taps). Child uploads
--    are private-by-default; parent uploads visible.
-- 3. storage bucket `class-files` for handout uploads (<uid>/<slug>/<date>/<file>).
--
-- RUN: paste into the Supabase dashboard SQL editor (project: cockpit).
-- RLS mirrors path_to_90_checks: steward full access; grantees read with
-- grades scope; the linked child pilot reads/writes their own rows.
-- =============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. checkins
-- ---------------------------------------------------------------------------
create table if not exists public.checkins (
  id             uuid    primary key default gen_random_uuid(),
  crew_member_id uuid    not null references public.crew_members(id) on delete cascade,
  -- Nullable: a general daily check-in, or tied to one class.
  class_name     text,
  checkin_date   date    not null default current_date,
  -- Quick-tap chips (stored as text arrays): what worked / confusing / due.
  worked_on      text[]  not null default '{}',
  confusing      text[]  not null default '{}',
  due_next       text[]  not null default '{}',
  -- Optional free text. Full text visible to the parent for 13–15 (D3).
  note           text,
  -- 'shared' (parent-visible, DEFAULT per D1) or 'private' ("Just for me").
  channel        text    not null default 'shared'
                 check (channel in ('shared', 'private')),
  -- Who wrote it: 'pilot' (parent) or 'crew' (the child).
  created_by     text    not null default 'crew'
                 check (created_by in ('pilot', 'crew')),
  created_at     timestamptz not null default now(),

  unique (crew_member_id, class_name, checkin_date, channel, created_by)
);

comment on table public.checkins is
  'Daily check-ins. Two channels: shared (parent-visible, default) and private (child-only).';

alter table public.checkins enable row level security;
alter table public.checkins force row level security;

-- Steward pilot: full access to their crew member's check-ins.
create policy checkins_steward_all on public.checkins
  for all
  using (
    auth.uid() = (
      select cm.pilot_id from public.crew_members cm
      where cm.id = checkins.crew_member_id
    )
  )
  with check (
    auth.uid() = (
      select cm.pilot_id from public.crew_members cm
      where cm.id = checkins.crew_member_id
    )
  );

-- Grantees with grades scope may read SHARED check-ins only.
create policy checkins_grantee_shared_select on public.checkins
  for select using (
    channel = 'shared'
    and exists (
      select 1 from public.crew_access_grants g
      where g.crew_member_id   = checkins.crew_member_id
        and g.grantee_pilot_id = auth.uid()
        and g.revoked_at is null
        and coalesce((g.scope ->> 'grades')::boolean, false)
    )
  );

grant select, insert, update, delete on public.checkins to authenticated;

-- ---------------------------------------------------------------------------
-- 2. class_resources — Links tab + Files tab metadata
-- ---------------------------------------------------------------------------
create table if not exists public.class_resources (
  id             uuid    primary key default gen_random_uuid(),
  crew_member_id uuid    not null references public.crew_members(id) on delete cascade,
  class_name     text    not null,
  unit_tag       text,
  -- 'file' (uploaded to storage) or 'link' (URL).
  kind           text    not null check (kind in ('file', 'link')),
  title          text    not null,
  -- One of the 13 RESOURCE_TYPES ids (khan, youtube, quizlet, ...).
  resource_type  text    not null default 'other',
  url            text,
  storage_path   text,
  -- 'pilot' uploads are visible; 'crew' uploads are private-by-default.
  added_by       text    not null default 'pilot'
                 check (added_by in ('pilot', 'crew')),
  -- Usage loop: taps feed Path-to-90, sink stale resources.
  used_count     integer not null default 0,
  helpful_count  integer not null default 0,
  created_at     timestamptz not null default now()
);

comment on table public.class_resources is
  'Per-class resources (Links tab) + handout file metadata (Files tab).';

alter table public.class_resources enable row level security;
alter table public.class_resources force row level security;

create policy class_resources_steward_all on public.class_resources
  for all
  using (
    auth.uid() = (
      select cm.pilot_id from public.crew_members cm
      where cm.id = class_resources.crew_member_id
    )
  )
  with check (
    auth.uid() = (
      select cm.pilot_id from public.crew_members cm
      where cm.id = class_resources.crew_member_id
    )
  );

create policy class_resources_grantee_select on public.class_resources
  for select using (
    exists (
      select 1 from public.crew_access_grants g
      where g.crew_member_id   = class_resources.crew_member_id
        and g.grantee_pilot_id = auth.uid()
        and g.revoked_at is null
        and coalesce((g.scope ->> 'grades')::boolean, false)
    )
  );

grant select, insert, update, delete on public.class_resources to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Storage bucket for handouts: class-files
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('class-files', 'class-files', false)
on conflict (id) do nothing;

-- Steward pilot: full object access under their crew member's folder.
create policy "class_files_steward_all" on storage.objects
  for all
  using (
    bucket_id = 'class-files'
    and auth.uid() in (
      select cm.pilot_id from public.crew_members cm
      where (storage.foldername(name))[1] = cm.id::text
    )
  )
  with check (
    bucket_id = 'class-files'
    and auth.uid() in (
      select cm.pilot_id from public.crew_members cm
      where (storage.foldername(name))[1] = cm.id::text
    )
  );
