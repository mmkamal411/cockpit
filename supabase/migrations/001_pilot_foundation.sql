-- =============================================================================
-- 001_pilot_foundation.sql
-- Cockpit clean rebuild — pilot-first foundation schema
--
-- Pookie is a spacecraft; the signed-in user is the PILOT.
-- Children are OPT-IN crew members, never assumed.
--
-- RUN: paste this whole file into the Supabase dashboard SQL editor
-- (project: cockpit / hwnesewathbnfvoxtbqh) and press Run.
-- =============================================================================

-- Random IDs for every table. pgcrypto gives us gen_random_uuid().
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. pilots — the user. One row per signed-in pilot.
-- ---------------------------------------------------------------------------
create table public.pilots (
  -- Matches the Supabase auth user. A pilot row is created at signup.
  id           uuid        primary key references auth.users(id) on delete cascade,
  display_name text,
  -- IANA timezone, e.g. 'America/New_York'. Set during the 30-sec onboarding.
  timezone     text,
  created_at   timestamptz not null default now()
);

comment on table public.pilots is
  'One row per pilot (the signed-in user). The pilot is the center of everything.';
comment on column public.pilots.timezone is
  'IANA timezone set during onboarding, e.g. America/New_York.';

-- ---------------------------------------------------------------------------
-- 2. pilot_integrations — data sources the pilot connects.
--    Health, shopping, calendar, mail, school, bank, travel. Nothing is
--    connected unless the pilot chooses to connect it.
-- ---------------------------------------------------------------------------
create table public.pilot_integrations (
  id           uuid    primary key default gen_random_uuid(),
  pilot_id     uuid    not null references public.pilots(id) on delete cascade,
  -- What part of life this integration feeds: health, shopping, calendar,
  -- mail, school, bank, or travel.
  kind         text    not null
               check (kind in ('health','shopping','calendar','mail','school','bank','travel')),
  -- The provider name, e.g. 'gmail', 'google_calendar', 'plaid'.
  provider     text    not null,
  status       text    not null default 'connected'
               check (status in ('connected','disconnected','error','expired')),
  -- Provider-specific settings. NEVER store raw passwords or tokens here;
  -- secrets live in the Secure Vault, this only keeps references and flags.
  config       jsonb   not null default '{}',
  connected_at timestamptz not null default now(),
  created_at   timestamptz not null default now(),
  -- One row per pilot, per kind, per provider. Reconnecting updates the row.
  unique (pilot_id, kind, provider)
);

comment on table public.pilot_integrations is
  'Data sources the pilot connected (health, calendar, mail, etc.). Opt-in only.';
comment on column public.pilot_integrations.config is
  'Settings only. Never raw passwords or tokens — those stay in the Secure Vault.';

-- ---------------------------------------------------------------------------
-- 3. crew_members — OPT-IN children (or other people the pilot looks after).
--    A pilot with no children simply has zero rows here. That is normal.
-- ---------------------------------------------------------------------------
create table public.crew_members (
  id          uuid    primary key default gen_random_uuid(),
  pilot_id    uuid    not null references public.pilots(id) on delete cascade,
  name        text    not null,
  birthdate   date,
  -- 'child' today; the column leaves room for other relationships later.
  relationship text   not null default 'child',
  created_at  timestamptz not null default now()
);

comment on table public.crew_members is
  'Opt-in crew members (children the pilot chooses to add). Zero rows is a valid, normal state.';
comment on column public.crew_members.birthdate is
  'Used for age-tier rules (under 13 / 13-15 / 16-17 / 18+).';

-- ---------------------------------------------------------------------------
-- 4. crew_access_grants — who may see a crew member''s data, and who said so.
--    THE CHILD IS THE ACCESS AUTHORITY: a grant made by the child (or their
--    steward for under-13s) cannot be vetoed or revoked by anyone else.
--    Only the original granter can revoke.
-- ---------------------------------------------------------------------------
create table public.crew_access_grants (
  id               uuid    primary key default gen_random_uuid(),
  crew_member_id   uuid    not null references public.crew_members(id) on delete cascade,
  -- Who made this grant: 'crew_member' (the child said yes) or 'steward'
  -- (the pilot acting for an under-13 child who cannot consent yet).
  granted_by       text    not null
                   check (granted_by in ('crew_member','steward')),
  -- The pilot receiving access (e.g. the other parent).
  grantee_pilot_id uuid    not null references public.pilots(id) on delete cascade,
  -- What the grantee may see, e.g. {"grades": true, "health": false}.
  scope            jsonb   not null default '{}',
  granted_at       timestamptz not null default now(),
  -- Set when the grant is revoked. Only the granter may set this.
  revoked_at       timestamptz,
  check (revoked_at is null or revoked_at > granted_at),
  unique (crew_member_id, grantee_pilot_id)
);

comment on table public.crew_access_grants is
  'Access grants on a crew member''s data. The child (or their steward) is the authority; only the granter can revoke.';
comment on column public.crew_access_grants.granted_by is
  'crew_member = the child consented; steward = pilot acting for an under-13 child.';
comment on column public.crew_access_grants.revoked_at is
  'Only the original granter may revoke. A grantee can never revoke or edit a grant.';

-- ---------------------------------------------------------------------------
-- 5. crew_school_links — per-crew-member school sync.
--    Credentials are NEVER stored here: username_ref points at the Secure
--    Vault entry that holds the login.
-- ---------------------------------------------------------------------------
create table public.crew_school_links (
  id             uuid    primary key default gen_random_uuid(),
  crew_member_id uuid    not null references public.crew_members(id) on delete cascade,
  -- School district, e.g. 'Cobb County'.
  district       text,
  -- Secure Vault reference for the login. Never a raw username or password.
  username_ref   text    not null,
  sync_status    text    not null default 'idle'
                 check (sync_status in ('idle','syncing','ok','error')),
  last_synced_at timestamptz,
  created_at     timestamptz not null default now(),
  -- One school link per crew member for now.
  unique (crew_member_id)
);

comment on table public.crew_school_links is
  'School portal sync per crew member. Holds vault references only — never raw credentials.';
comment on column public.crew_school_links.username_ref is
  'Points at the Secure Vault entry. Raw passwords must never be stored here.';

-- ---------------------------------------------------------------------------
-- 6. todos — the pilot''s own task list.
-- ---------------------------------------------------------------------------
create table public.todos (
  id         uuid    primary key default gen_random_uuid(),
  pilot_id   uuid    not null references public.pilots(id) on delete cascade,
  title      text    not null,
  due_at     timestamptz,
  done       boolean not null default false,
  -- Where the task came from: typed by the pilot, or picked up from the
  -- calendar or mail by the AI.
  source     text    not null default 'manual'
             check (source in ('manual','calendar','mail')),
  created_at timestamptz not null default now()
);

comment on table public.todos is
  'The pilot''s task list. Source tracks whether the pilot typed it or the AI picked it up from calendar/mail.';

-- ---------------------------------------------------------------------------
-- 7. nudges — the proactive AI co-pilot''s queue.
--    "You have a meeting at 11." "Let''s pay that bill." "We''re out of milk."
-- ---------------------------------------------------------------------------
create table public.nudges (
  id           uuid    primary key default gen_random_uuid(),
  pilot_id     uuid    not null references public.pilots(id) on delete cascade,
  -- What the nudge is about.
  kind         text    not null
               check (kind in ('meeting','bill','credit','homework','grocery','travel','health')),
  title        text    not null,
  detail       text,
  priority     text    not null default 'normal'
               check (priority in ('low','normal','high','urgent')),
  -- When the AI should surface this. Null means "as soon as it makes sense".
  scheduled_for timestamptz,
  delivered_at   timestamptz,
  dismissed_at   timestamptz,
  created_at     timestamptz not null default now()
);

comment on table public.nudges is
  'Proactive AI queue: meetings, bills, homework, groceries, travel, health — the co-pilot speaking up before being asked.';

-- ---------------------------------------------------------------------------
-- 8. cockpit_layouts — the AI''s custom cockpit design per pilot.
--    As the pilot connects data, the AI arranges their cockpit: which modules
--    show, where they sit, what the pilot sees first.
-- ---------------------------------------------------------------------------
create table public.cockpit_layouts (
  id           uuid    primary key default gen_random_uuid(),
  pilot_id     uuid    not null references public.pilots(id) on delete cascade,
  -- The full layout plan: module order, visibility, applet positions, etc.
  layout       jsonb   not null default '{}',
  generated_at timestamptz not null default now(),
  -- Exactly one layout is active per pilot at a time (enforced in app logic).
  active       boolean not null default false,
  created_at   timestamptz not null default now()
);

comment on table public.cockpit_layouts is
  'AI-generated cockpit layout per pilot. One active layout at a time.';

-- ---------------------------------------------------------------------------
-- Helpful indexes
-- ---------------------------------------------------------------------------
create index idx_pilot_integrations_pilot on public.pilot_integrations (pilot_id);
create index idx_crew_members_pilot       on public.crew_members (pilot_id);
create index idx_crew_grants_crew         on public.crew_access_grants (crew_member_id);
create index idx_crew_grants_grantee      on public.crew_access_grants (grantee_pilot_id);
create index idx_crew_school_links_crew   on public.crew_school_links (crew_member_id);
create index idx_todos_pilot_due          on public.todos (pilot_id, due_at);
create index idx_nudges_pilot_scheduled   on public.nudges (pilot_id, scheduled_for);
create index idx_cockpit_layouts_pilot    on public.cockpit_layouts (pilot_id);

-- =============================================================================
-- ROW LEVEL SECURITY
-- Project setting "automatic RLS" is ON, but these statements make it explicit
-- and survive any setting drift. Auto-expose of tables is OFF, so every table
-- also gets an explicit GRANT to the authenticated role below.
-- =============================================================================

alter table public.pilots              enable row level security;
alter table public.pilot_integrations  enable row level security;
alter table public.crew_members        enable row level security;
alter table public.crew_access_grants  enable row level security;
alter table public.crew_school_links   enable row level security;
alter table public.todos               enable row level security;
alter table public.nudges              enable row level security;
alter table public.cockpit_layouts     enable row level security;

-- Force RLS even for table owners, so no role silently bypasses the rules.
alter table public.pilots              force row level security;
alter table public.pilot_integrations  force row level security;
alter table public.crew_members        force row level security;
alter table public.crew_access_grants   force row level security;
alter table public.crew_school_links    force row level security;
alter table public.todos                force row level security;
alter table public.nudges               force row level security;
alter table public.cockpit_layouts      force row level security;

-- ---------------------------------------------------------------------------
-- pilots: a pilot sees and edits ONLY their own row (auth.uid() = id).
-- ---------------------------------------------------------------------------
create policy pilots_select_own on public.pilots
  for select using (auth.uid() = id);
create policy pilots_insert_own on public.pilots
  for insert with check (auth.uid() = id);
create policy pilots_update_own on public.pilots
  for update using (auth.uid() = id) with check (auth.uid() = id);
create policy pilots_delete_own on public.pilots
  for delete using (auth.uid() = id);

-- ---------------------------------------------------------------------------
-- Pilot-owned tables: rows belong to the pilot whose pilot_id they carry.
-- ---------------------------------------------------------------------------
create policy integrations_pilot_all on public.pilot_integrations
  for all using (auth.uid() = pilot_id) with check (auth.uid() = pilot_id);

create policy crew_members_pilot_all on public.crew_members
  for all using (auth.uid() = pilot_id) with check (auth.uid() = pilot_id);

create policy todos_pilot_all on public.todos
  for all using (auth.uid() = pilot_id) with check (auth.uid() = pilot_id);

create policy nudges_pilot_all on public.nudges
  for all using (auth.uid() = pilot_id) with check (auth.uid() = pilot_id);

create policy cockpit_layouts_pilot_all on public.cockpit_layouts
  for all using (auth.uid() = pilot_id) with check (auth.uid() = pilot_id);

-- ---------------------------------------------------------------------------
-- crew_access_grants: the child-is-authority model in RLS.
--   * The steward pilot (owner of the crew_members row) manages the grants.
--   * The grantee may READ only the grants given to them — never insert,
--     update, or delete. So a grantee can never revoke a grant, and can
--     never edit someone else''s grant. Revocation is the granter''s call.
-- ---------------------------------------------------------------------------
create policy grants_steward_manage on public.crew_access_grants
  for all
  using (
    auth.uid() = (
      select cm.pilot_id from public.crew_members cm
      where cm.id = crew_access_grants.crew_member_id
    )
  )
  with check (
    auth.uid() = (
      select cm.pilot_id from public.crew_members cm
      where cm.id = crew_access_grants.crew_member_id
    )
  );

create policy grants_grantee_read_own on public.crew_access_grants
  for select using (auth.uid() = grantee_pilot_id);

-- ---------------------------------------------------------------------------
-- crew_school_links: scoped through the crew member''s pilot.
-- ---------------------------------------------------------------------------
create policy school_links_pilot_all on public.crew_school_links
  for all
  using (
    auth.uid() = (
      select cm.pilot_id from public.crew_members cm
      where cm.id = crew_school_links.crew_member_id
    )
  )
  with check (
    auth.uid() = (
      select cm.pilot_id from public.crew_members cm
      where cm.id = crew_school_links.crew_member_id
    )
  );

-- =============================================================================
-- GRANTS — auto-expose is OFF, so nothing is reachable until granted here.
-- The authenticated role gets full row-level access; RLS policies above
-- decide which rows each pilot actually sees. service_role bypasses RLS
-- for server-side jobs.
-- =============================================================================
grant select, insert, update, delete on public.pilots             to authenticated;
grant select, insert, update, delete on public.pilot_integrations to authenticated;
grant select, insert, update, delete on public.crew_members       to authenticated;
grant select, insert, update, delete on public.crew_access_grants to authenticated;
grant select, insert, update, delete on public.crew_school_links  to authenticated;
grant select, insert, update, delete on public.todos              to authenticated;
grant select, insert, update, delete on public.nudges             to authenticated;
grant select, insert, update, delete on public.cockpit_layouts    to authenticated;

-- Sequences live on the tables via defaults; grant usage for completeness.
grant usage on all sequences in schema public to authenticated;
