-- =============================================================================
-- 019_calendar_multiprovider.sql
-- Cockpit — Calendar multi-provider support (Phase 1.x).
--
-- Extends calendar_connections.provider beyond 'google' to include
-- 'outlook' (Microsoft Graph OAuth) and 'icloud' (Apple CalDAV with
-- app-specific password).
--
-- Credential storage (all encrypted with CALENDAR_TOKEN_KEY, AES-256-GCM):
--   google  -> refresh_token_enc = OAuth refresh token
--   outlook -> refresh_token_enc = OAuth refresh token
--   icloud  -> refresh_token_enc = app-specific password (NOT the Apple ID
--              password; user generates it at appleid.apple.com)
--
-- RUN: paste into Supabase SQL editor AFTER 018_security_phase0.sql.
-- =============================================================================

alter table public.calendar_connections
  drop constraint if exists calendar_connections_provider_check;

alter table public.calendar_connections
  add constraint calendar_connections_provider_check
  check (provider in ('google', 'outlook', 'icloud'));

comment on column public.calendar_connections.refresh_token_enc is
  'Encrypted credential. google/outlook: OAuth refresh token. icloud: app-specific password.';
