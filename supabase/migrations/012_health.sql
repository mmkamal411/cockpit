-- =============================================================================
-- 012_health.sql
-- Cockpit — health basics module (Phase 2, v1: manual logging only).
--
-- PRIVACY: all tables owner-only RLS, forced. No cross-pilot reads anywhere.
-- Health data NEVER appears in logs — triggers and comments carry no values.
--
-- RUN: paste into the Supabase dashboard SQL editor AFTER 007_shopping.sql
-- and press Run. Expect "Success. No rows returned."
-- =============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. health_logs — unified event log. metric in (weight, sleep, water,
--    exercise). meta carries extras (see comment). source is 'manual' in
--    v1; reserved for the future HealthKit sync module.
-- ---------------------------------------------------------------------------
create table public.health_logs (
  id         uuid    primary key default gen_random_uuid(),
  pilot_id   uuid    not null references public.pilots(id) on delete cascade,
  metric     text    not null check (metric in ('weight','sleep','water','exercise')),
  logged_at  timestamptz not null default now(),
  value      numeric not null,
  unit       text    not null,
  meta       jsonb   not null default '{}'::jsonb,
  source     text    not null default 'manual' check (source in ('manual','healthkit')),
  created_at timestamptz not null default now()
);

comment on table public.health_logs is
  'Pilot-owned manual health logbook. meta: sleep -> {bedtime, wake_time, quality 1-5}; exercise -> {type, minutes, effort 1-5}; water -> {glasses}; weight -> {}.';
comment on column public.health_logs.source is
  'Where the entry came from. v1 writes manual only; healthkit reserved for the future sync module.';

-- ---------------------------------------------------------------------------
-- 2. health_goals — one active row per metric
-- ---------------------------------------------------------------------------
create table public.health_goals (
  id           uuid    primary key default gen_random_uuid(),
  pilot_id     uuid    not null references public.pilots(id) on delete cascade,
  metric       text    not null check (metric in ('weight','sleep','water','exercise')),
  target_value numeric not null,
  unit         text    not null,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  unique (pilot_id, metric)
);

comment on table public.health_goals is
  'Pilot-set goals. One active row per (pilot, metric); upsert on save.';

-- ---------------------------------------------------------------------------
-- 3. health_streaks — maintained by trigger; clients read only
-- ---------------------------------------------------------------------------
create table public.health_streaks (
  id               uuid    primary key default gen_random_uuid(),
  pilot_id         uuid    not null references public.pilots(id) on delete cascade,
  metric           text    not null check (metric in ('weight','sleep','water','exercise')),
  current_streak   integer not null default 0,
  best_streak      integer not null default 0,
  last_logged_date date,
  unique (pilot_id, metric)
);

comment on table public.health_streaks is
  'Consecutive-day streaks per metric. Maintained by trigger on health_logs; clients never write directly.';

-- ---------------------------------------------------------------------------
-- 4. Streak trigger — consecutive-day counting on local dates.
--    A log today extends the streak if yesterday was logged; otherwise
--    resets to 1. Idempotent per (pilot, metric, date).
-- ---------------------------------------------------------------------------
create or replace function public.health_bump_streak()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (new.logged_at at time zone 'America/New_York')::date;
  v_row   record;
begin
  select * into v_row
  from public.health_streaks
  where pilot_id = new.pilot_id and metric = new.metric
  for update;

  if not found then
    insert into public.health_streaks (pilot_id, metric, current_streak, best_streak, last_logged_date)
    values (new.pilot_id, new.metric, 1, 1, v_today);
    return new;
  end if;

  if v_row.last_logged_date = v_today then
    -- Already counted today; leave the streak alone.
    return new;
  elsif v_row.last_logged_date = v_today - 1 then
    update public.health_streaks
    set current_streak   = v_row.current_streak + 1,
        best_streak      = greatest(v_row.best_streak, v_row.current_streak + 1),
        last_logged_date = v_today
    where id = v_row.id;
  else
    update public.health_streaks
    set current_streak   = 1,
        best_streak      = greatest(v_row.best_streak, 1),
        last_logged_date = v_today
    where id = v_row.id;
  end if;

  return new;
end;
$$;

comment on function public.health_bump_streak() is
  'Trigger function: maintains health_streaks on health_logs insert. Carries no health values in comments or logs.';

drop trigger if exists trg_health_bump_streak on public.health_logs;
create trigger trg_health_bump_streak
  after insert on public.health_logs
  for each row execute function public.health_bump_streak();

-- ---------------------------------------------------------------------------
-- RLS — forced, owner-only. No grantee policies: health is never shared.
-- ---------------------------------------------------------------------------
alter table public.health_logs    enable row level security;
alter table public.health_logs    force row level security;
alter table public.health_goals   enable row level security;
alter table public.health_goals   force row level security;
alter table public.health_streaks enable row level security;
alter table public.health_streaks force row level security;

create policy health_logs_pilot_all on public.health_logs
  for all using (auth.uid() = pilot_id) with check (auth.uid() = pilot_id);

create policy health_goals_pilot_all on public.health_goals
  for all using (auth.uid() = pilot_id) with check (auth.uid() = pilot_id);

create policy health_streaks_pilot_read on public.health_streaks
  for select using (auth.uid() = pilot_id);

-- ---------------------------------------------------------------------------
-- Grants — clients never write health_streaks directly (trigger maintains it).
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.health_logs  to authenticated;
grant select, insert, update, delete on public.health_goals to authenticated;
grant select on public.health_streaks to authenticated;

-- Helpful indexes.
create index idx_health_logs_pilot_metric_logged
  on public.health_logs (pilot_id, metric, logged_at desc);
