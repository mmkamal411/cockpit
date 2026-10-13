# Cockpit Scalability Study: 1,000 → 1,000,000 Users

**Date:** 2026-10-13
**Prepared by:** Cloud Solutions Architect, Backend/Database Scaling Expert, Cost Analyst (expert subagent team)
**Repo audited:** `mmkamal411/cockpit` (`staging/crystal-robot-improved`), read-only — no code was changed for this study.
**Status:** Planning document. Every figure is a planning estimate, not a vendor quote. Prices verified against public sources on 2026-10-13 (each section cites its sources); vendors change prices without notice. Usage assumptions are stated explicitly — change the assumption, change the number.

> **Honesty note.** User counts below are ranges, not precision. They assume a typical active user makes ~20–40 dynamic requests/day, sends ~2–5 chat messages/day, and has 1–2 linked children. A power user counts 3–5×. Where the three experts' sources disagreed, a range is given. The *ordering* of what breaks first is more reliable than the exact user count at which it breaks.

---

## Executive summary — the whole study in one page

**The single most important finding: unit cost is nearly flat (~$0.20–0.26/user/month) and AI inference is the bill at every increment** — 65% of infra spend at 1K users, 84% at 1M. The cost curve is linear, not exponential. Everything else (Supabase, Cloudflare, email, storage) is a rounding error next to tokens.

| Increment | Monthly infra | $/user/mo | Dominant line (share) | Annualized |
|---|---|---|---|---|
| 1K users | ≈ **$260** | $0.26 | AI inference (65%) | ≈ $3.1K/yr |
| 10K users | ≈ **$2,313** | $0.23 | AI inference (74%) | ≈ $28K/yr |
| 100K users | ≈ **$21,129** | $0.21 | AI inference (80%) | ≈ $254K/yr |
| 1M users | ≈ **$202,540** | $0.20 | AI inference (84%) | ≈ $2.43M/yr |
| 1M users (cost levers pulled) | ≈ **$76,500** | $0.08 | AI inference (bent) | ≈ $918K/yr |

**People cost dwarfs infra at every increment** (e.g. at 10K users: ~$70K/mo in people vs ~$2.3K/mo in infra). The business question is never "can we afford the servers" — it's "does revenue per user cover ~$0.21 infra + the amortized team."

**One-time reengineering to get there: 45–84 person-weeks (~$180K–$336K)** across 8 workstreams, mostly incurred before/at 10K users.

**The single biggest risk is not technical — it's the data supply chain.** School data arrives via unofficial ParentVUE/StudentVUE scraping with no published rate limits, no ToS blessing, and no SLA. That risk scales with *user count*, not code quality: what survives as one family's laptop sync does not survive 10K families of scraping load without IP blocks, account lockouts, or legal contact. The fix (official data-provider partnerships, hosted sync service) must start at 10K and is the longest-lead item in the study.

**Top 5 reengineering items (in the order they bite):**

1. **AI serving tier** (bites first — at a few hundred active users): the Workers AI free quota allows ~50 chats/day *total, all users combined*. Fix now: Workers Paid ($5/mo) + per-user rate limits + auth on the crystal worker + a small-model triage router at 10K. This is also 65–84% of the infra bill at every increment.
2. **Cron → real job queue** (bites at ~200–500 pilots): the nudge producer loads *all* pilots unbounded and loops sequentially in one HTTP invocation. Fix: cursor pagination now (half-day change), Cloudflare Queues fan-out at 1K. The ~40 Muse-agent crons never scale — they must be replaced by in-platform scheduled jobs, not fanned out.
3. **Snapshot retention + read-path projection** (bites at ~6–40 months for a single child on the free DB): `crew_grade_syncs` is 19 JSONB columns, append-only, no retention — one child can fill the 500 MB free database. Fix: 30-day retention + weekly rollups, and stop `select("*")` on the latest-sync route.
4. **Deploys: retire direct upload** (bites at 1K–5K users or the second engineer): move to git-connected Pages + CI with preview deploys and one-click rollback. Manual script deploys from one VM don't survive on-call.
5. **Supabase tier + data-plane plan** (bites progressively): Pro ($25/mo) immediately (the free tier *pauses after 7 days of inactivity* — a production outage by design), Team at 10K, read replicas at 100K, region-pinned/multi-region data plane at 1M. No technical wall forces leaving Supabase before ~1M if retention is fixed — the exit is economic/compliance-driven.

---

## 1. Where we are today (current-state audit)

### 1.1 Runtime components

| # | Component | Runs on | Scale-relevant fact |
|---|---|---|---|
| 1 | Next.js 16 web app + ~90 API routes | Cloudflare Pages, **direct upload** (git integration disconnected), OpenNext adapter → single Worker | `NEXT_PUBLIC_*` baked at build time — every env change needs a full rebuild. ~76 MB bundle incl. 38 MB of videos re-uploaded every deploy. |
| 2 | Edge gate (`src/proxy.ts`) | Same Pages Worker | Calls Supabase `updateSession` (Auth API round-trip) on **every** non-static request. |
| 3 | Postgres + Auth + Storage | Supabase **FREE tier** (`hwnesewathbnfvoxtbqh`) | 500 MB DB, ~2–5 GB egress/mo, 50K MAU, 1 GB storage. RLS on every table. **Pauses after 7 days inactivity.** No pg_cron, no Edge Functions. |
| 4 | AI chat backend ("crystal" worker) | Separate Cloudflare Worker, llama-3.3-70b via Workers AI binding | **No auth between app and worker. No streaming.** 30s timeout from the app. |
| 5 | Nudge pipeline | `POST /api/nudges/producers/run` (service-key auth) | Loads **all pilots unbounded**, runs producers **sequentially per pilot in one invocation**. Nothing currently schedules it (0 cron triggers in use). |
| 6 | School sync | Python scripts on **parents' laptops** (OS schedulers, keychain creds) → pushes snapshots to Supabase | Compute is free (user hardware). Unofficial ParentVUE API — no rate limits published, ToS-gray. |
| 7 | Calendar sync | In-app Google + Outlook adapters | Tokens AES-256-GCM encrypted (`CALENDAR_TOKEN_KEY`). |
| 8 | Job scheduler | **~35 Muse-side cron jobs** | Agent-executed, account-scoped to Meheldi. ~14 hardcode Dawson/Cobb County. **None of them can serve a second family.** |
| 9 | Email | Resend (setting up) | — |

### 1.2 What only works at family scale

- **Nudge producer fan-out** (`src/lib/nudges/producers/index.ts`): unbounded `loadPilots()` + sequential per-pilot loop — the clearest "works for 1, breaks for N" code in the repo.
- **~14 household crons** hardcode one family's data and rhythms.
- **`/api/today`** aggregates ~8 queries at request time with no cache; **chat context** rebuilds ~6 queries per message with no cache; **weather cache** is per-isolate memory (doesn't share across Worker instances).
- **`/api/bills` GET** is the worst query in the app: `select("*")` over *all* bills, no `.limit()`, status/window filtered in JavaScript.
- **Zero rate limiting** on `/api/chat` and server-side fetch routes; the crystal worker URL is unauthenticated (anyone who finds it burns the shared AI budget).
- **38 MB of videos ship inside every deploy**; no versioned asset pipeline; no preview environments; no rollback runbook.

### 1.3 Third-party quotas that matter (verified Oct 2026)

| Dependency | Free limit | What happens at the limit |
|---|---|---|
| Workers AI (llama-3.3-70b) | **10,000 neurons/day, hard fail** | Chat dead for everyone at ~50 conversations/day total |
| Cloudflare Workers | 100K req/day, 10 ms CPU/invocation | ~3–5K users on request volume; 10 ms CPU threatens heavy routes earlier |
| Cloudflare cron triggers | **5 per account** | The planned scheduler needs Paid on day one |
| Supabase Free | 500 MB DB, 50K MAU, auto-pause after 7 idle days | DB size + auto-pause are the near-term walls |
| ParentVUE/StudentVUE | No published limits (unofficial) | IP blocks / account lockouts / legal contact — no SLA |

---

## 2. What breaks when — per increment

### 2.1 → 1,000 users

**Binding constraint:** Workers AI free quota — ~50 chats/day shared across all users. Bites at **~200–500 active users**, before any infra limit. Second: the nudge producer sequential loop (can't finish one 15-min invocation past a few hundred pilots). Third: Supabase Free auto-pause (correctness issue *today*).

**Infrastructure changes:**
- Workers Paid ($5/mo): neuron overage billing, 10M req/mo, 250 cron triggers.
- Supabase Pro ($25/mo): 8 GB, no auto-pause, daily backups.
- Build the `cockpit-scheduler` worker (cron triggers → queue messages); retire the corresponding agent crons.
- Put a secret on the crystal worker; add per-user chat rate limits.

**Reengineer now (small, high-leverage):** nudge producer → cursor-paginated batches (half-day change, 10× headroom); chat route → rate limits + neuron-budget logging + model fallback; videos → R2 with versioned URLs; `proxy.ts` → stop `updateSession` on every request (edge-cached session validation).

**Keep:** RLS-on-every-table, Supabase client singleton, dual-source sync merge semantics, service-key-only scheduled endpoints, token-crypto envelope.

**Observability:** ship structured logs to Logpush/Sentry; replace agent health-check polling with real synthetics; add a cost dashboard (neurons/day, requests/day, egress/DB size).

### 2.2 → 10,000 users

**Binding constraint:** (1) Supabase compute + connection churn from serverless workers; (2) the laptop-sync *support* burden — 10K families × Conditional Access trust + keychain issues + unofficial-API breakage = a support queue, not a scaling curve; (3) AI cost ≈ $200/mo — affordable, now the largest line item, growing linearly with zero caching.

**Infrastructure changes:**
- **Retire direct-upload deploys** → git-connected Pages + CI (build, typecheck, tests, preview deploys, promote). Trigger: 1K–5K users or the second engineer.
- **Real job queue:** Cloudflare Queues — nudge producers become one message per pilot/batch with retries + DLQ; the 15-min trigger becomes a dispatcher that only enqueues.
- **Sync:** add a hosted fallback sync service alongside laptop installers; per-district adapter monitoring; evaluate official data partnerships (Clever/ClassLink-style).
- Supabase Pro compute upgrade or Team; read replica for `/api/today` + admin reads.

**Reengineer:** chat context → KV-cached bundle (5-min TTL); weather → shared KV/Cache API cache; chat backend → model router (8B for simple turns, 70B for hard ones) + response caching + per-user budgets; token key → KMS-backed rotation plan.

**Observability:** trace IDs end-to-end, DB slow-query alerts, queue/DLQ dashboards, first SLOs (99.5%) + on-call rotation. Start measuring latency by geography.

### 2.3 → 100,000 users

**Binding constraint:** **the database.** ~100–200 GB of user data vs Pro's 8 GB; connection fan-out; RLS evaluation cost on hot tables; write throughput on append-heavy tables. Second: polling doesn't survive — 15-min global nudge sweeps = 9.6M producer executions/day. Third: AI ≈ $2K/mo — needs a dedicated inference strategy.

**Infrastructure changes:**
- Supabase Team/Enterprise + **read replicas** + transaction-mode pooling; hot append-only tables evaluated for cheaper homes (R2 + warehouse for history; Postgres stays transactional).
- **Chat becomes its own serving tier:** request queue + backpressure, multi-provider routing with fallback, prompt/response caching, per-tier rate limits (pricing enters here).
- **Sync becomes a managed platform service:** hosted workers, official APIs where available, scraping demoted to fallback with per-district rate limiters.
- **Nudges go event-driven:** DB webhooks / queue messages on data change replace the global sweep (sweep remains as a low-frequency safety net).
- **`/api/today` gets a precompute path:** per-user briefing materialized on data change + short-TTL edge cache; request-time aggregation becomes the fallback.

**Reengineer:** today-route → precomputed briefing; sync scripts → one of several sync paths; nudge engine → event-driven execution (keep the scoring math, dedupe keys, quiet hours).

**Observability:** OpenTelemetry, error budgets as deploy gates, load-tested staging, cost attribution per cohort. **Assets:** all uploads to R2 (egress-free), image optimization pipeline.

### 2.4 → 1,000,000 users

**Binding constraint:** everything still single-region or single-writer — ~1–2 TB data, ~1M MAU (10× Pro's included 100K), ~300K chats/day. The single-region Postgres primary is the wall; second is operational (no team runs 1M users on agent crons and a manual deploy script).

**Infrastructure changes:** multi-region data (region-pinned user shards, read replicas per region); dedicated inference tier with committed capacity and distilled models; workflow engine (Cloudflare Workflows / Temporal / Inngest) replacing queues-with-prayers; compliance surface (SOC 2, data residency, COPPA machinery as enforced infrastructure).

**Redone entirely at 1M (not refactored — replaced):**
1. The agent-cron ops model → in-platform workflows.
2. Direct-upload deploys → full CI/CD with progressive delivery and automated rollback.
3. Single-region Supabase as the only store → sharded/regionalized data plane; chat history, sync snapshots, and behavioral signals re-homed to fit-for-purpose stores.
4. Request-time aggregation as the primary read path → precomputed, event-driven, edge-cached.
5. Unofficial school-portal scraping as a load-bearing integration → official district/data-provider APIs; scraping kept only as deprecated fallback.
6. One shared AI budget → per-user/per-tier metering, budgets, and abuse protection as billing infrastructure.

---

## 3. Data-layer specifics

- **Hottest table: `crew_grade_syncs`** — 19 JSONB columns, append-only, no retention. ~11–80 MB/month per child (compressed); one child fills the free 500 MB DB in ~6–40 months. Fixes in priority order: (1) retention policy — keep 30 days full + weekly rollups (moves the ceiling from months to years); (2) stop `select("*")` on the latest-sync route — project only rendered columns (~2–4× byte cut, zero schema change); (3) differential snapshots later.
- **Chat:** ~1–6 MB/month per active user; hot paths are bounded (200-msg thread cap, 20-msg history). No thread archival — add it before 100K.
- **RLS is well-designed** (direct `auth.uid() = pilot_id`, index-friendly) but child tables scope through parent subqueries per row — denormalize `pilot_id` onto `crew_grade_syncs`, `chat_messages`, `calendar_events` before 100K.
- **Connection story correction:** the app never opens PG connections per request (all HTTPS to PostgREST) — bandwidth and DB size bite 10–50× before connections do.
- **No technical wall forces leaving Supabase before ~1M** if retention is fixed — Pro at 1K, Team at 10K, Enterprise at 100K+. The exit is economic/compliance-driven, not technical.
- **Storage:** zero buckets exist today — go to R2 directly for the first upload feature (egress-free), don't start on Supabase storage.

---

## 4. Time & materials

Blended basis: **$4,000/person-week**. Ranges are planning bands, not quotes.

### 4.1 One-time reengineering (mostly before/at 10K)

| Workstream | Scope | Person-weeks |
|---|---|---|
| Multi-tenant hardening | RLS audit, tenant-isolation tests, authz pen-test | 6–10 |
| Cron → batch job platform | ~40 family crons → parameterized triggers + queues, DLQ, dedupe | 8–14 |
| AI cost architecture | Triage router, caching, compression, rate limits, metering | 6–12 |
| Sync installer v2 | Auto-update, multi-district adapters, 2FA, code signing, headless fallback | 6–10 |
| Billing & entitlements | Plans, Stripe, metering, grace paths | 4–8 |
| Observability & SLOs | Logging, tracing, alerting, status page, on-call | 4–8 |
| Compliance foundation | SOC 2 Type I readiness, COPPA/FERPA posture, retention enforcement | 8–16 |
| Load & chaos testing | k6 load tests, dependency-failure drills | 3–6 |
| **Total one-time** | | **45–84 pw ≈ $180K–$336K** |

### 4.2 Run-rate engineering (recurring)

| Increment | Team | FTE | $/mo people | Focus |
|---|---|---|---|---|
| 1K | 1 BE, 0.5 FE, 0.5 SRE | ~2 | ≈ $30K | Finish core, launch, support |
| 10K | +1 BE, +1 SRE, 0.5 data | 4–5 | ≈ $65–80K | Reliability, first on-call |
| 100K | +2 BE, +1 FE, +1 SRE, +1 data, 0.5 EM | 8–12 | ≈ $130–200K | SOC 2 II, abuse/fraud, cost optimization |
| 1M | Platform, inference, data-platform, trust & safety teams | 20–35 | ≈ $330–580K | Multi-region, inference eval, enterprise |

### 4.3 What can be deferred

Native mobile apps → 100K+ · Self-hosted LLM → 1M (evaluate at 100K) · Multi-region active-active → 1M · SOC 2 Type II → 100K · Trust & safety team → 100K · Data warehouse → 100K.

---

## 5. Monthly infrastructure cost (assumptions stated)

Assumptions: 85% of registered users active monthly; 5 chat msgs + 2 proactive AI runs per active user/day (800/250 and 1500/400 in/out tokens); 5 MB Postgres + 25 MB object storage + 100 MB bandwidth per user/month; Workers AI llama-3.3-70b at $0.293/$2.253 per 1M in/out tokens → **≈ $0.20/active user/month for AI, linear at every increment**.

| Increment | $/mo infra | $/user/mo | AI share | Annualized |
|---|---|---|---|---|
| 1K (850 active) | ≈ **$260** | $0.26 | 65% | ≈ $3.1K/yr |
| 10K (8.5K active) | ≈ **$2,313** | $0.23 | 74% | ≈ $28K/yr |
| 100K (85K active) | ≈ **$21,129** | $0.21 | 80% | ≈ $254K/yr |
| 1M (850K active) | ≈ **$202,540** | $0.20 | 84% | ≈ $2.43M/yr |

### 5.1 Cost cliffs (where unit economics break)

1. **Leaving free tier (immediate):** free Supabase pauses after 7 idle days — Pro $25/mo is a correctness requirement, not a scale decision.
2. **Egress overage past 250 GB (~2.5K users):** Supabase $0.09/GB → serve all binaries from R2 ($0 egress) from the start.
3. **MAU overage past 100K ($0.00325/MAU):** linear but large ($2.4K/mo at 850K MAU) — bend via Enterprise negotiation at ~500K+ MAU.
4. **AI inference (the 80%-of-bill cliff):** bend with a small-model triage router (50–70% saving — the biggest lever), context compression (−40% input tokens), response caching, per-tier rate limits, cheaper providers (Groq ~4× cheaper than Workers AI), self-hosted inference at 1M.
5. **Email volume:** prefer in-app nudges over email; SES for bulk at 100K+ (~$0.10/1K vs Resend $0.90/1K overage).

### 5.2 The bent 1M-user bill (all levers pulled)

| Line | Unbent | Bent |
|---|---|---|
| AI inference | $170,000 | $55,000 |
| Supabase | $15,095 | $13,000 |
| Email | $12,000 | $3,500 |
| Everything else | $5,445 | $5,000 |
| **Total** | **≈ $202,540** | **≈ $76,500/mo (~$0.08/user/mo)** |

---

## 6. What to do now (the next 30 days, in order)

1. **Supabase Pro ($25/mo)** — kills the auto-pause outage-by-design. Do this week.
2. **Workers Paid ($5/mo) + auth on the crystal worker + per-user chat rate limits** — the free neuron quota is the first wall and it's measured in the low hundreds of users.
3. **Snapshot retention job** — 30-day full + weekly rollups on `crew_grade_syncs`; project columns on the latest-sync route. A day's work that buys years of DB headroom.
4. **Nudge producer cursor pagination** — half-day change, 10× headroom before the queue migration.
5. **Start the official school-data partnership track** — longest lead item; the unofficial scraping path won't survive 10K families.
6. **Videos → R2**, **synthetics replacing agent health-checks**, **cost dashboard** — cheap, permanent wins.

---

## Appendix A — decisions with explicit trigger points

| Decision | Trigger |
|---|---|
| Retire direct-upload deploys | 1K–5K users **or** the second engineer, whichever first |
| AI chat gets its own serving tier | 3 stages: Paid+limits now → model router at 10K → dedicated tier at 100K |
| Crons → real job queue | Product scheduling moves to cron-triggers→queues at 1K; per-pilot queue messages before ~500 pilots |
| Python sync → managed sync service | Hosted fallback at 10K; official APIs at 100K; scraping fully replaced as load-bearing at 1M |
| Multi-region | Measure at 10K; read replicas at 100K; region-pinned shards at 1M |
| Leave Supabase | Only on economics/compliance (~1M); no technical wall before that |

## Appendix B — what was verified vs. assumed

**Verified in-repo:** component inventory, ~90 API routes, proxy behavior, deploy pipeline, nudge producer unbounded fan-out, chat route (no streaming, no rate limit, 20-msg history), context bundle (6 queries/message, no cache), today-route aggregation, token-crypto envelope, 28 migrations (no pg_cron/Edge Functions), wrangler configs (0 cron triggers, Workers AI binding), 38 MB videos in deploy bundle, unauthenticated crystal worker.
**Verified via scheduler:** 35 enabled cron jobs; none are per-user product crons.
**Verified via web (Oct 2026):** Workers Free/Paid quotas and neuron pricing; Queues pricing; Supabase Free/Pro/Team quotas and overages; R2/Upstash/Resend/Neon pricing; Pages $0 unlimited bandwidth.
**Assumed (ranges given):** per-user request/chat volumes; ~1–2 MB data footprint per user; Graph API effective throttling; Open-Meteo fair-use headroom. Breakpoints shift proportionally if assumptions are off; the break *ordering* does not.
**Not verified:** Supabase Enterprise base fee (used $2,000/mo estimate — custom-quoted); Resend 30M-email custom rate; observability/fleet lines (labeled estimates); alternative LLM provider prices (secondary sources, re-verify before committing); $4K/person-week basis (planning basis, not a salary survey).

*End of study.*
