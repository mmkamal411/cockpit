-- =============================================================================
-- 028_pilot_profile_delete_grace.sql
-- Cockpit — Phase D (settings): pilot profile photo + account-delete grace.
--
--   * pilots.avatar_url — the pilot's photo (usually a browser-downscaled
--     data URL stored via pilot_settings 'profile', kept here for compat).
--   * pilots.deletion_requested_at — DangerZone delete sets this to now();
--     the account (and everything under it) is erased 30 days later.
--     Signing in again before then clears it — deletion is cancelled.
--
-- RUN: paste into Supabase SQL editor (project: cockpit / hwnesewathbnfvoxtbqh)
-- AFTER 027_education_tables.sql. Expect "Success. No rows returned."
-- =============================================================================

alter table public.pilots
  add column if not exists avatar_url text,
  add column if not exists deletion_requested_at timestamptz;

comment on column public.pilots.avatar_url is
  'Pilot profile photo URL (or browser-downscaled data URL). Null = initials shown.';

comment on column public.pilots.deletion_requested_at is
  'Set when the pilot confirms account deletion. Data is erased 30 days later; signing in before then clears it (cancellation).';
