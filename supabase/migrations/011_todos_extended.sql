-- =============================================================================
-- 011_todos_extended.sql
-- Cockpit — extended to-do fields (Team B, Phase 1: To-dos).
--
-- Adds to public.todos (idempotent — safe to run more than once):
--   priority  text    — how urgent the pilot feels this is
--                       ('low' | 'medium' | 'high', NULL = no priority set).
--   labels    text[]  — free-form tags like 'home', 'work', 'dawson'.
--                       Defaults to an empty array, never NULL.
--   notes     text    — longer detail the pilot wants to keep with the task.
--
-- RUN: paste into the Supabase SQL editor AFTER 006_weather_pilot_prefs.sql.
-- (Numbered 007 because 006 is taken by the weather pilot-prefs migration.)
-- =============================================================================

alter table public.todos
  add column if not exists priority text
    check (priority in ('low', 'medium', 'high'));

alter table public.todos
  add column if not exists labels text[] not null default '{}';

alter table public.todos
  add column if not exists notes text;

comment on column public.todos.priority is
  'Urgency of the task: low, medium, or high. NULL means the pilot never set one.';

comment on column public.todos.labels is
  'Free-form tags for the task (e.g. home, work, dawson). Empty array when untagged.';

comment on column public.todos.notes is
  'Longer detail the pilot wants to keep with the task. NULL when empty.';
