-- =============================================================================
-- 037_todo_lists.sql — Rich To-Do v1: lists, sharing, persistence fields.
--
-- Adds:
--   1. public.todo_lists — pilot-owned lists (sharing granularity = whole list).
--   2. public.todo_list_shares — owner grants view/edit to another pilot by
--      email (clone of the shopping_list_shares pattern, Tier 1).
--   3. public.share_invites gains todo_share_id so todo invites reuse the
--      same token pipeline as shopping (share_id is relaxed to nullable;
--      exactly one of share_id / todo_share_id is set).
--   4. todos additions: list_id, parent_todo_id (sub-tasks), section,
--      assigned_to_pilot_id, recurrence, reminder_at, updated_at,
--      deleted_at (tombstones), google_task_id, google_tasklist_id.
--      Priority check widens low/medium/high -> p1..p4 (legacy remapped).
--   5. calendar_connections: granted_scopes (persisted OAuth scopes),
--      last_tasks_sync (push watermark for Google Tasks two-way sync).
--   6. Default-list backfill: every pilot gets one "My tasks" list;
--      todos without a list move into their pilot's default list.
--   7. RLS rework on todos: owner FOR ALL stays; adds todos_shared_read
--      and edit-gated todos_shared_write via todo_list_shares.
--   8. SECURITY DEFINER helpers (hardened clone of 018's pattern — identity
--      from auth.uid() + JWT email, email binding, no anon):
--      find_todo_pilot_by_email, get_todo_share_invite_preview,
--      redeem_todo_share_invite.
--
-- RUN: paste into the Supabase dashboard SQL editor AFTER 036. Safe to re-run.
-- =============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. todo_lists
-- ---------------------------------------------------------------------------
create table if not exists public.todo_lists (
  id         uuid    primary key default gen_random_uuid(),
  pilot_id   uuid    not null references public.pilots(id) on delete cascade,
  name       text    not null,
  color      text,
  position   int     not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.todo_lists is
  'Pilot-owned to-do lists. Sharing happens at the list level (todo_list_shares).';

create index if not exists idx_todo_lists_pilot
  on public.todo_lists (pilot_id);

-- ---------------------------------------------------------------------------
-- 2. todo_list_shares
-- ---------------------------------------------------------------------------
create table if not exists public.todo_list_shares (
  id                 uuid    primary key default gen_random_uuid(),
  list_id            uuid    not null references public.todo_lists(id) on delete cascade,
  owner_pilot_id     uuid    not null references public.pilots(id) on delete cascade,
  shared_with_email  text    not null,
  shared_with_pilot_id uuid references public.pilots(id) on delete set null,
  permission         text    not null default 'edit'
    check (permission in ('view', 'edit')),
  owner_display_name text    not null default '',
  created_at         timestamptz not null default now(),

  constraint uq_todo_share_list_email unique (list_id, shared_with_email)
);

comment on table public.todo_list_shares is
  'Tier 1 to-do sharing: an owner shares a list with another pilot by email. view = read-only, edit = manage tasks.';

create index if not exists idx_todo_shares_list
  on public.todo_list_shares (list_id);
create index if not exists idx_todo_shares_invitee
  on public.todo_list_shares (shared_with_pilot_id)
  where shared_with_pilot_id is not null;
create index if not exists idx_todo_shares_email
  on public.todo_list_shares (lower(shared_with_email));

-- ---------------------------------------------------------------------------
-- 3. share_invites — todo-scoped tokens share the same table.
-- ---------------------------------------------------------------------------
alter table public.share_invites
  add column if not exists todo_share_id uuid
    references public.todo_list_shares(id) on delete cascade;

alter table public.share_invites
  alter column share_id drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'share_invites_one_kind' and conrelid = 'public.share_invites'::regclass
  ) then
    alter table public.share_invites
      add constraint share_invites_one_kind
      check (
        (share_id is null) <> (todo_share_id is null)
      );
  end if;
end $$;

create index if not exists idx_share_invites_todo_share
  on public.share_invites (todo_share_id);

-- ---------------------------------------------------------------------------
-- 4. todos additions
-- ---------------------------------------------------------------------------
alter table public.todos
  add column if not exists list_id uuid
    references public.todo_lists(id) on delete cascade;

alter table public.todos
  add column if not exists parent_todo_id uuid
    references public.todos(id) on delete cascade;

alter table public.todos
  add column if not exists section text;

alter table public.todos
  add column if not exists assigned_to_pilot_id uuid
    references public.pilots(id) on delete set null;

alter table public.todos
  add column if not exists recurrence text;

alter table public.todos
  add column if not exists reminder_at timestamptz;

alter table public.todos
  add column if not exists updated_at timestamptz not null default now();

alter table public.todos
  add column if not exists deleted_at timestamptz;

alter table public.todos
  add column if not exists google_task_id text;

alter table public.todos
  add column if not exists google_tasklist_id text;

-- Priority: widen low/medium/high -> p1..p4 (p1 highest, p4 = no priority).
-- Legacy values are remapped once, then the check is replaced.
alter table public.todos drop constraint if exists todos_priority_check;

update public.todos set priority = 'p1' where priority = 'high';
update public.todos set priority = 'p2' where priority = 'medium';
update public.todos set priority = 'p3' where priority = 'low';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'todos_priority_p1p4' and conrelid = 'public.todos'::regclass
  ) then
    alter table public.todos
      add constraint todos_priority_p1p4
      check (priority in ('p1', 'p2', 'p3', 'p4'));
  end if;
end $$;

comment on column public.todos.list_id is
  'Which list this todo belongs to. Backfilled to the pilot''s default list.';
comment on column public.todos.parent_todo_id is
  'Sub-tasks: the parent todo, if this is a sub-task.';
comment on column public.todos.section is
  'Lightweight section label inside a list (e.g. "Groceries", "School").';
comment on column public.todos.assigned_to_pilot_id is
  'The pilot this task is assigned to. Drives the "assigned to me" view.';
comment on column public.todos.recurrence is
  'Recurrence rule in Todoist-style grammar, e.g. "every day", "every Monday".';
comment on column public.todos.reminder_at is
  'Computed next reminder: 30 min before timed todos, morning of date-only ones.';
comment on column public.todos.updated_at is
  'Last write wins marker for merge — maintained by a trigger on every update.';
comment on column public.todos.deleted_at is
  'Soft-delete tombstone. Deletes become tombstones so shared lists merge instead of resurrecting.';
comment on column public.todos.google_task_id is
  'Google Tasks identity for two-way sync.';
comment on column public.todos.google_tasklist_id is
  'Google Tasks tasklist this task syncs with.';

create index if not exists idx_todos_list
  on public.todos (list_id);
create index if not exists idx_todos_parent
  on public.todos (parent_todo_id)
  where parent_todo_id is not null;
create index if not exists idx_todos_assignee
  on public.todos (assigned_to_pilot_id)
  where assigned_to_pilot_id is not null;
create index if not exists idx_todos_google
  on public.todos (google_tasklist_id, google_task_id)
  where google_task_id is not null;
create index if not exists idx_todos_reminder
  on public.todos (reminder_at)
  where reminder_at is not null and deleted_at is null;

-- updated_at maintenance (todos + todo_lists).
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_todos_touch_updated_at on public.todos;
create trigger trg_todos_touch_updated_at
  before update on public.todos
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_todo_lists_touch_updated_at on public.todo_lists;
create trigger trg_todo_lists_touch_updated_at
  before update on public.todo_lists
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 5. calendar_connections — Tasks scopes + sync watermark
-- ---------------------------------------------------------------------------
alter table public.calendar_connections
  add column if not exists granted_scopes text[];

alter table public.calendar_connections
  add column if not exists last_tasks_sync timestamptz;

comment on column public.calendar_connections.granted_scopes is
  'OAuth scopes Google actually granted at connect time (persisted from the token response).';
comment on column public.calendar_connections.last_tasks_sync is
  'Push watermark for Google Tasks two-way sync: todos with updated_at after this still need pushing.';

-- ---------------------------------------------------------------------------
-- 6. Default-list backfill
-- ---------------------------------------------------------------------------
insert into public.todo_lists (pilot_id, name, position)
select p.id, 'My tasks', 0
from public.pilots p
where not exists (
  select 1 from public.todo_lists l where l.pilot_id = p.id
);

update public.todos t
set list_id = (
  select l.id from public.todo_lists l
  where l.pilot_id = t.pilot_id
  order by l.position, l.created_at
  limit 1
)
where t.list_id is null;

-- ---------------------------------------------------------------------------
-- 7. RLS
-- ---------------------------------------------------------------------------
alter table public.todo_lists       enable row level security;
alter table public.todo_lists       force row level security;
alter table public.todo_list_shares enable row level security;
alter table public.todo_list_shares force row level security;

-- todo_lists: the owner manages them; shared pilots read the list.
drop policy if exists todo_lists_pilot_all on public.todo_lists;

create policy todo_lists_owner_all on public.todo_lists
  for all to authenticated
  using (auth.uid() = pilot_id)
  with check (auth.uid() = pilot_id);

create policy todo_lists_shared_read on public.todo_lists
  for select to authenticated
  using (
    exists (
      select 1 from public.todo_list_shares s
      where s.list_id = todo_lists.id
        and s.shared_with_pilot_id = auth.uid()
    )
  );

-- todo_list_shares: the owner manages them; the invitee can read their own.
create policy todo_shares_owner_all on public.todo_list_shares
  for all to authenticated
  using (auth.uid() = owner_pilot_id)
  with check (auth.uid() = owner_pilot_id);

create policy todo_shares_invitee_read on public.todo_list_shares
  for select to authenticated
  using (auth.uid() = shared_with_pilot_id);

-- The invitee claims a pending share at signup: may only set their own
-- pilot id, only on rows addressed to their sign-in email, only once.
create policy todo_shares_claim on public.todo_list_shares
  for update to authenticated
  using (
    shared_with_pilot_id is null
    and lower(shared_with_email) = lower(auth.jwt() ->> 'email')
  )
  with check (
    shared_with_pilot_id = auth.uid()
    and lower(shared_with_email) = lower(auth.jwt() ->> 'email')
  );

-- The list owner manages todo invites (redemption and preview go through
-- the SECURITY DEFINER helpers below so signed-out visitors can use links).
create policy todo_share_invites_owner_all on public.share_invites
  for all to authenticated
  using (
    exists (
      select 1 from public.todo_list_shares s
      where s.id = share_invites.todo_share_id
        and s.owner_pilot_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.todo_list_shares s
      where s.id = share_invites.todo_share_id
        and s.owner_pilot_id = auth.uid()
    )
  );

-- todos: owner FOR ALL stays; shared pilots read; 'edit' shares write.
drop policy if exists todos_pilot_all on public.todos;

create policy todos_owner_all on public.todos
  for all to authenticated
  using (auth.uid() = pilot_id)
  with check (auth.uid() = pilot_id);

create policy todos_shared_read on public.todos
  for select to authenticated
  using (
    exists (
      select 1 from public.todo_list_shares s
      where s.list_id = todos.list_id
        and s.shared_with_pilot_id = auth.uid()
    )
  );

-- 'edit' shares: insert / update / delete todos on the shared list.
-- Tombstones (deleted_at) flow through the same policy — a soft delete is
-- an UPDATE, so revoking a share can't resurrect rows via policy gaps.
create policy todos_shared_write on public.todos
  for all to authenticated
  using (
    exists (
      select 1 from public.todo_list_shares s
      where s.list_id = todos.list_id
        and s.shared_with_pilot_id = auth.uid()
        and s.permission = 'edit'
    )
  )
  with check (
    exists (
      select 1 from public.todo_list_shares s
      where s.list_id = todos.list_id
        and s.shared_with_pilot_id = auth.uid()
        and s.permission = 'edit'
    )
  );

-- ---------------------------------------------------------------------------
-- 8. Grants
-- ---------------------------------------------------------------------------
grant select, insert, update, delete on public.todo_lists to authenticated;
grant select, insert, update, delete on public.todo_list_shares to authenticated;
grant select, insert, update, delete on public.share_invites to authenticated;

-- ---------------------------------------------------------------------------
-- 9. SECURITY DEFINER helpers (hardened 018 pattern: server-side identity,
--    email binding, single-use, idempotent pass-through, no anon grants).
-- ---------------------------------------------------------------------------

-- Resolve a pilot id by email ONLY in the context of a todo list the caller
-- owns (the share-creation flow). Uniform null otherwise — no oracle.
create or replace function public.find_todo_pilot_by_email(p_email text, p_list_id uuid)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select p.id from public.pilots p
  where lower(p.email) = lower(nullif(trim(p_email), ''))
    and exists (
      select 1 from public.todo_lists l
      where l.id = p_list_id
        and l.pilot_id = auth.uid()
    )
  limit 1;
$$;

comment on function public.find_todo_pilot_by_email(text, uuid) is
  'Share-creation helper: resolve an invitee email to a pilot id, but ONLY for a todo list the caller owns. Uniform null otherwise.';

revoke all on function public.find_todo_pilot_by_email(text, uuid) from public, anon;
grant execute on function public.find_todo_pilot_by_email(text, uuid) to authenticated;

-- Preview for /invite/<token>: safe metadata for the landing page.
create or replace function public.get_todo_share_invite_preview(p_token_hash text)
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
         l.name as list_name, l.color as list_color,
         p.display_name as owner_name, p.email as owner_email
    into inv
  from public.share_invites i
  join public.todo_list_shares s on s.id = i.todo_share_id
  join public.todo_lists l on l.id = s.list_id
  left join public.pilots p on p.id = s.owner_pilot_id
  where i.token_hash = p_token_hash
    and i.todo_share_id is not null;

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
    'kind', 'todo',
    'list_name', inv.list_name,
    'list_color', inv.list_color,
    'owner_name', coalesce(inv.owner_name, split_part(inv.owner_email, '@', 1), 'Someone'),
    'permission', inv.permission
  );
end;
$$;

comment on function public.get_todo_share_invite_preview(text) is
  'Preview for todo-list /invite/<token>: safe metadata only. The token hash is the Bearer <redacted> — signed-out visitors can call this.';

revoke all on function public.get_todo_share_invite_preview(text) from public, anon;
grant execute on function public.get_todo_share_invite_preview(text) to anon, authenticated;

-- Redeem: single-use. Backfills the share's pilot id, stamps accepted_at,
-- returns the list to open. Idempotent for the same pilot re-opening.
create or replace function public.redeem_todo_share_invite(p_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  inv record;
  v_pilot_id uuid := auth.uid();
  v_email text := lower(auth.jwt()->>'email');
begin
  -- Redeem requires a signed-in pilot (the /invite page signs users in first).
  if v_pilot_id is null or v_email is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;

  -- The invite's addressed email must match the signed-in pilot's email.
  select i.id as invite_id, i.expires_at, i.accepted_at,
         s.id as share_id, s.list_id, s.shared_with_pilot_id, s.permission,
         l.name as list_name
    into inv
  from public.share_invites i
  join public.todo_list_shares s on s.id = i.todo_share_id
  join public.todo_lists l on l.id = s.list_id
  where i.token_hash = p_token_hash
    and i.todo_share_id is not null
    and lower(s.shared_with_email) = v_email;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid');
  end if;
  if inv.expires_at < now() then
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;
  if inv.accepted_at is not null then
    -- Already redeemed: only the original redeemer gets a pass-through.
    if inv.shared_with_pilot_id = v_pilot_id then
      return jsonb_build_object('ok', true, 'already', true,
        'list_id', inv.list_id, 'list_name', inv.list_name,
        'permission', inv.permission);
    end if;
    return jsonb_build_object('ok', false, 'reason', 'accepted');
  end if;

  update public.todo_list_shares
    set shared_with_pilot_id = v_pilot_id
    where id = inv.share_id
      and (shared_with_pilot_id is null or shared_with_pilot_id = v_pilot_id);

  update public.share_invites
    set accepted_at = now()
    where id = inv.invite_id;

  return jsonb_build_object('ok', true,
    'list_id', inv.list_id, 'list_name', inv.list_name,
    'permission', inv.permission);
end;
$$;

comment on function public.redeem_todo_share_invite(text) is
  'Redeem a single-use todo-list invite. Identity from auth.uid() + JWT email server-side; the invite addressed-email binding is enforced. Signed-in pilots only.';

revoke all on function public.redeem_todo_share_invite(text) from public, anon;
grant execute on function public.redeem_todo_share_invite(text) to authenticated;
