# 03 — LLM Context Pipeline: Evaluation (AI Engineer 1/2)

**Date:** 2026-10-13 · **Evaluator:** AI Engineer (context pipeline) · **Mode:** evaluation only — no production code changed
**Repo:** `~/workspace/cockpit` (`mmkamal411/cockpit`, main) · **Scope:** what reaches the LLM on every Crystal/Fireball turn, and what should.

---

## 1. Current-pipeline audit

### 1.1 Files that form the pipeline

| File | Role in the pipeline |
|---|---|
| `src/app/api/chat/route.ts` (232 lines) | HTTP entry. Resolves thread, fetches history (`HISTORY_LIMIT = 20`), calls `buildContextBundle`, POSTs `{ messages, context, mode }` to the worker, persists the reply. |
| `src/lib/chat/context.ts` (196 lines) | Assembles the `ChatContextBundle`. This IS the context pipeline. |
| `src/lib/chat/mode.ts` | Persona keyword routing (client-applet concern; not context). |
| `src/lib/chat/sse.ts` | Streaming wrapper; not context. |
| `src/lib/calendar.ts` → `getEventsInRange()` | Agenda source: reads the **Supabase calendar cache** (never Google directly). |
| `src/lib/weather.ts` → `getWeatherCurrent()` | Weather source: Open-Meteo with a **15-minute in-memory cache** per rounded location. |
| `../d-dash-app/workers/crystal/src/index.ts` | **The actual LLM call lives here** — a separate Cloudflare Worker. It builds the system prompt (`crystalPrompt` / `fireballPrompt`) from `body.context` and calls `@cf/meta/llama-3.3-70b-instruct-fp8-fast` with `MAX_HISTORY = 20`, `MAX_TOKENS = 600` for the reply. |

Key architecture fact: **the app builds a data bundle; the worker builds the system prompt.** The app never constructs a system prompt itself.

### 1.2 Exactly what gets injected per request today

`buildContextBundle()` in `src/lib/chat/context.ts` produces `ChatContextBundle`:

```ts
{
  pilot: { name, timezone },          // from pilots.display_name / timezone (always present)
  now: "<ISO timestamp>",             // always present — the model's "today"
  weather?: "72°F, Sunny in Marietta (high 78°, low 61°)",   // Open-Meteo, pilot home_lat/home_lon
  agenda?: string[],                  // up to 12 today's events from calendar cache
  todos?: string[],                   // up to 12 open todos, due-date sorted
  nudges?: string[],                  // up to 8 non-dismissed nudges, "kind/priority: title — detail"
  crew?: string                       // "Children linked: Name (child), ..." or "No children linked"
}
```

Field-level caps are hardcoded: agenda 12, todos 12, nudges 8 (detail sliced to 120 chars), crew 20 names. User messages are truncated to 4000 chars; thread title to 60.

### 1.3 Token-budget claim — verified

The file header comment says *"The bundle is kept compact — well under a 2000-token budget."* **There is no enforcement anywhere.** No token counting, no truncation guard, no budget check in `context.ts`, `route.ts`, or the worker. It's an aspiration written as a comment. Measured honestly: with 12 todos + 12 agenda items + 8 nudges, the bundle is roughly 400–700 tokens in the common case — but nothing *guarantees* it, and the **conversation history is the unbounded part** (see §2.4).

### 1.4 How assembly works

1. `pilotSection()` runs **first and alone** (sequential) — the pilot row is needed for timezone + coordinates.
2. Then five sources run in **`Promise.all`** (parallel): weather, agenda, todos, nudges, crew.
3. **No timeouts.** `Promise.all` waits for the slowest source; a hung source blocks the whole reply path up to the worker call's own 30s `AbortSignal.timeout`. There is no per-source deadline.
4. **Failure semantics: silent skip.** Every section is wrapped in try/catch and returns `undefined` on any failure (table missing, migration not run, integration not connected, fetch failed). `buildContextBundle` itself "never throws — worst case it returns just pilot + now." This is robust but **lossy** (see §2.6): the model cannot distinguish "no events today" from "calendar sync is broken."

### 1.5 Critical finding: the app↔worker contract is drifted

`route.ts` sends the **new** `ChatContextBundle` shape (`pilot: {name, timezone}`, `weather`, `agenda`, `todos`, `nudges`, `crew`, `now`). The worker's `ChatRequest.context` type still expects the **legacy d-dash shape** (`pilotName`, `studentName`, `timeOfDay`, `grades`, `dueNext`, `weakestClass`, `belowGoal`):

- Worker `displayName()` reads `ctx?.pilotName?.trim() || ctx?.studentName?.trim() || "pilot"` → with the new bundle both are undefined → **the model is currently told the pilot's name is literally "pilot"** unless the worker falls back elsewhere.
- `timeOfDay`, `grades`, `dueNext`, `belowGoal`, `weakestClass` are all undefined → `gradesBlock()` → "(no grade data right now)"; `dueBlock()` → "(nothing on the scope right now)".
- The new fields (`weather`, `agenda`, `todos`, `nudges`, `crew`, `now`) are **never read by the worker prompts at all.**

**Net effect:** the context pipeline runs correctly on the app side, but almost none of it reaches the model's system prompt today — this is rename-era drift (pookie-tutor → crystal). The bundle must be versioned and the contract made explicit.

### 1.6 What else the pipeline carries today

- **History:** last 20 messages of the thread (`role`, `text` only), newest-last. Fetched fresh on every turn — no delta, no cache.
- **Thread model:** one active thread per day, API-enforced (`findTodayThread` compares `updated_at` to UTC midnight). Pinned threads exist in schema but are never referenced by `route.ts`.
- **No layout state, no learned model, no corrections** reach the LLM (confirmed §2).

---

## 2. Gap analysis

### 2.1 Learned user model — confirmed absent (by design, not yet built)

Grepped `supabase/migrations/` and `src/lib/chat/` for `correction`, `learned`, `user_model`, `adapt`, `behavioral`: **zero hits.** The KNOW layer does not exist in code. Today's bundle carries only *ephemeral state* (weather, today's agenda, open todos, active nudges) — nothing about who the pilot is beyond a name and timezone. The model re-meets the pilot as a stranger on every thread. This is the single biggest personalization gap.

### 2.2 Layout state — not in the bundle

The memory record lists `cockpit_layouts` among the 8 foundation tables, and ARRANGE is a named layer of the stack. `context.ts` never queries it. Crystal therefore cannot explain *why* the cockpit looks the way it does, notice layout drift, or reference the pilot's arrangement ("your Health panel is up top because…"). When ARRANGE ships, the layout rationale should enter the context as a semi-static layer (§3).

### 2.3 Nudge history — only the present tense

`nudgesSection` selects only non-dismissed nudges (`dismissed_at IS NULL`, limit 8). The model sees *what's nagging now* but nothing about what was dismissed, snoozed, or acted on — the exact signal ADAPT needs ("the pilot always dismisses the water nudge; stop sending it"). Nudge outcomes are the cheapest learning signal in the system and they're invisible to the LLM.

### 2.4 Conversation summarization — no summary column; long threads are unguarded

`014_chat_threads.sql`: `chat_threads` has `id, pilot_id, title, pinned, created_at, updated_at`. `chat_messages` has `id, thread_id, role, text, persona, created_at`. **No `summary` column anywhere.** Long threads are handled only by `HISTORY_LIMIT = 20` (and the worker's own `MAX_HISTORY = 20`). Two problems:

1. **No token cap on history.** 20 messages × long homework-paste turns can be thousands of tokens — or tens of thousands. The "~2000-token budget" fiction is most false here. Nothing truncates, summarizes, or drops old turns; the context window is simply assumed large enough.
2. **Amnesia across threads.** Yesterday's thread is a separate thread with no bridge. A daily-active pilot accumulates orphaned context the model can never consult.

### 2.5 Schema-level gaps for the target pipeline

No table or column exists today for: a user-model summary doc, correction events, conversation summaries, nudge-outcome rollups, or bundle provenance. All of §3's target design needs new storage (proposed in §6 as migration-sized work, not code).

### 2.6 Silent degradation is a correctness bug, not just a robustness feature

Because failures skip silently, the model is told "(nothing on the scope right now)" in three indistinguishable situations: genuinely nothing scheduled, calendar not connected, calendar sync broken. For an *anticipatory* co-pilot this is dangerous: "you have a free afternoon" is wrong when the calendar integration is down. **Degraded sources must be labeled as degraded** in the bundle (provenance), so the model can hedge or ask instead of hallucinating confidence.

### 2.7 Other gaps worth recording

- **No per-source latency or budget logging.** If the bundle gets slow, there's no telemetry saying which source did it.
- **The bundle is never persisted.** No debug trail of what the model saw on any turn — painful for RCA on bad replies.
- **Weather cache is in-memory per instance.** On Cloudflare Pages (edge), in-memory caches don't share across instances and die on cold start — the 15-min cache is a single-origin assumption wearing edge clothes. Fine for correctness (it refetches), wasteful for latency/cost.
- **Inconsistency:** `pilots.default_mode` ("chat preferences read at session start") exists in schema, but `route.ts` takes `mode` from the request body and defaults to `"crystal"` — the stored preference is never consulted server-side.

---

## 3. Target pipeline: layered context assembly

### 3.1 Layer model

Assemble the prompt from five layers, outermost (most stable) first. Each layer carries a token budget and a provenance envelope `{ source, fetched_at, stale, degraded }`.

| Layer | Contents | Source of truth | Budget | Refresh |
|---|---|---|---|---|
| **L0 — Static** | System prompt: persona (Crystal/Fireball), voice rules, intelligence-first directive, safety/product invariants. **Stays in the worker** (it owns the LLM call); versioned string, e.g. `crystal-prompt v3`. | Worker code / config | ~900 tok (Crystal prompt today is ~700 words; budget the ceiling, not the current) | On deploy only |
| **L1 — Pilot profile + user model (KNOW)** | One **user-model summary doc**: name, timezone, comms style, known routines ("runs mornings, checks bills on the 1st"), stated goals, long-term context (e.g. "son in 10th grade, 90%-in-every-class goal" — only where relevant and pilot-visible). Generated by a nightly summarizer from corrections + behavior; human-readable, pilot-viewable, editable. | New `pilot_profile` / `user_model` table (see §6) | **400 tok** | Nightly regen + on correction event |
| **L2 — Semi-static daily** | Today's narrative: agenda digest (not the raw 12 events — a 3-line day shape: "3 meetings, free 2–4pm"), active nudges with *outcome context* ("2 dismissed yesterday"), open todos (top 5 by impact), weather line, layout rationale (ARRANGE: "Health panel is prominent because you check it daily"). | Calendar/todo/nudge caches + layout engine | **600 tok** | Rebuilt on day rollover or data change; cached |
| **L3 — Dynamic right-now** | `now` timestamp, weather (fresh), next-up event, any corrections from the last 24h not yet folded into L1, active alerts. Small, fresh, cheap. | Live fetches | **300 tok** | Every request (but cached 5–15 min) |
| **L4 — Conversation** | Thread history with **rolling summary**: summary of turns older than the last N + last N full turns. Summary regenerated async after each reply. | `chat_messages` + new `chat_threads.summary` | **1200 tok** (800 summary + 400 recent) | Summary updated post-reply, off the critical path |

**Total prompt budget: ≤ 3,400 tokens** (L0–L4), leaving the llama-3.3 context window overwhelmingly for reasoning, with the 600-token reply cap unchanged. Each layer is independently skippable — the assembler degrades layer by layer, never all-or-nothing.

### 3.2 How the personalization stack feeds the LLM

- **KNOW → L1.** A nightly (or correction-triggered) job reads the corrections log + behavioral signals and rewrites the user-model summary doc. The doc is plain language, versioned, and shown to the pilot ("here's what I know about you — fix anything"). The LLM receives the *doc*, never raw behavioral event streams. Privacy invariant preserved: the profile is per-account, never leaves the account, never trains anything.
- **ARRANGE → L2.** The layout engine emits a one-paragraph *layout rationale* ("Today: school panel first — 3 assignments due; bills panel minimized — nothing due") stored alongside `cockpit_layouts`. Crystal can narrate the cockpit instead of being blind to it.
- **ANTICIPATE → L2/L3.** The nudge engine already writes `nudges`. The pipeline change: include **nudge outcomes** (dismissed/acted/snoozed counts, last 7 days) as a compact rollup, not just active nudges. This is the ADAPT bootstrap signal.
- **ADAPT (not built) → L1 + L3.** Corrections ("don't call me that", "stop reminding me about X", "that's wrong — the meeting is at 3") are logged as first-class events. Recent ones ride L3 immediately; the nightly job folds durable ones into L1. Correction logging must precede any learning — **log first, learn later.**

### 3.3 Assembly algorithm (target)

```
1. Load L0 (worker-side, versioned; no fetch).
2. Load L1 from cache (pilot_profile). Miss → fetch + cache. Failure → omit + mark degraded.
3. Load L2 from cache keyed by (pilot, date). Miss/stale → rebuild from sources with per-source 5s timeout; each source labeled fresh/stale/degraded.
4. Load L3: now + cached weather/next-up (5–15 min TTL).
5. Load L4: thread.summary + last N messages (N chosen so L4 ≤ 1200 tok — token-aware trim, not a fixed 20).
6. Enforce total ≤ 3400: shed in order L4-oldest → L2 detail → L3 extras. Never shed L0/L1.
7. Emit bundle v2 with provenance envelope per section; log token estimate + per-source latency.
```

---

## 4. Caching & cost

### 4.1 Cache plan

| What | Cache key | TTL | Invalidation trigger |
|---|---|---|---|
| L1 user-model doc | `ctx:pilot:{id}:profile:v{n}` | Until rewritten | Nightly job or correction event bumps version |
| L2 daily digest | `ctx:pilot:{id}:day:{YYYY-MM-DD}` | End of day | Calendar sync webhook, todo change, nudge state change |
| Weather line | Existing: rounded lat/lon in-memory → **move to shared KV/edge cache** | 15 min | — (time-based only) |
| Next-up event | `ctx:pilot:{id}:nextup` | 5 min | Calendar sync |
| Todos top-N | `ctx:pilot:{id}:todos` | 15 min | Todo write path |
| Thread summary | `chat_threads.summary` (DB, not cache) | — | Async regen after each assistant reply |
| L0 prompt | Worker code/config | Deploy | Prompt version bump |

**Edge-cache note:** the weather helper's in-memory cache is per serverless instance. On Pages this means N instances × N fetches and cold-start misses. Move shared layers (weather, L2 digest) to a shared store (Workers KV or Supabase) — correctness today, cost/latency tomorrow.

### 4.2 Token-cost estimate per request (before → after)

Assumptions: llama-3.3-70b via Workers AI (batch-friendly pricing), ~4 chars/token, pilot sends ~20 chat messages/day. Estimates, not metered figures.

**Before (today, as-coded):**
- Bundle: ~300–700 tok fresh-built every message (5 parallel fetches, no cache except weather's in-memory).
- History: **uncapped** — 20 messages, no token accounting. Typical short chat: ~500–1,500 tok. A homework-heavy thread: easily 5,000–15,000 tok.
- Typical total: ~1,500–3,000 tok/req; worst case unbounded. All of it recomputed per keystroke-turn.

**After (target):**
- L0: ~900 tok — static, could be prompt-cached by the provider if supported.
- L1: ~400 tok — cached; ~0 marginal fetch cost.
- L2: ~600 tok — cached per day; amortized to ~0 per request.
- L3: ~300 tok — mostly cached (5–15 min).
- L4: ≤1,200 tok — summary (~800, written once per turn async) + recent turns.
- Typical total: **~2,400–3,400 tok/req, capped**, with per-request *fresh compute* limited to L3 refresh + L4 tail.

The win is not primarily fewer tokens per request — it's **boundedness** (no more unbounded history), **freshness where it matters** (L3), and **amortized cost** (L1/L2 built once, reused all day). The current pipeline's real cost risk is the uncapped history term, which the target design eliminates.

---

## 5. Failure-mode design

Standing rule: every error is plain-English, grandmother-test, with a recovery path — never a blank page, never a dead end. Applied to the context pipeline:

### 5.1 Degraded-mode matrix

| Failure | User sees | Model is told | Behavior |
|---|---|---|---|
| Worker unreachable / 5xx / empty reply | "I went quiet for a moment — check your connection and try again. I'm still here." (already implemented, `route.ts` `WorkerDown` → 502) | n/a | Keep — it's good copy. Add: retry button in the applet. |
| Supabase down (context sources fail) | Chat still sends; reply may be less personal. No error shown unless *everything* fails. | Bundle carries `degraded: ["calendar","todos"]`; model instructed: "some data is unavailable — don't assert emptiness; hedge or ask." | **New:** never render "(nothing on the scope right now)" for a failed source — render the provenance flag instead. |
| Calendar sync broken (stale cache) | Nothing user-facing (ambient) | `agenda: { stale: true, age: "26h" }` → model says "your calendar hasn't synced since yesterday" instead of inventing a free day. | Staleness threshold per source (calendar: 6h; weather: 1h). |
| Weather provider down | Nothing user-facing | `weather` omitted + `degraded: ["weather"]` | Model doesn't mention weather. |
| Single source slow | Nothing user-facing | **Per-source timeout 5s** → mark degraded, continue. | Total context assembly deadline 8s; then proceed with what arrived. |
| Thread summary missing/corrupt | Nothing user-facing | Fall back to raw last-N with token trim. | Regen queued. |
| Auth expired mid-chat | "Sign in to chat with Crystal." (existing 401) | n/a | Keep. |
| Message send fails validation | "Type a message first — I can't read minds yet." (existing 400) | n/a | Keep. |

### 5.2 Design principles for degraded mode

1. **Provenance over silence.** Every bundle section carries `{ state: fresh | stale | degraded | unavailable }`. The model must be able to say "I can't see your calendar right now" — which requires *knowing* it can't.
2. **Layered shedding, fixed order.** Under time pressure shed L4-oldest first, then L2 detail, then L3 extras. L0/L1 never shed — identity and persona are the last things to go.
3. **Persist the bundle.** Log `{ thread_id, bundle_version, layer_states, token_estimate, latencies }` per turn (server-side, pilot-scoped). This is the RCA trail for "why did Crystal say that."
4. **User-facing copy stays in the app, not the model.** Degradation notices the *pilot* needs ("calendar hasn't synced") should be UI chrome, not something we hope the model phrases well.
5. **No cross-user anything, ever.** Cached L1/L2 are keyed by pilot id; the summarizer job is per-account; nothing in this design trains a shared model or pools behavioral data. State it in the migration comments so future engineers don't "optimize" it away.

---

## 6. Per-phase acceptance criteria

### Phase A — Contract & observability (unblocks everything)
- [ ] Bundle versioned (`context_version: 2`); worker `ChatRequest.context` type updated to match the app's bundle 1:1; legacy d-dash fields removed or mapped explicitly.
- [ ] Worker's `displayName` resolves the real pilot name from the new bundle (regression test: bundle without legacy fields → name appears in system prompt).
- [ ] Every section carries provenance `{ state, fetched_at }`; a degraded source is labeled, never rendered as empty.
- [ ] Per-turn log line: `thread_id, context_version, token_estimate, per-source latency ms, degraded[]`.
- [ ] Token estimate computed (chars/4 heuristic is fine) and asserted ≤ 3,400 in a unit test with a maxed-out bundle.
- [ ] Per-source timeout (5s) + assembly deadline (8s) implemented and tested with a hung source.

### Phase B — Conversation memory
- [ ] Migration: `chat_threads.summary text`, `chat_threads.summary_updated_at timestamptz`.
- [ ] Rolling summary: after each assistant reply (async, off the critical path), a summarizer pass folds older turns into `summary`; L4 = summary + token-trimmed recent turns, capped at 1,200 tok.
- [ ] Test: a 60-turn thread stays under the L4 budget; summary mentions facts from turn 1 that are no longer in the raw window.
- [ ] Cross-thread: opening a new day-thread includes a 2-line "yesterday" bridge from the prior thread's summary.

### Phase C — KNOW: the user-model doc
- [ ] Migration: `pilot_profiles` (or `user_model`) table — `pilot_id PK, summary_md text, version int, updated_at`; plus `correction_events` append-only log (`pilot_id, kind, text, created_at`).
- [ ] Nightly job (per pilot): rewrite `summary_md` from corrections + signals. The doc is viewable/editable by the pilot in-app.
- [ ] L1 feeds every chat turn from the cached doc (≤ 400 tok); a correction sent in chat appears in L3 within the same session and in L1 by next day.
- [ ] Privacy test: two pilots' docs are never co-mingled; the summarizer prompt includes the no-cross-user invariant; audit log shows per-account-only reads.

### Phase D — Caching & invalidation
- [ ] L2 daily digest cached with key `ctx:pilot:{id}:day:{date}`; invalidated by calendar-sync webhook, todo writes, nudge state changes.
- [ ] Weather moved off per-instance memory to a shared cache (KV or Supabase); cold-start no longer refetches per instance.
- [ ] Load test: 20 consecutive turns reuse cached L1/L2 (assert single build per day in logs); p95 context-assembly latency < 500 ms on cache hit.
- [ ] Cost report: measured tokens/turn before/after on a scripted 20-turn session; history term shown bounded.

### Phase E — Degraded-mode drills (chaos, per the standing test protocol)
- [ ] Drill 1: calendar table unreachable → chat works; model says it can't see the calendar; no "free afternoon" hallucination (assert on reply text).
- [ ] Drill 2: Supabase fully down → chat returns the plain-English 502 path; no blank page, no stack trace to the client.
- [ ] Drill 3: one source hangs 30s → assembly completes in ≤ 8s with that source marked degraded.
- [ ] Drill 4: worker returns empty reply → `WorkerDown("empty reply")` path fires with the existing friendly copy.
- [ ] All drills produce the persisted bundle log showing exactly what the model saw.

---

## Appendix: verdicts on the task's explicit questions

1. **Does the bundle include the learned user model?** No — confirmed absent; KNOW is not built. Only name + timezone travel today.
2. **Does it include layout state?** No. `cockpit_layouts` is unread by the pipeline.
3. **Nudge history?** No — only active nudges; outcomes invisible.
4. **Conversation summarization?** No summary column; `HISTORY_LIMIT = 20` raw messages, no token cap. Long threads are the unbounded-cost term.
5. **How is the ~2000-token budget enforced?** It isn't — comment only.
6. **Parallel vs sequential, timeouts, source failure?** Pilot sequential, then 5-way `Promise.all`; no timeouts; failures skip silently.
7. **Biggest near-term risk:** the app↔worker contract drift (§1.5) — the pipeline runs but the worker ignores the new fields and misreads the pilot's name. Fix the contract before layering anything on top.
