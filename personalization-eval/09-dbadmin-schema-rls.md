# DB ADMIN — Personalization Data Layer: Schema Audit, RLS Review, Migration 018 Draft

**Evaluator:** DB Admin (subagent `d424ad8a-3c1f-4b08-872a-6009a9c17a8b`)
**Date:** 2026-10-13
**Scope:** KNOW / ARRANGE / ANTICIPATE / ADAPT stack — schema, RLS, migration 018. Evaluation only; no `.sql` files written.

---

## 1. Schema audit — `cockpit_layouts` (current state)

**Source:** `supabase/migrations/001_pilot_foundation.sql`, §8 (lines ~300–330).

Exact current definition:

```sql
create table public.cockpit_layouts (
  id           uuid        primary key default gen_random_uuid(),
  pilot_id     uuid        not null references public.pilots(id) on delete cascade,
  layout       jsonb       not null default '{}',
  generated_at timestamptz not null default now(),
  active       boolean     not null default false,
  created_at   timestamptz not null default now()
);
```

- Index: `idx_cockpit_layouts_pilot on (pilot_id)`.
- RLS: `enable + force`; single policy `cockpit_layouts_pilot_all for all using (auth.uid() = pilot_id) with check (auth.uid() = pilot_id)`; grants `select, insert, update, delete` to `authenticated`.
- "Exactly one layout is active per pilot at a time" is **enforced in app logic only** — there is no DB constraint. Multiple `active = true` rows per pilot are possible today.
- **Nothing writes to it.** Confirmed by repo grep: `cockpit_layouts` appears only in `001_pilot_foundation.sql`, `005_admin_helpers.sql` (admin whitelist), `supabase/migrations/README.md` (verification queries), and `src/app/api/admin/users/[id]/view-as/route.ts` (admin read of the active layout). No ARRANGE writer exists anywhere in `src/`.

### Fitness verdict for an AI-driven layout: **NOT FIT — replace, don't extend.**

| Requirement | Current table | Verdict |
|---|---|---|
| Per-module scores | Not present (opaque `layout` blob) | ❌ |
| Tiers / ordering rationale | Not present | ❌ |
| User pins overriding AI | Not present (can't distinguish user-set vs AI-set) | ❌ |
| Version history / audit | Rows accumulate, no `version` number, no `created_by`, no ordering guarantee beyond `generated_at` | ❌ |
| Explanations ("why is this here") | Not present | ❌ |
| Single-active guarantee | App-logic only, unenforceable | ❌ |
| Corrections linkage (ADAPT) | No target id a correction could point at | ❌ |

The opaque-JSONB blob was fine as a placeholder. An AI layout needs **structured, queryable, auditable** columns: ordered module list with per-module `score`, `tier`, `pinned`, `reason`; a monotonic `version`; `created_by in ('ai','user','system')`; append-only history. Extending `cockpit_layouts` with five more nullable JSONB columns repeats the original sin. The right move is a new append-only `layout_versions` table (see §6 and §8).

---

## 2. RLS audit — 001, 009, 014

### Patterns used

**001_pilot_foundation.sql** — the canonical pattern for all pilot-owned tables:
```sql
create policy <table>_pilot_all on public.<table>
  for all using (auth.uid() = pilot_id) with check (auth.uid() = pilot_id);
```
Plus `enable row level security` **and** `force row level security` on every table, explicit `grant select, insert, update, delete ... to authenticated` (auto-expose is OFF, so no grant = no access), and service_role bypasses RLS for server-side jobs (documented, not in SQL — it's inherent to service_role).

**009_nudges.sql** — `nudge_preferences` mirrors the 001 pattern exactly (`nudge_preferences_pilot_all`, force RLS, grant to authenticated). Uses `if not exists` / `drop policy if exists` defensively — good rerun hygiene. Adds a partial unique index (`uq_nudges_pilot_dedup_live`) — good.

**014_chat_threads.sql** — `chat_threads` mirrors 001. `chat_messages` (no `pilot_id` column of its own) scopes through its parent:
```sql
create policy chat_messages_pilot_all on public.chat_messages
  for all
  using (auth.uid() = (select t.pilot_id from public.chat_threads t where t.id = chat_messages.thread_id))
  with check (...same...);
```
Correct and safe (the subquery re-applies the thread's own RLS; no recursion issue). 014 also uses `drop policy if exists` before create — safe for reruns. 001's policies lack the `drop if exists` guard, but 001 is a one-shot foundation migration, so acceptable.

### Is the isolation consistent? **Yes — every personalization-relevant table is pilot-isolated.** ✅

| Table | Isolation mechanism | Gap? |
|---|---|---|
| pilots | `auth.uid() = id` per-op policies | None |
| pilot_integrations, crew_members, todos, nudges, cockpit_layouts | single `for all` pilot_id policy | None |
| nudge_preferences | single `for all` pilot_id policy | None |
| chat_threads | single `for all` pilot_id policy | None |
| chat_messages | scoped via parent thread's pilot_id | None |
| crew_access_grants / crew_school_links | steward-pilot + grantee-read model | None (child-authority model, distinct from personalization but sound) |

### Gaps found (none are live privacy holes; fix in 018 where noted)

1. **No cross-pilot read protection needed beyond RLS — but one sanctioned exception exists:** `src/app/api/admin/users/[id]/view-as/route.ts` reads any pilot's `cockpit_layouts` via a service_role admin client. This is intentional (admin support view, audit-logged via `logAdminAction`, secrets stripped). Any new personalization table admins need to inspect must be added to the 005 allowlist (`admin_whitelisted_table` + `ADMIN_TABLES` in `src/lib/admin/routeHandler.ts`) or admins go blind. **018 decision:** do NOT whitelist raw `personalization_signals` (too granular) — whitelist `pilot_preferences`, `layout_versions`, `personalization_corrections` only, if the build team wants admin visibility. Default: none.
2. **`active` uniqueness unenforced** (001 comment admits app-logic enforcement). Moot after the replace decision, but any reader of `cockpit_layouts` today must `order by generated_at desc limit 1` rather than trust `active`.
3. **`anon` role gets no grants** (only `authenticated`) — correct; anonymous users can't touch any of these tables even if RLS were misconfigured, because auto-expose is OFF.
4. **No `updated_at` triggers** anywhere in 001/009/014 (`nudge_preferences.updated_at` is never auto-bumped). 018 includes a shared `set_updated_at` trigger for the mutable tables.
5. **Signals tables don't exist yet** — the 4-layer stack's KNOW layer has no raw-signal store; the nudge engine's dismissals/acts are the only behavioral exhaust, and they aren't aggregated. This is exactly what 018 creates.

---

## 3. New schema design (migration 018)

Five new tables. Naming: `pilot_` prefix for pilot-scoped personalization tables (matches `pilot_integrations`, `pilot_preferences` reads naturally next to `nudge_preferences`).

### 3.1 `personalization_signals` — raw behavioral exhaust (KNOW, raw)

Append-only. Every module open/close, applet minimize, pin, hide, nudge dismiss/act, chat module mention. High insert volume, short retention.

```sql
create table public.personalization_signals (
  id         uuid        primary key default gen_random_uuid(),
  pilot_id   uuid        not null references public.pilots(id) on delete cascade,
  event_type text        not null check (event_type in (
               'module_open','module_close','module_pin','module_unpin',
               'module_hide','module_restore','applet_minimize','applet_expand',
               'nudge_delivered','nudge_dismissed','nudge_acted','nudge_snoozed',
               'chat_module_ask','checkin_submit','search_module')),
  module     text        not null,   -- e.g. 'bills','health','school','chat','today'
  metadata   jsonb       not null default '{}'::jsonb,  -- durations_ms, nudge_id, query text (pilot's own; never another pilot's)
  created_at timestamptz not null default now()
);
```

### 3.2 `personalization_aggregates` — rolled-up counts (KNOW, compact)

Written by a server-side aggregation job (service_role), read by the layout engine. Tiny, kept indefinitely.

```sql
create table public.personalization_aggregates (
  pilot_id     uuid    not null references public.pilots(id) on delete cascade,
  module       text    not null,
  window       text    not null check (window in ('7d','30d','90d')),
  opens        integer not null default 0,
  seconds_spent bigint not null default 0,
  pins         integer not null default 0,
  hides        integer not null default 0,
  nudge_acts   integer not null default 0,
  nudge_dismissals integer not null default 0,
  last_signal_at timestamptz,
  updated_at   timestamptz not null default now(),
  primary key (pilot_id, module, window)
);
```

### 3.3 `pilot_preferences` — the user model (KNOW, durable)

Explicit preferences (pilot-set) + learned weights (ADAPT output), versioned. One row per pilot; upserted.

```sql
create table public.pilot_preferences (
  pilot_id    uuid  primary key references public.pilots(id) on delete cascade,
  -- Explicit: onboarding answers, module toggles, quiet hours override, mode default.
  -- Example: {"daily_rhythm": "early", "modules_hidden": ["travel"], "orb_speed": "calm"}
  explicit    jsonb not null default '{}'::jsonb,
  -- Learned: module affinity weights, nudge receptivity per category, rhythm features.
  -- Example: {"module_affinity": {"bills": 0.92, "health": 0.71}, "nudge_receptivity": {"bill": 0.85}}
  learned     jsonb not null default '{}'::jsonb,
  -- Bumped every time the ADAPT loop rewrites `learned`. Readers can cache on this.
  model_version integer not null default 1,
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);
```

### 3.4 `layout_versions` — append-only layout history (ARRANGE)

**This replaces `cockpit_layouts` as the source of truth.** Every layout decision is a row; latest `version` per pilot is current. Full audit trail, diffable, corrections-linkable.

```sql
create table public.layout_versions (
  id         uuid        primary key default gen_random_uuid(),
  pilot_id   uuid        not null references public.pilots(id) on delete cascade,
  version    integer     not null,
  -- Ordered module plan. Each entry:
  -- {"module": "bills", "score": 0.92, "tier": "hero", "pinned": false,
  --  "reason": "Bill due in 2 days; opened 12x this week"}
  modules    jsonb       not null default '[]'::jsonb,
  created_by text        not null check (created_by in ('ai','user','system')),
  -- Free-text note for user/system rows (e.g. "pilot dragged Health to hero").
  note       text,
  created_at timestamptz not null default now(),
  unique (pilot_id, version)
);
```

### 3.5 `personalization_corrections` — pilot feedback (ADAPT input)

Dismissals, pins, explicit corrections. Feeds the learning loop; also the pilot's proof that "the AI listened."

```sql
create table public.personalization_corrections (
  id          uuid        primary key default gen_random_uuid(),
  pilot_id    uuid        not null references public.pilots(id) on delete cascade,
  target_type text        not null check (target_type in ('layout_version','nudge','module')),
  target_id   uuid,                       -- layout_versions.id or nudges.id; null when target is a module name
  module      text,                       -- set when target_type = 'module'
  feedback    text        not null check (feedback in ('dismiss','pin','unpin','correction','restore')),
  note        text,                       -- pilot's own words, e.g. "stop showing travel, I never fly"
  created_at  timestamptz not null default now()
);
```

---

## 4. Extend-vs-replace decision: **REPLACE**

`cockpit_layouts` is **superseded by `layout_versions`** as the single source of truth. Justification:

1. **Nothing writes to `cockpit_layouts` today** (grep-verified: only the admin view-as route reads it, and it reads zero-or-one active rows). There is no live writer to migrate, no dual-write period needed, no rollback risk from existing traffic.
2. The opaque-JSONB design is the wrong foundation — extending it with more nullable JSONB columns preserves an unqueryable, unauditable shape. The requirements (scores, tiers, pins, reasons, created_by, monotonic versions) need first-class columns.
3. Append-only history is a **privacy and trust feature**, not just engineering: a pilot can ask "why does my cockpit look like this?" and we can answer with the exact version row, its reasons, and the corrections that shaped it. `cockpit_layouts` can never do that.
4. The unenforced `active` flag is a latent bug; `max(version)` per pilot is self-evidently correct and index-friendly.

**Deprecation plan (not in 018):** 018 creates `layout_versions` and seeds v1 from any existing active `cockpit_layouts` row (optional commented block). A later migration (019+) switches admin view-as to `layout_versions`, then drops `cockpit_layouts`. Keep the drop separate so it's reviewable on its own.

---

## 5. RLS policies (draft, in 018)

Same battle-tested 001 pattern on every new table: `enable + force RLS`, single `for all` pilot-scoped policy, grants to `authenticated` only. service_role bypasses RLS — that's the sanctioned path for the aggregation/learning jobs, which **must** use service_role and **must** scope every query by `pilot_id` in application code (defense in depth; a job bug must never produce cross-pilot writes).

```sql
alter table public.personalization_signals    enable row level security;
alter table public.personalization_aggregates enable row level security;
alter table public.pilot_preferences          enable row level security;
alter table public.layout_versions            enable row level security;
alter table public.personalization_corrections enable row level security;

alter table public.personalization_signals    force row level security;
alter table public.personalization_aggregates force row level security;
alter table public.pilot_preferences          force row level security;
alter table public.layout_versions            force row level security;
alter table public.personalization_corrections force row level security;

create policy signals_pilot_all on public.personalization_signals
  for all using (auth.uid() = pilot_id) with check (auth.uid() = pilot_id);
create policy aggregates_pilot_all on public.personalization_aggregates
  for all using (auth.uid() = pilot_id) with check (auth.uid() = pilot_id);
create policy pilot_preferences_all on public.pilot_preferences
  for all using (auth.uid() = pilot_id) with check (auth.uid() = pilot_id);
create policy layout_versions_pilot_all on public.layout_versions
  for all using (auth.uid() = pilot_id) with check (auth.uid() = pilot_id);
create policy corrections_pilot_all on public.personalization_corrections
  for all using (auth.uid() = pilot_id) with check (auth.uid() = pilot_id);

grant select, insert, update, delete on public.personalization_signals    to authenticated;
grant select, insert, update, delete on public.personalization_aggregates to authenticated;
grant select, insert, update, delete on public.pilot_preferences          to authenticated;
grant select, insert, update, delete on public.layout_versions            to authenticated;
grant select, insert, update, delete on public.personalization_corrections to authenticated;
```

**Explicit non-goals (privacy):** no policy grants any pilot read access to another pilot's rows; no cross-pilot aggregate views; the learning job computes per-pilot weights only — **no cross-user model training** on signal data, per the NON-NEGOTIABLE constraint. If a future "population baseline" feature is ever proposed, it requires a new reviewed migration and explicit pilot opt-in.

**Isolation verification queries** (run post-migration with two test pilots):
```sql
-- As pilot A (authenticated JWT): must return 0 rows for pilot B's data
select count(*) from public.personalization_signals where pilot_id <> auth.uid();
select count(*) from public.layout_versions            where pilot_id <> auth.uid();
select count(*) from public.pilot_preferences          where pilot_id <> auth.uid();
-- All three must return 0.
```

---

## 6. Indexes (draft, in 018)

Hot queries and their indexes:

| Hot query | Index |
|---|---|
| Latest layout per pilot: `where pilot_id=$1 order by version desc limit 1` | `idx_layout_versions_pilot_version on layout_versions (pilot_id, version desc)` |
| Aggregates per module+window (upsert + read) | PK `(pilot_id, module, window)` covers it; add `idx_aggregates_pilot_window on (pilot_id, window, module)` for window-scoped reads |
| Recent signals per pilot (aggregation job scans last N hours) | `idx_signals_pilot_created on personalization_signals (pilot_id, created_at desc)` |
| Retention purge: `delete ... where created_at < now() - interval '90 days'` | `idx_signals_created on personalization_signals (created_at)` |
| Corrections by pilot, newest first | `idx_corrections_pilot_created on personalization_corrections (pilot_id, created_at desc)` |
| Corrections targeting a specific layout/nudge | `idx_corrections_target on personalization_corrections (pilot_id, target_type, target_id)` |
| User model read (single-row PK lookup) | PK on `pilot_preferences(pilot_id)` — no extra index |

Note: `personalization_signals` is insert-heavy; keep indexes minimal (the two above). If volume exceeds ~50M rows, move to monthly range partitioning on `created_at` — flagged as a future optimization, not 018.

---

## 7. Retention & scale

### Retention policy (recommendation)

| Data | Retain | Rationale |
|---|---|---|
| `personalization_signals` (raw) | **90 days**, hard purge | Raw exhaust is the highest-volume, highest-sensitivity store. 90 days covers the 90d aggregate window; anything older has already been rolled up. Purge via scheduled job (pg_cron or app cron calling a service_role function) — `delete ... where created_at < now() - interval '90 days'` in batches of ~50k to avoid long locks. |
| `personalization_aggregates` | Indefinite | Tiny (one row per pilot×module×window). This is the durable KNOW layer after raw purge. |
| `layout_versions` | **Last 50 versions per pilot**, keep all `created_by='user'` rows | 50 versions ≈ ~1 year at weekly regeneration. User-created versions are the pilot's explicit intent — never auto-purge. |
| `personalization_corrections` | **2 years** | Feedback is sparse and is the ADAPT training signal; keep long but bounded. |
| `pilot_preferences` | Indefinite (one row per pilot) | The user model itself; `model_version` gives rollback. |

### Storage estimate — 10,000 pilots

Assumptions (conservative-active pilot): 30 signal events/day, ~300 bytes/row (uuid + text + small JSONB + overhead); 31 modules × 3 windows aggregates; layout regenerates weekly (~5 KB JSONB); 2 corrections/month.

| Table | Rows @10k pilots | Size |
|---|---|---|
| `personalization_signals` (90d × 30/d × 10k) | 27,000,000 | **~8.1 GB** |
| `personalization_aggregates` (10k × 31 × 3) | 930,000 | ~0.11 GB |
| `layout_versions` (10k × 50 kept × 5 KB) | 500,000 | ~2.5 GB (worst case; typical ~0.5 GB at 10 kept) |
| `personalization_corrections` (10k × 48) | 480,000 | ~0.1 GB |
| `pilot_preferences` | 10,000 | negligible |
| **Total** | | **~11 GB worst case / ~9 GB typical** |

Fits comfortably in Supabase Pro (8 GB included, then $0.125/GB-mo). Dominant cost is raw signals — if growth demands it, cut raw retention to 60 days (~5.4 GB) or compress `metadata` before insert. No action needed at 018 time.

---

## 8. Migration 018 — full draft SQL

> **STATUS: DRAFT — do not run as-is.** Build phase finalizes numbering (018 assumes 017_shopping_shares lands first) and reviews. Follows repo conventions: `pgcrypto`, `create ... if not exists`, `force row level security`, explicit grants, table/column comments, `set_updated_at` trigger (new — 001/009/014 lack it), idempotent policy creation via `drop policy if exists`.

```sql
-- =============================================================================
-- 018_personalization.sql — Personalization data layer (KNOW / ARRANGE / ADAPT)
--
-- 4-layer stack: KNOW (user model) -> ARRANGE (layout engine) ->
-- ANTICIPATE (nudge engine, built in 009) -> ADAPT (learning from corrections).
--
-- Creates:
--   personalization_signals     raw behavioral exhaust, 90-day retention
--   personalization_aggregates  rolled-up counts per pilot/module/window
--   pilot_preferences           the user model: explicit prefs + learned weights, versioned
--   layout_versions             append-only AI layout history (SUPERSEDES cockpit_layouts)
--   personalization_corrections pilot feedback: dismiss / pin / correction
--
-- PRIVACY (NON-NEGOTIABLE): every table is pilot-isolated via RLS
-- (pilot_id = auth.uid()). No cross-pilot reads. No cross-user learning.
-- Aggregation/learning jobs use service_role and MUST scope by pilot_id
-- in application code.
--
-- RUN: paste into the Supabase dashboard SQL editor AFTER 017_shopping_shares.sql.
-- =============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Shared updated_at trigger (001/009/014 never had one; new tables get it).
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. personalization_signals — raw behavioral exhaust (KNOW, raw).
--    Append-only. Insert-heavy. 90-day retention enforced by scheduled purge.
-- ---------------------------------------------------------------------------
create table if not exists public.personalization_signals (
  id         uuid        primary key default gen_random_uuid(),
  pilot_id   uuid        not null references public.pilots(id) on delete cascade,
  event_type text        not null check (event_type in (
                 'module_open','module_close','module_pin','module_unpin',
                 'module_hide','module_restore','applet_minimize','applet_expand',
                 'nudge_delivered','nudge_dismissed','nudge_acted','nudge_snoozed',
                 'chat_module_ask','checkin_submit','search_module')),
  -- Which module the event concerns: 'bills','health','school','chat','today',...
  module     text        not null,
  -- Event detail: {"durations_ms": 42000}, {"nudge_id": "<uuid>"}.
  -- The pilot's own data only; never another pilot's.
  metadata   jsonb       not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.personalization_signals is
  'Raw behavioral signals per pilot (KNOW layer). Append-only, 90-day retention. Feeds personalization_aggregates.';
comment on column public.personalization_signals.metadata is
  'Event detail JSON. Pilot''s own data only — never another pilot''s.';

-- ---------------------------------------------------------------------------
-- 2. personalization_aggregates — rolled-up counts (KNOW, compact).
--    Written by the server-side aggregation job (service_role). Read by the
--    layout engine. Kept indefinitely; one row per pilot x module x window.
-- ---------------------------------------------------------------------------
create table if not exists public.personalization_aggregates (
  pilot_id         uuid    not null references public.pilots(id) on delete cascade,
  module           text    not null,
  window           text    not null check (window in ('7d','30d','90d')),
  opens            integer not null default 0,
  seconds_spent    bigint  not null default 0,
  pins             integer not null default 0,
  hides            integer not null default 0,
  nudge_acts       integer not null default 0,
  nudge_dismissals integer not null default 0,
  last_signal_at   timestamptz,
  updated_at       timestamptz not null default now(),
  primary key (pilot_id, module, window)
);

comment on table public.personalization_aggregates is
  'Per-pilot module engagement rollups (KNOW layer). Upserted by the aggregation job; the durable signal after raw purge.';

create trigger trg_aggregates_updated_at
  before update on public.personalization_aggregates
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. pilot_preferences — the user model (KNOW, durable).
--    One row per pilot. explicit = pilot-set; learned = ADAPT output.
--    model_version bumps on every learned rewrite so readers can cache on it.
-- ---------------------------------------------------------------------------
create table if not exists public.pilot_preferences (
  pilot_id      uuid    primary key references public.pilots(id) on delete cascade,
  explicit      jsonb   not null default '{}'::jsonb,
  learned       jsonb   not null default '{}'::jsonb,
  model_version integer not null default 1,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.pilot_preferences is
  'The pilot''s user model (KNOW layer): explicit preferences + learned weights. One row per pilot.';
comment on column public.pilot_preferences.explicit is
  'Pilot-set preferences: onboarding answers, hidden modules, rhythm, orb behavior.';
comment on column public.pilot_preferences.learned is
  'ADAPT-learned weights: module affinity, nudge receptivity, rhythm features. Rewritten by the learning job only.';
comment on column public.pilot_preferences.model_version is
  'Bumped on every learned rewrite. Readers may cache on (pilot_id, model_version).';

create trigger trg_pilot_preferences_updated_at
  before update on public.pilot_preferences
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. layout_versions — append-only layout history (ARRANGE).
--    SUPERSEDES public.cockpit_layouts as the source of truth.
--    Latest version per pilot = current layout. Full audit trail.
-- ---------------------------------------------------------------------------
create table if not exists public.layout_versions (
  id         uuid        primary key default gen_random_uuid(),
  pilot_id   uuid        not null references public.pilots(id) on delete cascade,
  version    integer     not null,
  -- Ordered module plan; each entry:
  -- {"module":"bills","score":0.92,"tier":"hero","pinned":false,
  --  "reason":"Bill due in 2 days; opened 12x this week"}
  -- tier in ('hero','primary','secondary','drawer').
  modules    jsonb       not null default '[]'::jsonb,
  created_by text        not null check (created_by in ('ai','user','system')),
  -- Free text for user/system rows, e.g. "pilot dragged Health to hero".
  note       text,
  created_at timestamptz not null default now(),
  unique (pilot_id, version)
);

comment on table public.layout_versions is
  'Append-only AI layout history (ARRANGE layer). Supersedes cockpit_layouts. Latest version per pilot is current.';
comment on column public.layout_versions.modules is
  'Ordered module plan with per-module score, tier (hero|primary|secondary|drawer), pinned flag, and human-readable reason.';
comment on column public.layout_versions.created_by is
  'ai = layout engine, user = pilot rearranged manually, system = seed/migration.';

-- ---------------------------------------------------------------------------
-- 5. personalization_corrections — pilot feedback (ADAPT input).
--    Dismissals, pins, explicit corrections. The learning loop's training
--    signal and the pilot's proof the AI listened.
-- ---------------------------------------------------------------------------
create table if not exists public.personalization_corrections (
  id          uuid        primary key default gen_random_uuid(),
  pilot_id    uuid        not null references public.pilots(id) on delete cascade,
  target_type text        not null check (target_type in ('layout_version','nudge','module')),
  -- layout_versions.id or nudges.id; null when target_type = 'module'.
  target_id   uuid,
  -- Set when target_type = 'module', e.g. 'travel'.
  module      text,
  feedback    text        not null check (feedback in ('dismiss','pin','unpin','correction','restore')),
  -- The pilot's own words, e.g. "stop showing travel, I never fly".
  note        text,
  created_at  timestamptz not null default now()
);

comment on table public.personalization_corrections is
  'Pilot feedback on personalization (ADAPT input): dismissals, pins, corrections. Feeds learned weights.';

-- ---------------------------------------------------------------------------
-- Indexes — hot queries: latest layout per pilot, aggregates per module+window,
-- recent signals per pilot, retention purge, corrections lookup.
-- ---------------------------------------------------------------------------
create index if not exists idx_layout_versions_pilot_version
  on public.layout_versions (pilot_id, version desc);

create index if not exists idx_aggregates_pilot_window
  on public.personalization_aggregates (pilot_id, window, module);

create index if not exists idx_signals_pilot_created
  on public.personalization_signals (pilot_id, created_at desc);

-- Retention purge scans by age across pilots; keep it off the hot path.
create index if not exists idx_signals_created
  on public.personalization_signals (created_at);

create index if not exists idx_corrections_pilot_created
  on public.personalization_corrections (pilot_id, created_at desc);

create index if not exists idx_corrections_target
  on public.personalization_corrections (pilot_id, target_type, target_id);

-- ---------------------------------------------------------------------------
-- RLS — pilot-isolated, no cross-pilot reads. Mirrors the 001 pattern:
-- enable + force, single FOR ALL policy, grants to authenticated only.
-- service_role bypasses RLS for the aggregation/learning jobs, which MUST
-- scope every query by pilot_id in application code.
-- ---------------------------------------------------------------------------
alter table public.personalization_signals    enable row level security;
alter table public.personalization_aggregates enable row level security;
alter table public.pilot_preferences          enable row level security;
alter table public.layout_versions            enable row level security;
alter table public.personalization_corrections enable row level security;

alter table public.personalization_signals    force row level security;
alter table public.personalization_aggregates force row level security;
alter table public.pilot_preferences          force row level security;
alter table public.layout_versions            force row level security;
alter table public.personalization_corrections force row level security;

drop policy if exists signals_pilot_all     on public.personalization_signals;
drop policy if exists aggregates_pilot_all  on public.personalization_aggregates;
drop policy if exists pilot_preferences_all on public.pilot_preferences;
drop policy if exists layout_versions_pilot_all on public.layout_versions;
drop policy if exists corrections_pilot_all on public.personalization_corrections;

create policy signals_pilot_all on public.personalization_signals
  for all using (auth.uid() = pilot_id) with check (auth.uid() = pilot_id);

create policy aggregates_pilot_all on public.personalization_aggregates
  for all using (auth.uid() = pilot_id) with check (auth.uid() = pilot_id);

create policy pilot_preferences_all on public.pilot_preferences
  for all using (auth.uid() = pilot_id) with check (auth.uid() = pilot_id);

create policy layout_versions_pilot_all on public.layout_versions
  for all using (auth.uid() = pilot_id) with check (auth.uid() = pilot_id);

create policy corrections_pilot_all on public.personalization_corrections
  for all using (auth.uid() = pilot_id) with check (auth.uid() = pilot_id);

grant select, insert, update, delete on public.personalization_signals     to authenticated;
grant select, insert, update, delete on public.personalization_aggregates  to authenticated;
grant select, insert, update, delete on public.pilot_preferences           to authenticated;
grant select, insert, update, delete on public.layout_versions             to authenticated;
grant select, insert, update, delete on public.personalization_corrections to authenticated;

grant usage on all sequences in schema public to authenticated;

-- ---------------------------------------------------------------------------
-- OPTIONAL SEED (review before running): carry any existing active
-- cockpit_layouts row forward as layout v1 so no pilot loses a layout.
-- Today nothing writes to cockpit_layouts, so this is expected to seed
-- zero rows; keep for safety.
-- ---------------------------------------------------------------------------
-- insert into public.layout_versions (pilot_id, version, modules, created_by, note)
-- select
--   cl.pilot_id,
--   1,
--   coalesce(cl.layout -> 'modules', '[]'::jsonb),
--   'system',
--   'Seeded from legacy cockpit_layouts on 018'
-- from public.cockpit_layouts cl
-- where cl.active = true
--   and not exists (
--     select 1 from public.layout_versions lv
--     where lv.pilot_id = cl.pilot_id
--   );

-- ---------------------------------------------------------------------------
-- Retention helper: purge raw signals older than 90 days.
-- Call from a scheduled job (pg_cron or app cron) with service_role.
-- Batched to avoid long locks.
-- ---------------------------------------------------------------------------
create or replace function public.purge_old_signals(batch_size integer default 50000)
returns bigint language plpgsql security definer as $$
declare
  deleted_count bigint := 0;
  batch         bigint;
begin
  loop
    delete from public.personalization_signals
    where id in (
      select id from public.personalization_signals
      where created_at < now() - interval '90 days'
      limit batch_size
    );
    get diagnostics batch = row_count;
    deleted_count := deleted_count + batch;
    exit when batch < batch_size;
  end loop;
  return deleted_count;
end;
$$;

comment on function public.purge_old_signals(integer) is
  'Retention: hard-purge personalization_signals older than 90 days, in batches. service_role only (security definer, no RLS bypass needed for callers).';

-- Lock the helper down: only service_role may execute.
revoke all on function public.purge_old_signals(integer) from public, anon, authenticated;
```

---

## 9. Per-phase acceptance criteria

### KNOW (user model + signals)
- [ ] 018 applies cleanly on a fresh clone **and** reruns idempotently on the live project (all `if not exists` / `drop policy if exists` guards hold).
- [ ] `pilot_preferences` row auto-created on pilot signup (trigger or app code — build team to wire; DB side: `pilot_id` PK + FK cascade ready).
- [ ] Isolation test: with two test pilots' JWTs, `select count(*) ... where pilot_id <> auth.uid()` returns **0** on all five new tables.
- [ ] `purge_old_signals()` deletes only rows > 90 days, returns the count, and is **not** executable by `authenticated`/`anon` (verify via `has_function_privilege`).
- [ ] Aggregation job upserts `(pilot_id, module, window)` with `on conflict do update` and never writes a row for a different pilot than the one it was invoked for (code review gate).

### ARRANGE (layout engine)
- [ ] Layout engine writes a new `layout_versions` row per regeneration; `version` is strictly increasing per pilot (unique constraint enforces).
- [ ] "Current layout" query — `where pilot_id=$1 order by version desc limit 1` — uses `idx_layout_versions_pilot_version` (verify with `explain`) and p99 < 50 ms at 10k pilots.
- [ ] Every `modules[]` entry carries `module`, `score`, `tier`, `pinned`, `reason`; a row missing any field is rejected by engine-side validation (DB stores JSONB; contract enforced in code + documented here).
- [ ] User rearrangement writes `created_by='user'` rows; AI never overwrites a `pinned=true` module placement without a new correction.
- [ ] Admin view-as switched from `cockpit_layouts` to latest `layout_versions` before `cockpit_layouts` is dropped (separate migration).

### ANTICIPATE (nudge engine — already built in 009)
- [ ] Nudge engine reads `pilot_preferences.learned->'nudge_receptivity'` and `explicit` categories; `min_score` from `nudge_preferences` still honored (no regression).
- [ ] `nudge_dismissed` / `nudge_acted` signals are emitted to `personalization_signals` (closes the loop between ANTICIPATE and KNOW).

### ADAPT (learning from corrections)
- [ ] Each `personalization_corrections` row produces a `learned` weight update in `pilot_preferences` within 24h; `model_version` increments.
- [ ] **No cross-pilot learning:** the learning job's queries are all `where pilot_id = $1`; a code-review checklist item, plus a quarterly audit query confirming no aggregate or weight row references more than one pilot's signals.
- [ ] Pilot-visible proof: the next `layout_versions` row after a correction references it in a `reason` (e.g. "Moved Travel to drawer — you hid it on Oct 14").

---

## 10. Open questions for the build phase

1. **Signal emission point:** client-side (Supabase JS direct insert, RLS-protected) vs server-side API route? Client-side is simpler and RLS already allows it; server-side gives dedup/validation. Recommend server-side `/api/signals` for the write path, RLS as backstop.
2. **Aggregation cadence:** hourly rollup job vs nightly? Hourly keeps the "latest layout" fresh; nightly is cheaper. Recommend hourly for `7d` window, nightly for `30d`/`90d`.
3. **pg_cron availability:** if the project doesn't enable pg_cron, the purge + rollup run as app crons with service_role. Either way, `purge_old_signals()` is the single purge implementation.
4. **`cockpit_layouts` drop timing:** propose migration 019 or 020, after admin view-as is switched and 30 days of `layout_versions` production writes.
5. **Admin visibility:** confirm whether `pilot_preferences`, `layout_versions`, `personalization_corrections` join the 005 admin whitelist (my recommendation: yes for those three; never `personalization_signals` raw).

---

*End of DB Admin evaluation. Draft SQL above is review-ready; no `.sql` file written per task instructions.*
