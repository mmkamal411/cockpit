# Signal Collection Service — Backend Evaluation
**Backend developer 1 of 2 · Cockpit personalization stack · 2026-10-13**
**Evaluation only — no production code.** Schemas here are proposals for the DB admin
(migrations start at `018_*`); tables will live in the DB admin's `02-*` / `03-*` docs.
Conceptual coordination, no blocking dependencies.

The personalization stack is 4 layers: **KNOW** (user model), **ARRANGE** (layout engine —
`cockpit_layouts` exists, nothing writes to it), **ANTICIPATE** (nudge engine built:
scoring, 6 API routes, quiet hours, dedup), **ADAPT** (not built). This doc covers the
signal-collection service that feeds all four. Privacy posture: **pilot-isolated data,
no cross-user learning.**

---

## 1. Auth-pattern audit (real code)

### 1a. Three auth idioms in the codebase — recommend ONE

| # | Pattern | Where | How it works |
|---|---------|-------|--------------|
| A | `pilotRoute(handler)` wrapper | `src/lib/api/pilotRoute.ts`; used by bills, shopping, health, calendar, crew, todos? (see note) | Builds SSR Supabase client from request cookies → `supabase.auth.getUser()` → rejects with plain-English 401; passes `{ supabase, pilotId }`; handler errors are plain English. **Cleanest: recommended for new routes.** |
| B | `requirePilot()` from `src/lib/nudges/route-helpers.ts` | `src/app/api/nudges/*` (all 6: `route.ts`, `center`, `[id]/acknowledge`, `[id]/snooze`, `preferences`, `candidates`) | Same cookie→`getUser()` flow, returns `{ ok, ctx }` where `ctx = { pilotId, supabase, timezone }` — additionally resolves the `pilots` row to get the pilot's **timezone** for quiet-hours math. 404 if no `pilots` row. |
| C | Ad-hoc inline auth | `src/app/api/todos/route.ts` (local `requirePilot()` defined lines 46–50), `src/lib/api-auth.ts` (`requirePilot()` returning `{ supabase, user }` or 401 `NextResponse`) | Same mechanism (cookie → `getUser()`), but hand-rolled per file. |

**Findings:**
- **Auth is session-cookie-based everywhere** (`createClient()` from `src/lib/supabase/server.ts` reads the SSR session cookies). There is **no middleware-based auth gate** — I found no `src/middleware.ts` performing auth redirects; auth is enforced per-route-handler. The only server-to-server exception is `POST /api/nudges/candidates`, which additionally accepts `Authorization: Bearer <service_role>` (see `src/lib/nudges/PRODUCERS.md` §1).
- **Row-level security does the real authorization.** `pilotRoute.ts` states it explicitly: "Row-level security does the authorization: every bills-table policy is owner-only (`auth.uid() = pilot_id`)". The route-level auth just proves "this request belongs to a signed-in pilot"; RLS prevents cross-pilot reads/writes even if a handler has a bug. Any new `signals` table **must follow the same owner-only RLS pattern** or the service becomes a cross-pilot exfiltration vector.
- **Inconsistency to fix:** `requirePilot` exists in **three variants** (`pilotRoute` wrapper, `route-helpers.requirePilot`, inline in todos, plus `src/lib/api-auth.ts`). The nudges variant adds the timezone lookup (extra DB round-trip per request). For the signals endpoint, **recommend pattern A (`pilotRoute`)** — no `pilots`-row lookup needed; the client already knows its timezone, and raw events should be stored with UTC timestamps. Note the tradeoff: `pilotRoute` passes `pilotId = user.id` without verifying a `pilots` row exists, which is fine since RLS keys off `auth.uid()` anyway.
- No existing analytics/event logging anywhere. A grep for PostHog/Mixpanel/Amplitude/Segment/gtag/telemetry/`sendBeacon` found **zero** matches in `src/` and `public/`. The single false positive was "tracking" in a Tailwind class (`tracking-[0.22em]` — letter-spacing).

### 1b. How the frontend currently reports user actions

**It doesn't — there is no behavioral event reporting today.**

- `src/lib/applet-bus.ts` (the applet dispatcher): `openApplet`, `closeApplet`, `closeAllApplets`, `minimizeApplet`, `restoreApplet` are **pure client-side state transitions** (`useSyncExternalStore`) — zero network calls. Opening/closing/minimizing an applet emits nothing to the server.
- `src/components/applet-host.tsx`: no `fetch` calls at all.
- The nudge-center applet (`src/components/applets/nudge-center-applet.tsx`) `fetch`es `/api/nudges/center` (read) and POSTs to `/api/nudges/preferences` — **but it does not record that a nudge was *shown***. There is no `nudge_shown` event.
- Nudge interactions ARE partially captured as **state transitions**, not events:
  - `POST /api/nudges/[id]/acknowledge` → status `acknowledged`
  - `POST /api/nudges/[id]/snooze` → status `snoozed` + `snoozed_until`
  - (per migration 009, also legacy `dismissed_at` / `delivered_at` columns)
  These tell us a nudge *was* clicked/snoozed but not when it was *surfaced* — so **click-through rate is unknowable today** (no denominator). That's the single biggest data gap for ANTICIPATE→ADAPT learning.
- Quiet-hours behavior is also invisible: `nudge_preferences` stores quiet hours, the engine schedules around them, but a nudge deferred *by* quiet hours leaves no trace of the deferral (no `quiet_hours_hit` event).

**Bottom line:** the code already has the right auth/RLS primitives and a producer-contract precedent (`PRODUCERS.md`), but behavioral signal capture is **zero** — we're designing from a green field, with the one hard requirement that the client must never break if signal POSTs fail (today's interactions would survive a backend outage; signals must not regress that).

---

## 2. Event taxonomy

### 2.1 Design principles
- **Signal ≠ state.** State transitions (nudge acknowledged) already live in domain tables. Signals are the *behavioral exhaust around* those transitions (nudge was shown at t, clicked at t+42s). They are append-only, never updated.
- **Pilot-scoped, always.** Every event carries `pilot_id` from auth, never from the client body (prevents spoofing).
- **Client timestamps are advisory.** `client_ts` is recorded but the server stamps `received_at` itself; dwell calculations use client timestamps only as hints, validated server-side (negative dwell or dwell > 24h is rejected/clamped).
- **Params are a bag of short strings.** Applet params in `applet-bus.ts` are `Record<string, string>` — the schema mirrors that; no free-form objects, no PII payloads.

### 2.2 Event list

| Event | Trigger point (client) | Payload schema | Delivery | Privacy class |
|-------|------------------------|----------------|----------|---------------|
| `applet_open` | `openApplet(id)` in `src/lib/applet-bus.ts` | `{ applet_id: string≤64, params: Record<string,string> (≤10 keys, ≤200 chars each), via: "toolbar"\|"link"\|"restore"\|"deep_link" }` | real-time (single-event POST, debounce 300ms) — opens are the primary ranking signal, cheap and infrequent | **B — behavioral.** Reveals usage patterns (e.g. `health` opened nightly). Stored pilot-isolated; aggregate only per-pilot. |
| `applet_close` | `closeApplet()` / `closeAllApplets()` | `{ applet_id: string≤64, reason: "user_close"\|"replaced"\|"close_all" }` | batched | B |
| `applet_dwell_ms` | applet host unmount OR page hide, per open session | `{ applet_id: string≤64, dwell_ms: int (0–86,400,000), interactions: int (taps inside, 0–10,000) }` | batched; **computed on close** — no separate heartbeat timer (saves volume; see §5) | B. Dwell reveals attention, not content. |
| `applet_minimize` / `applet_restore` | `minimizeApplet()` / `restoreApplet()` | `{ applet_id: string≤64 }` | batched | B |
| `nudge_shown` | nudge rendered in glass pane / Today briefing / nudge-center list (viewport impression, once per nudge per surface per session) | `{ nudge_id: uuid, surface: "glass_pane"\|"today_briefing"\|"nudge_center", rank: int (position in list) }` | real-time-ish (piggyback on the existing `/api/nudges/center` response read: client reports impressions 1s after render) | **B.** Enables CTR = clicks/impressions per nudge — currently impossible (§1b). |
| `nudge_clicked` | pilot taps a nudge → opens its target applet | `{ nudge_id: uuid, action: "open_target"\|"acknowledge" }` | real-time | B. Redundant with the existing `acknowledge` state transition; keep as signal for join-friendly CTR math, but **do not double-count** in aggregates. |
| `nudge_dismissed` | pilot dismisses without engaging | `{ nudge_id: uuid, how: "swipe"\|"x_button"\|"snooze" }` | batched | B |
| `nudge_expired_unseen` | **server-side derived**, not client-sent: nudge reaches `expires_at` with status still `delivered`/`pending` and no `nudge_shown` ever recorded | `{ nudge_id: uuid }` written by the expiry sweep (`expireOld` in `src/lib/nudges/engine.ts` already runs this sweep — emit the signal there) | server-side, during existing sweep | B. Measures "engine noise" — nudges nobody ever saw. |
| `layout_pin` / `layout_unpin` | pilot pins/unpins a module to the cockpit layout | `{ applet_id: string≤64, slot: string≤64 }` | real-time | **A — configuration.** Explicit preference, the strongest ARRANGE signal. |
| `layout_reorder` | pilot drags modules into a new order | `{ order: string[] (≤40 ids) }` | real-time (debounced 1s; this IS the write that `cockpit_layouts` should finally get) | A. |
| `correction_given` | pilot corrects Crystal ("no, that's wrong", edits an AI summary, re-ranks a nudge) | `{ context: "chat"\|"nudge"\|"briefing"\|"layout", target_ref: string≤200 (opaque id, never the corrected text), kind: "factual"\|"tone"\|"relevance"\|"other" }` | real-time | **C — feedback on AI output.** Never store the corrected text or the user's words — only the *fact and kind* of correction. This is the ADAPT fuel; keep the payload minimal by design. |
| `quiet_hours_hit` | engine defers/batches a nudge because of quiet hours | `{ nudge_id: uuid, deferred_until: ISO8601 }` — **server-side emitted** by the scheduling path in `src/lib/nudges/engine.ts` | server-side, at schedule time | B. Lets ADAPT learn whether quiet hours are too aggressive (pilot immediately opens the app at 6am and reads everything queued = hours may be fine; pilot never reads queued items = engine should say less). |
| `crystal_mode_switch` | pilot toggles Crystal ↔ Fireball | `{ from: "crystal"\|"fireball", to: "crystal"\|"fireball" }` | real-time | A. Explicit preference for KNOW (persona model). |
| `onboarding_completed` / `module_enabled` / `module_disabled` | lifecycle | `{ module: string≤64 }` | real-time | A. |

**Explicitly NOT captured:** keystrokes, message/chat text, email bodies, health values, GPS/precise location, anything from crew members' data about anyone but the pilot (child data is never a signal source — the child is the access authority; signals are pilot-behavior only). Applet `params` are allow-listed keys (`thread_id`, `bill_id`) — opaque IDs, never content.

**Privacy classes:** A = explicit configuration/preference (strongest, keep longest); B = behavioral exhaust (aggregate aggressively, raw expires fast); C = AI-feedback (minimal payload by design, raw expires fastest). Cross-pilot learning is **out of scope** — every aggregate is keyed by `pilot_id`, no cohort tables, no shared embeddings.

---

## 3. API contract design

### 3.1 Routes

```
POST /api/signals/batch        — primary ingestion (array of events)
POST /api/signals               — alias for single-event convenience (wraps into batch of 1)
GET  /api/signals/health        — liveness for the client SDK ("is collection up?"; returns {ok:true}); cheap, cacheable, no auth needed (reveals nothing)
```

**Recommendation: ONE ingestion route.** A single `POST /api/signals/batch` keeps the client SDK trivial and lets the server do one auth check + one bulk insert per flush. Do not proliferate per-event routes.

### 3.2 Request / response contract

```http
POST /api/signals/batch
Content-Type: application/json
Cookie: <pilot session>            ← same cookie auth as every other route (pattern A: pilotRoute)

{
  "events": [
    {
      "type": "applet_open",                    // required, must be in allow-list
      "client_ts": "2026-10-13T01:44:32.118-04:00",  // required, ISO-8601, within ±7 days
      "payload": { "applet_id": "bills", "via": "toolbar", "params": {} }  // per-type schema
    }
  ],
  "sdk": "cockpit-web/1.0"                      // optional, for debugging client versions
}
```

Response — **always 202, never 4xx for bad events** (see §3.5):

```json
{ "accepted": 18, "rejected": 2, "rejected_idx": [3, 11] }
```

Per-event validation errors are counted, not thrown. The client uses `rejected_idx` only for debugging; it must not retry rejected events (they're malformed, retrying won't help).

### 3.3 Auth
- **Pattern A** (`pilotRoute` from `src/lib/api/pilotRoute.ts`): cookie → `supabase.auth.getUser()` → 401 if signed out. `pilot_id` is taken **from auth only**; any `pilot_id` in the body is ignored (prevents a signed-in pilot A from writing signals as pilot B).
- The insert uses the **pilot-scoped client** so RLS enforces `pilot_id = auth.uid()` at the DB layer as a second check.
- No service-role path on this route: signals are *only* ever about the caller's own behavior. Server-side-emitted events (`nudge_expired_unseen`, `quiet_hours_hit`) bypass HTTP entirely — they're written by the engine with the service-role client inside the existing sweep/schedule code paths.

### 3.4 Rate limits, size caps, validation

| Control | Value | Rationale |
|---|---|---|
| Max events per batch | **100** | A flush every 30s can't legitimately exceed this; larger = client bug or abuse. |
| Max payload size | **64 KB** per request | Events are tiny (~150–300 bytes); 64KB ≈ 200+ events of headroom. Reject the whole batch with 413 above this (the one case where a non-202 is correct — the client should drop, not retry). |
| Per-event payload cap | **2 KB** serialized | Prevents stuffing PII/content into `params`. |
| Rate limit | **10 batches/min/pilot** (token bucket) | Normal usage ≈ 2 flushes/min max. Excess → **429 with `Retry-After`, and the client drops the batch** (signals are loss-tolerant; never queue unboundedly). |
| Type allow-list | server-side enum of §2.2 types | Unknown `type` → counted in `rejected`, never stored. Schema evolves by adding types, never by accepting free-form types. |
| `client_ts` window | ±7 days | Outside → rejected. Prevents clock-skew poisoning of dwell math and replay of ancient events. |
| `applet_id` validation | must match `^[a-z0-9_]{1,64}$` and ideally a known module id | Garbage ids are the #1 client-bug symptom; reject loudly in counts. |
| `dwell_ms` validation | 0 ≤ dwell ≤ 86,400,000; negative → rejected | Clocks go backwards on laptops; don't store nonsense. |

Rate limiting implementation note: Cloudflare Pages has no in-memory shared state across isolates — implement the token bucket in Postgres (`signals_rate_buckets` table, or reuse a generic `rate_limits` table if the DB admin creates one) or via Cloudflare Rate Limiting rules on the path. Prefer the edge rule if available (zero DB writes); the DB table is the portable fallback. Either way, **the limiter must fail open**: if the limiter itself errors, accept the batch (losing signals is worse than missing a limit — these are low-value writes, abuse upside is minimal).

### 3.5 Failure behavior — the client contract (non-negotiable)

1. **Fire-and-forget.** The SDK wraps every send in try/catch; a failed POST (network error, 401, 429, 500, timeout) **never surfaces to the pilot** — no toasts, no retries UI, no console spam beyond a single debug-level log.
2. **Timeout: 5s** per flush; abort via `AbortController`.
3. **Bounded local buffer.** Events queue in memory (cap: 500 events); on flush failure, keep the buffer but **drop oldest first** when over cap. Never persist the queue to localStorage/IndexedDB — a stale queue replaying a week's events after the laptop wakes is worse than losing them.
4. **`sendBeacon` on page hide.** Flush via `navigator.sendBeacon('/api/signals/batch', blob)` on `pagehide`/`visibilitychange` — beacon has no response handling, which is fine because the response is advisory anyway. Note: beacon sends cookies, so auth works.
5. **Offline:** if `navigator.onLine === false`, skip the flush and let the buffer cap handle it. Do not implement a retry backoff ladder — one retry on the next natural flush, then drop.
6. **Server side:** ingestion failures (DB down) → 503 with the plain-English body per the codebase convention (`serverError()` / `jsonError`); the client treats any non-2xx as "drop batch". **Never let a signals-insert failure propagate into a domain route** — server-emitted signals (`quiet_hours_hit`, `nudge_expired_unseen`) are wrapped in try/catch inside the engine; the nudge pipeline must work identically with signal collection disabled.

### 3.6 Idempotency
Each event carries a client-generated `event_id` (uuid). The server dedupes on `(pilot_id, event_id)` with a unique constraint — beacon retries and double-flushes on flaky networks don't double-count opens. On conflict: count as accepted (idempotent success), don't error.

---

## 4. Volume & cost analysis

### 4.1 Per-pilot estimate (single active pilot, active day)

Assumptions: pilot opens the app 4–6 sessions/day, opens ~12 applets/session, interacts with ~5 nudges/day.

| Event | Events/day (active pilot) | Notes |
|---|---|---|
| `applet_open` | ~60 | 12 opens × 5 sessions |
| `applet_close` | ~60 | 1:1 with opens (batched, cheap) |
| `applet_dwell_ms` | ~60 | 1:1 with opens |
| `applet_minimize`/`restore` | ~20 | minimize-heavy UX (dock chips) |
| `nudge_shown` | ~25 | 5 nudges × ~3 surfaces + Today briefing |
| `nudge_clicked` | ~5 | |
| `nudge_dismissed` | ~8 | |
| `nudge_expired_unseen` | ~3 | server-side |
| `layout_pin/unpin/reorder` | ~2 | bursty, rare |
| `correction_given` | ~3 | |
| `quiet_hours_hit` | ~4 | server-side, overnight |
| `crystal_mode_switch` | ~1 | |
| **Total** | **~250 events/day** | active day; quiet day ≈ 30–50 |

At ~250 bytes/event serialized (JSONB in Postgres, with indexes), that's **~62 KB/day/pilot raw**, or **~1.9 MB/month/pilot**. Batches: ~60 opens are real-time single POSTs (~60 requests/day — trivial), the rest flush in ~4–6 batched POSTs/day. **Total HTTP load: <100 requests/day/pilot.** Negligible.

### 4.2 At 10,000 pilots

- **Writes:** 10,000 × 250 = **2.5M rows/day** (~29 writes/sec average, spiky at morning/evening). Postgres handles this easily; Supabase free tier's constraint is not write *rate* but **total DB size (500 MB)** and **egress**.
- **Storage:** 10k × 1.9 MB/month = **~19 GB/month raw** — this **blows past the 500 MB free-tier DB limit in under a day** if raw events are kept. Raw retention must therefore be short (see §4.3). This is the controlling constraint, not request volume.
- **Egress:** signals are write-mostly; reads happen only in aggregation jobs. Egress impact ≈ 0 for ingestion. (Dashboard reads of aggregates are KBs.)
- **Edge compute:** Cloudflare Pages functions — 100 req/day/pilot × 10k = 1M requests/day. Well within Workers/Pages free limits (100k/day free on Workers; Pages Functions similar order — verify against the current plan, but this is a non-issue next to DB size).

**Verdict: write volume is safe; storage is not.** The design must treat raw signals as a **short-lived stream**, not a warehouse.

### 4.3 Retention policy (recommendation)

| Tier | Content | Retention | Rationale |
|---|---|---|---|
| **Raw events** (`pilot_signals`) | every event as received | **14 days**, rolling delete | Long enough to debug ("why did ARRANGE do that on Tuesday?"), re-run a broken aggregation, and backfill. Short enough to fit free tier: 2.5M rows/day × 14d = 35M rows ≈ at peak ~8–9 GB… **still too big for 500 MB free.** See mitigation below. |
| **Daily aggregates** (`pilot_signal_daily`, per §5) | counts/sums per pilot per day per feature | **13 months** | Covers year-over-year seasonality; tiny (one row per pilot per day ≈ 10k rows/day ≈ 3.65M rows/year, each <200 bytes ≈ <1 GB/year — fits). |
| **Rolling-window features** (`pilot_features`, per §5) | 7d/30d rolling features (open counts, CTR, dwell p50) | **current snapshot only** (overwritten on refresh) | What ARRANGE/ANTICIPATE actually read. One row per pilot per feature-family — trivial size. |
| **Corrections** (class C) | `correction_given` raw | **7 days**, then aggregate-only | Highest sensitivity (adjacent to user speech); minimize by design. |

**Free-tier mitigation for raw storage:** 500 MB at ~250 bytes/row ≈ 2M rows capacity. At 10k pilots × 250 events = 2.5M rows/**day**, 14-day raw retention is impossible on free tier. Options, in order of preference:
1. **Sample raw storage:** store 100% of class A (config) + class C (corrections, tiny volume anyway), but only a **10% sample of class B** raw events past 48h; keep 100% for 48h (debuggability window), then downsample. Aggregates are computed from the full stream *before* downsampling (see §5 — aggregation runs daily, so the full-fidelity window only needs to cover the aggregation lag).
2. **Shorter raw window:** 48–72h full fidelity + aggregates forever. Honest tradeoff: you lose the ability to re-run aggregates over a bug older than 3 days.
3. **Upgrade trigger:** define the scale point explicitly — when raw 7-day volume exceeds ~400 MB, move to Pro. At the estimated rate that's ~1,600 active pilots. **Recommend: implement (1) now; it's ~20 lines in the aggregation job and buys 10× headroom.**

Either way: **aggregates are the durable record; raw is a debugging buffer.** The ADAPT layer must never depend on raw events older than the retention window.

---

## 5. Aggregation design

### 5.1 Where aggregation runs: **scheduled job, not on-read**

- **On-read aggregation is rejected:** computing 7-day open counts by scanning 1,750 raw rows on every Today-briefing load adds latency to the hottest path and repeats the same scan thousands of times/day. 
- **Scheduled job (daily):** a server-side job (Cloudflare Cron Trigger on the Pages project, or the existing cron-worker pattern the nudge engine's `expireOld` sweep already implies) runs **once daily ~03:00 pilot-local** (or 07:00 UTC batch for all pilots — simpler; pilot-local is a v2 nicety). It reads the last N days of raw signals per pilot and upserts the aggregate tables. Runs with the service-role client (server-to-server, same precedent as `POST /api/nudges/candidates`).
- **Near-real-time exception:** exactly one feature needs freshness — `nudge CTR` for the ANTICIPATE ranker. But even that doesn't need streaming: the ranker reads the `pilot_features` snapshot, and a nudge's own `shown/clicked` counts are derivable from the daily table with <24h lag. **Accept 24h feature lag in v1.** If Mehedi later wants same-session adaptation ("stop showing me bill nudges *today*"), that's a targeted incremental counter, not a streaming architecture.
- **Idempotent + backfillable:** the job processes date-partitioned input (`where received_at >= $1 and received_at < $2`) and upserts on `(pilot_id, day)` — re-running a day is safe, which is exactly what you need when the first version of a feature definition has a bug.

### 5.2 Proposed aggregate tables (for the DB admin's design; conceptual)

**`pilot_signal_daily`** — one row per pilot per day. The durable record.
```sql
-- pilot_id uuid, day date, primary key (pilot_id, day)
-- applet_opens        jsonb  -- {"bills": 12, "health": 4, ...}  (top applets by opens)
-- applet_dwell_ms     jsonb  -- {"bills": {"total": 540000, "p50": 45000}, ...}
-- applet_minimizes    jsonb  -- {"bills": 3, ...}
-- nudge_shown         int    -- total impressions
-- nudge_shown_by_cat  jsonb  -- {"bill": 8, "meeting": 5, ...}
-- nudge_clicked       int
-- nudge_dismissed     int
-- nudge_expired_unseen int
-- quiet_hours_hits    int
-- corrections         int
-- sessions            int    -- distinct open-sessions (gap >30min between opens)
-- computed_at         timestamptz
```
JSONB maps keep the schema stable as applets are added — no DDL per new module. (DB admin: consider a GIN index only if querying inside the JSONB; the readers mostly fetch the whole row per pilot, so a plain btree on `(pilot_id, day)` suffices.)

**`pilot_features`** — one row per pilot, overwritten on each run. What ARRANGE/ANTICIPATE/ADAPT actually read.
```sql
-- pilot_id uuid primary key
-- applet_open_count_7d    jsonb  -- {"bills": 84, "health": 28}
-- applet_open_count_30d   jsonb
-- applet_dwell_p50_7d     jsonb  -- {"bills": 45000}
-- applet_affinity_score   jsonb  -- opens normalized: {"bills": 0.62, ...} (sums to 1) — ARRANGE's layout ranker input
-- nudge_ctr_7d            numeric -- clicks / shown (null if shown < 10 — don't personalize on noise)
-- nudge_ctr_by_category_30d jsonb
-- dismiss_rate_7d         numeric
-- quiet_hours_hit_rate_7d numeric -- hits / (hits + shown overnight) — is quiet-hours config wrong?
-- correction_rate_30d     numeric
-- active_days_7d          int
-- sessions_per_day_7d     numeric
-- computed_at             timestamptz
```

**`pilot_signal_downsample`** — internal bookkeeping: which raw days have been aggregated + downsampled, so the retention janitor knows what's safe to delete. (Or fold into a generic `jobs_watermark` table if the DB admin prefers.)

### 5.3 Refresh cadence

| Job | Cadence | Input window | Output |
|---|---|---|---|
| `aggregate-signals-daily` | daily 03:10 pilot-local (batch: 07:00 UTC v1) | previous full day raw | upsert `pilot_signal_daily` |
| `refresh-features` | daily, chained after aggregation | last 30d of `pilot_signal_daily` | overwrite `pilot_features` |
| `janitor-raw-signals` | daily, after aggregation | raw older than 48h → downsample to 10% (class B only); raw older than 14d (A) / 7d (C) → delete | storage bounded |
| `backfill` | manual trigger only | arbitrary date range | re-run aggregation (idempotent upsert makes this safe) |

**Ordering guarantee:** the janitor must never delete raw data for a day the aggregator hasn't processed — coordinate via the watermark table, or simply run janitor ≥6h after aggregation in the same scheduled worker (simplest correct: one cron worker that does aggregate → refresh → janitor in sequence).

### 5.4 How the layers consume this

- **KNOW:** reads `pilot_features` for the user model (active hours from `sessions`, persona affinity from `applet_affinity_score`, `crystal_mode_switch` history from daily table).
- **ARRANGE:** `applet_affinity_score` + `layout_pin/unpin` events (class A, read from a small `pilot_layout_prefs` projection or directly from recent daily rows) → initial layout ranking. **This is what finally writes to `cockpit_layouts`.**
- **ANTICIPATE:** `nudge_ctr_7d`, `nudge_ctr_by_category_30d`, `dismiss_rate_7d` → per-pilot score adjustments in `src/lib/nudges/engine.ts` (multiplicative prior on category scores; never below a floor — exploration beats pure exploitation).
- **ADAPT:** `correction_given` counts + `quiet_hours_hit_rate_7d` → the not-yet-built adaptation policy.

---

## 6. Per-phase acceptance criteria

### Phase 0 — Contract + SDK (no DB writes yet)
- [ ] `POST /api/signals/batch` exists behind `pilotRoute` auth; returns 202 `{accepted, rejected, rejected_idx}`; 401 when signed out (verified with curl, signed-in vs signed-out).
- [ ] Validation enforced: >100 events → 413 or truncation-counted; >64KB → 413; unknown type → rejected-counted; `client_ts` outside ±7d → rejected; `dwell_ms` < 0 → rejected. Each covered by a unit test on the validator.
- [ ] Client SDK module (`lib/signals/`) implements: in-memory buffer (cap 500, drop-oldest), 30s flush timer, `pagehide` → `sendBeacon`, 5s abort timeout, try/catch around everything, zero UI on failure. **Acceptance: block the endpoint (offline devtools) and confirm the app behaves identically — no errors, no toasts, no console errors.**
- [ ] `pilot_id` spoofing test: body containing another pilot's `pilot_id` is ignored; stored row carries the auth pilot.
- [ ] RLS on the raw table: pilot A cannot `SELECT` pilot B's signals via the anon key (verified with two test pilots).

### Phase 1 — Raw ingestion live
- [ ] `applet_open`/`close`/`dwell_ms` wired into `src/lib/applet-bus.ts` (single choke point — all applet transitions flow through it); `nudge_shown` wired into nudge-center + glass pane + Today briefing render paths (impression = rendered, deduped per nudge per surface per session).
- [ ] 7-day soak on staging with 1 pilot: raw row count/day within 2× of the §4.1 estimate (50–500/day); zero client-side errors attributable to the SDK; p95 ingestion latency < 300ms.
- [ ] Server-emitted `quiet_hours_hit` wired into the nudge scheduling path; `nudge_expired_unseen` wired into `expireOld`.
- [ ] **CTR becomes measurable:** for any nudge with ≥1 `nudge_shown`, `clicks/shown` is computable by joining signals to `nudges`.

### Phase 2 — Aggregation + retention
- [ ] Daily cron worker runs `aggregate → refresh-features → janitor` in sequence; watermark table prevents janitor from deleting unaggregated days.
- [ ] `pilot_signal_daily` backfill works: delete a day's aggregate, re-run, row is identical (idempotency test).
- [ ] `pilot_features` snapshot exists for every pilot with ≥1 day of signals; readers (ARRANGE ranker, nudge scorer) handle a missing row gracefully (cold start = global defaults, no crash).
- [ ] Storage check: raw table size stays bounded — after 21 days of staging data, raw ≤ 3 days full-fidelity + downsampled remainder; projection to 10k pilots fits the mitigation in §4.3.
- [ ] `correction_given` payload audit: no free-text user content in any stored row (spot-check 100 rows).

### Phase 3 — Consumption (ADAPT groundwork)
- [ ] ARRANGE reads `applet_affinity_score` and writes its first rows to `cockpit_layouts` (the table stops being write-only-empty).
- [ ] ANTICIPATE applies per-pilot CTR priors in `engine.ts` scoring with a documented floor (e.g. category score multiplier clamped to [0.5, 1.5]); an A/B-style before/after on staging shows dismiss_rate not regressing.
- [ ] Privacy review: confirm no aggregate table contains cross-pilot data, no cohort computations, and the admin `view-as` path cannot expose another pilot's signals (admin reads go through the same RLS).

---

## 7. Open questions for the parent / DB admin

1. **Cron runtime:** does the Pages project have a Cron Trigger worker already, or should the aggregation live in the existing worker that hosts the nudge sweep? (Affects where the service-role key is available.)
2. **Known-module allow-list:** should `applet_id` be validated against a registry table (strict, needs DDL per new module) or a regex (loose, typo-tolerant)? Recommend regex v1, registry v2.
3. **`nudge_clicked` duplication:** the `acknowledge` endpoint already records the click as state. Keep both (signal for CTR math) or derive clicks from state transitions and drop the signal? Recommend keep-both v1 for join simplicity, revisit if volume surprises.
4. **Mehedi's call:** the 48h-full-fidelity + 10%-sample vs 14d-full raw retention tradeoff (§4.3) is a product decision about debuggability vs free-tier headroom — needs his explicit pick before the janitor is built.
5. **Child-signal boundary:** confirmed out of scope — signals are pilot-behavior only. If a future phase wants crew-module usage signals, that needs a separate privacy review (child is the access authority).

---

## 8. File references (audit trail)

- `src/lib/api/pilotRoute.ts` — pattern A auth wrapper (recommended for `/api/signals/*`)
- `src/lib/nudges/route-helpers.ts` — pattern B `requirePilot` (+timezone lookup); `readJson` non-throwing body parse
- `src/lib/api-auth.ts` — pattern C standalone `requirePilot`
- `src/app/api/todos/route.ts` — pattern C inline auth (lines 46–50)
- `src/app/api/nudges/route.ts` (+ `center/`, `[id]/acknowledge/`, `[id]/snooze/`, `preferences/`, `candidates/`) — the 6 nudge routes; `candidates` is the sole service-role exception
- `src/lib/nudges/PRODUCERS.md` — producer contract precedent (auth either session-cookie or service-role bearer)
- `src/lib/nudges/engine.ts` — `expireOld` sweep (hook point for `nudge_expired_unseen`); quiet-hours scheduling (hook point for `quiet_hours_hit`)
- `src/lib/applet-bus.ts` — applet dispatcher; zero network calls today; the single choke point to instrument
- `src/components/applet-host.tsx` — no fetches; render-layer, not reporting-layer
- `src/components/applets/nudge-center-applet.tsx` — fetches `/api/nudges/center`, POSTs preferences; no impression logging
- `supabase/migrations/001_pilot_foundation.sql` — `cockpit_layouts`, `pilots` tables
- `supabase/migrations/009_nudges.sql` — nudge pipeline columns, `nudge_preferences` (quiet hours)
- No `src/middleware.ts` auth gate; no analytics SDK in `src/` or `public/`
