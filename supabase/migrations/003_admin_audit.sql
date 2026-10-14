-- =============================================================================
-- 003_admin_audit.sql
-- Cockpit — admin audit log + admin allowlist + is_admin() helper.
--
-- Two tables:
--   admin_users      — the allowlist of admin emails (normalized lowercase).
--   admin_audit_log  — append-only record of every privileged admin action:
--                      who did it, what it was, what changed, when.
--
-- RLS MODEL
--   * RLS is enabled AND forced on both tables.
--   * Only admins may READ either table (policy via public.is_admin()).
--   * NOBODY writes through RLS: there are no insert/update/delete policies
--     for any RLS role. All writes go through the service-role client from
--     the API layer, which bypasses RLS by design. This is deliberate:
--     a compromised user JWT can never insert audit rows or fake admins.
--   * anon gets no grants at all.
--
-- ADMIN GATE (defense in depth, two layers):
--   Layer 1 (API): route handlers call requireAdmin() in
--     src/lib/admin/auth.ts, which checks the signed-in user's email against
--     the ADMIN_EMAILS env var (comma-separated, case-insensitive).
--   Layer 2 (DB):  admin routes that need it also call the is_admin(email)
--     RPC (SECURITY DEFINER), which checks the admin_users table.
--   Either layer denying access blocks the action.
--
-- RUN: paste this whole file into the Supabase dashboard SQL editor
-- (project: cockpit / hwnesewathbnfvoxtbqh) AFTER 002_crew_grade_syncs.sql
-- and press Run. Expect "Success. No rows returned."
--
-- AFTER RUNNING: add your admin email(s) to admin_users — either run the
-- commented-out seed INSERT below (edit the address first) or insert rows
-- in the dashboard Table Editor.
-- =============================================================================

-- Random IDs for every table. pgcrypto gives us gen_random_uuid().
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. admin_users — allowlist of admin emails.
--    Emails are stored normalized: lowercase, no surrounding whitespace.
-- ---------------------------------------------------------------------------
create table public.admin_users (
  id         uuid    primary key default gen_random_uuid(),
  -- Normalized admin email: lower(btrim(email)). Lookups must normalize too.
  email      text    not null unique check (email = lower(btrim(email))),
  -- Who added this admin (email), for the paper trail.
  created_by text,
  -- Free-text note, e.g. "founder", "support lead".
  note       text,
  created_at timestamptz not null default now()
);

comment on table public.admin_users is
  'Allowlist of admin emails. Checked by public.is_admin(). Layer 2 of the admin gate; the API layer also checks the ADMIN_EMAILS env var.';
comment on column public.admin_users.email is
  'Normalized admin email (lowercase, trimmed). All lookups must normalize the same way.';

-- ---------------------------------------------------------------------------
-- 2. admin_audit_log — append-only record of privileged admin actions.
--    Rows are never updated or deleted by the app; they are the forensic
--    trail for user.delete, user.suspend, table.export, etc.
-- ---------------------------------------------------------------------------
create table public.admin_audit_log (
  id         uuid    primary key default gen_random_uuid(),
  -- The admin who acted (their sign-in email).
  actor_email text   not null,
  -- What happened, e.g. 'user.delete', 'user.suspend', 'table.export',
  -- 'admin.impersonate_view'. Namespaced dot notation; app-defined.
  action     text    not null,
  -- What kind of thing was acted on, e.g. 'pilot', 'crew_member',
  -- 'pilot_integration', 'table'.
  target_type text,
  -- ID of the acted-on row, as text so uuid and text targets both fit.
  -- Null for actions with no single target (e.g. a table export).
  target_id  text,
  -- Snapshot of the row (or relevant state) BEFORE the action. Null when
  -- there is no meaningful before-state (e.g. exports).
  before     jsonb,
  -- Snapshot AFTER the action. Null for reads and exports.
  after      jsonb,
  -- Extra context: reason, IP, user agent, row counts, confirmation id.
  -- NEVER put raw credentials or tokens here.
  metadata   jsonb,
  created_at timestamptz not null default now()
);

comment on table public.admin_audit_log is
  'Append-only audit trail of privileged admin actions. Written only via the service-role client from the API layer; no RLS role may insert.';
comment on column public.admin_audit_log.actor_email is
  'The admin who acted (sign-in email).';
comment on column public.admin_audit_log.action is
  'What happened, namespaced dot notation, e.g. user.delete, user.suspend, table.export.';
comment on column public.admin_audit_log.before is
  'State before the action. Redact secrets before logging.';
comment on column public.admin_audit_log.after is
  'State after the action. Redact secrets before logging.';
comment on column public.admin_audit_log.metadata is
  'Extra context: reason, IP, confirmation id, row counts. No credentials.';

-- ---------------------------------------------------------------------------
-- Helpful indexes — audit queries are newest-first, filtered by actor or target.
-- ---------------------------------------------------------------------------
create index idx_admin_audit_created   on public.admin_audit_log (created_at desc);
create index idx_admin_audit_actor     on public.admin_audit_log (actor_email, created_at desc);
create index idx_admin_audit_target    on public.admin_audit_log (target_type, target_id, created_at desc);
create index idx_admin_audit_action    on public.admin_audit_log (action, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. public.is_admin(p_email) — the reusable admin check.
--    SECURITY DEFINER so it can read admin_users without recursing through
--    that table's own RLS policy (the policy calls this function, which
--    reads the table — without SECURITY DEFINER that would loop forever).
--    Read-only: it returns a single boolean and nothing else.
-- ---------------------------------------------------------------------------
create or replace function public.is_admin(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users
    where email = lower(btrim(p_email))
  );
$$;

comment on function public.is_admin(text) is
  'True when the given email is on the admin_users allowlist (normalized lowercase). SECURITY DEFINER to avoid RLS recursion; read-only.';

-- =============================================================================
-- ROW LEVEL SECURITY
--   * Enabled + forced: no role silently bypasses.
--   * One policy each: admins may SELECT. That is all.
--   * NO insert/update/delete policies for any role — writes happen only via
--     the service-role client in the API layer, which bypasses RLS.
-- =============================================================================

alter table public.admin_users     enable row level security;
alter table public.admin_audit_log enable row level security;
alter table public.admin_users     force row level security;
alter table public.admin_audit_log force row level security;

create policy admin_users_select_admins on public.admin_users
  for select using (public.is_admin(auth.jwt() ->> 'email'));

create policy admin_audit_select_admins on public.admin_audit_log
  for select using (public.is_admin(auth.jwt() ->> 'email'));

-- =============================================================================
-- GRANTS — auto-expose is OFF, so nothing is reachable until granted here.
--   * authenticated: SELECT on both tables (RLS narrows it to admins);
--     EXECUTE on is_admin so API layers can do the second-layer DB check.
--   * anon: NOTHING. Not even execute on is_admin.
--   * service_role bypasses RLS and needs no grants (Supabase default).
-- =============================================================================
grant select on public.admin_users     to authenticated;
grant select on public.admin_audit_log to authenticated;
grant execute on function public.is_admin(text) to authenticated;

-- Explicit: anon gets nothing on these objects.
revoke all on public.admin_users     from anon;
revoke all on public.admin_audit_log from anon;
revoke all on function public.is_admin(text) from anon;

grant usage on all sequences in schema public to authenticated;

-- =============================================================================
-- SEED (commented out on purpose — edit the email, then run separately).
-- Mehedi: uncomment and run this once to bootstrap the first admin.
-- =============================================================================
-- insert into public.admin_users (email, created_by, note)
-- values ('mehedikamal@gmail.com', 'mehedikamal@gmail.com', 'founder');
