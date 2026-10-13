-- =============================================================================
-- 022_parentvue_extra_sections.sql
-- Cockpit — store the ParentVUE sections the P0 fix (2026-10-13) started
-- pulling: calendar events, class schedule, and student info.
--
-- Three new jsonb columns on crew_grade_syncs, each an object carrying the
-- winning API method name (audit trail) plus the data:
--   calendar_events: {method, events[]}   — from GetCalendarData
--   class_schedule:  {method, raw{}}      — from GetClassList
--   student_info:    {method, raw{}}      — from GetStudentInfoData
--
-- The worker's rpc_push_crew_grade_sync ignores unknown p_data keys, so
-- workers running the new code BEFORE this migration is applied push
-- safely — these fields simply start landing once this runs.
--
-- RUN: paste into the Supabase dashboard SQL editor
-- (project: cockpit / hwnesewathbnfvoxtbqh) AFTER 021_school_credential_types.sql.
-- Idempotent: add column if not exists + create or replace are safe to re-run.
-- =============================================================================

alter table public.crew_grade_syncs
  add column if not exists calendar_events jsonb not null default '{"method":null,"events":[]}'::jsonb,
  add column if not exists class_schedule  jsonb not null default '{"method":null,"raw":{}}'::jsonb,
  add column if not exists student_info    jsonb not null default '{"method":null,"raw":{}}'::jsonb;

comment on column public.crew_grade_syncs.calendar_events is
  'ParentVUE calendar events {method, events[]} — populated by the laptop sync P0 fix; needs no backfill.';
comment on column public.crew_grade_syncs.class_schedule is
  'ParentVUE class schedule {method, raw} — populated by the laptop sync P0 fix; needs no backfill.';
comment on column public.crew_grade_syncs.student_info is
  'ParentVUE student info {method, raw} — populated by the laptop sync P0 fix; needs no backfill.';

-- ---------------------------------------------------------------------------
-- Update rpc_push_crew_grade_sync to persist the new keys (coalesce keeps
-- old workers pushing safely — they just send nothing for these keys).
-- ---------------------------------------------------------------------------
create or replace function public.rpc_push_crew_grade_sync(
  p_data jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_id uuid;
  v_crew_member_id uuid;
begin
  v_crew_member_id := (p_data->>'crew_member_id')::uuid;
  if v_crew_member_id is null then
    raise exception 'rpc_push_crew_grade_sync: p_data.crew_member_id is required';
  end if;

  insert into public.crew_grade_syncs (
    crew_member_id, device_name, synced_at,
    grades, gpa, due_next, past_periods,
    synergy_mail, office365_emails,
    class_details, ctls_syllabi,
    attendance, ctls_announcements, ctls_upcoming,
    zero_guard_flags, pull_method,
    calendar_events, class_schedule, student_info
  ) values (
    v_crew_member_id,
    coalesce(p_data->>'device_name', 'unknown'),
    coalesce((p_data->>'synced_at')::timestamptz, now()),
    coalesce(p_data->'grades', '[]'::jsonb),
    coalesce(p_data->'gpa', '{}'::jsonb),
    coalesce(p_data->'due_next', '[]'::jsonb),
    coalesce(p_data->'past_periods', '[]'::jsonb),
    coalesce(p_data->'synergy_mail', '[]'::jsonb),
    coalesce(p_data->'office365_emails', '[]'::jsonb),
    coalesce(p_data->'class_details', '[]'::jsonb),
    coalesce(p_data->'ctls_syllabi', '{}'::jsonb),
    coalesce(p_data->'attendance', '{}'::jsonb),
    coalesce(p_data->'ctls_announcements', '[]'::jsonb),
    coalesce(p_data->'ctls_upcoming', '[]'::jsonb),
    coalesce(p_data->'zero_guard_flags', '[]'::jsonb),
    coalesce(p_data->>'pull_method', 'browser'),
    coalesce(p_data->'calendar_events', '{"method":null,"events":[]}'::jsonb),
    coalesce(p_data->'class_schedule', '{"method":null,"raw":{}}'::jsonb),
    coalesce(p_data->'student_info', '{"method":null,"raw":{}}'::jsonb)
  )
  returning id into new_id;

  return new_id;
end;
$$;

comment on function public.rpc_push_crew_grade_sync(jsonb) is
  'Workers call this to push one grade-sync snapshot. crew_member_id comes inside p_data; foreign key rejects unknown IDs. 022 adds calendar_events, class_schedule, student_info.';
