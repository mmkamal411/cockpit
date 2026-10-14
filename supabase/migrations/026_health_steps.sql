-- =============================================================================
-- 026_health_steps.sql
-- Cockpit — health module: step counts as a first-class metric.
--
-- Adds 'steps' to the three metric check constraints:
--   health_logs   — individual step entries (manual or HealthKit); multiple
--                   entries per day append and accumulate (never upsert).
--   health_streaks — steps earn daily streaks like water/sleep/exercise.
--   health_goals  — pilots can set a daily step target (default unit "steps").
--
-- PRIVACY: same owner-only RLS as 012 (unchanged). No values in logs/comments.
--
-- RUN: paste into the Supabase dashboard SQL editor AFTER 025 and press Run.
-- Expect "Success. No rows returned."
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. health_logs: widen the metric check to include 'steps'.
--    (Current value from 016: weight, sleep, water, exercise, blood_glucose, a1c_lab)
-- ---------------------------------------------------------------------------
alter table public.health_logs drop constraint if exists health_logs_metric_check;
alter table public.health_logs
  add constraint health_logs_metric_check
  check (metric in ('weight','sleep','water','exercise','blood_glucose','a1c_lab','steps'));

comment on table public.health_logs is
  'Pilot-owned manual health logbook. meta: sleep -> {bedtime, wake_time, quality 1-5}; exercise -> {type, minutes, effort 1-5}; water -> {glasses}; weight -> {}; blood_glucose -> {context: fasting|before_meal|after_meal|bedtime|other}; a1c_lab -> {lab_name?}; steps -> {}. Steps append: several entries per day sum to the day''s total.';

-- ---------------------------------------------------------------------------
-- 2. health_streaks: steps earn daily streaks.
--    (Current value from 016: weight, sleep, water, exercise, blood_glucose)
-- ---------------------------------------------------------------------------
alter table public.health_streaks drop constraint if exists health_streaks_metric_check;
alter table public.health_streaks
  add constraint health_streaks_metric_check
  check (metric in ('weight','sleep','water','exercise','blood_glucose','steps'));

-- ---------------------------------------------------------------------------
-- 3. health_goals: allow a daily step target.
--    (Original inline check from 012: weight, sleep, water, exercise.
--     Postgres auto-names an inline column check "<table>_<column>_check".)
-- ---------------------------------------------------------------------------
alter table public.health_goals drop constraint if exists health_goals_metric_check;
alter table public.health_goals
  add constraint health_goals_metric_check
  check (metric in ('weight','sleep','water','exercise','steps'));

comment on table public.health_goals is
  'One active target per metric per pilot. Steps goal: daily step count target.';
