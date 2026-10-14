-- =============================================================================
-- 007_bills.sql
-- Cockpit — Money/Bills module (Phase 2, v1).
--
-- Three tables:
--   bills         — one row per obligation occurrence. Manual entry in v1;
--                   email/AI detection candidates land in bill_drafts first.
--   bill_drafts   — parser/AI candidates awaiting pilot approval.
--   bill_history  — append-only ledger of paid periods (trend comparison).
--
-- RLS MODEL
--   * RLS is enabled AND forced on all three tables.
--   * Owner-only: every policy is (auth.uid() = pilot_id).
--   * anon gets no grants at all — the app writes through the pilot's own
--     session via the SSR server client; RLS decides what each pilot sees.
--   * Recurring bills: v1 creates the next occurrence at mark-paid time
--     (no separate rollover job yet). Each occurrence is its own row for
--     clean history.
--
-- RUN: paste this whole file into the Supabase dashboard SQL editor
-- (project: cockpit / hwnesewathbnfvoxtbqh) AFTER 005_admin_helpers.sql
-- and press Run. Expect "Success. No rows returned."
-- =============================================================================

-- Random IDs for every table. pgcrypto gives us gen_random_uuid().
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. bills — one row per obligation occurrence.
-- ---------------------------------------------------------------------------
create table public.bills (
  id         uuid    primary key default gen_random_uuid(),
  -- Which pilot this bill belongs to. Deletes with them.
  pilot_id   uuid    not null references public.pilots(id) on delete cascade,

  -- What the bill is.
  name       text    not null check (char_length(btrim(name)) > 0),
  payee      text,
  amount     numeric(12,2),

  -- When it is due. due_date for a concrete occurrence; due_day (1-31)
  -- + cadence for the recurring template the next occurrence is built from.
  due_date   date,
  due_day    int     check (due_day is null or (due_day >= 1 and due_day <= 31)),
  cadence    text    not null default 'one-off'
             check (cadence in ('monthly', 'quarterly', 'annual', 'one-off')),

  -- Lifecycle. paid_at set <=> status 'paid'. snoozed_until defers
  -- reminders (the nudge engine will respect it when it lands).
  status        text not null default 'upcoming'
                check (status in ('upcoming', 'due', 'overdue', 'paid')),
  paid_at       timestamptz,
  snoozed_until timestamptz,

  -- Where it came from and where to pay it.
  source     text    not null default 'manual'
             check (source in ('manual', 'email-draft', 'ai-draft')),
  issuer_url text,
  -- Prior-period amount for "up 12% vs last quarter" comparisons.
  last_amount numeric(12,2),
  notes      text,

  -- Soft delete: the row stays for the audit trail, queries filter it out.
  deleted_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.bills is
  'Money/Bills module: one row per obligation occurrence. Recurring bills spawn the next occurrence at mark-paid time. Never moves money — tracking only.';
comment on column public.bills.due_day is
  'Day of month (1-31) for recurring bills; the next occurrence due_date is derived from this.';
comment on column public.bills.snoozed_until is
  'Reminders deferred until this time. Respected by the future nudge engine.';

-- "All live bills for this pilot, soonest first" — the applet's main query.
create index idx_bills_pilot_due
  on public.bills (pilot_id, due_date)
  where deleted_at is null;

-- Status grouping for the Overdue → Due → Upcoming → Paid sections.
create index idx_bills_pilot_status
  on public.bills (pilot_id, status)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- 2. bill_drafts — detection candidates awaiting pilot approval.
--    v1: the table exists and the API serves it; the email parser that
--    feeds it is deferred (needs the Mail module).
-- ---------------------------------------------------------------------------
create table public.bill_drafts (
  id         uuid    primary key default gen_random_uuid(),
  pilot_id   uuid    not null references public.pilots(id) on delete cascade,

  -- { issuer, amount, due_date, confidence, email_ref, ... } — free-form
  -- because the parser's shape will evolve.
  candidate_json jsonb not null default '{}'::jsonb,
  state      text    not null default 'pending'
             check (state in ('pending', 'confirmed', 'dismissed')),
  -- Candidates auto-expire after 30 days; confirmations are reversible
  -- from the feed for 7 days per BGAI-004.
  expires_at timestamptz not null default now() + interval '30 days',

  created_at timestamptz not null default now()
);

comment on table public.bill_drafts is
  'Money/Bills module: email/AI detection candidates awaiting pilot approval. Confirmed rows promote to bills.';

create index idx_bill_drafts_pilot_state
  on public.bill_drafts (pilot_id, state);

-- ---------------------------------------------------------------------------
-- 3. bill_history — append-only ledger of paid periods.
-- ---------------------------------------------------------------------------
create table public.bill_history (
  id       uuid    primary key default gen_random_uuid(),
  bill_id  uuid    not null references public.bills(id) on delete cascade,
  pilot_id uuid    not null references public.pilots(id) on delete cascade,

  period   date    not null,
  amount   numeric(12,2),
  paid_at  timestamptz not null default now(),
  paid_late boolean not null default false,

  created_at timestamptz not null default now()
);

comment on table public.bill_history is
  'Money/Bills module: append-only ledger of paid bill periods, for trend comparison ("up 12% vs last quarter"). Rows are never updated.';

create index idx_bill_history_bill_period
  on public.bill_history (bill_id, period desc);

-- =============================================================================
-- ROW LEVEL SECURITY — owner-only on all three tables.
-- =============================================================================

alter table public.bills        enable row level security;
alter table public.bills        force row level security;
alter table public.bill_drafts  enable row level security;
alter table public.bill_drafts  force row level security;
alter table public.bill_history enable row level security;
alter table public.bill_history force row level security;

create policy bills_pilot_all on public.bills
  for all using (auth.uid() = pilot_id) with check (auth.uid() = pilot_id);

create policy bill_drafts_pilot_all on public.bill_drafts
  for all using (auth.uid() = pilot_id) with check (auth.uid() = pilot_id);

create policy bill_history_pilot_all on public.bill_history
  for all using (auth.uid() = pilot_id) with check (auth.uid() = pilot_id);

-- =============================================================================
-- GRANTS — authenticated pilots get full row-level access; RLS decides which
-- rows each pilot actually sees. anon gets nothing on these tables.
-- =============================================================================
grant select, insert, update, delete on public.bills         to authenticated;
grant select, insert, update, delete on public.bill_drafts   to authenticated;
grant select, insert, update, delete on public.bill_history  to authenticated;

-- Sequences live on the tables via defaults; grant usage for completeness.
grant usage on all sequences in schema public to authenticated;

-- Keep updated_at honest on bills.
create or replace function public.bills_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists bills_touch_updated_at on public.bills;
create trigger bills_touch_updated_at
  before update on public.bills
  for each row execute function public.bills_touch_updated_at();
