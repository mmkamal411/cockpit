-- =============================================================================
-- 028_subscriptions.sql
-- Cockpit — Money/Bills module (Phase 2, v1).
--
-- One table:
--   subscriptions — one row per recurring subscription (streaming, music,
--                   gaming, software, news, fitness, other). Never moves
--                   money — tracking only, like bills.
--
-- RLS MODEL
--   * RLS is enabled AND forced on the table.
--   * Owner-only: the policy is (auth.uid() = pilot_id).
--   * anon gets no grants at all — the app writes through the pilot's own
--     session via the SSR server client; RLS decides what each pilot sees.
--   * Soft delete via deleted_at (kept for the audit trail); live queries
--     filter on it, and the indexes below only index live rows.
--
-- RUN: paste this whole file into the Supabase dashboard SQL editor
-- (project: cockpit / hwnesewathbnfvoxtbqh) AFTER 026_health_steps.sql
-- and press Run. Expect "Success. No rows returned."
-- =============================================================================

-- Random IDs for every table. pgcrypto gives us gen_random_uuid().
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- subscriptions — one row per recurring subscription.
-- ---------------------------------------------------------------------------
create table public.subscriptions (
  id         uuid    primary key default gen_random_uuid(),
  -- Which pilot this subscription belongs to. Deletes with them.
  pilot_id   uuid    not null references public.pilots(id) on delete cascade,

  -- What the subscription is and what it costs per billing period.
  name       text    not null check (char_length(btrim(name)) > 0),
  amount     numeric(12,2) not null check (amount >= 0),
  cadence    text    not null default 'monthly'
             check (cadence in ('monthly', 'quarterly', 'annual')),

  -- When the next payment comes out. Null = unknown / not tracked.
  next_renewal date,

  -- What kind of thing it is — for grouping in the applet ("Streaming
  -- costs you $64.99/mo"). Defaults to 'other' when it doesn't fit.
  category   text    not null default 'other'
             check (category in ('streaming', 'music', 'gaming', 'software', 'news', 'fitness', 'other')),

  -- Lifecycle: paused subs still show (at reduced emphasis) so the pilot
  -- can resume them; cancelled subs stay visible for history.
  status     text    not null default 'active'
             check (status in ('active', 'paused', 'cancelled')),
  notes      text,

  -- Soft delete: the row stays for the audit trail, queries filter it out.
  deleted_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.subscriptions is
  'Money/Bills module: one row per recurring subscription. Never moves money — tracking only.';
comment on column public.subscriptions.next_renewal is
  'Date the next billing period starts. Null when the renewal date is unknown.';

-- "All live subscriptions for this pilot by status" — the applet's
-- section query (active, paused, cancelled).
create index idx_subscriptions_pilot_status
  on public.subscriptions (pilot_id, status)
  where deleted_at is null;

-- "What's renewing soon" — the renewal-ordered list.
create index idx_subscriptions_pilot_renewal
  on public.subscriptions (pilot_id, next_renewal)
  where deleted_at is null;

-- =============================================================================
-- ROW LEVEL SECURITY — owner-only.
-- =============================================================================

alter table public.subscriptions enable row level security;
alter table public.subscriptions force row level security;

create policy subscriptions_pilot_all on public.subscriptions
  for all using (auth.uid() = pilot_id) with check (auth.uid() = pilot_id);

-- =============================================================================
-- GRANTS — authenticated pilots get full row-level access; RLS decides which
-- rows each pilot actually sees. anon gets nothing on this table.
-- =============================================================================
grant select, insert, update, delete on public.subscriptions to authenticated;

-- Sequences live on the tables via defaults; grant usage for completeness.
grant usage on all sequences in schema public to authenticated;

-- Keep updated_at honest on subscriptions.
create or replace function public.subscriptions_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists subscriptions_touch_updated_at on public.subscriptions;
create trigger subscriptions_touch_updated_at
  before update on public.subscriptions
  for each row execute function public.subscriptions_touch_updated_at();
