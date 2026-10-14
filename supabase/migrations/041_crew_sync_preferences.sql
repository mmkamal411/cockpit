-- =============================================================================
-- 041_crew_sync_preferences.sql
-- Cockpit — per-crew-member sync preferences.
--
-- 1. crew_members.sync_preferences (jsonb, NOT NULL, default '{}'): a
--    schemaless preference bag for the school sync pipeline, per child.
--    Holds things like: which sources are enabled (parentvue / studentvue /
--    installer), per-source cadence overrides, quiet hours, and opt-outs
--    for specific data classes. jsonb keeps new preferences deployable
--    without a schema change per preference.
--
--    Contract: missing keys = defaults (treat absent as "not set").
--    Keys are advisory hints for the sync worker; the worker always has
--    its own hardcoded safe defaults when a key is absent or malformed.
--
-- RUN: paste into Supabase SQL editor (Meheldi runs migrations).
-- =============================================================================

alter table public.crew_members
  add column if not exists sync_preferences jsonb not null default '{}';

comment on column public.crew_members.sync_preferences is
  'Per-child school sync preferences (source enables, cadence overrides, opt-outs). Missing keys = defaults; malformed keys ignored by the worker.';
