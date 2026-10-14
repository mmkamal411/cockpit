-- =============================================================================
-- 004_admin_suspend.sql
-- Cockpit — admin suspension flag on pilots.
--
-- Adds pilots.suspended, used by the admin command center
-- (POST /api/admin/users/[id]/suspend and /unsuspend).
--
-- RUN: paste into the Supabase dashboard SQL editor
-- (project: cockpit / hwnesewathbnfvoxtbqh) AFTER 003_admin_audit.sql.
-- Idempotent: safe to run twice.
-- =============================================================================

alter table public.pilots
  add column if not exists suspended boolean not null default false;

comment on column public.pilots.suspended is
  'Admin suspension flag. Set/cleared by the admin API (user.suspend / user.unsuspend audit actions). '
  'The app sign-in flow should refuse suspended pilots; that enforcement lives in app code, not here.';

-- No RLS policy change: pilots rows are still owner-readable. The flag is
-- only ever written with the service-role key behind requireAdmin().
