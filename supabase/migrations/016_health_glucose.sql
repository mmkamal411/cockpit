-- =============================================================================
-- 016_health_glucose.sql
-- Cockpit — health module: blood glucose + lab A1C tracking.
--
-- Extends the unified health_logs event table with two new metric types:
--   blood_glucose — manual readings in mg/dL; meta.context in
--                   (fasting, before_meal, after_meal, bedtime, other).
--                   Multiple readings per day; appends like water/sleep.
--   a1c_lab       — manual lab A1C results in %; meta.lab_name optional.
--                   Occasional entries; excluded from streak counting.
--
-- PRIVACY: same owner-only RLS as 012 (unchanged). No values in logs/comments.
--
-- RUN: paste into the Supabase dashboard SQL editor AFTER 014_chat_threads.sql
-- and press Run. Expect "Success. No rows returned."
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. health_logs: widen the metric check to the two new types.
-- ---------------------------------------------------------------------------
alter table public.health_logs drop constraint if exists health_logs_metric_check;
alter table public.health_logs
  add constraint health_logs_metric_check
  check (metric in ('weight','sleep','water','exercise','blood_glucose','a1c_lab'));

comment on table public.health_logs is
  'Pilot-owned manual health logbook. meta: sleep -> {bedtime, wake_time, quality 1-5}; exercise -> {type, minutes, effort 1-5}; water -> {glasses}; weight -> {}; blood_glucose -> {context: fasting|before_meal|after_meal|bedtime|other}; a1c_lab -> {lab_name?}.';

-- ---------------------------------------------------------------------------
-- 2. health_streaks: blood_glucose earns daily streaks; a1c_lab does not
--    (lab results are occasional, not a daily habit).
-- ---------------------------------------------------------------------------
alter table public.health_streaks drop constraint if exists health_streaks_metric_check;
alter table public.health_streaks
  add constraint health_streaks_metric_check
  check (metric in ('weight','sleep','water','exercise','blood_glucose'));

-- ---------------------------------------------------------------------------
-- 3. Streak trigger: skip a1c_lab — a lab result must not start or extend
--    a streak row, and must not fail the insert via the streaks check.
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
  -- Lab A1C entries are occasional measurements, not daily habits.
  if new.metric = 'a1c_lab' then
    return new;
  end if;

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

-- Note: health_goals keeps its original 4-metric check on purpose —
-- glucose targets are ranges, not single values, and are out of scope.
