-- =============================================================================
-- 010_shopping.sql
-- Cockpit — shopping lists module (Phase 2, v1).
--
-- Pilot-owned tables. RLS: owner-only (auth.uid() = pilot_id), forced.
-- Pattern engine / restock suggestions are v1.1 — purchase_history feeds it.
--
-- RUN: paste into the Supabase dashboard SQL editor AFTER 006 (calendar)
-- and press Run. Expect "Success. No rows returned."
-- =============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. shopping_lists — the pilot's named lists (groceries, household, ...)
-- ---------------------------------------------------------------------------
create table public.shopping_lists (
  id         uuid    primary key default gen_random_uuid(),
  pilot_id   uuid    not null references public.pilots(id) on delete cascade,
  name       text    not null,
  icon       text    not null default '🛒',
  sort_order integer not null default 0,
  archived   boolean not null default false,
  created_at timestamptz not null default now()
);

comment on table public.shopping_lists is
  'Pilot-owned shopping lists. Seeded with Groceries / Household / Pharmacy on first open (client-side).';

-- ---------------------------------------------------------------------------
-- 2. shopping_items — one row per line item
-- ---------------------------------------------------------------------------
create table public.shopping_items (
  id             uuid    primary key default gen_random_uuid(),
  list_id        uuid    not null references public.shopping_lists(id) on delete cascade,
  pilot_id       uuid    not null references public.pilots(id) on delete cascade,
  name           text    not null,
  quantity       numeric,
  unit           text,
  checked        boolean not null default false,
  checked_at     timestamptz,
  recurring      boolean not null default false,
  recurring_interval_days integer,
  notes          text,
  position       integer not null default 0,
  created_at     timestamptz not null default now()
);

comment on table public.shopping_items is
  'Line items on a shopping list. Checked items sink to a "Got it" section, never deleted.';

-- ---------------------------------------------------------------------------
-- 3. purchase_history — append-only; feeds the v1.1 replenishment model
-- ---------------------------------------------------------------------------
create table public.purchase_history (
  id                    uuid    primary key default gen_random_uuid(),
  pilot_id              uuid    not null references public.pilots(id) on delete cascade,
  item_name_normalized  text    not null,
  completed_at          timestamptz not null default now(),
  list_id               uuid    references public.shopping_lists(id) on delete set null
);

comment on table public.purchase_history is
  'Append-only check-off history (name-based, survives item deletion). Feeds the v1.1 restock pattern engine.';

-- ---------------------------------------------------------------------------
-- RLS — forced, owner-only
-- ---------------------------------------------------------------------------
alter table public.shopping_lists   enable row level security;
alter table public.shopping_lists   force row level security;
alter table public.shopping_items   enable row level security;
alter table public.shopping_items   force row level security;
alter table public.purchase_history enable row level security;
alter table public.purchase_history force row level security;

create policy shopping_lists_pilot_all on public.shopping_lists
  for all using (auth.uid() = pilot_id) with check (auth.uid() = pilot_id);

create policy shopping_items_pilot_all on public.shopping_items
  for all using (auth.uid() = pilot_id) with check (auth.uid() = pilot_id);

create policy purchase_history_pilot_all on public.purchase_history
  for all using (auth.uid() = pilot_id) with check (auth.uid() = pilot_id);

-- ---------------------------------------------------------------------------
-- Grants — auto-expose is OFF; RLS decides which rows each pilot sees.
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.shopping_lists   to authenticated;
grant select, insert, update, delete on public.shopping_items   to authenticated;
grant select, insert, update, delete on public.purchase_history to authenticated;

-- Helpful indexes: items for a list in position order; latest history first.
create index idx_shopping_items_list_position
  on public.shopping_items (list_id, position);
create index idx_purchase_history_pilot_completed
  on public.purchase_history (pilot_id, completed_at desc);
