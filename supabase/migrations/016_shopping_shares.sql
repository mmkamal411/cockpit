-- =============================================================================
-- 016_shopping_shares.sql
-- Cockpit — shopping list sharing, Tier 1 (simple sharing) + viral invites.
--
-- Adds:
--   1. public.shopping_list_shares — owner grants view/edit to another pilot
--      (by email; pilot_id resolved when they exist / at signup).
--   2. public.share_invites — single-use invite tokens (hashed at rest,
--      30-day expiry) that power the /invite/<token> acquisition loop.
--   3. public.pilots.email — lets share-by-email resolve to a pilot row.
--      Backfilled on every sign-in (see auth/callback).
--   4. RLS rework on shopping_lists / shopping_items: owner keeps full
--      control; shared pilots read the list; 'edit' shares manage items.
--   5. SECURITY DEFINER helpers: find_pilot_by_email, get_share_invite_preview,
--      redeem_share_invite. Tokens are bearer secrets — lookup/validation
--      must work for signed-out visitors, so it can't rely on RLS.
--
-- Tier 2 (real-time live sync) is explicitly NOT built here. When it lands,
-- it rides on these same tables — no schema change needed, just a realtime
-- channel on shopping_items.
--
-- RUN: paste into the Supabase dashboard SQL editor AFTER 014 and press Run.
-- Expect "Success. No rows returned."
-- =============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. pilots.email — share-by-email needs a pilot lookup by email.
--    Populated by the auth callback on every sign-in (upsert, non-destructive).
-- ---------------------------------------------------------------------------
alter table public.pilots
  add column if not exists email text;

do $$
begin
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'idx_pilots_email'
  ) then
    create unique index idx_pilots_email on public.pilots (lower(email));
  end if;
end $$;

comment on column public.pilots.email is
  'Sign-in email, kept so features like list sharing can resolve a pilot by email. Backfilled on sign-in.';

-- ---------------------------------------------------------------------------
-- 2. shopping_list_shares — one row per (list, invited email).
-- ---------------------------------------------------------------------------
create table public.shopping_list_shares (
  id                 uuid    primary key default gen_random_uuid(),
  list_id            uuid    not null references public.shopping_lists(id) on delete cascade,
  owner_pilot_id     uuid    not null references public.pilots(id) on delete cascade,
  -- Invitee's email, lowercased+trimmed at write. The invite is addressed to
  -- this email even before they have a Cockpit account.
  shared_with_email  text    not null,
  -- Resolved pilot when the invitee exists (at share time) or signs up
  -- (claimed via the pilots.email backfill in the auth callback).
  shared_with_pilot_id uuid references public.pilots(id) on delete set null,
  permission         text    not null default 'view'
    check (permission in ('view', 'edit')),
  -- Denormalized at share time: pilots RLS is owner-only, so the invitee
  -- can't read the owner's pilots row to get their name.
  owner_display_name text    not null default '',
  created_at         timestamptz not null default now(),

  constraint uq_share_list_email unique (list_id, shared_with_email)
);

comment on table public.shopping_list_shares is
  'Tier 1 sharing: an owner shares a list with another pilot by email. view = read-only, edit = manage items.';

create index if not exists idx_shares_list
  on public.shopping_list_shares (list_id);
create index if not exists idx_shares_invitee
  on public.shopping_list_shares (shared_with_pilot_id)
  where shared_with_pilot_id is not null;
create index if not exists idx_shares_email
  on public.shopping_list_shares (lower(shared_with_email));

-- ---------------------------------------------------------------------------
-- 3. share_invites — the viral loop. One single-use token per share.
--    Only the SHA-256 hash is stored; the raw token lives in the email link.
-- ---------------------------------------------------------------------------
create table public.share_invites (
  id          uuid    primary key default gen_random_uuid(),
  share_id    uuid    not null references public.shopping_list_shares(id) on delete cascade,
  token_hash  text    not null unique,
  expires_at  timestamptz not null default (now() + interval '30 days'),
  accepted_at timestamptz,
  created_at  timestamptz not null default now()
);

comment on table public.share_invites is
  'Single-use invite tokens for shared lists. /invite/<token> redeems exactly once; 30-day expiry.';

create index if not exists idx_share_invites_share
  on public.share_invites (share_id);

-- ---------------------------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------------------------
alter table public.shopping_list_shares enable row level security;
alter table public.shopping_list_shares force row level security;
alter table public.share_invites        enable row level security;
alter table public.share_invites        force row level security;

-- Shares: the owner manages them; the invitee can read their own.
create policy shares_owner_all on public.shopping_list_shares
  for all to authenticated
  using (auth.uid() = owner_pilot_id)
  with check (auth.uid() = owner_pilot_id);

create policy shares_invitee_read on public.shopping_list_shares
  for select to authenticated
  using (auth.uid() = shared_with_pilot_id);

-- The invitee claims a pending share at signup: may only set their own
-- pilot id, only on rows addressed to their sign-in email, only once.
create policy shares_claim on public.shopping_list_shares
  for update to authenticated
  using (
    shared_with_pilot_id is null
    and lower(shared_with_email) = lower(auth.jwt() ->> 'email')
  )
  with check (
    shared_with_pilot_id = auth.uid()
    and lower(shared_with_email) = lower(auth.jwt() ->> 'email')
  );

-- Invites: the list owner manages them. (Redemption and preview go through
-- the SECURITY DEFINER helpers below so signed-out visitors can use links.)
create policy share_invites_owner_all on public.share_invites
  for all to authenticated
  using (
    exists (
      select 1 from public.shopping_list_shares s
      where s.id = share_invites.share_id
        and s.owner_pilot_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.shopping_list_shares s
      where s.id = share_invites.share_id
        and s.owner_pilot_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 5. shopping_lists RLS rework — owner keeps full control; shared pilots
--    can read. (Previous policy was owner-only FOR ALL; shared readers need
--    SELECT without gaining UPDATE/DELETE.)
-- ---------------------------------------------------------------------------
drop policy if exists shopping_lists_pilot_all on public.shopping_lists;

create policy shopping_lists_owner_all on public.shopping_lists
  for all to authenticated
  using (auth.uid() = pilot_id)
  with check (auth.uid() = pilot_id);

create policy shopping_lists_shared_read on public.shopping_lists
  for select to authenticated
  using (
    exists (
      select 1 from public.shopping_list_shares s
      where s.list_id = shopping_lists.id
        and s.shared_with_pilot_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------------
-- 6. shopping_items RLS rework — item-level writes follow the share's
--    permission. List-level operations (rename/archive/delete) stay
--    owner-only via the lists policies above.
-- ---------------------------------------------------------------------------
drop policy if exists shopping_items_pilot_all on public.shopping_items;

-- Owner: everything.
create policy shopping_items_owner_all on public.shopping_items
  for all to authenticated
  using (auth.uid() = pilot_id)
  with check (auth.uid() = pilot_id);

-- Shared pilots: read any item on a list shared with them.
create policy shopping_items_shared_read on public.shopping_items
  for select to authenticated
  using (
    exists (
      select 1 from public.shopping_list_shares s
      where s.list_id = shopping_items.list_id
        and s.shared_with_pilot_id = auth.uid()
    )
  );

-- 'edit' shares: insert / update / delete items on the shared list.
create policy shopping_items_shared_write on public.shopping_items
  for all to authenticated
  using (
    exists (
      select 1 from public.shopping_list_shares s
      where s.list_id = shopping_items.list_id
        and s.shared_with_pilot_id = auth.uid()
        and s.permission = 'edit'
    )
  )
  with check (
    exists (
      select 1 from public.shopping_list_shares s
      where s.list_id = shopping_items.list_id
        and s.shared_with_pilot_id = auth.uid()
        and s.permission = 'edit'
    )
  );

-- ---------------------------------------------------------------------------
-- 7. Grants
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.shopping_list_shares to authenticated;
grant select, insert, update, delete on public.share_invites        to authenticated;

-- ---------------------------------------------------------------------------
-- 8. SECURITY DEFINER helpers (invite links work for signed-out visitors)
-- ---------------------------------------------------------------------------

-- Resolve a pilot id by email for share-by-email. Returns null when the
-- email has no Cockpit account yet (the share stays pending).
create or replace function public.find_pilot_by_email(p_email text)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select id from public.pilots
  where lower(email) = lower(nullif(trim(p_email), ''))
  limit 1;
$$;

grant execute on function public.find_pilot_by_email(text) to authenticated;

-- Preview for /invite/<token>: safe metadata for the landing page.
-- The token hash IS the secret — only someone holding the link can call this.
create or replace function public.get_share_invite_preview(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inv record;
begin
  select i.expires_at, i.accepted_at,
         s.permission,
         l.name as list_name, l.icon as list_icon,
         p.display_name as owner_name, p.email as owner_email
    into inv
  from public.share_invites i
  join public.shopping_list_shares s on s.id = i.share_id
  join public.shopping_lists l on l.id = s.list_id
  left join public.pilots p on p.id = s.owner_pilot_id
  where i.token_hash = p_token_hash;

  if not found then
    return jsonb_build_object('valid', false, 'reason', 'invalid');
  end if;
  if inv.accepted_at is not null then
    return jsonb_build_object('valid', false, 'reason', 'accepted');
  end if;
  if inv.expires_at < now() then
    return jsonb_build_object('valid', false, 'reason', 'expired');
  end if;
  return jsonb_build_object(
    'valid', true,
    'list_name', inv.list_name,
    'list_icon', inv.list_icon,
    'owner_name', coalesce(inv.owner_name, split_part(inv.owner_email, '@', 1), 'Someone'),
    'permission', inv.permission
  );
end;
$$;

grant execute on function public.get_share_invite_preview(text) to anon, authenticated;

-- Redeem: single-use. Backfills the share's pilot id, stamps accepted_at,
-- returns the list to open. Idempotent for the same pilot re-opening.
create or replace function public.redeem_share_invite(
  p_token_hash text, p_pilot_id uuid, p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inv record;
begin
  select i.id as invite_id, i.share_id, i.expires_at, i.accepted_at,
         s.list_id, s.shared_with_pilot_id, s.permission,
         l.name as list_name
    into inv
  from public.share_invites i
  join public.shopping_list_shares s on s.id = i.share_id
  join public.shopping_lists l on l.id = s.list_id
  where i.token_hash = p_token_hash;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if inv.expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if inv.accepted_at is not null then
    -- Already redeemed: only the original redeemer gets a pass-through.
    if inv.shared_with_pilot_id = p_pilot_id then
      return jsonb_build_object('ok', true, 'already', true,
        'list_id', inv.list_id, 'list_name', inv.list_name,
        'permission', inv.permission);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'accepted');
  end if;

  update public.shopping_list_shares
    set shared_with_pilot_id = p_pilot_id
    where id = inv.share_id
      and (shared_with_pilot_id is null or shared_with_pilot_id = p_pilot_id);

  update public.share_invites
    set accepted_at = now()
    where id = inv.invite_id;

  return jsonb_build_object('ok', true,
    'list_id', inv.list_id, 'list_name', inv.list_name,
    'permission', inv.permission);
end;
$$;

grant execute on function public.redeem_share_invite(text, uuid, text) to anon, authenticated;
