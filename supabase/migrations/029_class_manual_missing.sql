-- =============================================================================
-- 029_class_manual_missing.sql
-- Cockpit — Phase B (child education UX).
--
-- class_manual_missing — assignments the sync doesn't show but the family
-- knows are missing (name + category). Fed into the deterministic Path-to-90
-- math exactly like sync-flagged missing work: "Turn in X" with point impact.
--
-- RUN: paste into the Supabase dashboard SQL editor (project: cockpit).
-- RLS mirrors path_to_90_checks: steward full access; grantees read with
-- grades scope.
-- =============================================================================

create table if not exists public.class_manual_missing (
  id             uuid    primary key default gen_random_uuid(),
  crew_member_id uuid    not null references public.crew_members(id) on delete cascade,
  class_name     text    not null,
  title          text    not null,
  category       text,
  added_by       text    not null default 'pilot'
                 check (added_by in ('pilot', 'crew')),
  created_at     timestamptz not null default now()
);

comment on table public.class_manual_missing is
  'Manually logged missing assignments (name + category). Feeds Path-to-90 math.';

alter table public.class_manual_missing enable row level security;
alter table public.class_manual_missing force row level security;

create policy manual_missing_steward_all on public.class_manual_missing
  for all
  using (
    auth.uid() = (
      select cm.pilot_id from public.crew_members cm
      where cm.id = class_manual_missing.crew_member_id
    )
  )
  with check (
    auth.uid() = (
      select cm.pilot_id from public.crew_members cm
      where cm.id = class_manual_missing.crew_member_id
    )
  );

create policy manual_missing_grantee_select on public.class_manual_missing
  for select using (
    exists (
      select 1 from public.crew_access_grants g
      where g.crew_member_id   = class_manual_missing.crew_member_id
        and g.grantee_pilot_id = auth.uid()
        and g.revoked_at is null
        and coalesce((g.scope ->> 'grades')::boolean, false)
    )
  );

grant select, insert, update, delete on public.class_manual_missing to authenticated;
