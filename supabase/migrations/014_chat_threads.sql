-- =============================================================================
-- 014_chat_threads.sql
-- Crystal Chat — thread persistence.
--
-- One active thread per day (enforced in /api/chat, not the DB), plus
-- pinned threads the pilot saves. chat_messages carries the persona that
-- answered so the mode pill stays truthful across reloads.
--
-- Also adds pilots.default_mode (the Crystal/Fireball preference from the
-- module spec §4 — chat preferences read at session start).
--
-- NOTE: originally numbered 013; renamed to 014 on 2026-10-13 after the
-- calendar team claimed 013. Do not renumber without coordinating.
--
-- RUN: paste into the Supabase dashboard SQL editor AFTER 013_calendar.sql.
-- =============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. chat_threads — one row per conversation thread, owned by the pilot.
-- ---------------------------------------------------------------------------
create table if not exists public.chat_threads (
  id         uuid        primary key default gen_random_uuid(),
  pilot_id   uuid        not null references public.pilots(id) on delete cascade,
  -- Short label for the drawer, e.g. the first user message, truncated.
  title      text,
  pinned     boolean     not null default false,
  created_at timestamptz not null default now(),
  -- Bumped on every new message so the drawer sorts by recency.
  updated_at timestamptz not null default now()
);

comment on table public.chat_threads is
  'Crystal Chat threads. One active thread per day (API-enforced), plus pinned threads the pilot saves.';

-- ---------------------------------------------------------------------------
-- 2. chat_messages — the messages inside a thread.
-- ---------------------------------------------------------------------------
create table if not exists public.chat_messages (
  id         uuid        primary key default gen_random_uuid(),
  thread_id  uuid        not null references public.chat_threads(id) on delete cascade,
  role       text        not null check (role in ('user', 'assistant')),
  text       text        not null,
  -- Which persona answered (assistant messages). Drives the mode pill.
  persona    text        check (persona in ('crystal', 'fireball')),
  created_at timestamptz not null default now()
);

comment on table public.chat_messages is
  'Messages inside a chat thread. persona records which mode answered.';

comment on column public.chat_messages.persona is
  'crystal or fireball — which persona answered this message (assistant rows only).';

-- ---------------------------------------------------------------------------
-- 3. pilots.default_mode — the pilot's preferred chat mode (spec §4).
-- ---------------------------------------------------------------------------
alter table public.pilots
  add column if not exists default_mode text not null default 'crystal'
    check (default_mode in ('crystal', 'fireball'));

comment on column public.pilots.default_mode is
  'Pilot''s preferred chat mode: crystal (warm, default) or fireball (direct).';

-- ---------------------------------------------------------------------------
-- Indexes
-- ---------------------------------------------------------------------------
create index if not exists idx_chat_threads_pilot_updated
  on public.chat_threads (pilot_id, updated_at desc);

create index if not exists idx_chat_messages_thread_created
  on public.chat_messages (thread_id, created_at);

-- ---------------------------------------------------------------------------
-- RLS — pilots see only their own threads and messages.
-- ---------------------------------------------------------------------------
alter table public.chat_threads  enable row level security;
alter table public.chat_messages enable row level security;

alter table public.chat_threads  force row level security;
alter table public.chat_messages force row level security;

drop policy if exists chat_threads_pilot_all on public.chat_threads;
create policy chat_threads_pilot_all on public.chat_threads
  for all using (auth.uid() = pilot_id) with check (auth.uid() = pilot_id);

-- Messages are scoped through their thread's pilot — one rule covers
-- select/insert/update/delete.
drop policy if exists chat_messages_pilot_all on public.chat_messages;
create policy chat_messages_pilot_all on public.chat_messages
  for all
  using (
    auth.uid() = (
      select t.pilot_id from public.chat_threads t
      where t.id = chat_messages.thread_id
    )
  )
  with check (
    auth.uid() = (
      select t.pilot_id from public.chat_threads t
      where t.id = chat_messages.thread_id
    )
  );

-- ---------------------------------------------------------------------------
-- GRANTS — auto-expose is OFF, so nothing is reachable until granted here.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.chat_threads  to authenticated;
grant select, insert, update, delete on public.chat_messages to authenticated;
