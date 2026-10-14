-- =============================================================================
-- 025_calendar_sync_status.sql
-- Cockpit — record the last calendar sync failure on the connection row.
--
-- The shared sync engine (src/lib/calendar-sync.ts) writes a plain-English
-- message here whenever a connection's sync fails, and clears it (null) on
-- the next successful sync. The Calendar UI reads this column to explain
-- "needs attention" states without jargon. Additive: no data migration.
--
-- RUN: paste into Supabase SQL editor (Meheldi runs migrations).
-- =============================================================================

alter table public.calendar_connections
  add column if not exists last_sync_error text;

comment on column public.calendar_connections.last_sync_error is
  'Plain-English message from the last failed sync; null when the last sync succeeded.';
