-- =============================================================================
-- 007_nudges.sql — Phase 1 nudge engine schema.
--
-- Context: migration 001 created public.nudges with an early shape
-- (kind / title / detail / priority / scheduled_for / delivered_at /
-- dismissed_at / created_at). The Phase 1 nudge engine needs the full
-- pipeline columns: category, score, dedup_key, source, source_ref,
-- status, snoozed_until, expires_at.
--
-- This migration ADDS the new columns and backfills them from the legacy
-- ones. The legacy columns are KEPT (not dropped): existing admin views
-- read dismissed_at, and the engine writes both models so old and new
-- readers stay consistent. A later cleanup migration may drop the legacy
-- columns once every reader uses status/category.
--
-- Also creates public.nudge_preferences (per-pilot quiet hours, minimum
-- score, per-category enable flags, quiet-hours breakthrough opt-in).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Extend public.nudges with the Phase 1 pipeline columns.
-- ---------------------------------------------------------------------------
alter table public.nudges
  add column if not exists category      text,
  add column if not exists body          text,
  add column if not exists score         numeric,
  add column if not exists dedup_key     text,
  add column if not exists source        text    not null default 'system',
  add column if not exists source_ref    jsonb   not null default '{}'::jsonb,
  add column if not exists status        text    not null default 'pending',
  add column if not exists snoozed_until timestamptz,
  add column if not exists expires_at    timestamptz;

-- Backfill the new columns from the legacy shape. Only rows that have not
-- been migrated yet (category is null) are touched, so re-running the
-- backfill after a partial failure is safe.
update public.nudges
set
  category = case kind
    when 'meeting'  then 'meeting'
    when 'bill'     then 'bill'
    when 'credit'   then 'bill'
    when 'homework' then 'todo'
    when 'grocery'  then 'todo'
    when 'travel'   then 'system'
    when 'health'   then 'health'
    else 'system'
  end,
  body = detail,
  score = case priority
    when 'urgent' then 90
    when 'high'   then 70
    when 'low'    then 30
    else 50
  end,
  status = case
    when dismissed_at is not null then 'acknowledged'
    when delivered_at is not null then 'delivered'
    else 'pending'
  end
where category is null;

-- Lock in the new model for future rows.
alter table public.nudges
  alter column category set not null,
  alter column category set default 'system',
  alter column score set default 0;

alter table public.nudges
  add constraint nudges_category_check
    check (category in ('meeting','bill','weather','todo','school','health','system'));

alter table public.nudges
  add constraint nudges_status_check
    check (status in ('pending','delivered','acknowledged','snoozed','expired','muted'));

comment on column public.nudges.category is
  'What the nudge is about: meeting | bill | weather | todo | school | health | system.';
comment on column public.nudges.score is
  'importance x urgency, computed by the nudge engine (src/lib/nudges/engine.ts).';
comment on column public.nudges.dedup_key is
  'Stable key per underlying event, e.g. meeting:<event_id>. One live nudge per (pilot_id, dedup_key).';
comment on column public.nudges.source is
  'Producing module: calendar | bills | weather | todos | school | system | crystal.';
comment on column public.nudges.status is
  'pending | delivered | acknowledged | snoozed | expired | muted.';

-- The dedupe guarantee: at most one LIVE nudge per (pilot, dedup_key).
-- Expired/muted rows are excluded so an event can nudge again later;
-- NULL dedup_keys never conflict (producers must always send a key).
create unique index if not exists uq_nudges_pilot_dedup_live
  on public.nudges (pilot_id, dedup_key)
  where status not in ('expired','muted') and dedup_key is not null;

create index if not exists idx_nudges_pilot_status_scheduled
  on public.nudges (pilot_id, status, scheduled_for);

-- ---------------------------------------------------------------------------
-- 2. public.nudge_preferences — per-pilot engine tuning.
-- ---------------------------------------------------------------------------
create table if not exists public.nudge_preferences (
  pilot_id             uuid    primary key references public.pilots(id) on delete cascade,
  -- Per-category enabled flags, e.g. '{"bill": false}'. A category absent
  -- from the map is ENABLED (opt-out, never dark patterns).
  categories           jsonb   not null default '{}'::jsonb,
  -- Nudges scoring below this are swallowed silently.
  min_score            numeric not null default 0,
  -- Quiet hours, pilot-local, HH:MM. Defaults 22:00-07:00.
  quiet_hours_start    time    not null default time '22:00',
  quiet_hours_end      time    not null default time '07:00',
  -- Urgent-tier nudges may break quiet hours only when the pilot opts in.
  breakthrough_allowed boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

comment on table public.nudge_preferences is
  'Per-pilot nudge engine tuning: quiet hours, minimum score, per-category on/off, quiet-hours breakthrough opt-in.';

alter table public.nudge_preferences enable row level security;
alter table public.nudge_preferences force row level security;

create policy nudge_preferences_pilot_all on public.nudge_preferences
  for all using (auth.uid() = pilot_id) with check (auth.uid() = pilot_id);

grant select, insert, update, delete on public.nudge_preferences to authenticated;
