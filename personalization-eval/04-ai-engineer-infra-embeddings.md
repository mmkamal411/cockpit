# 04 — AI Engineer Evaluation: Personalization Infrastructure & Embedding Strategy

**Author:** AI Engineer (2 of 2) — infra & embeddings domain
**Date:** 2026-10-13
**Scope:** Evaluation only. No production code written or changed.
**Repo state audited:** `~/workspace/cockpit` @ `f32562b` (main), plus the Crystal worker source at `~/workspace/d-dash-app/workers/crystal/src/index.ts` (separate deploy, audited read-only for the data-flow section).

---

## 1. Infrastructure audit: how compute runs today

### 1.1 Background / scheduled compute: NONE in-repo

| Mechanism | Present? | Evidence |
|---|---|---|
| Cloudflare Cron Triggers | **No** | `wrangler.jsonc` has no `[triggers]` / `crons` section; only `vars`, `assets`, `compatibility_flags` |
| Supabase pg_cron / pg_net | **No** | All migrations use `create extension if not exists pgcrypto` only — no `pg_cron`, no `pg_net`, no scheduled jobs in any of `supabase/migrations/*.sql` |
| Nudge producers | **No** | `POST /api/nudges/candidates` exists (`src/app/api/nudges/candidates/route.ts`) and the engine exists (`src/lib/nudges/engine.ts`), but **zero producers exist in the codebase**. Only callers of `submitCandidate` are the route itself. `PRODUCERS.md` documents the contract with a Python cron example — the producers are aspirational, expected to run *outside* this repo (VM crons / external schedulers). |
| Edge Functions (Supabase) | **No** | No `supabase/functions/` directory |
| Queue / durable execution | **No** | No Cloudflare Queues, no Durable Objects, no workflow bindings |

**Everything the app computes today runs request-time inside Next.js route handlers** (via OpenNext on Cloudflare Pages/Workers). The request-time compute inventory:

- `src/proxy.ts` — edge middleware: session refresh + auth redirects only (fail-open by design).
- `GET /api/today` (`src/app/api/today/route.ts`) — read-only aggregation over todos, calendar, nudges, crew school items; each source in its own try/catch.
- `POST /api/chat` (`src/app/api/chat/route.ts`) — context bundle assembly + one outbound LLM call.
- `src/lib/weather.ts` — Open-Meteo fetch with 15-minute in-memory cache (worker-global memory; note: on Cloudflare Workers this cache is per-isolate, not shared — fine for v1).
- `src/lib/nudges/engine.ts` — pure scoring/dedupe/scheduling logic, unit-tested (`engine.test.ts`, runnable with `node`), invoked only when a candidate is submitted.

### 1.2 Embeddings / vectors: NONE anywhere

- `package.json`: no vector libraries (no `ai` SDK, no `langchain`, no `openai`, no `pgvector` client).
- `grep -ri "embedding|pgvector|vector("` across `src/`, `supabase/`, `package.json`: **zero hits**.
- Migrations: no `vector` column type, no `CREATE EXTENSION vector`.
- There is **no semantic search, no RAG, no vector index** in the current system. This is a clean slate — a deliberate choice is still available.

### 1.3 ARRANGE layer state (cockpit_layouts)

- Table `public.cockpit_layouts` exists (`supabase/migrations/001_pilot_foundation.sql:185`): `pilot_id`, `layout jsonb`, `generated_at`, `active bool`, one-active-per-pilot enforced "in app logic" (no DB constraint — noted gap).
- RLS is pilot-isolated (`cockpit_layouts_pilot_all`, `auth.uid() = pilot_id`, `force row level security` on).
- **Nothing writes to it.** The only references are reads: admin view-as (`src/app/api/admin/users/[id]/view-as/route.ts:45`) and the admin table registry (`src/lib/admin/routeHandler.ts:85`). ARRANGE is schema-ready, compute-missing. This matches the task brief.

### 1.4 KNOW layer state

- Structured only: `pilots` (display_name, timezone), `pilot_integrations`, `nudge_preferences` (quiet hours, min_score, category flags), `chat_threads`/`chat_messages`, todos, health logs, bills.
- No user-model summary table, no behavioral aggregates. Client-side `localStorage` (`src/lib/local-store.ts`) holds device-local state for todos/goals until server counterparts ship — personalization-relevant data that is currently *not* synced cross-device.

---

## 2. Embedding strategy evaluation

### 2a. No embeddings — rules + structured preferences + full-text search

**What it solves:** All v1 personalization needs are satisfiable without vectors:
- "Find past conversations about geometry" → Postgres full-text search (`tsvector` on `chat_messages.text`, pilot-scoped by RLS) + thread titles + structured tags.
- Nudge relevance → the existing importance×urgency scorer + pilot's `min_score` + category opt-outs.
- Layout arrangement → deterministic rules over connected integrations (calendar connected → calendar applet prominent; child linked → school module surfaces).
- Recommendations → curated/peer-tip content matched on unit tags and class names (exact structured joins), not semantic similarity.

**Infra cost:** ~zero. One `tsvector` GIN index; no new services, no new secrets, no per-request model calls.

**Privacy:** Perfect fit — no derived artifacts at all; the constraint is satisfied by absence.

### 2b. In-account embeddings for semantic recall

**What it solves that rules can't:** Fuzzy recall the pilot can't phrase exactly — "that conversation where Crystal explained photosynthesis like a story," typo-ridden queries, cross-thread concept search ("everything about my dentist anxiety"). FTS fails on paraphrase; embeddings handle it.

**Infra cost on this stack:**
- Embedding model: Cloudflare Workers AI has embedding models (e.g. `@cf/baai/bge-small-en-v1.5`, 384-dim) callable from the same worker that already holds the `AI` binding — no new vendor, no API key, free tier. Cost is one sub-second RPC per chunk, done at write time.
- Storage: pgvector extension on the existing Supabase project; per-pilot tables hold KBs–MBs for a lifetime of chat. Supabase free tier is comfortable at this scale.
- Query: `SELECT ... ORDER BY embedding <=> $1 LIMIT k` filtered by `pilot_id` — at tens of thousands of vectors per pilot, even brute force is fast; HNSW makes it trivially fast.

**Privacy constraint — satisfiable? Yes.** The constraint is "embeddings derived from user data must stay in their account." pgvector rows live in the same Postgres as everything else, under the same `force row level security` + `auth.uid() = pilot_id` policies. There is no cross-user read path by construction — similarity search is always `WHERE pilot_id = <caller>` (or via RLS). No pooling, no shared index, no training. The embedding model itself is inference-only (Workers AI binding); inputs are not used for model training (Cloudflare's Workers AI terms — re-verify at contract time, cite in the security review). **Verdict: pgvector + RLS fully satisfies the constraint with no architectural gymnastics.**

### 2c. Embeddings for content recommendation

**What it solves that rules can't:** "Pilots like you also read…" / semantic matching of articles, tips, study material to interests.

**Why it's wrong for this product:**
1. **It directly collides with the privacy constraint.** Cross-user recommendation requires either pooling embeddings across accounts (violates "no cross-user learning") or per-account-only recommendations, which at single-pilot scale are statistically meaningless.
2. There is no content corpus in this repo to recommend from. The peer-tips pipeline lives outside this system. Recommendation without a corpus is a solution without a problem.
3. Cold-start: a new pilot has no behavioral history; rules + onboarding preferences beat collaborative filtering for the first 90 days.

**Verdict: do not build. Not in v1, not in v2 in its cross-user form.** If content matching is ever wanted, constrain it to *corpus-side* embeddings (embed the public content library once, match against the pilot's *query* embedding at request time — no per-user behavioral vectors leave the account, no cross-user learning).

### 2d. Recommendation

**v1 ships with NO embeddings.** Rationale:
- Every v1 personalization job (recall, nudging, layout, recommendation) is served by rules + structured prefs + FTS at this data scale.
- Embeddings add a write-time inference dependency, a new failure mode, and a new privacy surface to audit — for recall quality gains the pilot will not feel in v1.
- The decision is reversible: §3 gives the migration path. Building the embedding pipeline *before* we have evidence of an FTS-shaped recall failure is premature infrastructure.

---

## 3. Migration path if semantic features are wanted later (Phase 2)

Trigger condition (do not build before this): pilot feedback or analytics show semantic-recall failures — e.g., chat search with zero FTS hits but a relevant thread exists, measured over ≥30 days of real usage.

**Schema sketch** (new migration, e.g. `018_chat_embeddings.sql`):

```sql
create extension if not exists vector;

create table public.chat_message_embeddings (
  id          uuid primary key default gen_random_uuid(),
  pilot_id    uuid not null references public.pilots(id) on delete cascade,
  message_id  uuid not null references public.chat_messages(id) on delete cascade,
  thread_id   uuid not null references public.chat_threads(id) on delete cascade,
  chunk_text  text not null,
  embedding   vector(384) not null,          -- bge-small-en-v1.5
  model       text not null default 'bge-small-en-v1.5',
  created_at  timestamptz not null default now(),
  unique (message_id)                         -- one embedding per message
);

alter table public.chat_message_embeddings enable row level security;
alter table public.chat_message_embeddings force row level security;
create policy chat_emb_pilot_all on public.chat_message_embeddings
  for all using (auth.uid() = pilot_id) with check (auth.uid() = pilot_id);
grant select, insert, update, delete on public.chat_message_embeddings to authenticated;

-- HNSW, not IVFFlat (see below).
create index chat_emb_hnsw on public.chat_message_embeddings
  using hnsw (embedding vector_cosine_ops);
```

**Index choice: HNSW.** At this scale (≤10⁵ vectors/pilot, realistically ≤10⁴) HNSW gives exact-ish recall with no tuning. IVFFlat requires choosing `lists`, needs `VACUUM ANALYZE` discipline, and degrades on small or growing datasets — it is the wrong default for a per-pilot table that grows incrementally. Revisit only if a pilot exceeds ~1M vectors (not a v1/v2 concern).

**Pipeline (write-time, never read-time):**
1. Chat message persisted → enqueue embedding job (out-of-band: producer worker or a lightweight queue table; NOT in the `/api/chat` request path — chat latency must not depend on embedding inference).
2. Worker calls Workers AI embedding model with `chunk_text`, inserts row. Batch: embed the day's messages in one nightly pass as a simpler alternative.
3. Recall query: embed the pilot's query → `ORDER BY embedding <=> $query_vec` with `pilot_id` filter (RLS enforces even if the filter is forgotten) → merge with FTS results (reciprocal rank fusion is a one-function addition if needed).

**Privacy gates for Phase 2:**
- Cross-pilot leakage test: similarity query as pilot A must never return pilot B's rows (RLS test in CI).
- Model-version pinning: `model` column guards against mixing embedding spaces across model upgrades; re-embed on model change.
- Rollback: drop the table + extension; app degrades to FTS. No application logic may *require* the embeddings table.

---

## 4. Compute topology recommendation

Principle: **request path stays read-aggregation only; all model/scoring compute moves to write-time or scheduled batches.** The current architecture (OpenNext on Cloudflare Pages → one Workers runtime) supports this with small additions — no new platform needed.

| Workload | Recommended placement | Rationale |
|---|---|---|
| **Layout scoring (ARRANGE)** | Event-driven + lazy refresh. Compute on integration connect/disconnect and crew-link events; otherwise recompute-at-most-daily, lazily on `/home` load *only if* no active layout or `generated_at` older than threshold. Read path = single-row fetch from `cockpit_layouts`. | Layout is a planning artifact, not a per-request decision. Per-page-load scoring wastes compute and adds tail latency to every navigation. Cache the decision; the table already has the `active` flag for exactly this. **Also add the missing DB guard:** a partial unique index `ON cockpit_layouts (pilot_id) WHERE active` — "enforced in app logic" (migration 001 comment) is a race condition. |
| **Signal aggregation / nudge producers (ANTICIPATE)** | Scheduled cron, **outside** the Pages worker: either (a) Cloudflare Cron Triggers on a tiny dedicated producers worker, or (b) the existing VM cron ecosystem POSTing to `/api/nudges/candidates` with the service key — which is *exactly* what `PRODUCERS.md §6` already specifies. Producers must never run in the request path. | Matches the engine's golden rule ("a failed producer never breaks the engine"). Request-time emission couples producer failures to user-facing latency. Cadence per producer: calendar ~15 min, bills/weather/todos ~hourly, school ~on-sync-event. |
| **User-model summarization (KNOW)** | Nightly batch, off-request. New table `pilot_daily_summary (pilot_id, date, summary jsonb)`; a nightly job condenses the day's chat/nudge/todo/health signals (LLM summarization via the crystal worker's AI binding, or deterministic rollups where rules suffice). `/api/chat`'s context builder then reads **one summary row** instead of re-deriving state. | Keeps the chat request path at its current ~6 parallel cheap queries. Summarization is the most expensive personalization compute and has zero freshness requirement tighter than a day. |
| **Request-time (stays as-is)** | Context bundle assembly, `/api/today` aggregation, weather fetch+cache, nudge reads. The single LLM call in `/api/chat` is the product itself — acceptable on the request path with its existing 30s timeout and graceful 502 fallback. | These are all bounded read aggregations; no change needed. |

**What NOT to do:** do not put layout scoring, producer emission, or summarization into `proxy.ts`/middleware or into page-load server components. Middleware runs on *every* request including static-adjacent paths; personalization compute there is a latency and cost multiplier with no benefit.

---

## 5. Third-party LLM data-flow audit (for the security threat model)

### 5.1 The path

```
Browser → POST /api/chat (Pages worker, pilot session cookie)
  → src/app/api/chat/route.ts: builds ChatContextBundle, reads thread history
  → fetch POST https://crystal.mehedikamal.workers.dev/chat        (1)
  → crystal worker (~/workspace/d-dash-app/workers/crystal/src/index.ts)
  → env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", …)       (2)
```

- Hop (1): server-to-server, same Cloudflare account (`mehedikamal.workers.dev`), no auth header on the request (origin allowlist is the only gate — CORS check in worker; note the app-to-worker call carries no `Origin` header server-side, and the worker's `isAllowedOrigin(null)` returns false but the request is still *processed* — CORS only affects browsers. Flag for the security expert: **the /chat endpoint is effectively unauthenticated server-to-server**; anyone who knows the URL can POST. Rate/abuse posture should be reviewed.)
- Hop (2): Cloudflare Workers AI binding — inference on Cloudflare's fleet, **no third-party API key, no external LLM vendor**. The "LLM provider" in the data-flow sense is Cloudflare itself. Inference-only; nothing in this pipeline trains or fine-tunes.

### 5.2 Exact fields leaving the Cockpit system boundary per chat request

POST body to `https://crystal.mehedikamal.workers.dev/chat` (`callWorker`, `src/app/api/chat/route.ts:107`):

| Field | Content | Bounds |
|---|---|---|
| `messages` | Array of `{role: "user"\|"assistant", text}` — last 20 messages of the thread + the current message | Current message truncated to 4000 chars at the route; worker slices every message to 2000 chars |
| `context` | `ChatContextBundle` (`src/lib/chat/context.ts`): `pilot: {name: display_name\|null, timezone: timezone\|null}`, `now: ISO timestamp`, optional `weather` (one-line string: temp/conditions/high/low + home_location), optional `agenda` (≤12 strings: event time/title/location), optional `todos` (≤12 strings: title + due date), optional `nudges` (≤8 strings: kind/priority/title + 120-char detail), optional `crew` (`"Children linked: Name (relationship), …"` or `"No children linked"`) | Each section degrades silently; worst case the bundle is just `{pilot, now}` |
| `mode` | `"crystal"` \| `"fireball"` | — |

**Never sent:** `pilot_id`, `thread_id`, auth tokens/session cookies, passwords, integration tokens, raw grades tables, health metrics, financial account numbers. Thread history is sent as bare role/text — no timestamps, no IDs.

### 5.3 ⚠️ Material finding: context-shape mismatch narrows the actual LLM-visible data

The Crystal worker's prompt builders (`crystalPrompt`/`fireballPrompt`) only read **legacy d-dash fields**: `pilotName`, `studentName`, `app`, `timeOfDay`, `weakestClass`, `belowGoal`, `grades`, `dueNext`. The Cockpit `ChatContextBundle` shape (`pilot`/`now`/`weather`/`agenda`/`todos`/`nudges`/`crew`) is **not consumed at all** — every new field is silently dropped before the model call.

Consequences:
1. **Today, the LLM effectively sees only the conversation messages** (+ a system prompt addressed to `"pilot"` since `pilotName` is absent). Crystal is currently blind to weather, agenda, todos, nudges, and crew despite the app assembling them — a functional gap, and the likely reason "proactive, anticipatory" behavior isn't observable.
2. **Privacy-positive accident:** the data flow to the LLM is *narrower* than the code at the route suggests. The security threat model must cite the **worker** as the effective boundary, not the route.
3. **Fixing the mismatch is a deliberate data-flow widening.** When the worker is updated to consume the new bundle, these newly LLM-visible fields need explicit sign-off: pilot display name, home location (weather string includes it), children's names/relationships (`crew` section — **minor children's names sent to a third-party inference service**; needs a COPPA/teen-privacy policy decision per the product's age-tier rules), calendar event titles/locations, todo titles, nudge titles+details. Recommend a per-section inclusion rule + a pilot-facing "what Crystal can see" disclosure before that change ships.

### 5.4 Other LLM-touching surface

- `POST /quiz` on the same worker accepts `{topic, className, unitName, count, material, studentName}` — `material` is free-form study text (potentially the highest-sensitivity field in the whole flow). **No caller found in the cockpit repo** (legacy d-dash surface); if reintroduced, `material` needs the same disclosure treatment.
- `GET /health` and the admin `/api/admin/integrations` crystal check transmit no user data.

### 5.5 Privacy-constraint compliance status (as audited)

- "Behavioral profile never leaves the pilot's account": **holds today** — the profile doesn't exist yet as an artifact, and per-request context stays within Mehedi's Cloudflare account (Workers AI), never a third-party LLM vendor.
- "No cross-user learning": **holds** — no training, no pooling, no shared model state anywhere in the pipeline.
- "No LLM training on user data": **holds by architecture** (inference-only binding). Must be re-verified if any external chat/completions API (OpenAI/Anthropic/etc.) is ever introduced — that would move prompt data to a true third party under different data-use terms.

---

## 6. Per-phase acceptance criteria

### Phase 0 — now (no code changes)
- [ ] This evaluation is filed at `personalization-eval/04-ai-engineer-infra-embeddings.md`.
- [ ] No embedding/vector dependencies added to `package.json`; no `vector` extension in migrations.
- [ ] The context-shape mismatch (§5.3) is logged as a known issue for the chat team — do not "fix" by widening data flow without the privacy review in §5.3(3).

### Phase 1 — v1 personalization, no embeddings (KNOW/ARRANGE/ANTICIPATE-rules/ADAPT-rules)
- [ ] **KNOW:** chat recall served by a `tsvector` GIN index on `chat_messages.text` + thread titles; recall query is pilot-scoped (RLS test: pilot A cannot match pilot B's messages). Structured prefs (`nudge_preferences`, `pilots.timezone`) remain the primary personalization signal.
- [ ] **ARRANGE:** a layout writer populates `cockpit_layouts` on integration-connect/crew-link events and on stale-refresh (no active layout or `generated_at` > 24h); exactly one `active` row per pilot enforced by a **partial unique DB index**, not app logic; read path on `/home` is a single-row fetch with no scoring compute.
- [ ] **ANTICIPATE:** at least one scheduled producer (bills-due or calendar) runs on a cron outside the Pages worker, emits via `POST /api/nudges/candidates` with the service key, and demonstrates the full pipeline: score → dedupe (resubmit same `dedup_key` → `deduped`) → quiet-hours hold → insert. Producer failures never surface to the pilot (golden-rule test: kill the producer, app unaffected).
- [ ] **ADAPT (rules only):** one explicit adaptive rule ships, e.g. auto-raise `min_score` when dismiss-rate exceeds a threshold — implemented as a readable rule with a pilot-visible explanation, not a learned model.
- [ ] **Privacy:** no new data leaves the account boundary; the §5.2 field inventory is re-verified against the shipped code and any delta is documented.

### Phase 2 — embeddings, only if the Phase-2 trigger fires (measured semantic-recall failures over ≥30 days)
- [ ] Migration adds `chat_message_embeddings` per §3 sketch: `pilot_id`-scoped, `force row level security`, pilot-isolated policy, HNSW index (`vector_cosine_ops`), `model` column pinning the embedding model version.
- [ ] Embedding happens **write-time/batch only** — `/api/chat` latency is unchanged when the embedding worker is down (degrades to FTS).
- [ ] Cross-pilot leakage test in CI: similarity search as pilot A returns zero rows from pilot B.
- [ ] Rollback verified: dropping the table/extension returns the app to FTS-only with no code changes required beyond the query path.
- [ ] Privacy review re-run: the embedding model and its data-use terms (Workers AI or alternative) are cited in the security file; no external completions API is introduced without a new data-flow audit.

### Explicit non-goals (do not build)
- Cross-user / collaborative recommendation embeddings — conflicts with the no-cross-user-learning constraint.
- Real-time (request-path) embedding inference for chat or layout.
- IVFFlat indexes, custom vector DB sidecars, or a separate vector database — pgvector in the existing Supabase project covers every scale this product will see in v1/v2.
