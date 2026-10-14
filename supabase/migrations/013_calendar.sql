-- =============================================================================
-- 013_calendar.sql
-- Cockpit — Calendar module (Phase 1).
--
-- Google Calendar sync cache: connections (OAuth), calendars (per-account
-- calendar list), events (cached, incrementally synced).
-- Google is the source of truth; Supabase is the fast local cache.
--
-- RUN: paste into Supabase SQL editor AFTER 012_health.sql.
-- =============================================================================

create table public.calendar_connections (
  id                    uuid primary key default gen_random_uuid(),
  pilot_id              uuid not null references public.pilots(id) on delete cascade,
  provider              text not null default 'google' check (provider = 'google'),
  provider_account_email text,
  refresh_token_enc     text,
  sync_token            text,
  last_synced_at        timestamptz,
  status                text not null default 'active'
    check (status in ('active', 'error', 'revoked')),
  created_at            timestamptz not null default now(),
  unique (pilot_id, provider, provider_account_email)
);

comment on table public.calendar_connections is
  'OAuth connections to calendar providers. Refresh tokens are encrypted server-side.';

create table public.calendars (
  id                   uuid primary key default gen_random_uuid(),
  connection_id        uuid not null references public.calendar_connections(id) on delete cascade,
  provider_calendar_id text not null,
  name                 text not null,
  color                text,
  visible              boolean not null default true,
  kind                 text not null default 'personal'
    check (kind in ('personal', 'work', 'family', 'school')),
  created_at           timestamptz not null default now(),
  unique (connection_id, provider_calendar_id)
);

comment on table public.calendars is
  'Per-account calendar list. kind=school rows appear only when children are linked.';

create table public.calendar_events (
  id                uuid primary key default gen_random_uuid(),
  calendar_id       uuid not null references public.calendars(id) on delete cascade,
  provider_event_id text not null,
  title             text not null default '(no title)',
  starts_at         timestamptz not null,
  ends_at           timestamptz not null,
  all_day           boolean not null default false,
  location          text,
  description       text,
  attendees         jsonb not null default '[]'::jsonb,
  status            text not null default 'confirmed'
    check (status in ('confirmed', 'tentative', 'cancelled')),
  updated_at        timestamptz not null default now(),
  unique (calendar_id, provider_event_id)
);

create index idx_calendar_events_calendar_time
  on public.calendar_events (calendar_id, starts_at);

comment on table public.calendar_events is
  'Cached calendar events. Google is the source of truth; this is the fast local read cache.';

alter table public.calendar_connections enable row level security;
alter table public.calendar_connections force row level security;

create policy calendar_connections_owner on public.calendar_connections
  for all
  using (auth.uid() = pilot_id)
  with check (auth.uid() = pilot_id);

alter table public.calendars enable row level security;
alter table public.calendars force row level security;

create policy calendars_owner on public.calendars
  for all
  using (
    auth.uid() = (
      select cc.pilot_id from public.calendar_connections cc
      where cc.id = calendars.connection_id
    )
  )
  with check (
    auth.uid() = (
      select cc.pilot_id from public.calendar_connections cc
      where cc.id = calendars.connection_id
    )
  );

alter table public.calendar_events enable row level security;
alter table public.calendar_events force row level security;

create policy calendar_events_owner on public.calendar_events
  for all
  using (
    auth.uid() = (
      select cc.pilot_id
      from public.calendar_connections cc
      join public.calendars c on c.connection_id = cc.id
      where c.id = calendar_events.calendar_id
    )
  )
  with check (
    auth.uid() = (
      select cc.pilot_id
      from public.calendar_connections cc
      join public.calendars c on c.connection_id = cc.id
      where c.id = calendar_events.calendar_id
    )
  );

grant select, insert, update, delete on public.calendar_connections to authenticated;
grant select, insert, update, delete on public.calendars to authenticated;
grant select, insert, update, delete on public.calendar_events to authenticated;
