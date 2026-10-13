-- =============================================================================
-- 006_weather_pilot_prefs.sql
-- Cockpit — pilot weather preferences.
--
-- Adds home_location (coarse city/ZIP + rounded lat/lon per directive D7)
-- and weather_units (F/C) to the pilots table.
--
-- RUN: paste into Supabase SQL editor AFTER 005_admin_helpers.sql.
-- =============================================================================

alter table public.pilots
  add column if not exists home_location text,
  add column if not exists home_lat double precision,
  add column if not exists home_lon double precision,
  add column if not exists weather_units text not null default 'F'
    check (weather_units in ('F', 'C'));

comment on column public.pilots.home_location is
  'Pilot-pinned home location label, e.g. "Marietta, GA". Coarse only (D7).';
comment on column public.pilots.home_lat is
  'Home latitude, rounded to ~0.1° (coarse per D7). Null until the pilot pins a location.';
comment on column public.pilots.home_lon is
  'Home longitude, rounded to ~0.1° (coarse per D7). Null until the pilot pins a location.';
comment on column public.pilots.weather_units is
  'Temperature units: F (default) or C.';
