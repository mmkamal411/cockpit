-- =============================================================================
-- 005_admin_helpers.sql
-- Cockpit — admin-only RPC helpers for the admin command center API.
--
--   admin_table_stats()            -> [{name, row_count}] for admin tables
--   admin_table_columns(p_table)   -> [{name, data_type}] (whitelisted only)
--   admin_table_policies(p_table)  -> {rls_enabled, rls_forced, policies[]}
--   admin_run_select(p_sql)        -> {columns, rows, row_count}
--                                     SELECT/WITH only, 5s timeout, 500 rows
--
-- SECURITY MODEL: all functions are SECURITY DEFINER and EXECUTE is
-- revoked from PUBLIC and granted ONLY to service_role. The Next.js admin
-- API layer calls them with the service-role client AFTER requireAdmin()
-- (or requireAdminBothLayers()) has passed. Anon/authenticated callers
-- cannot execute them at all.
--
-- RUN: paste into the Supabase dashboard SQL editor
-- (project: cockpit / hwnesewathbnfvoxtbqh) AFTER 004_admin_suspend.sql.
-- Idempotent: create or replace + revoke/grant are safe to re-run.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Whitelist shared by the helpers. Mirrors ADMIN_TABLES in
-- src/lib/admin/routeHandler.ts (the API layer enforces it too; this is
-- defense in depth so the functions are safe even if called directly).
-- ---------------------------------------------------------------------------
create or replace function public.admin_whitelisted_table(p_table text)
returns boolean
language sql
immutable
as $$
  select p_table in (
    'pilots',
    'pilot_integrations',
    'crew_members',
    'crew_access_grants',
    'crew_school_links',
    'todos',
    'nudges',
    'cockpit_layouts',
    'crew_grade_syncs',
    'admin_users',
    'admin_audit_log'
  );
$$;

comment on function public.admin_whitelisted_table(text) is
  'True when the table may be inspected by admin helpers. Keep in sync with ADMIN_TABLES in src/lib/admin/routeHandler.ts.';

-- ---------------------------------------------------------------------------
-- Row counts for every whitelisted table.
-- ---------------------------------------------------------------------------
create or replace function public.admin_table_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  t text;
  cnt bigint;
  result jsonb := '[]'::jsonb;
begin
  foreach t in array array[
    'pilots','pilot_integrations','crew_members','crew_access_grants',
    'crew_school_links','todos','nudges','cockpit_layouts',
    'crew_grade_syncs','admin_users','admin_audit_log'
  ]
  loop
    execute format('select count(*) from public.%I', t) into cnt;
    result := result || jsonb_build_object('name', t, 'row_count', cnt);
  end loop;
  return result;
end;
$$;

comment on function public.admin_table_stats() is
  'Admin helper: row counts for every whitelisted table. service_role only.';

-- ---------------------------------------------------------------------------
-- Column names + data types for one whitelisted table.
-- ---------------------------------------------------------------------------
create or replace function public.admin_table_columns(p_table text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.admin_whitelisted_table(p_table) then
    raise exception 'admin_table_columns: table % is not whitelisted', p_table;
  end if;

  return coalesce((
    select jsonb_agg(
      jsonb_build_object('name', c.column_name, 'data_type', c.data_type)
      order by c.ordinal_position
    )
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = p_table
  ), '[]'::jsonb);
end;
$$;

comment on function public.admin_table_columns(text) is
  'Admin helper: [{name, data_type}] for a whitelisted table. service_role only.';

-- ---------------------------------------------------------------------------
-- RLS status + policies for one whitelisted table (from pg_catalog).
-- ---------------------------------------------------------------------------
create or replace function public.admin_table_policies(p_table text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled boolean;
  v_forced  boolean;
  v_policies jsonb;
begin
  if not public.admin_whitelisted_table(p_table) then
    raise exception 'admin_table_policies: table % is not whitelisted', p_table;
  end if;

  select c.relrowsecurity, c.relforcerowsecurity
    into v_enabled, v_forced
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname = p_table;

  if not found then
    raise exception 'admin_table_policies: table % does not exist', p_table;
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'name',       p.policyname,
      'command',    p.cmd,
      'roles',      p.roles,
      'using',      p.qual,
      'with_check', p.with_check
    )
    order by p.policyname
  ), '[]'::jsonb)
  into v_policies
  from pg_policies p
  where p.schemaname = 'public'
    and p.tablename = p_table;

  return jsonb_build_object(
    'rls_enabled', coalesce(v_enabled, false),
    'rls_forced',  coalesce(v_forced, false),
    'policies',    v_policies
  );
end;
$$;

comment on function public.admin_table_policies(text) is
  'Admin helper: {rls_enabled, rls_forced, policies[]} for a whitelisted table. service_role only.';

-- ---------------------------------------------------------------------------
-- Run a read-only SELECT/WITH query. The API layer validates the statement
-- first; this function re-validates (defense in depth), applies a 5-second
-- statement timeout, and caps results at 500 rows by wrapping the query.
-- ---------------------------------------------------------------------------
create or replace function public.admin_run_select(p_sql text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cleaned text;
  rec record;
  cols text[] := '{}';
  rows jsonb := '[]'::jsonb;
  n int := 0;
begin
  if p_sql is null or btrim(p_sql) = '' then
    raise exception 'admin_run_select: sql is required';
  end if;

  -- Strip block comments, then line comments, then trailing semicolons.
  cleaned := regexp_replace(p_sql, '/\*.*?\*/', ' ', 'gs');
  cleaned := regexp_replace(cleaned, '--[^\n]*', ' ', 'g');
  cleaned := btrim(cleaned);
  cleaned := regexp_replace(cleaned, ';+\s*$', '');

  if cleaned !~* '^(select|with)\b' then
    raise exception 'admin_run_select: only SELECT or WITH statements are allowed';
  end if;

  -- 5-second statement timeout, local to this call.
  perform set_config('statement_timeout', '5000', true);

  for rec in execute
    'select row_to_json(t) as j from (' || cleaned || ') as t limit 500'
  loop
    if n = 0 then
      select array_agg(k order by o) into cols
      from jsonb_object_keys((rec.j)::jsonb) with ordinality as k(k, o);
      cols := coalesce(cols, '{}');
    end if;
    rows := rows || (rec.j)::jsonb;
    n := n + 1;
  end loop;

  return jsonb_build_object(
    'columns', to_jsonb(cols),
    'rows', rows,
    'row_count', n
  );
exception
  when others then
    raise exception 'admin_run_select failed: %', sqlerrm;
end;
$$;

comment on function public.admin_run_select(text) is
  'Admin helper: runs a SELECT/WITH query with a 5s timeout, max 500 rows. Rejects anything else. service_role only.';

-- =============================================================================
-- Lock down: revoke from PUBLIC, grant only to service_role.
-- (Functions default to PUBLIC execute; without this, anon could call them.)
-- =============================================================================
revoke all on function public.admin_whitelisted_table(text) from public;
revoke all on function public.admin_table_stats()              from public;
revoke all on function public.admin_table_columns(text)        from public;
revoke all on function public.admin_table_policies(text)       from public;
revoke all on function public.admin_run_select(text)           from public;

grant execute on function public.admin_whitelisted_table(text) to service_role;
grant execute on function public.admin_table_stats()              to service_role;
grant execute on function public.admin_table_columns(text)        to service_role;
grant execute on function public.admin_table_policies(text)       to service_role;
grant execute on function public.admin_run_select(text)           to service_role;
