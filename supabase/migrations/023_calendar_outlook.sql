-- =============================================================================
-- 023_calendar_outlook.sql
-- Cockpit — allow 'outlook' as a calendar_connections provider.
--
-- 013_calendar.sql pinned the provider CHECK to 'google'. The Microsoft
-- Graph sync engine stores its OAuth connections in the same table, so the
-- check now admits both providers. No data migration: existing rows are
-- untouched.
--
-- RUN: paste into Supabase SQL editor (Meheldi runs migrations).
-- =============================================================================

do $$
declare
  cname text;
begin
  select conname into cname
  from pg_constraint
  where conrelid = 'public.calendar_connections'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%provider%';

  if cname is not null then
    execute format('alter table public.calendar_connections drop constraint %I', cname);
  end if;
end $$;

alter table public.calendar_connections
  add constraint calendar_connections_provider_check
  check (provider in ('google', 'outlook'));

comment on column public.calendar_connections.provider is
  'Calendar provider: google (Google Calendar) or outlook (Microsoft Graph).';
