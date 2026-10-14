-- =============================================================================
-- 038_todo_reminder_sent.sql — Rich To-Do v1: reminder delivery bookkeeping.
--
-- Adds public.todos.reminder_sent_at — stamped when a reminder email goes
-- out so the /api/todos/reminders cron never double-sends. Clearing
-- reminder_at (or setting a new one) should also clear this column; the
-- reminders route and the client both maintain that invariant.
--
-- RUN: paste into the Supabase dashboard SQL editor AFTER 037.
-- =============================================================================

alter table public.todos
  add column if not exists reminder_sent_at timestamptz;

comment on column public.todos.reminder_sent_at is
  'When the last reminder for this todo was sent. Reset whenever reminder_at changes.';

create index if not exists idx_todos_reminder_due
  on public.todos (reminder_at)
  where reminder_at is not null
    and reminder_sent_at is null
    and done = false
    and deleted_at is null;
