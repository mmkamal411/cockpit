-- =============================================================================
-- 035_restore_worker_secret_check.sql
-- Cockpit — restore the 018 (A1) worker-secret gate on rpc_push_crew_grade_sync.
--
-- REGRESSION FOUND (new-user gap hunt, 2026-10-13):
-- Migration 018_security_phase0 §1e hardened rpc_push_crew_grade_sync with a
-- per-crew-member worker-secret check (the A1 fix: anon callers must present
-- the secret from crew_sync_worker_secrets, service_role bypasses). Migration
-- 022_parentvue_extra_sections then did CREATE OR REPLACE on the same
-- function to add the calendar_events / class_schedule / student_info
-- columns — and its replacement body SILENTLY DROPPED the entire secret
-- check. Since 022 runs after 018, the live function currently accepts
-- pushes from anyone holding the public anon key for ANY crew_member_id
-- they can guess: the A1 fix is reverted.
--
-- This migration re-applies 018's hardened body on top of 022's column set:
-- secret check (or service_role) + all 19 columns. The secret is still
-- never stored — the insert keeps 022's explicit column list.
--
-- RUN: paste into the Supabase dashboard SQL editor (project: cockpit).
-- Idempotent: create or replace + grant are safe to re-run.
-- =============================================================================

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
  v_secret text;
  v_is_service_role boolean;
begin
  v_crew_member_id := (p_data->>'crew_member_id')::uuid;
  if v_crew_member_id is null then
    raise exception 'rpc_push_crew_grade_sync: p_data.crew_member_id is required';
  end if;

  -- 018 A1 gate, restored: workers present the per-crew-member secret;
  -- service_role callers (server-side jobs) bypass the secret check.
  v_is_service_role := coalesce(auth.jwt()->>'role', '') = 'service_role';
  if not v_is_service_role then
    v_secret := p_data->>'worker_secret';
    if v_secret is null or not exists (
      select 1 from public.crew_sync_worker_secrets s
      where s.crew_member_id = v_crew_member_id
        and s.revoked_at is null
        and crypt(v_secret, s.secret_hash) = s.secret_hash
    ) then
      raise exception 'rpc_push_crew_grade_sync: invalid worker credentials';
    end if;
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
  'Workers push one grade-sync snapshot. Requires p_data.worker_secret (per-crew-member secret from rotate_crew_worker_secret) unless called as service_role. 035 restores the 018 A1 gate that 022 dropped; keeps the 022 columns (calendar_events, class_schedule, student_info). The secret is never stored.';

-- Callers unchanged (workers call with the anon key + secret):
grant execute on function public.rpc_push_crew_grade_sync(jsonb) to anon, authenticated;
