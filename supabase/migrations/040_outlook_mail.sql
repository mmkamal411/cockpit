-- =============================================================================
-- 040_outlook_mail.sql
-- Cockpit — Outlook school-email (Graph Mail) sync support.
--
-- 1. calendar_connections.status admits 'needs_reconsent': an Outlook
--    connection authorized BEFORE Mail.Read was added to the OAuth scope can
--    still sync calendars, but mail sync flags it until the pilot reconnects
--    (the connect route always asks consent, so one reconnect grants mail).
-- 2. calendar_connections.last_mail_sync_at: watermark for the mail sync.
-- 3. calendar_connections.granted_scopes backfill: 037 added the column for
--    tasks; rows connected before that have NULL. The mail sync treats NULL
--    granted_scopes on an outlook connection as "consented before Mail.Read"
--    -> needs_reconsent. (We do NOT mass-update status here: a legacy row
--    still syncs calendars fine; only the mail sync flags the scope gap.)
--
-- RUN: paste into Supabase SQL editor (Meheldi runs migrations).
-- =============================================================================

-- 1. Widen the status CHECK to admit 'needs_reconsent'.
do $$
declare
  cname text;
begin
  select conname into cname
  from pg_constraint
  where conrelid = 'public.calendar_connections'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%status%';

  if cname is not null then
    execute format('alter table public.calendar_connections drop constraint %I', cname);
  end if;
end $$;

alter table public.calendar_connections
  add constraint calendar_connections_status_check
  check (status in ('active', 'error', 'revoked', 'needs_reconsent'));

-- 2. Mail sync watermark.
alter table public.calendar_connections
  add column if not exists last_mail_sync_at timestamptz;

comment on column public.calendar_connections.last_mail_sync_at is
  'Last successful Graph mail sync for this connection; null when mail has never synced.';

comment on column public.calendar_connections.status is
  'active | error | revoked | needs_reconsent. needs_reconsent = the OAuth grant predates a scope the pilot asked to add (e.g. Mail.Read) — reconnect once and approve.';
