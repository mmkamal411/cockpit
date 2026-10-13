# 06 — Layout Scoring/Ranking Engine (ARRANGE): Backend Evaluation

**Author:** Backend Developer (2 of 2) · **Date:** 2026-10-13 · **Status:** evaluation only — no production code written

## 0. Executive verdict

`cockpit_layouts` exists in `supabase/migrations/001_pilot_foundation.sql` (lines 181–197) but is a **write-only-by-design shell**: five columns, a free-form `jsonb` blob, **zero writers** outside admin count/delete, and no ordering/ranking logic anywhere in the app. The schema is *structurally* viable (jsonb can carry anything) but *contractually* insufficient — there is no defined blob shape, no per-module score field, no pin state, no prominence tiers, no version history discipline, no explanation strings, and no single-active enforcement beyond a code comment. The nudge engine (`src/lib/nudges/engine.ts`) already solves 70% of the design problems layout scoring will face (pure scoring functions, dedupe, preference gates, dual-mode auth, structured errors, a producer contract doc); the layout engine should be built as its sibling, not a reinvention. Recommended: one follow-up migration (018) + `src/lib/layout/engine.ts` mirroring nudge patterns + three API routes.

---

## 1. Schema audit — `cockpit_layouts` as it stands

### 1.1 Definition (verbatim from 001)

```sql
create table public.cockpit_layouts (
  id           uuid    primary key default gen_random_uuid(),
  pilot_id     uuid    not null references public.pilots(id) on delete cascade,
  layout       jsonb   not null default '{}',
  generated_at timestamptz not null default now(),
  active       boolean not null default false,
  created_at   timestamptz not null default now()
);
```

**What exists:**
| Element | Location | Notes |
|---|---|---|
| Table + `pilot_id` FK with `on delete cascade` | `001_pilot_foundation.sql:185-194` | Pilot-isolated by FK; good |
| `layout jsonb not null default '{}'` | line 189 | The "full layout plan" — module order, visibility, applet positions. No shape contract anywhere |
| `generated_at` / `created_at` | lines 190/193 | Timestamps exist |
| `active boolean default false` | line 192 | "Exactly one layout is active per pilot at a time (enforced in app logic)" — **comment only, no constraint** |
| Index `idx_cockpit_layouts_pilot (pilot_id)` | line 209 | Read path OK |
| RLS: `cockpit_layouts_pilot_all` (auth.uid() = pilot_id, FOR ALL) | lines 264-265, 225/235 | Pilot-isolated; matches privacy principle |
| GRANT select/insert/update/delete to `authenticated` | line 323 | Pilot-scoped client can write; consistent with nudges |

**Writer inventory (grep across `src/`, `supabase/`, `docs/`):**
- The only references are **admin** count/delete: `src/app/api/admin/users/[id]/route.ts` (lines 126, 143, 164, 175, 249), `src/lib/admin/routeHandler.ts:85`, `005_admin_helpers.sql:40,66`.
- **No INSERT, no UPDATE, no SELECT in product code.** The ARRANGE layer's stated purpose ("the AI arranges their cockpit") has zero implementation. This is the confirmed "big gap."

### 1.2 Current ordering behavior (what renders today)

There is **no ordering logic anywhere** — every surface is hardcoded:
- `src/components/toolbar.tsx:58-62` — toolbar stations are a literal array: Home · Today · Crystal · Progress · More. Crystal is always centered (product-locked, line 70).
- `src/components/applets/more-applet.tsx:30-38` — `SEEDLINGS` is a hardcoded array; sections render in fixed order: Core stations → Crew → Seedlings.
- `src/app/home/page.tsx` (55 lines) — static glass pane, no module ordering.
- `src/components/applets/today-applet.tsx:176+` — briefing sections (`overdue, schedule, dueToday, nudges, school, handled`) render in fixed order.

Any AI layout work must therefore **start from a static world** — there is no existing ranking to degrade, only hardcoded orders to eventually replace with a layout-driven source of truth. This is actually good news: no legacy ranking contract to preserve.

---

## 2. Gap analysis — is `cockpit_layouts` sufficient?

**Sufficient for:** pilot isolation, single-row lookup, schema flexibility (jsonb), admin visibility, audit trail of generation times.

**Insufficient for an AI-driven layout engine.** Seven gaps, each one a hard blocker:

| # | Gap | Why it matters |
|---|---|---|
| G1 | **No blob contract.** `layout jsonb` has no documented shape. Every reader/writer must agree on key names by convention. One renamed key silently corrupts the render path. | Readers and engine drift apart; no validation possible |
| G2 | **No per-module score field.** Scores would live inside the opaque blob (or not at all). No way to answer "why is Bills above Health?" from the DB; no SQL-observable ranking for debugging or the ADAPT layer. | Debuggability, ADAPT input |
| G3 | **No prominence tiers.** The product needs tiers (hero / standard / tucked-away), not just an order. A total order without tiers can't express "show top 3 prominently, tuck the rest in More." | Can't express the actual design intent |
| G4 | **No pin/override state.** "The AI proposes, the user disposes" requires durable pin state: which module is pinned, when, in what order. Without it, the next recompute silently unpins the user's explicit choice — violating the #1 principle. | Principle violation, user trust |
| G5 | **No explanation strings stored.** Every automated decision must carry a human-readable explanation ("why am I seeing this?"). The nudge engine has `whyLine()` for exactly this. Layouts have nowhere to persist `reason`. | Transparency principle unenforceable |
| G6 | **Single-active is app-logic-only.** Two concurrent recomputes can both set `active=true`; the "exactly one active" invariant is a comment (line 191), not a constraint. Race condition by design. | Data corruption under concurrency |
| G7 | **No recompute provenance.** No `version`, no `trigger` (what caused this layout — 7am refresh? bill due? user pin?), no input fingerprint. When Mehedi asks "why did my cockpit change?", there is no answerable record. | RCA impossible |

**Recommendation:** do not rework the table in place — 001 is foundation. Ship a follow-up migration **`018_layouts_v2.sql`** (next free number; note 015→016 rename precedent in repo conventions) that:

```sql
-- additive only; existing rows keep working
alter table public.cockpit_layouts
  add column if not exists version        integer not null default 1,
  add column if not exists trigger        text    not null default 'initial',
  -- JSON fingerprint of the inputs that produced this layout
  -- (time bucket, top nudge scores, integration kinds, usage snapshot).
  -- Enables "what changed?" diffing and ADAPT learning.
  add column if not exists input_fingerprint jsonb not null default '{}';

-- Single-active, enforced by the database, not a comment.
create unique index if not exists uq_cockpit_layouts_pilot_active
  on public.cockpit_layouts (pilot_id)
  where active;

-- New: durable user overrides. The AI proposes (cockpit_layouts),
-- the user disposes (layout_overrides). Overrides always win at render.
create table if not exists public.layout_overrides (
  id          uuid primary key default gen_random_uuid(),
  pilot_id    uuid not null references public.pilots(id) on delete cascade,
  module_id   text not null,               -- e.g. 'bills', 'today', 'health'
  -- pin | reorder | hide. 'pin' locks module to hero tier. 'hide' tucks it
  -- regardless of score. 'reorder' carries an explicit rank.
  kind        text not null check (kind in ('pin','reorder','hide')),
  -- Client-generated UUID per gesture; unique index = idempotent retries.
  client_op_id uuid not null,
  payload     jsonb not null default '{}', -- e.g. {"rank": 2}
  created_at  timestamptz not null default now(),
  constraint  uq_layout_overrides_op unique (pilot_id, client_op_id)
);
alter table public.layout_overrides enable row level security;
alter table public.layout_overrides force row level security;
create policy layout_overrides_pilot_all on public.layout_overrides
  for all using (auth.uid() = pilot_id) with check (auth.uid() = pilot_id);
grant select, insert, update, delete on public.layout_overrides to authenticated;
create index if not exists idx_layout_overrides_pilot on public.layout_overrides (pilot_id);

-- Blob contract note: cockpit_layouts.layout shape is versioned in
-- src/lib/layout/schema.ts (JSON-Schema + TS types + zod-style validation
-- in the route layer). Blob shape:
-- { "version": int, "modules": [ { "id", "rank", "tier", "score",
--   "reason", "signals": {...} } ], "toolbar": ["today","crystal","progress"] }
```

Design rationale for the split:
- **`cockpit_layouts` = the AI's proposal.** Regenerated freely; old rows kept (`active=false`) as version history — G7 solved by retention, not by a separate history table.
- **`layout_overrides` = the user's disposal.** Separate table so user intent is never overwritten by a recompute, survives layout regeneration, and feeds the ADAPT layer as clean training signal (each row is a labeled preference: "user pinned X", "user hid Y").
- **Explicit `reorder`/`pin`/`hide` kinds** instead of a boolean `pinned` column: extensible (future: `snooze_module`?), and the `client_op_id` unique index gives the route layer free idempotency on retry (mirrors the nudge engine's 23505-dedupe pattern).

---

## 3. Engine design — the ranking service

### 3.1 Where it lives

**`src/lib/layout/engine.ts`** — pure functions, mirroring `src/lib/nudges/engine.ts`:
- `scoreModule(module, signals, now) → number` (unit-testable, `node src/lib/layout/engine.test.ts`)
- `applyOverrides(scored, overrides) → ranked` (pins/hides win — G4 enforced in code, not hope)
- `assignTiers(ranked) → tiered` (hero / standard / tucked)
- `reasonLine(module, signals) → string` (mirror of nudge `whyLine()`)
- Thin DB touchpoints take a minimal Supabase-shaped client, exactly like nudge `dedupeCheck`/`submitCandidate`.

### 3.2 Inputs

| Input | Source | Refresh cadence |
|---|---|---|
| **Time-of-day bucket** | `pilots.timezone` (already in 001); buckets: morning (5–11), midday (11–17), evening (17–22), night (22–5) | every recompute |
| **Recency/frequency aggregates** | per-module open counts 7d/30d — needs a lightweight `module_usage` journal or reuse of existing analytics if any (check Phase 1; start with 7d opens recorded by a fire-and-forget POST from applet-host) | rolling |
| **Event triggers** | **aggregate nudge scores per module** (see §5 — reuse, don't duplicate) + direct high-priority signals (bill due ≤48h, grade drop, meeting <1h) | on nudge insert |
| **Explicit pins/overrides** | `layout_overrides` table | read every render |
| **Integration state** | `pilot_integrations.kind` — a module with no data connected can never outrank one with live data; unconnected modules get a score floor (they still show as seedlings, never as "connect your X!" upsells — matches nudge PRODUCERS.md §7 rule) | on connect/disconnect |
| **Pilot preferences** | future `layout_preferences` (mirrors `nudge_preferences`): quiet layout churn during focus hours? max hero count? — Phase 2 | — |

### 3.3 Scoring formula

Mirror the nudge engine's legibility: `score = base × recency × event × timefit`, each factor named and rounded, every factor explainable:

```
base        = module base weight (mirror CATEGORY_BASE_SCORES;
              e.g. today 70, bills 65, health 45, school 60, crystal 50, progress 40)
recency     = 1 + 0.3 × (opens_7d / max_opens_7d)        // 1.0–1.3, what you use floats up
event       = 1 + 0.5 × (max_live_nudge_score / 135)    // 1.0–1.5, nudge aggregates drive this
timefit     = module × time-bucket multiplier            // e.g. calendar ×1.2 in morning,
                                                       // bills ×1.15 on 1st/15th-ish cadence
score       = round(base × recency × event × timefit, 2)
```

Overrides are applied **after** scoring, never inside it: `pin` → rank 0, locked; `hide` → tier tucked regardless of score; `reorder` → explicit rank. This keeps scoring honest (no gaming — same rule as nudge PRODUCERS.md §2: "don't game it") and makes override behavior total and predictable.

### 3.4 Tiers and output

```ts
type ModuleTier = "hero" | "standard" | "tucked";
interface RankedModule {
  id: string;            // 'today' | 'bills' | 'health' | ... (31-module registry)
  rank: number;          // 1..N after overrides
  tier: ModuleTier;      // hero: top ≤3 by default; tucked: score < floor or hidden
  score: number;         // final computed score (pins still carry their computed score for honesty)
  pinned: boolean;       // true when an override placed it
  reason: string;        // plain-English explanation, stored per module
  signals: Record<string, number>; // the factor values — debuggability
}
```

`GET /api/layout` returns `{ version, trigger, computed_at, modules: RankedModule[], toolbar: [...] }`. The toolbar's five stations stay product-locked (Home · Today · Crystal · Progress · More per Mehedi's direction), but **the order and prominence of module cards inside Today/More/home glass pane are layout-driven**.

### 3.5 Where it runs — recompute strategy, not request-time scoring

**Decision: cached layout, recomputed on trigger — never scored per page load.**

- Request-time scoring per page load would add 3–5 Supabase round trips (nudges, usage, overrides, integrations) to every navigation. On Cloudflare Workers with cold starts, that's a latency tax on the most latency-sensitive surface (the cockpit home).
- The layout changes slowly (minutes/hours), while page loads are frequent. Cache invalidation is cheap because the trigger set is small and explicit.

**Recompute triggers:**
| Trigger | Mechanism |
|---|---|
| Time-of-day bucket change | cron, 4×/day per timezone batch (or a single hourly sweeper checking buckets) |
| New high-priority nudge (`score ≥ 65`, mirror nudge "important" threshold) | hook inside `submitCandidate` — after insert, enqueue layout recompute for that pilot (fire-and-forget, never blocks nudge delivery; golden rule applies) |
| Integration connected/disconnected | hook in the integrations route |
| Explicit user override (pin/reorder/hide) | `POST /api/layout/override` recomputes synchronously (user expects immediate feedback) |
| Periodic refresh | every 4h fallback so usage-decay and timefit don't go stale |
| Module usage signal | ADAPT phase; Phase 1 only via periodic refresh |

**Caching:**
- DB is the cache: the single `active=true` row per pilot (now DB-enforced via the partial unique index).
- Read path: `GET /api/layout` = one indexed SELECT + overrides SELECT. Client (cockpit-shell/applet-host) caches for the session; revalidate on `visibilitychange` or after override POST.
- `version` increments per recompute; `trigger` records the cause; `input_fingerprint` lets a later run (or Mehedi, or the ADAPT layer) answer "what changed and why."
- Concurrency: two recomputes racing → the partial unique index on `(pilot_id) where active` makes the loser's `active=true` UPDATE/INSERT fail with 23505; the route catches it and re-reads the winner (same pattern as nudge dedupe races).

**Failure mode:** recompute fails → pilot keeps the last good active layout (never blank, never 500 — matches Mehedi's NO BLANK PAGES rule). `GET /api/layout` with no active row → returns the static default order (today's hardcoded order, extracted to a constant) with `trigger: "default"`.

---

## 4. API contracts

All routes: `export const dynamic = "force-dynamic"`, `jsonError`/`requirePilot`/`readJson` from a shared `src/lib/layout/route-helpers.ts` (or reuse the nudges one — it's generic; recommendation: extract to `src/lib/api-helpers.ts` in Phase 1 so both engines share it).

### 4.1 `GET /api/layout`

- **Auth:** pilot session (requirePilot). No service-key path — layouts are read by the pilot's own client.
- **Response 200:**
```json
{
  "version": 7,
  "trigger": "nudge:bill:high",
  "computed_at": "2026-10-13T05:30:00Z",
  "modules": [
    { "id": "today", "rank": 1, "tier": "hero", "score": 96.25, "pinned": false,
      "reason": "Three items need you before noon — this is the fastest path through them.",
      "signals": { "base": 70, "recency": 1.12, "event": 1.28, "timefit": 1.2 } }
  ],
  "toolbar": ["today", "crystal", "progress"]
}
```
- **Errors:** 401 (not signed in), 503 (DB unreachable) via `jsonError` — plain-English, never stack traces.

### 4.2 `POST /api/layout/override`

Body:
```json
{ "module_id": "bills", "kind": "pin", "client_op_id": "<uuid>", "payload": { "rank": 1 } }
```
- **Validation (422 on bad input):** `module_id` ∈ the 31-module registry; `kind` ∈ `pin|reorder|hide`; `client_op_id` valid UUID; `payload.rank` integer 1..31 when kind=reorder. Mirror the candidates-route validation style (explicit checks, plain-English errors).
- **Idempotency:** `client_op_id` unique per pilot. Retry with the same op id → 200 `{ action: "deduped" }`, no duplicate row (23505 caught, same as nudge dedupe).
- **Effect:** insert override row → synchronous recompute → return the new layout (same shape as GET). The user sees their pin take effect immediately.
- **Auth:** pilot session; `pilot_id` must match (403 otherwise) — same guard as nudge candidates.

### 4.3 `DELETE /api/layout/override` (or `POST /api/layout/override` with `kind: "unpin"`)

- Removes the override row(s) for `(pilot_id, module_id)` → recompute. Lets the user "let the AI decide again." Keep as DELETE with `module_id` query param for REST clarity.

### 4.4 `POST /api/layout/recompute` (internal)

- **Auth:** service key only (`Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>`), like nudge candidates' server path. Body: `{ "pilot_id": "uuid", "trigger": "cron:time-bucket" }`.
- Called by cron + the nudge-insert hook. Returns `{ version, trigger }` or 200 `{ action: "skipped", reason }` when the fingerprint is unchanged (don't burn a version on a no-op recompute — cheap diff before write).

### 4.5 ADAPT feedback path

Every override row is inherently an ADAPT training signal. Phase 1: the recompute service reads recent overrides as hard constraints (already the design). Phase 2 (ADAPT layer): a `layout_feedback` view/aggregation over `layout_overrides` + `module_usage` feeds a per-pilot weight tuner — e.g., "pilot pinned Health twice and hid Shopping → raise health base ×1.1, lower shopping ×0.9." Because overrides are a separate table with timestamps, this is a clean labeled dataset — **no cross-pilot learning ever** (each pilot's tuner reads only their rows; the RLS policy already guarantees it).

---

## 5. Nudge-integration design — reuse, don't duplicate

**The core decision: the layout engine consumes nudge aggregates; it never re-detects events.**

The nudge engine already knows "what deserves attention" — scored, deduped, quiet-hours-aware, with producers in calendar/bills/todos/school/weather. If the layout engine re-implemented "bill due soon" detection, we'd have two sources of truth for the same event, two scoring formulas to keep in sync, and double-counting (bill due → nudge score boost AND layout event boost both firing).

**Integration point — `moduleNudgeSignals(pilot_id)` in `src/lib/layout/engine.ts`:**
```ts
// One query per recompute: max live nudge score + count, grouped by source.
select source, max(score) as peak, count(*) as live_count
from nudges
where pilot_id = $1 and status in ('pending','delivered','snoozed')
group by source;
```
- `source` maps 1:1 to module ids (producers already send `source: "bills" | "calendar" | ...` per PRODUCERS.md §1; enforce the module registry as the allowed `source` values in a later nudge migration, or maintain a mapping table in the layout lib).
- The `event` factor in §3.3 **is** this aggregate: `1 + 0.5 × (peak_score / 135)`. A module with an urgent nudge (score ≥85) floats up; a module with no live nudges gets `event = 1.0`.
- **No double-counting by construction:** the layout engine never looks at bills/todos/calendar tables directly for urgency — only at the nudge table's already-deduped, already-scored aggregates. One event, one score, two consumers (nudge center shows the item; layout promotes the module).

**Hook direction (nudge → layout, not layout → nudge):**
- After `submitCandidate` returns `inserted` with `score ≥ 65`, the candidates route fire-and-forgets a recompute enqueue for that pilot (internal fetch to `POST /api/layout/recompute` with the service key, wrapped in try/catch — the golden rule: a layout failure must never break nudge delivery).
- Below 65: no recompute. Layout churn is the enemy — the pilot's cockpit shouldn't reshuffle because a low-key health tip arrived. (Mirrors the nudge engine's own restraint: `min_score` gates.)

**What layout scoring adds that nudges don't:**
1. **Time-of-day fit** — nudges are event-driven; layouts are rhythm-driven (calendar matters more at 8am than 8pm).
2. **Usage recency** — nudges don't know you open Health every morning; the layout should.
3. **Tiers, not just order** — nudges rank items; layout assigns prominence tiers across modules.
4. **Pins** — nudges have snooze/acknowledge; layout has the stronger "user disposes" primitive.

**Shared code:** `whyLine()` (nudge) → `reasonLine()` (layout) should share a tone guide; propose a `src/lib/personalization/copy.ts` with the plain-English voice rules (grandmother test, no jargon) so both engines explain themselves the same way. Category base scores (`CATEGORY_BASE_SCORES`) and module base weights should be defined once and cross-referenced, not copy-pasted.

---

## 6. Acceptance criteria

### Phase 1 — Foundation (schema + engine + routes + one surface)
- [ ] Migration `018_layouts_v2.sql` applied: `version`/`trigger`/`input_fingerprint` columns, partial unique index on active, `layout_overrides` table with RLS + grants. Verified via REST: insert two `active=true` rows for one pilot → second fails (23505).
- [ ] `src/lib/layout/engine.ts`: pure `scoreModule`, `applyOverrides`, `assignTiers`, `reasonLine`; `engine.test.ts` runnable with `node src/lib/layout/engine.test.ts` covering: pin always wins, hide always tucks, identical inputs → identical output, empty signals → default order.
- [ ] Blob shape documented and validated: `src/lib/layout/schema.ts` with TS types + runtime validation in the route layer; an invalid blob fails closed to the default order (never a blank page).
- [ ] `GET /api/layout`: returns ranked modules with reasons for a pilot with no prior layout (default order, `trigger: "default"`); 401 when signed out; 503-shaped `jsonError` when DB unreachable.
- [ ] `POST /api/layout/override`: pin → module appears first on next GET; retry with same `client_op_id` → `{ action: "deduped" }`; invalid `module_id` → 422 with plain-English error; another pilot's session → 403.
- [ ] `DELETE /api/layout/override`: unpin → module returns to scored position.
- [ ] `POST /api/layout/recompute`: service-key only; pilot session → 403; unchanged fingerprint → `{ action: "skipped" }`.
- [ ] One surface wired: the More applet (or Today) renders module order from `GET /api/layout` instead of the hardcoded array; with no layout, renders exactly today's order (no visual regression).
- [ ] Every automated placement carries a `reason` string that passes the grandmother test (reviewed by a human, not just asserted).

### Phase 2 — Triggers + nudge integration
- [ ] Nudge-insert hook: nudge with score ≥65 → layout recompute enqueued; nudge delivery latency unchanged (hook is fire-and-forget; measured).
- [ ] Time-bucket cron: layout recomputes at bucket boundaries; version increments and `trigger` records `cron:time-bucket`.
- [ ] No layout churn: 10 consecutive recomputes with unchanged inputs → ≤1 version bump (fingerprint diff works).
- [ ] Race test: two concurrent recomputes → exactly one active row; loser re-reads winner.
- [ ] `module_usage` journal exists and `recency` factor moves a frequently-opened module up within 24h.

### Phase 3 — ADAPT input (not built in this phase; criteria for the handoff)
- [ ] `layout_overrides` rows are queryable per pilot as labeled preferences (pin/hide/reorder with timestamps).
- [ ] No cross-pilot reads possible: RLS policy test — pilot A's session cannot select pilot B's overrides.
- [ ] Weight-tuner design doc references this table as its sole training input.

---

## 7. Open questions for Mehedi / the squad

1. **Module registry:** the 31-module shell — is there a canonical id list yet (design team's IA docs)? The engine needs `module_id` values to be stable before overrides reference them.
2. **Default order:** today's hardcoded toolbar/More order is the de-facto default — blessed as the `trigger: "default"` fallback, or does design want a different cold-start order?
3. **Hero count:** top-3 hero tier default — right number? (Mirrors "top-3 ranked actionable next steps" from the class-page design rule.)
4. **Quiet layout churn:** should there be "do not reshuffle my cockpit during these hours" (layout quiet hours), or is nudge-level quiet hours enough?
5. **`layout_preferences` table:** defer to Phase 2, or create alongside 018 with `max_hero_count`/`churn_ok` columns now?
6. **Crystal's role:** does the Crystal chat get to propose layout changes conversationally ("want me to pin Bills up top?") — and if so, does that flow through `POST /api/layout/override` with a `source: "crystal"` marker?

---

## Appendix — files cited

| File | Lines | What |
|---|---|---|
| `supabase/migrations/001_pilot_foundation.sql` | 181–197 | `cockpit_layouts` definition |
| `supabase/migrations/001_pilot_foundation.sql` | 209 | `idx_cockpit_layouts_pilot` |
| `supabase/migrations/001_pilot_foundation.sql` | 225, 235, 264–265 | RLS enable/force + `cockpit_layouts_pilot_all` |
| `supabase/migrations/001_pilot_foundation.sql` | 323 | GRANT to `authenticated` |
| `supabase/migrations/009_nudges.sql` | 1–130 | Nudge schema patterns to mirror (constraints, backfill discipline, `nudge_preferences`) |
| `src/lib/nudges/engine.ts` | full | Scoring, `whyLine()`, `getPreferences()`, dedupe, quiet hours |
| `src/lib/nudges/route-helpers.ts` | full | `requirePilot`, `jsonError`, `readJson` |
| `src/lib/nudges/PRODUCERS.md` | full | Producer contract — the doc pattern layout consumers need |
| `src/app/api/nudges/candidates/route.ts` | 1–80 | Validation + dual-mode auth pattern |
| `src/components/toolbar.tsx` | 58–62 | Hardcoded station order (no ranking today) |
| `src/components/applets/more-applet.tsx` | 30–38, 46–130 | Hardcoded `SEEDLINGS` + fixed section order |
| `src/app/home/page.tsx` | full | No ordering logic |
| `src/components/applets/today-applet.tsx` | 176–340 | Fixed briefing-section order |
| `src/app/api/admin/users/[id]/route.ts` | 126–175, 249 | Only existing `cockpit_layouts` readers (admin counts/delete) |
