# Personalization Stack — Build Plan

**Status:** EVALUATION COMPLETE — build not started. Awaiting founder approval.
**Date:** 2026-10-13
**Repo:** `mmkamal411/cockpit` (main) · Supabase `hwnesewathbnfvoxtbqh`
**Source material:** 12 expert evaluations in `personalization-eval/` (00–11, ~4,000 lines). This document is the synthesis; the eval files hold the full detail, file citations, and rationale.

---

## 1. What we're building (the 4 layers)

| Layer | Today | Target |
|---|---|---|
| **KNOW** — user model | Three unconnected piles: `pilots` columns (never written — no onboarding), `nudge_preferences`, chat context bundle (situational, no durable memory) | Versioned `pilot_profile` + append-only event log → LLM-summarized, pilot-editable preference doc injected into context |
| **ARRANGE** — layout engine | `cockpit_layouts` table exists, **zero readers/writers** in app code. Ordering hardcoded in 3+ places. | Rules-based ranking engine (v1) → per-pilot learning bandit (v2). Toolbar stays fixed; dynamic ordering in More applet + Home "Today's stations" deck |
| **ANTICIPATE** — nudge engine | **Built.** Scoring engine, 28 passing tests, quiet hours, dedup, "why am I seeing this" | Causal explanations, impression tracking (CTR currently unknowable), learning hooks |
| **ADAPT** — learn from corrections | Not built. | Correction affordances → feedback update rules → Bayesian nudge weights + layout bandit |

**Non-negotiables (from the founder):** behavioral profile never leaves the pilot's account · no cross-user learning · no LLM training on user data · every automated decision explains itself in plain English · the AI proposes, the user disposes (explicit overrides always win) · no blank pages, ever.

---

## 2. Phase 0 — Security & integrity fixes (GATING: nothing in KNOW/ADAPT starts until these ship)

The security expert found **active vulnerabilities**, not theoretical ones. Fix order:

| ID | Severity | Issue | Fix |
|---|---|---|---|
| A1 | **CRITICAL** | `crew_grade_syncs` readable AND writable by the entire internet (`anon` SELECT `using (true)`, INSERT `with check (true)`; `rpc_get_latest_crew_grade_sync` granted to `anon`, no caller check). Every child's grades, teacher emails, assessments publicly readable today. | Drop anon policies; move workers to service-role/worker-secret path; revoke anon grant on RPC; add caller check (steward or live grantee) for `authenticated`. |
| A2 | HIGH | Google Calendar refresh tokens stored in **plaintext** (`refresh_token_enc` is aspirational; `TODO: encrypt` never done) | Envelope-encrypt with KMS/data key before storing; decrypt server-side only at sync time. |
| A3 | HIGH | `redeem_share_invite` (017) trusts caller-supplied `p_pilot_id`, ignores addressed email — invite hijack via leaked link | Use `auth.uid()` + `auth.jwt()->>'email'` inside function; require email match; revoke anon grant. |
| A4 | MEDIUM | `find_pilot_by_email` is an email→UUID enumeration oracle for any authenticated user (signup is free) | Inline lookup into share-creation RPC with ownership check; return success/failure only. |
| A5 | MEDIUM | Admin `view-as` reads any pilot's data (incl. children's grades) on single-layer auth | Require both auth layers; audit-log credential reads. |
| W1 | HIGH | Crystal worker `/chat` and `/quiz` endpoints **effectively unauthenticated** (`isAllowedOrigin` only sets CORS headers, never rejects) | Shared-secret check on worker; kill the client-direct browser→worker path (flag-gated today). |
| C1 | HIGH | **Context contract drift:** app sends new `ChatContextBundle` shape; worker still expects legacy d-dash fields → worker calls the pilot literally "pilot"; weather/agenda/todos/nudges/crew fields **never reach the model**. Fixing this widens data flow to the LLM — needs privacy sign-off (children's names to inference service is the sharpest item). | Align contract; sign off the field inventory before enabling. |

Also in Phase 0: fix the 2 broken test files (`bills/logic.test.ts`, `health/glucose.test.ts` — extensionless imports rejected by Node type-stripping), resolve the smoke-test URL mismatch (`cockpit-10c.pages.dev` vs `cockpit.pages.dev` — one is wrong), add the missing `chat_threads.summary` column design, sign the calendar OAuth `state` (HMAC).

**Phase 0 done =** A1–A5 + W1 + C1 shipped and re-audited; `npm test` green; smoke test certifies the correct artifact.

---

## 3. Phase 1 — Foundation (migration 018, signals, flags, onboarding)

**Database — migration 018** (full draft SQL in `personalization-eval/09-dbadmin-schema-rls.md`):

- `personalization_signals` — raw behavioral events (90-day retention, then purge)
- `personalization_aggregates` — PK `(pilot_id, module, window)`; durable feature store
- `pilot_preferences` — explicit + learned weights JSONB, `model_version`
- `layout_versions` — **append-only**, `pilot_id, version, modules JSONB[{module,score,tier,pinned,reason}], created_by (ai|user|system)`, unique `(pilot_id, version)`. **Replaces** `cockpit_layouts` (zero live writers — no dual-write period; legacy table dropped in a later migration)
- `personalization_corrections` — labeled feedback (2-year retention)
- `feature_flags` — kill switches + dark-launch flags (60s-TTL cached reads)
- RLS: `enable + force`, single `for all` policy on `auth.uid() = pilot_id`, grants to `authenticated` only. New tables **not** added to the admin allowlist. Indexes: latest-layout per pilot, signal purge, corrections lookup.

**Signal collection:**
- `POST /api/signals/batch` — events array, max 100/batch, 64KB cap, always-202 with per-event accepted/rejected counts. `pilot_id` from auth only (spoof-proof). Rate limit 10 batches/min/pilot, fail-open limiter. Client: fire-and-forget, bounded 500-event buffer, drop-oldest, `sendBeacon` on pagehide, **zero UI on failure**. `event_id` uuid + unique constraint for idempotent retries. Auth via `pilotRoute` wrapper (the cleanest of the 3 existing idioms).
- 13-event taxonomy with privacy classes: **A** explicit config (kept longest) · **B** behavioral exhaust (aggregate fast, raw expires fast) · **C** AI feedback (stores only the *fact/kind* of correction, never user text). **Explicitly excluded:** keystrokes, chat/email content, health values, GPS, any crew/child data.
- Aggregation: scheduled daily job (never on-read); `pilot_signal_daily` + `pilot_features` snapshot + watermark table; accept 24h feature lag in v1.
- **Volume/cost flag:** ~250 events/day/active pilot. At 10k pilots, raw retention blows the 500MB free tier in under a day → 48h full-fidelity → 10% downsample → aggregates forever. (Retention tradeoff needs founder pick — see §8.)

**Onboarding (cheapest high-ROI fix):** first-run capture of name + timezone (browser-detected timezone, OAuth-prefilled name). Today `display_name`/`timezone` are never written and everything falls back to hardcoded defaults.

**Scheduler:** dedicated Cloudflare Worker (`cockpit-scheduler`) with cron triggers calling secured `/api/cron/*` app endpoints — versioned in repo, survives Supabase pauses, reuses app code. Chunked idempotent jobs via `job_runs` watermark table. pg_cron only for DB maintenance.

**Phase 1 done =** 018 applied; signals endpoint live with RLS tests passing; onboarding captures name/timezone; scheduler worker deployed; "block the endpoint and confirm the app behaves identically" test passes.

---

## 4. Phase 2 — ARRANGE v1 (rules-based layout engine + UI)

**Scoring formula (v1)** — same 0–135 scale and tier bands as the nudge engine, additive so every point carries its own reason:

```
score = BASE + time_of_day_fit + trigger_pressure (capped +35)
        + usage_recency + usage_frequency − neglect_penalty
clamp [5, 135]
```

`BASE` per module (editorial defaults; Crystal chat BASE 85 keeps it near-always-surfaced — flagged for founder review). Worked example validated (morning, $142 bill due tomorrow → Bills 108 SPOTLIGHT, Health 35 QUIET).

**Engine:** `src/lib/layout/engine.ts` mirroring nudge-engine patterns (pure functions, node-runnable tests, `whyLine`-style explanations). **Cached layout recomputed on trigger, never per page load.** Triggers: time-bucket change, nudge aggregate ≥65 (layout consumes nudge *aggregates* as its event factor — never re-detects events, no double-counting), integration connect/disconnect, explicit override, 4h fallback. DB is the cache; recompute failures keep last good layout (no-blank-pages rule).

**API:** `GET /api/layout` (ordered modules + tier + reason) · `POST /api/layout/override` (pin/reorder/hide, idempotent via `client_op_id`, synchronous recompute) · `DELETE /api/layout/override` · `POST /api/layout/recompute` (service-key only, fingerprint-diff skips no-ops). Overrides applied *after* scoring — user intent always wins. `layout_overrides` table doubles as ADAPT's labeled training data.

**Frontend:** module registry refactor first (ordering is hardcoded in toolbar/more-applet/applet-bus — ~1,200–1,600 new lines, ~10 files; extend `AppletDef` with glyph/blurb/tier/rank metadata; `useLayout()` hook). **Toolbar stays fixed** (muscle memory). Dynamic ordering in More applet + new Home "Today's stations" deck. Three tiers: **Spotlight** (hero panel, live context lines, breathing glow) · **Stations** (standard tiles) · **Lower deck** (collapsed). Re-ranks use FLIP morph + stagger ≤800ms, queued while an applet overlay is open, `prefers-reduced-motion` → instant swap. Overrides: long-press/⋯ menu ("Keep up front" / "Send to lower deck" / "Why is this here?") + drag rearrange; confirmation via Undo toast; local-first persistence. Failure → static default order + plain-English notice + Try again. Cold start → skeleton → default arrangement → one-time welcome card. **UI can ship before the AI engine** — `useLayout()` falls back to defaults.

**Transparency:** generalized `<WhyThis>` component — every automated decision ships server-composed `WhyInfo` (summary ≤140 chars + ranked factors + mandatory `sources` list + counterfactual + one-tap actions). Upgrade nudge `whyLine` to causal format so both rankers share one explanation language.

**11 ranking invariants** (property-tested): pins sacred · explicit-beats-implicit · floors-not-cliffs (dismiss demotes, never hides) · no cross-pilot learning · monotonic response to explicit feedback · layout stability (recompute ≤ hourly, persist only on top-3 change) · every module has a non-empty reason · increasing usage never decreases rank, all else equal · etc.

**Phase 2 done =** layouts recompute on triggers with p95 < 300ms; 100% of ranked modules carry explanations; override-precedence property tests green; UI matches design with FLIP transitions; browser-verified on staging.

---

## 5. Phase 3 — KNOW v2 (preference docs, user-model view, context pipeline)

**LLM-summarized preference documents** (the core bet): periodic summarization of chat history + nudge outcomes into a human-readable, **pilot-editable, pilot-deletable** profile doc injected into the context bundle (L1 layer). Token-efficient, interpretable, stays in-account. Raw inputs ≤90 days. Groundedness gate: ≥0.9 evidence-backed facts.

**"What does Crystal know about me?"** view: facts with provenance ("you told me" vs "I noticed") + plain-word confidence, per-item Keep/Forget, mirrored "rules you've set" section, connected integrations with kill switches, explicit-negatives ("I can't see your location"), danger-zone controls. Nothing described by table names.

**Context pipeline upgrade** (after C1 contract fix): 5-layer assembly — L0 static prompt → L1 user-model doc → L2 daily digest → L3 right-now → L4 conversation with rolling summary. Total budget ≤3,400 tokens with per-layer budgets. Real token counting (the "2000-token budget" is currently a comment, unenforced). Per-source timeouts with provenance flags (model must distinguish "no events" from "calendar broken"). Fix the 20-message unbounded history; bridge yesterday's thread via summary. Cache pilot profile (rarely changes); edge-cache fix for weather.

**Phase 3 done =** preference doc generated, visible, editable, deletable; context pipeline within token budget with enforced counting; degraded-mode chaos drills pass; privacy invariant tests green (per-account profile, nothing trains a model).

---

## 6. Phase 4 — ADAPT (learning from corrections)

**Correction affordances:** per-decision "This was wrong" → 3-choice sheet (not relevant / wrong timing / just wrong) → visible consequence ("Got it — I won't nudge you about water on weekdays anymore") + undo. Corrections feed ADAPT as labeled signals.

**Feedback update rules:** dismiss = demote-not-hide with diminishing returns (×0.5, ×0.25 on repeats), anti-runaway caps, learned-delta cap ±15 pts, fresh reset after explicit overrides. Dismiss twice → demote with floor; explicit feedback monotonic.

**Learning algorithms:**
- **Nudges:** Bayesian preference learning where the Beta prior *is* today's hardcoded scores — cold-start behavior bit-identical to now (regression-tested). Categories move at ~1 month of data.
- **Layout:** per-pilot, per-time-slot Beta-Bernoulli **Thompson sampling bandit** — ±25% modulation of v1 (never a replacement), editorial priors as pseudo-counts, weekly decay to prior, reward = opened within 30 min of surfacing. No deep learning, no cross-user state, per-account arithmetic only.
- **Exploration:** ≤1 honestly-framed probe/day from modules untouched ≥14d, doubling backoff on ignores, never displacing pins or urgent triggers.

**Embeddings: DEFERRED** — only ever as in-account semantic retrieval over long history, never as the model itself. Cross-user recommendation embeddings rejected outright.

**Cold-start honesty:** profile summary useful at 1–2 weeks (~20 messages) · nudge categories move at ~1 month · layout learning at 2–3 months (regenerate ≤ monthly, with undo).

**Phase 4 done =** correction affordances live with undo; Bayesian regression test proves zero-history scores identical to rules; dismiss-storm and exploration simulations pass; override rate <25% in dark launch for 7 days.

---

## 7. Phase 5 — Hardening, rollout, verification

- **Privacy gates (12 testable acceptance criteria AC-1…AC-12):** no personalization query without a `pilot_id` filter · SECURITY DEFINER functions return only the caller's data · two-user RLS suite with symmetric A/B checks + negative control · LLM context-bundle tests (explicit `pilot_id` argument, no cross-pilot fields) · no-cross-user-learning integration check.
- **Kill switch + dark launch:** `feature_flags` — `personalization.layout_engine` master switch, `dark_launch` shadow mode (shadow layouts written, deltas measured), per-subsystem flags; fail-closed to static on any error; kill drill in acceptance. Promotion gate: <25% shadow override for 7 days, ≥90% explanation coverage → 10→50→100% rollout.
- **Observability:** signal ingest rate/error, layout recompute latency p50/p95, **ranking override rate as the primary "AI is wrong" signal** (>40%/24h pages), explanation coverage %, nudge precision proxy, cron heartbeat lag, free-tier tripwires (DB size, egress). Structured JSON logs, salted-hashed pilot IDs, zero PII.
- **Cost:** ~$0–5/mo at 1k pilots · ~$36/mo at 10k (Workers Paid ~$11 + Supabase Pro $25). Binding constraint is Supabase DB size, not requests.
- **Browser verification:** every phase's UI claims verified in the agent's own browser on staging before "done" is claimed (staging 500s must be resolved first — separate team active).
- **Phase 5 done =** all privacy gates green · kill drill passes · rollout complete · `STATUS: COMPLETE`.

---

## 8. Open questions for the founder (Mehedi)

1. **Retention policy:** 7d vs 14d raw signals — cost vs debuggability. Likely decides free vs $25/mo Pro at scale.
2. **Cloudflare cron triggers:** usage vs the 5/account free cap — okay to consume one for `cockpit-scheduler`?
3. **Smoke-test URL:** `cockpit-10c.pages.dev` vs `cockpit.pages.dev` — which is canonical?
4. **CI with service_role:** confirm a CI runner may hold the service_role key for RLS tests.
5. **Crew/child signals:** recommended EXCLUDED from behavioral collection. Confirm.
6. **Crystal chat BASE 85:** nearly-always-surfaced by design — confirm or adjust.
7. **Aggregation cron runtime:** Cloudflare Worker (recommended) vs external — confirm.
8. **Fix order approval:** Phase 0 security fixes (A1–A5, W1, C1) — approve an immediate fix squad under standing MD authority?

---

## 9. Risks

- **A1 is live now:** children's grade data publicly readable until fixed. Highest priority in the entire plan.
- **Staging 500s** block all browser-verification gates (separate deep-dive team active).
- **Contract drift (C1):** the LLM currently sees almost none of the context bundle — any personalization work that assumes the model "knows" things is built on sand until fixed.
- **Free-tier DB size** is the binding cost constraint, not compute — retention policy is the lever.
- **Two broken test files** provide zero coverage today despite existing.
- **Scope discipline:** embeddings, cross-user learning, and crew/child signals are explicitly out. The plan degrades gracefully if any phase is cut — v1 rules-based ARRANGE works with zero learning.

---

*Eval reports: `personalization-eval/00-security-threat-model.md` through `11-devops-deploy-observability.md`.*
