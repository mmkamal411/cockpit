-- =============================================================================
-- 024_todos_completed_at.sql
-- Cockpit — track when a todo was marked done.
--
-- The Today briefing's "Handled" section folds completed todos into "handled
-- today", but the table had no completion timestamp — every done todo ever
-- showed up as handled. This adds a nullable completed_at, maintained by
-- PUT /api/todos/[id] (done=true sets it, done=false clears it).
--
-- RUN: paste into Supabase SQL editor (Meheldi runs migrations).
-- =============================================================================

alter table public.todos
  add column if not exists completed_at timestamptz;

comment on column public.todos.completed_at is
  'When the pilot last marked this todo done. NULL when not done. Drives the Today briefing "Handled" section.';
