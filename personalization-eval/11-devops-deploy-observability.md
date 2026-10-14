# DevOps: Deployment & Observability for the Personalization Stack

**Author:** DevOps Engineer (evaluation) · **Date:** 2026-10-13
**Scope:** KNOW / ARRANGE (layout engine, new) / ANTICIPATE (nudge engine, built) / ADAPT (new)
**Repo:** `~/workspace/cockpit` → GitHub `mmkamal411/cockpit` (main)
**Stack:** Next.js 16 → OpenNext adapter → Cloudflare Pages (Workers runtime) · Supabase Postgres (`hwnesewathbnfvoxtbqh`) · Crystal LLM on external Cloudflare Worker

> Evaluation only. No code was written. All file citations below were read from the repo on 2026-10-13.

---

## 1. Deploy-pipeline audit (as it exists today)

### 1.1 End-to-end pipeline

The entire deploy is a single script: `deploy/deploy-staging.py`, invoked as `python3 deploy/deploy-staging.py` from the repo root (documented in `DEPLOY.md`).

| Step | What runs | Gate |
|---|---|---|
| 0. Clean tree | `git status --porcelain` must be empty | Refuses dirty builds (lesson 2026-10-13: dirty builds caused an unreproducible-bundle outage) |
| 1. Clean `.next/` | `rm -rf .next` | Prevents stale adapter inlining |
| 2. Patches | `npx patch-package` | Ensures the `@opennextjs/cloudflare` load-manifest patch is applied in `node_modules` |
| 3. `npm run build` | Next.js 16 production build (`cacheComponents: false` — it hangs page renders on Workers; see `next.config.ts`) | Fails loudly if `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are missing from env or `.env.local` |
| 4. `npx opennextjs-cloudflare build` | Adapts to Workers runtime (`.open-next/`) | Post-build assertion: built `handler.mjs` must contain the inlined preview-props manifest branch, else refuse (missing it 500s every request — Cloudflare 1101) |
| 5. `deploy/assemble-pages-deploy.py` | Copies `.open-next/` → `.pages-deploy/`, writes `_routes.json` | `_routes.json` excludes `/_next/static/*` and `/videos/*` so Pages serves them directly instead of routing through the worker (without this the worker 404s every static asset — lesson from pookie-app 2026-10-11) |
| 6. `wrangler pages deploy .pages-deploy --project-name cockpit --branch=main --commit-dirty=false` | Direct-upload deploy to the Pages project | Cloudflare API token comes from Secure Vault entry `custom.cloudflare` via `dynamic_credential_entry` — never from the repo |
| 7. `deploy/smoke-test-staging.py <url>` (after 10s propagation wait) | Real HTTP assertions: `/` → 200/3xx, `/login` → 200 + non-trivial HTML body (catches error-boundary-posing-as-200), `/auth/callback` → 307, `/videos/vista-planets-1.mp4` → 200 + `video/*`, first `/_next/static/*` asset → 200 | Non-zero exit blocks any "deployed" announcement |

Key structural facts:

- **Direct upload, NOT Git-connected.** The Pages project was created once in the dashboard (Upload assets). There is no CI: no GitHub Actions (no `.github/` directory exists), no branch previews, no automatic deploys on push. Every deploy is a human (or agent) running the script.
- **The Pages project serves production on `--branch=main`.** The deploy treats a `--branch=main` upload as the production deployment.
- **⚠️ Audit finding — smoke-test URL mismatch.** `DEPLOY.md` names the target `https://cockpit.pages.dev`, but `deploy-staging.py` sets `STAGING_URL = "https://cockpit-10c.pages.dev"` and smoke-tests that URL after deploying `--project-name cockpit --branch=main`. One of these is wrong: either the production deployment lands on `cockpit.pages.dev` and the smoke test is checking a stale/different deployment, or the project's real URL is `cockpit-10c.pages.dev` and `DEPLOY.md` is stale. **Before the personalization rollout, verify which URL a `--branch=main` deploy actually serves and make the smoke test target exactly that URL.** A smoke test against the wrong URL is worse than none — it certifies the wrong artifact. **RESOLVED 2026-10-13: `https://cockpit-10c.pages.dev` is the canonical staging URL (Meheldi confirmed); DEPLOY.md, both deploy scripts, and docs are locked to it.**
- **Staging is currently red.** Per `STATUS.md` (2026-10-13 ~01:20 EDT): 500s on `/`, `/login`, `/auth/callback`; a separate deep-dive team is on it. Nothing in this plan ships to users until staging is green and the smoke test passes.

### 1.2 Environment-variable management

| Variable | Where it lives | Baked or runtime |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Build env / `.env.local`; fallback hardcoded in `wrangler.jsonc` `[vars]` | **Baked into the bundle at build time** |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Same as above | **Baked into the bundle at build time** |
| `SUPABASE_SERVICE_ROLE_KEY` | Cloudflare Pages dashboard → Settings → Environment variables (Production) **only**; `.env.local` for local dev (gitignored) | Runtime (server only) |
| `NEXT_PUBLIC_CRYSTAL_URL` (Crystal voice) | Optional; commented in `.env.example`; hardcoded fallback `https://crystal.mehedikamal.workers.dev` in `src/app/api/chat/route.ts` and `src/components/applets/crystal-applet.tsx` | Baked (client) |
| Cloudflare API token | Secure Vault `custom.cloudflare`, injected at deploy time | Deploy-time only |

Audit notes:

- **Baked public vars are a deploy hazard for personalization.** Any new `NEXT_PUBLIC_*` flag the layout engine needs (it shouldn't need one — see §4, flags belong in the DB) requires a full rebuild + redeploy. The script already fails loudly when they're missing, which is good.
- **Secret hygiene is correct:** service_role is never in the repo, never in `wrangler.jsonc`. Keep it that way for any new secrets (`CRON_SECRET`, see §2).
- **`.env.example` is the contract.** New env vars must be added there with a comment. There is no runtime validation of server env vars at boot (only the two build-time public ones are gated) — consider a startup self-check in the future, out of scope for this eval.

### 1.3 Schedulers — what exists today

**There is no application scheduler.** Verified:

- No `pg_cron` usage anywhere in `supabase/migrations/` (001–017); no `cron.schedule` calls.
- No `[triggers]` / cron section in `wrangler.jsonc`; no `scheduled` handler in the codebase.
- No `.github/workflows`, no VM crontab in the repo, no scheduler config files.

What *does* exist and is easily confused with app infra:

- **Muse runtime crons** (e.g. `phase1-progress-update`, `phase2-progress-update` hourly briefings, `dawson-school-watch`) — these are agent-level automations in my own runtime, not production application infrastructure. They must never be the execution path for per-pilot personalization jobs.
- **Supabase skill scripts / sync workers** (`~/workspace/cockpit-sync/`, ParentVUE pulls) — external data pipelines pushing snapshots into `crew_grade_syncs`, not app schedulers.
- **Nudge engine** (`src/lib/nudges/engine.ts`) — pure scoring library invoked on-demand by API routes (`/api/nudges/candidates`, producers). There is no background producer loop; nudges are computed when requested. The personalization aggregation jobs will be the **first** recurring background workload this app has.

### 1.4 LLM hosting (Crystal)

- Crystal is **not** in this repo and **not** on this Pages project. It is an external Cloudflare Worker at `https://crystal.mehedikamal.workers.dev` (llama-3.3-70b), called over HTTPS:
  - Server-side: `src/app/api/chat/route.ts` proxies `/api/chat` → `${CRYSTAL_URL}/chat` (env `NEXT_PUBLIC_POOKIE_TUTOR_URL` with hardcoded fallback).
  - Client-side: `src/components/applets/crystal-applet.tsx` calls it directly.
  - Health: `src/app/api/admin/integrations/[id]/test/route.ts` pings `${CRYSTAL_URL}/health`.
- Deploy implication: personalization's LLM needs (user-model summarization) reuse this existing worker over HTTPS — **no new LLM infra to deploy**. Cost/scale of the Crystal worker itself is Mehedi's existing concern; the incremental load from personalization is quantified in §5.
- Reliability note: the app already degrades gracefully when Crystal is unset/down (chat falls back). Summarization jobs must follow the same pattern — a Crystal outage skips the summary and retries next cycle, never fails the whole aggregation job.

### 1.5 Migration deployment

- Migrations are **manual**: numbered SQL files in `supabase/migrations/` (001–017), run by Mehedi via copy-paste into the Supabase dashboard SQL editor. `supabase/migrations/README.md` documents the click path and per-migration verify queries. Rule: numeric order, one file per change, never edit a file after it has been run.
- The VM↔Supabase egress block (2026-10-12 ~22:40 EDT → cleared 2026-10-13 ~01:30 EDT) is the reason automation isn't used. Even now that egress is clear, the established process is manual runs by Mehedi — keep it; add verification queries, not new tooling, for the 018+ series.
- Free-tier note: `pg_cron`/`pg_net` extensions are installable on Supabase free tier, but jobs stop when a project pauses after 7 days of inactivity. Production (daily users) won't pause; staging might — design cron so a missed window is harmless (idempotent, catch-up by time window, see §2).

---

## 2. Deployment plan for personalization

### 2.1 What needs deploying

| Component | Ships how | Notes |
|---|---|---|
| Signal-collection API (`POST /api/signals`, batch endpoint) | With the app (Next.js route, same deploy script) | Write-heavy. Must be lean: auth check → single batched INSERT → 200. No LLM, no scoring on this path (§3 latency budget). |
| Layout read API (`GET /api/layout`) + scoring lib | With the app | Scoring runs on read (cheap, rules-based) or reads precomputed layout from `cockpit_layouts` (table already exists from migration 001). |
| Nudge producers / ranking overrides | With the app (extends existing engine) | No new infra. |
| Aggregation jobs (nightly rollups, layout recompute, retention) | **New: dedicated scheduler Worker** (see §2.2) calling secured app endpoints | First recurring workload; must not live in the Pages worker (no cron support on Pages direct-upload). |
| User-model summarization (LLM) | Scheduler-triggered app endpoint → HTTPS to existing Crystal worker | No new LLM deploy. Cadence weekly per pilot, not per event. |
| Migrations 018+ (signals tables, feature flags, metrics rollups) | Manual SQL-editor run by Mehedi **before** the code deploy | Code must be defensive: missing tables → degrade, never 500 (see §2.4). |
| Feature-flag reads | DB table, no deploy | Runtime kill switch (§4). |

### 2.2 Scheduler recommendation: dedicated Cloudflare Worker with Cron Triggers

**Recommendation: a small, dumb scheduler Worker (`cockpit-scheduler`) in this repo, deployed with `wrangler deploy`, holding only `[triggers] crons` + a `scheduled` handler that `fetch()`es secured app endpoints (`/api/cron/aggregate`, `/api/cron/summarize`, `/api/cron/retention`) with a `CRON_SECRET` bearer token. All real logic stays in the Next.js app (service_role access, scoring code, Supabase client singleton already there).**

Comparison of the options:

| | **A. Scheduler Worker → app endpoints (recommended)** | B. Supabase pg_cron + pg_net → app endpoints | C. pg_cron doing work inside Postgres | D. External (VM/Muse) crons |
|---|---|---|---|---|
| Versioned with the app | ✅ wrangler config in repo | ✅ SQL in migrations | ✅ SQL in migrations | ❌ agent-local, invisible |
| Survives Supabase pause | ✅ | ❌ jobs stop on pause | ❌ jobs stop on pause | ✅ (but fragile — see below) |
| LLM / app-code reuse | ✅ calls app routes | ✅ calls app routes | ❌ PL/pgSQL only; LLM needs HTTP out anyway | ✅ |
| Observability | ✅ Cloudflare logs + tail; per-run HTTP status | ⚠️ Postgres logs only | ⚠️ Postgres logs only | ❌ scattered |
| Free-tier fit | ✅ 5 cron triggers/account free; invocations trivial | ✅ extension free | ✅ | ✅ |
| Failure blast radius | ✅ isolated; app unaffected | ⚠️ shares DB compute | ⚠️ long jobs contend with app queries | ❌ VM egress outage (Oct 12–13) proved this path fragile |
| Secrets | `wrangler secret put CRON_SECRET` (dashboard ok too) | Vault in DB (readable by DB admins) | Same | Scattered |

**Why not B/C as primary:** pg_cron is genuinely good for *DB-only* maintenance (retention deletes, index upkeep), and I recommend using it for exactly that as an optional second layer. But per-pilot aggregation needs app code (scoring lib, Crystal HTTPS calls, the Supabase client singleton in `src/lib/supabase/`), and routing it through Postgres adds a failure domain with worse observability. The Oct 12–13 egress incident is also instructive in reverse: it was VM-side, Supabase-side jobs were unaffected — but the lesson is to keep production scheduling on infrastructure Mehedi owns in the Cloudflare dashboard, not on my VM.

**Why not D:** my runtime crons are for agent briefings, not for serving users. The VM egress block proved this path can silently die for a day.

Concretely:

- New `scheduler/` directory (or `workers/scheduler/`) with its own `wrangler.toml`-equivalent config: name `cockpit-scheduler`, `[triggers]` with three crons — e.g. nightly aggregation at `15 6 * * *` (2:15 AM ET), weekly summarization Sundays `30 5 * * 0`, retention Sundays `0 4 * * 0`. (Free plan allows 5 cron triggers per account — verify the account isn't already at the cap from the Crystal/other workers; if it is, that's a $5/mo Workers Paid trigger, see §5.)
- The `scheduled` handler does nothing but `fetch(APP_URL + path, { headers: { authorization: 'Bearer ' + env.CRON_SECRET } })`, logs the status, and returns. Timeout-safe: app endpoints must respond within the worker's limits and do chunked work (see below).
- App endpoints verify the bearer against `CRON_SECRET` (constant-time compare), reject everything else with 401, and are excluded from any public API docs.
- **Chunking rule:** one cron invocation must never try to process all pilots in one pass. Paginate by `pilot_id` cursor, N pilots per invocation (start N=50), each invocation idempotent and resumable via a `job_runs` watermark table. On Workers Free the per-invocation CPU cap is 10ms — the scheduler worker itself does ~1ms (just a fetch); the heavy lifting happens in the Pages worker serving `/api/cron/*`, which is also CPU-capped per request, so the endpoint processes one chunk per call and the scheduler re-invokes (or the endpoint chains via `waitUntil` + self-fetch — prefer scheduler-driven pagination: simpler to observe, no runaway recursion).
- **Idempotency:** every job writes a `job_runs(job_name, window_start, window_end, status)` row with a unique constraint on `(job_name, window_start)`; a duplicate cron firing for the same window is a no-op.

### 2.3 Migration deployment order (018+)

1. Schema team writes `018_personalization_foundation.sql` (signals table, `feature_flags`, `job_runs`, metrics rollup tables, indexes, RLS, grants — auto-expose is OFF, so every table needs its explicit `GRANT ... TO authenticated`, per the lesson in `supabase/migrations/README.md`).
2. Mehedi runs it in the SQL editor; runs the bundled verify queries (tables exist, RLS on, grants present); confirms in chat.
3. Only then does the app code deploying routes that read those tables go out via `deploy/deploy-staging.py` + green smoke test.
4. **Code defensiveness (non-negotiable, ties to Mehedi's NO BLANK PAGES rule):** every personalization route wraps table access so a missing table degrades to static behavior with a structured error log, never a 500. The smoke test stays green even if a migration was missed — the degradation is caught by the observability alerts (§3), not by users.
5. Scheduler worker deploys **after** the app endpoints it calls exist in production (deploy app first, verify endpoint with a manual authenticated curl, then `wrangler deploy` the scheduler).

### 2.4 What changes in the existing pipeline

- Almost nothing: `deploy/deploy-staging.py` already rebuilds from a clean tree, gates on build env, and smoke-tests. Add two smoke assertions for personalization: `POST /api/signals` without auth → 401 (not 500), and `GET /api/layout` without auth → 401/redirect (not 500). These prove the new routes are deployed and fail closed.
- Add a deploy-step note: after any deploy that touches cron endpoints, manually hit each `/api/cron/*` once with the secret to confirm 200 before enabling the scheduler — or better, a `deploy/verify-cron-endpoints.py` script (future work, flagged not built).
- Fix the §1.1 smoke-test URL mismatch before any of this ships.

---

## 3. Observability plan

### 3.1 Metrics (what to track and why)

**Ingestion health**
- `signal_ingest_rate` (events/min) and `signal_ingest_error_rate` (5xx or validation-fail / total). A sudden drop means the client batching broke; a spike in errors means a bad client release.
- `signal_batch_size_avg` — guards against a client bug sending 1-event batches (request amplification) or 10k-event batches (payload blowup).

**Layout engine quality** — the money metrics:
- `layout_recompute_latency_ms` p50/p95 per run — scoring must stay cheap; p95 growth means the scoring model got too fancy.
- `ranking_override_rate` = fraction of sessions where the pilot manually reorders/pins/hides a module differently from the AI order. **Sustained high override = the AI is wrong.** This is the primary quality signal for ARRANGE.
- `explanation_coverage_pct` = fraction of AI-placed modules carrying a human-readable "why" explanation. Below threshold = the engine is confident but inarticulate; Mehedi's plain-language standard applies to AI decisions too.
- `layout_serve_source` (ai vs static-fallback vs dark-shadow) — distribution over time; fallback spikes indicate upstream failures.

**Anticipation (nudges)**
- `nudge_precision_proxy` = acknowledge+act rate vs dismiss/mute rate per category. The engine already tracks ack/snooze (`/api/nudges/[id]/acknowledge`, `/snooze`); aggregate it.
- `nudge_duplicate_rate` — dedupe misses; duplicates are the fastest way to train users to ignore the co-pilot.

**Jobs**
- `aggregation_job_duration_ms`, `aggregation_job_success` (per window), `pilots_processed`, `pilots_failed`.
- `cron_heartbeat_lag` = now − last successful `job_runs` row per job. Missing heartbeat = the scheduler died silently (the failure mode cron systems actually have).
- `summarization_skipped_crystal_down` count — tracks Crystal worker availability impact separately from our bugs.

**Platform guards (free-tier tripwires)**
- Supabase DB size (alert at 400MB of the 500MB free quota), egress (alert at 4GB of 5GB/month), MAU (alert at 40k of 50k).
- Cloudflare Workers requests/day (alert at 80k of 100k free).

Where metrics live: a `personalization_metrics_daily` rollup table (written by the aggregation job) + Cloudflare Workers Logs for raw events. **Do not log every signal event as a Workers log line** — at 10k pilots that log volume alone becomes a cost line (see §5).

### 3.2 Log structure

Structured JSON, one line per significant event. Required fields:

- `ts` (ISO-8601), `route`, `operation`, `pilot_id_hash` (SHA-256 of pilot UUID with a server-side salt — **never the raw UUID, never email, never names**), `duration_ms`, `outcome` (ok / degraded / error), `error_code` (stable string like `signals.validation_failed`, never a stack trace in prod logs), `trace_id` (propagated `x-trace-id` or generated).
- Optional: `model_version` (layout scorer version — essential for attributing quality changes to a deploy), `flag_state` (which flags were on — essential for dark-launch analysis).
- **PII rules:** no raw pilot IDs, no emails, no names, no message/notes content, no health values, no grades. Aggregates only. Signal payloads themselves live in the signals table under RLS, not in logs.
- Client-side: batch signal send failures locally with exponential backoff; log client errors via a sampled `/api/client-log` endpoint (1% sample) — never full-fidelity client logs.

Retention: raw structured logs 7 days (matches Supabase free log retention and Cloudflare free 3-day traces — export what matters into the daily rollup table, which is kept 1 year).

### 3.3 Alert thresholds (initial — tune after 2 weeks of baseline)

| Signal | Threshold | Severity | Action |
|---|---|---|---|
| `signal_ingest_error_rate` | > 1% over 5 min | Page (chat) | Check client release / validation schema |
| `signal_ingest_rate` | drops > 50% vs same hour last week | Warn | Client batching or deploy regression |
| `layout_recompute_latency_ms` p95 | > 2,000 ms | Warn | Scoring too heavy; simplify or chunk smaller |
| `ranking_override_rate` | > 40% over 24h | **Page** | AI is wrong — consider kill switch (§4) |
| `ranking_override_rate` | rising 3 days straight (any level) | Warn | Model drift; review scorer weights |
| `explanation_coverage_pct` | < 80% | Warn | Engine shipping unexplained placements |
| `aggregation_job_success` | 2 consecutive windows failed | Page | Scheduler or endpoint down |
| `cron_heartbeat_lag` | > 2× expected interval | Page | Scheduler worker dead; check Cloudflare dashboard |
| nudge dismiss/mute rate per category | > 60% over 7d | Warn | Mute or retune that producer |
| Supabase DB size | > 400 MB | Warn | Retention job behind or growth spike; plan Pro |
| Supabase egress | > 4 GB in month | Warn | Approaching 5 GB cap; enable caching |
| Workers requests/day | > 80k | Warn | Approaching free cap; plan Workers Paid |
| Crystal summarization skipped | > 10% of weekly pilots | Warn | Crystal worker degraded; summaries delayed, not lost |

Alert delivery: start with a dedicated chat/DM to Mehedi (he already gets hourly briefings; alerts must be distinct from briefings — different prefix, e.g. `[PERSONALIZATION ALERT]`). No PagerDuty-style paging for a family-scale app; do not over-build.

---

## 4. Kill switch + dark-launch design

### 4.1 The kill switch: `feature_flags` table

New table `feature_flags(flag_key text primary key, enabled boolean, rollout_pct integer, updated_at timestamptz)` deployed in migration 018, seeded with:

- `personalization.layout_engine` — master switch. OFF = every pilot gets the static module order, zero AI involvement.
- `personalization.dark_launch` — when ON (and engine ON), layouts are computed and stored but **never served**; clients get static order. Used for shadow evaluation.
- `personalization.nudge_ranking_v2`, `personalization.summarization` — per-subsystem switches so a misbehaving subsystem is isolated without killing the whole stack.

Mechanics:

- **Read path:** layout/nudge routes read flags once per request from a tiny in-memory cache with 60-second TTL (per isolate). 60s bounds the kill-switch latency: flipping the flag takes effect within ~1 minute, no redeploy, no env-var change.
- **Why not an env var:** Pages env-var changes require a redeploy to take effect — too slow and too coupled for an emergency switch. Why not Cloudflare KV: another store, another bill, another thing to secure; Postgres is already the source of truth and the read is one indexed PK lookup.
- **Who can flip it:** an admin-only endpoint (`/api/admin/flags`, reusing the existing admin auth in `src/app/api/admin/`) + direct SQL for Mehedi. Every flip writes to the existing admin audit log (migration 003 `admin_audit` — check it covers flag changes; if not, extend in 018).
- **Fail-closed default:** if the flags table is unreadable (missing migration, DB blip), the engine treats all flags as OFF and serves static. This is the same defensive posture as §2.3 — a missing table can never produce a 500 or a half-personalized page.
- **Kill drill:** part of acceptance (§6): with staging green, flip `layout_engine` OFF mid-session and confirm static order returns within 60s with no errors.

### 4.2 Dark launch (shadow mode)

Purpose: prove the layout engine is *right* before any pilot sees it.

1. Deploy engine with `dark_launch=ON`, `layout_engine=ON`.
2. Aggregation job (or read path — prefer the job, cheaper) computes the AI layout per pilot and writes it to `cockpit_layouts` with `active=false`, plus a `shadow_eval` JSONB: the AI order, the static order it would have replaced, and per-module position deltas.
3. Clients continue to receive the static order. All serving metrics are tagged `serving=static, shadow_computed=true`.
4. Offline analysis (a weekly query, later a dashboard panel): for pilots who manually reorder modules, compare their manual order against the shadow AI order — this is a direct measurement of `ranking_override_rate` *before* launch. Also measure `explanation_coverage_pct` on shadow layouts.
5. **Promotion gate:** shadow override rate < 25% for 7 consecutive days AND explanation coverage ≥ 90% → flip `dark_launch=OFF` for 10% of pilots (`rollout_pct`), watch 48h, then 50%, then 100%. Any regression → back to 0% (the flag supports gradual rollout, not just on/off).

### 4.3 Rollback story

- **Layout misbehaves in production:** flip `personalization.layout_engine` → OFF. Static order returns within 60s. No deploy, no data migration, no user action. Then diagnose from `shadow_eval` rows and structured logs.
- **Bad deploy (code):** the deploy script already refuses dirty trees; rollback is `git revert` + redeploy via the same script (direct-upload means no instant Pages rollback button as with Git-connected projects — note this as a known limitation; the flag-based kill switch is the fast path, redeploy is the slow path).
- **Bad migration:** migrations are manual and additive-only (never edit a run file). A bad 018 is fixed by a compensating 019, not by editing 018. Flags let you neutralize the feature while the fix is prepared.

---

## 5. Cost estimates

Assumptions (stated so they can be argued with): per active pilot per day — 50 raw signal events (batched by the client into ~5 HTTP requests), 1 layout fetch (~2 KB JSON, cached client-side per session), 100 total dynamic requests/day across all routes, nightly aggregation chunk of ~50 pilots per cron invocation, weekly LLM summary (~2k tokens via the existing Crystal worker). Signal event ~500 bytes stored. Retention: raw signals 14 days, daily rollups 1 year.

### 5.1 Cloudflare

| | 1k pilots | 10k pilots |
|---|---|---|
| Dynamic requests | ~100k/day → **at the Workers Free 100k/day cap** | ~1M/day → over free |
| Plan needed | Free is borderline on day one; **budget Workers Paid $5/mo** as soon as daily actives approach 1k | Workers Paid: $5 + (30M − 10M incl.) × $0.30/M ≈ **$11/mo** requests |
| CPU | Layout scoring ~5–20ms CPU per pilot per night, chunked 50/invocation — fits Paid (30M CPU-ms incl./mo; usage here is thousands) | Same shape; well within included CPU |
| Cron triggers | Free allows 5/account — **verify the account isn't already at the cap** (Crystal + other workers). If capped, triggers alone force Workers Paid. | Same $5 already covers 250 triggers |
| Logs | Keep structured logging sampled; full-fidelity signal logging would blow the 200k events/day free observability quota at 10k pilots | Paid: 20M events/mo incl., then $0.60/M — sampled logging stays inside |
| Static assets/video | Free, unlimited (already served direct via `_routes.json`) | Same |

**Key risk:** the app's dynamic requests ride the same 100k/day free quota as everything else on the account. Personalization's ~5 batched signal requests/pilot/day are a small fraction of the ~100 total — the cap risk is *app-wide*, personalization just adds ~5%. The honest estimate: **plan $5/mo Workers Paid from the 1k-pilot milestone regardless; personalization is not the driver, it just arrives at the same time.**

### 5.2 Supabase (free tier: 500 MB DB · 5 GB egress/mo · 50k MAU · 500k edge-function invocations/mo)

The app doesn't use Edge Functions for this stack (Pages worker + scheduler worker instead), so that quota is untouched.

| | 1k pilots | 10k pilots |
|---|---|---|
| Raw signals (14-day retention) | 50 × 500 B × 14 d × 1k ≈ **350 MB** | ≈ **3.5 GB** |
| Daily rollups (1 yr) | ~2 KB/pilot/day × 365 × 1k ≈ 730 MB → **too big; keep 90 days ≈ 180 MB** | 90 days ≈ 1.8 GB |
| Layouts + flags + job_runs | Negligible (< 10 MB) | Negligible (< 50 MB) |
| **DB total (personalization only)** | **~540 MB → EXCEEDS 500 MB free** | **~5.3 GB → needs Pro** |
| Verdict | **Free tier does not fit 1k pilots** with 14-day raw retention. Options: 7-day raw retention (~175 MB, total ~365 MB — fits but tight alongside the app's existing tables), or accept **Pro $25/mo at the 1k-pilot mark**. | **Pro $25/mo required** (8 GB included). Egress: layout fetch 2 KB × 10k × 30 ≈ 600 MB/mo — fine inside 250 GB. |

**Free-tier risks, ranked:**

1. **DB size is the binding constraint, not requests.** "Unlimited API requests" on free is real, but 500 MB fills fast with write-heavy signals. The single most important cost control is the retention policy: raw 7–14 days, rollups 90 days, and the retention cron (§2.2) is not optional — it's what keeps the bill at $0.
2. **Egress (5 GB/mo)** — personalization adds little (small JSON payloads, cached client-side), but the app's overall media/video-adjacent traffic plus 10k pilots' page loads could approach it. The 4 GB alert (§3.3) is the tripwire.
3. **Project pause after 7 days inactivity** — production won't pause, but staging will between bursts. pg_cron-based jobs would silently stop on staging; another reason the Cloudflare scheduler worker is primary (§2.2).
4. **No point-in-time recovery / no automated backups on free** — a bad migration 018+ is unrecoverable except by compensating migration. Mehedi should export a schema+data snapshot before running 018 (one `pg_dump` line in the runbook).
5. **MAU 50k** — not a personalization concern until far past 10k pilots.

### 5.3 LLM (Crystal worker)

No new infra. Weekly per-pilot summarization: 1k pilots ≈ 143 summaries/day ≈ 300k tokens/day on llama-3.3-70b via the existing worker — this rides Mehedi's existing Crystal hosting, not a new bill. If Crystal is on Workers AI free tier, watch its own caps; if it degrades, summaries skip and retry (tracked by `summarization_skipped_crystal_down`, §3.1). **Do not put LLM calls on the signal-ingest hot path** — that would convert a free batch API into a per-event inference bill.

### 5.4 Bottom line

| Scale | Incremental infra cost | Driver |
|---|---|---|
| 1k pilots | **$0–5/mo** (Workers Paid $5 if request cap nears; Supabase free if 7-day raw retention holds, else Pro) | DB size, request cap |
| 10k pilots | **~$36/mo** (Workers Paid ~$11 + Supabase Pro $25) | DB size (Pro), request overage |

The cheapest architectural decision in this whole plan is aggressive signal retention. The most expensive mistake would be logging every signal event to Workers Logs or retaining raw signals indefinitely.

---

## 6. Per-phase acceptance criteria

**Phase 0 — Tables & flags (migration 018).**
- [ ] `018_personalization_foundation.sql` written: signals, feature_flags (seeded), job_runs, metrics rollup tables; RLS on; explicit grants (auto-expose is OFF).
- [ ] Mehedi runs it in the SQL editor; verify queries pass (tables exist, RLS on, grants present); schema snapshot exported before the run.
- [ ] `/api/admin/flags` flips a flag; change appears in admin audit log; read-path cache picks it up within 60s.

**Phase 1 — Signal ingestion (dark).**
- [ ] `POST /api/signals` deployed; unauthenticated → 401 (smoke test asserts, never 500).
- [ ] Batch of 50 events ingests p95 < 300ms; error rate < 0.1% over 24h on staging.
- [ ] Missing signals table (simulated) → route degrades with structured log, no 500.
- [ ] Client batches (not per-event POSTs); `signal_batch_size_avg` visible in logs.

**Phase 2 — Dark-launch layout compute.**
- [ ] Scheduler worker deployed; three crons firing; `job_runs` heartbeats current; `cron_heartbeat_lag` < 2× interval.
- [ ] Shadow layouts written nightly for all staging pilots; `active=false`; `shadow_eval` populated.
- [ ] Clients still receive static order; `layout_serve_source=static` at 100%.
- [ ] Kill drill: flip `layout_engine` OFF mid-session → static order within 60s, no errors.

**Phase 3 — Gradual rollout.**
- [ ] Promotion gate met: shadow override rate < 25% for 7 days, explanation coverage ≥ 90%.
- [ ] 10% → 50% → 100% via `rollout_pct`, 48h soak each; override rate stays < 40% at each step.
- [ ] Rollback drill: force a bad scorer version on staging, confirm flag flip restores static in < 60s.

**Phase 4 — Aggregation + summarization steady state.**
- [ ] Nightly aggregation completes inside its window 7/7 days; `pilots_failed` = 0.
- [ ] Weekly summaries generated for 100% of eligible pilots; Crystal-down skips tracked and retried.
- [ ] Retention job holds raw signals ≤ 14 days; DB size stays under the 400 MB alert line on free tier.
- [ ] Cost review: actual Workers requests/day and Supabase usage vs §5 estimates; adjust retention or plan tier.

---

## 7. Open questions / risks for the parent orchestrator

1. **Smoke-test URL mismatch (§1.1)** — ~~confirm whether production is `cockpit.pages.dev` or `cockpit-10c.pages.dev` before any personalization deploy; the smoke test currently may be certifying the wrong artifact.~~ **RESOLVED 2026-10-13: `https://cockpit-10c.pages.dev` is canonical (Meheldi confirmed); locked everywhere.**
2. **Staging is red** (500s, deep-dive team active) — all phases above are gated on green staging + passing smoke test.
3. **Cron-trigger account cap** — verify the Cloudflare account's used cron triggers (free = 5/account across all workers) before committing to the scheduler-worker design.
4. **Mehedi's manual migration step** — 018+ keeps the established SQL-editor process; the runbook needs the pre-run snapshot export and the verify queries bundled in the migration file header.
5. **Retention policy needs a product decision** — 7 vs 14 days raw signals is a cost-vs-debuggability tradeoff (7d keeps Supabase free at 1k pilots; 14d likely forces Pro $25/mo). Recommend deciding before Phase 1.
6. **No Git-connected deploys** — rollback of bad code is revert+redeploy (minutes), not instant. The DB flag kill switch (§4) is therefore the primary incident control, not the deploy pipeline.

---

*End of DevOps evaluation. Sibling evals in this directory cover the other layers; this document owns deploy pipeline, scheduling, observability, kill-switch/dark-launch, and cost.*
