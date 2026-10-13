# AI Scientist Evaluation 01 — User Modeling (KNOW Layer)

**Evaluator:** AI Scientist 1 (user-modeling domain)
**Date:** 2026-10-13
**Scope:** What feeds the user model today, which modeling approaches fit the single-user-per-account constraint, cold-start strategy, signal taxonomy, and per-phase acceptance criteria for the KNOW layer.
**Constraint (non-negotiable):** The behavioral profile NEVER leaves the pilot's account. No cross-user learning. No LLM training on user data (standing decision D2). This evaluation treats that as a hard architectural boundary, not a tunable parameter.

---

## 1. Audit findings — what feeds the user model today

The "user model" today is not a model at all. It is three loosely coupled piles of data, none of which is consumed as a model by any decision-making code. Everything cited below is from the actual codebase on `main`.

### 1a. Explicit profile columns on `pilots` (rules-friendly, human-readable)

Source: `supabase/migrations/001_pilot_foundation.sql`, `004_admin_suspend.sql`, `006_weather_pilot_prefs.sql`, `014_chat_threads.sql`, `017_shopping_shares.sql`.

Current columns: `id`, `display_name`, `timezone`, `created_at`, `home_location`, `home_lat`, `home_lon`, `weather_units` (F/C), `suspended`, `default_mode` (crystal/fireball), `email`.

Findings:

- **`display_name` is write-only-in-theory: nothing writes it.** `grep` across `src/` shows the only writers of the `pilots` row are the auth callback (upserts `id` + `email` only) and the weather-location route (writes `home_location/lat/lon/weather_units`). There is no onboarding UI anywhere in the app, despite the `001` comment claiming timezone is "Set during the 30-sec onboarding." In practice, `display_name` and `timezone` are NULL for essentially every pilot, and all consumers fall back to hardcoded defaults (`America/New_York`, `"UTC"` in the nudge engine, `"Cockpit"` in `whyLine`). **The explicit profile is a skeleton the product never fleshes out.**
- **`nudge_preferences` (009) is the only real learned-adjacent explicit surface:** per-category enable/disable (opt-out, never dark patterns), `min_score`, quiet hours (default 22:00–07:00), `breakthrough_allowed`. Defaults are sane and the `DEFAULT_PREFS` mirror in `src/lib/nudges/engine.ts` keeps the engine running even when the row is missing. This is the gold standard for how v1 preferences should look: explicit, editable, fallback-safe.
- **`cockpit_layouts` exists and is dead.** One writer exists in the entire tree — nobody. One reader — the admin API. The ARRANGE layer's storage contract is in place (`001`: one active layout per pilot, app-enforced), but nothing generates or consumes layouts. Any layout personalization starts from zero.

### 1b. The Crystal Chat context bundle (per-request, stateless)

Source: `src/lib/chat/context.ts`, consumed by `src/app/api/chat/route.ts` → the `crystal` Cloudflare Worker.

Per request, the bundle carries: pilot name + timezone, `now`, one-line weather (needs home lat/lon), today's agenda (≤12 events), open todos (≤12), live nudges (≤8, kind/priority/title/detail), and crew names. Budget: "well under a 2000-token budget." Thread history: last 20 messages of the day's thread (`HISTORY_LIMIT`), one active thread per day, full history persisted in `chat_threads`/`chat_messages` (`014`) with `persona` recorded per assistant message.

Findings:

- The bundle is **situational awareness, not a user model.** It tells the worker what's happening *today*, but nothing about the pilot as a *person*: no durable preferences, no history of what worked, no memory of corrections. A pilot who says "stop nagging me about bills before 9am" on Monday gets nagged again on Tuesday — the thread history scrolls away (20-message cap) and nothing durable is extracted.
- **Crew awareness is names-only — good.** `crewSection` deliberately fetches only `name, relationship`, never credentials. This is the right pattern for every future feed into the bundle: project only the fields the model needs.
- `weatherSection` and `agendaSection` degrade silently, which is correct, but it means the "user model" silently shrinks to `{pilot: {name: null, timezone: null}, now}` for a fresh pilot — the bundle carries almost zero personalization signal until integrations are connected. This is the cold-start gap made concrete.

### 1c. The nudge engine (ANTICIPATE — built, but Phase 1 has no learning)

Source: `src/lib/nudges/engine.ts`, `src/lib/nudges/PRODUCERS.md`, `src/app/api/nudges/*`.

- Scoring today is **pure rules**: `importance (category base score) × urgency (deadline multiplier)`, with hardcoded `CATEGORY_BASE_SCORES` (meeting 80 … health 30 … system 90). "Learning-to-rank" is explicitly marked Phase 2 in the engine header.
- The engine **already records the raw material for preference learning for free**: every nudge carries `status` through `pending → delivered → acknowledged | snoozed | expired | muted`, with `acknowledge`, `snooze` routes live, plus per-category mutes via `nudge_preferences.categories`. The outcomes exist; nobody reads them as signal. `expireOld` sweeps past-due nudges to `expired`, so "ignored" is observable too.
- `whyLine()` gives every nudge a plain-language "why am I seeing this" — the transparency primitive the KNOW layer's outputs will need as well.

### 1d. What is missing (the gap inventory)

| Capability | State |
|---|---|
| Behavioral event log (applet opens, dwell, impressions) | **None.** No tracking code exists anywhere in `src/`. |
| Correction capture ("Crystal, don't do X") | **None.** ADAPT is unbuilt by design. |
| Preference summarization from history | **None.** Thread history is write-only storage. |
| Layout generation/consumption (`cockpit_layouts`) | **Table exists, zero readers/writers in app code.** |
| Onboarding that populates `display_name`/`timezone` | **Does not exist** (comment in `001` is aspirational). |
| Cross-request pilot memory in the chat bundle | **None** beyond the 20-message window. |

**Net:** today the product personalizes via (a) five preference columns that are mostly NULL, (b) the nudge-preferences row, and (c) today's situational context. There is no learned component anywhere, and no durable memory of the pilot's behavior or corrections.

---

## 2. Approach evaluation (single-user-per-account constraint)

The constraint kills collaborative filtering outright — and that's liberating. There is no cold-start-via-neighbors, no matrix factorization, no federated averaging. Every candidate must learn from **one pilot's data, inside that pilot's account**. This rules out an entire class of complexity and makes the interpretable options strictly dominant.

### (a) Rule-based explicit profile — ✅ SHIP IN v1

**What:** `pilots` columns + `nudge_preferences` + per-module opt-in flags. Human-readable, human-editable, versioned in SQL.

**Fit:** Perfect. Single-user means no schema has to generalize across populations. Rules are transparent ("you see fewer bill nudges because you muted the category"), cheap, debuggable, and they work on day zero. The engine's `DEFAULT_PREFS` fallback pattern proves the failure mode is graceful.

**Limits:** Coarse — can't capture "I like morning briefings but only on weekdays" without column sprawl. Captures stated preference, not revealed preference. But for v1, stated > revealed: the pilot should be able to *see and edit* everything the system believes about them, and nothing builds trust like a settings page that actually works.

### (b) Learned embeddings (per-account) — ⏸ DEFER, and scope narrowly when adopted

**What:** A dense vector per pilot (or per preference facet), updated from behavior, used for ranking/retrieval.

**Fit:** Poor for the *user model itself*, good for *memory retrieval*. With one user and sparse early data, an embedding is an uninterpretable black box that needs hundreds of interactions before it beats rules — and when it's wrong, neither the pilot nor the engineer can inspect why. It also invites the exact failure the constraint exists to prevent: embeddings are portable, copyable artifacts that *look* like anonymized data but aren't.

**Verdict:** Do not build a "user embedding" for personalization. The one legitimate future use is **semantic retrieval over the pilot's own long history** (finding the relevant old thread when the 20-message window is exhausted). Even there: embeddings computed in-account, stored in the pilot's rows, never exported, and used only as a recall mechanism — the *model of the pilot* remains the readable document in (c).

### (c) LLM-summarized preference documents — ✅ THE CORE BET (v2)

**What:** A periodic job (cron or on-demand) reads the pilot's recent chat history, nudge outcomes, and corrections, and writes/updates a compact, human-readable "pilot profile" document — e.g. `pilot_profile` (one row per pilot, versioned): stable facts ("prefers metric", "works late, quiet hours should start at 23:30"), communication style ("wants numbers first, no softening" — cf. Fireball flips), domain interests (connected integrations + which applets get opened), and correction-derived rules ("never nudge about groceries on weekends").

**Fit:** Excellent — arguably the *only* approach that fits all constraints simultaneously:
- **Single-user native.** Summarization needs no population data; an LLM summarizing one pilot's history is exactly what LLMs are good at.
- **Interpretable and editable.** The profile is prose the pilot can read, correct, and delete. This is the trust story: "here's what I remember about you" as a first-class screen.
- **Token-efficient.** The summary replaces unbounded history in the context bundle: instead of 20 raw messages, the worker gets ~200 tokens of durable preference facts plus today's situational bundle. This directly extends the <2000-token budget as history grows.
- **Stays in-account.** The summary is generated by the first-party worker (or the app's own cron) and stored in the pilot's Supabase rows under existing RLS. No training, no export — consistent with D2.

**Risks and mitigations:**
- *Hallucinated preferences.* Require every extracted fact to cite evidence (message IDs / nudge IDs); facts without evidence are dropped. Keep a confidence field; low-confidence facts are shown as "tentative" in the profile UI.
- *Stale preferences.* Version the document; the summarizer runs as a diff ("here is the current profile; update only what the new evidence contradicts"), not a rewrite. Corrections always win over history.
- *Prompt injection from third-party content.* The summarizer's input includes mail/calendar/school content the pilot didn't write. The summarization prompt must treat non-pilot-authored content as *data about the world*, never as instructions about the pilot — same injection discipline as the rest of the system.
- *Runaway growth.* Cap the document (e.g. 40 facts, ~800 tokens); the summarizer must also *prune* (merge duplicates, drop contradicted or ancient low-confidence facts).

### (d) Bayesian preference learning from corrections — ✅ v2, scoped to nudge ranking

**What:** Per-category, per-pilot Beta-Binomial propensities updated from nudge outcomes: acknowledge/snooze/mute/expire/dismiss map to positive/negative observations; the posterior adjusts the category's effective base score (or `min_score`) for that pilot. Quiet-hour timing can be learned similarly (snooze-to-morning patterns shift `quiet_hours_end`).

**Fit:** Strong, because the outcome stream already exists and the math is honest about uncertainty. A Beta prior *is* the cold-start strategy: start every pilot at the population-default prior (the current hardcoded `CATEGORY_BASE_SCORES`), and let the pilot's own outcomes pull the posterior. With 0 outcomes you get exactly today's behavior — no regression, no cold-start cliff. The update is a one-line SQL/pure-function change in `scoreCandidate`, fully explainable ("bill nudges: you've muted 6 of 8, so I score them lower now").

**Limits:** Thin data per category for months (a pilot may get 2 bill nudges a month). So Bayesian updates must be *bounded and slow*: cap the per-category adjustment (e.g. ±15 points on the base score), require minimum evidence (e.g. ≥5 outcomes) before moving, and let explicit mutes (hard signal) dominate implicit ones (expire = weak). Do not learn across pilots — the prior is a constant, not a population estimate.

### Recommendation: phased

- **v1 (now): rules + explicit.** Fill the skeleton: a real onboarding/profile surface that populates `display_name`/`timezone` (the columns exist; the UI doesn't), keep `nudge_preferences` as the pattern, and add the profile-doc *schema* (empty) so v2 has somewhere to write. No learned anything. Acceptance: every personalization decision the app makes is traceable to a row the pilot can see and edit.
- **v2: (c) + (d).** Ship the `pilot_events` log (see §4), the weekly profile-summarization cron writing a versioned, pilot-visible `pilot_profile` document injected into the chat bundle, and Bayesian per-category score adjustments in the nudge engine fed by outcome history. This is the KNOW layer becoming real.
- **v3 (later):** Correction extraction in chat ("stop doing X" → structured preference update, the ADAPT layer), semantic recall over long history via in-account embeddings (retrieval only, never the model), and ARRANGE consuming the profile + usage aggregates to generate `cockpit_layouts`.

What **not** to build: cross-pilot learning of any kind, a monolithic "user embedding" as the model, or any training/fine-tuning on pilot data (D2).

---

## 3. Cold-start strategy

### Sensible defaults (before any data exists)

Most of these already exist and are good — the gap is that several have no UI to ever change them:

| Default | Current state | Recommendation |
|---|---|---|
| Quiet hours 22:00–07:00, no breakthrough | ✅ in `DEFAULT_PREFS` | Keep. Safest possible default. |
| Mode: Crystal (warm) | ✅ `default_mode` default | Keep; the mode pill + `/api/chat/mode` already lets the pilot flip it. |
| All nudge categories enabled, `min_score` 0 | ✅ opt-out pattern | Keep — "never dark patterns" is the right call. |
| Weather units F | ✅ default | Infer from timezone at onboarding when it exists (US → F); keep F fallback. |
| Timezone | ❌ NULL, no onboarding | **Fix in v1:** detect from browser (`Intl.DateTimeFormat().resolvedOptions().timeZone`) at first login and offer confirm-or-change. One line of client code, huge personalization win (quiet hours, agenda bounds, `applyQuietHours` all depend on it). |
| Display name | ❌ NULL, no onboarding | **Fix in v1:** prefill from OAuth profile (`user_metadata.full_name`), editable. |
| Layout | Dead table | Ship the default 31-module shell with seedlings per the launch plan; ARRANGE learns later. |
| Chat context | Situational only | Acceptable for v1 — but see "warmed" below. |

### How long until the model is "warmed"?

Define "warmed" as: the profile document contains ≥10 evidence-backed facts and the nudge engine has ≥1 category with enough outcomes to move its Bayesian adjustment. Honest estimates for a normally-active pilot:

- **Day 0–2:** Explicit only. Timezone/name captured at first login; integrations connected or not. The bundle is situational. Nudge scoring = today's rules.
- **Week 1–2:** First profile summary becomes useful. ~20+ chat messages and a handful of nudge outcomes give the summarizer real material (communication style, active life domains, first corrections). Run the summarizer weekly *or* when ≥15 new messages accumulate — whichever comes first — so an active pilot warms in days, not weeks.
- **Month 1:** Bayesian category adjustments start moving (≥5 outcomes in the noisiest categories: meeting/todo/weather). High-frequency categories warm first; bill/school/health may take 2–3 months. This is fine — the prior *is* today's behavior, so "not yet warmed" is indistinguishable from "working as today."
- **Month 2–3:** Layout learning (ARRANGE) has enough applet-usage aggregates to generate a first real `cockpit_layouts` row. Don't rush this — a layout that reshuffles weekly destroys trust; regenerate at most monthly, and always with a visible "your cockpit rearranged — undo" affordance.

The single most impactful cold-start investment is not ML at all: **it's the 60-second first-run capture** (name, timezone confirm, units, quiet hours confirm, which life domains to connect). Everything downstream — bundle quality, quiet hours, scoring — compounds from those five fields.

---

## 4. Signal taxonomy

### Collect — predictive, worth the storage

| Signal | Why it's predictive | Notes |
|---|---|---|
| Nudge outcomes: mute / category disable | **Strongest explicit signal.** A mute is the pilot saying "never again" in the clearest possible terms. | Already recorded (`status=muted`, `nudge_preferences.categories`). Feed to Bayesian updates + profile doc. |
| Nudge outcomes: acknowledge vs expire | Ack = weak positive ("useful enough to clear"); expire = weak negative ("not worth opening"). Noisy individually, meaningful in aggregate. | Already recorded. Weight: mute ≫ snooze-pattern > ack > expire. |
| Snooze time-of-day patterns | Reveals *timing* preference, distinct from *content* preference. Repeated snooze-to-9am → quiet-hours suggestion. | Record `snoozed_until` deltas; suggest, don't auto-change, quiet hours. |
| Explicit preference edits | Ground truth. Always wins over inferred signals. | `nudge_preferences`, `pilots` columns, future profile-doc edits. |
| Chat corrections ("don't remind me…", "I prefer…") | High-precision preference statements in the pilot's own words. The ADAPT layer's primary fuel. | v3: extract to structured facts with message-ID evidence. |
| Persona mode choice + flips | Reveals communication-style preference (warm vs direct). Persistent `default_mode` flips are strong. | Already stored per message (`persona`) and as `default_mode`. |
| Integration connect/disconnect | Which life domains the pilot cares about. Disconnect = "this domain is noise to me." | `pilot_integrations.status` transitions are signal. |
| Applet open frequency/recency (daily aggregates) | Moderately predictive for ARRANGE: modules opened daily belong up front; untouched-for-30-days modules are seedlings. | **Aggregate only** (see privacy). |
| Crew presence (opt-in children) | Structural fact that reframes everything (school nudges exist or don't). | Already in bundle as names-only. |

### Collect with caution — weak or noisy

| Signal | Caveat |
|---|---|
| Dwell time / scroll depth | Extremely noisy (tab left open, kid grabbed the phone). Never use alone; only as a tiebreaker for ARRANGE, heavily smoothed. |
| Dismissal latency (how fast a nudge was cleared) | Confounded by notification UX more than preference. Skip unless nothing better exists. |
| Applet open *sequences* | Tempting for "next best module" but sparse; v3 research, not v2. |
| Time-of-day usage patterns | Useful for quiet hours; weak for content ranking. Keep to the timing lane. |

### Do NOT collect

- **Keystroke-level or per-second telemetry.** Nothing in the product needs it; it poisons trust on discovery.
- **Precise location.** D7 (coarse city/ZIP only) is already the rule — the 0.1° rounding in `006` is the ceiling, not the floor.
- **Raw content of mail/bank/health beyond the feature's need.** The nudge producers already project to titles/bodies; the profile summarizer must never persist account numbers, diagnoses, or message bodies into the profile doc — facts only ("has a dentist appointment Tuesday" is fine; the confirmation email's contents are not).
- **Cross-pilot aggregates of behavior.** The Bayesian *prior* is a hardcoded constant, not a population statistic. No "pilots like you" — ever.
- **Anything for model training.** D2: the summarized profile and event log are *operational data for serving this pilot*, never training data.

### Privacy architecture: what "never leaves the account" means in practice

1. **Storage:** profile doc, event log, and (future) embeddings live in pilot-scoped rows (`pilot_id` FK, `force row level security`, same policy shape as `001`). Service-role crons operate strictly within one `pilot_id` per run — no cross-pilot queries, ever.
2. **Compute:** summarization runs in the first-party worker or app cron with the pilot's data; the raw chat history already flows to the Crystal worker today, so the profile doc *reduces* exposure (facts instead of transcripts).
3. **No export surface:** no admin bulk-export of profiles/events (the admin `view-as` path is the documented exception and is audit-logged via `003_admin_audit`); no analytics pipeline; no third-party SDKs in the client that could observe behavior.
4. **Pilot control:** the profile doc is viewable, editable, and deletable by the pilot; deleting it resets personalization to explicit-rules defaults (v1 behavior) — the "forget me" path is a feature, not a support ticket.
5. **Aggregates, not traces:** applet usage is stored as per-day counts (`pilot_id, module, date, opens`), never timestamped event streams. Enough for ARRANGE, useless for surveillance.

---

## 5. Per-phase acceptance criteria for the KNOW layer

### Phase v1 — Explicit profile (ship criteria)

- [ ] First-run capture writes `display_name` (prefilled from OAuth, editable) and `timezone` (browser-detected, confirm-or-change) — the two columns the bundle already reads but nothing writes.
- [ ] Every personalization decision traceable: any nudge shows `whyLine`; any bundle field maps to a visible row the pilot can edit.
- [ ] `pilot_profile` table (or `profile_doc` jsonb on `pilots`) exists with RLS mirroring `pilots_select_own`, versioned (`version`, `updated_at`, `generated_by`), empty for now — v2's write target.
- [ ] `pilot_events` append-only log exists: `(pilot_id, occurred_at, event_type, ref_table, ref_id, meta jsonb)` with pilot-scoped RLS. Writers: nudge outcome transitions, preference edits, mode flips, integration connect/disconnect. No per-second telemetry, no raw content in `meta`.
- [ ] No learned component anywhere; document the defaults table (§3) in the repo.

### Phase v2 — Summarized profile + Bayesian nudges (ship criteria)

- [ ] Weekly (or ≥15-new-messages) summarizer cron: reads the pilot's recent threads + `pilot_events`, diffs against the current profile doc, writes a new version with per-fact `{fact, confidence, evidence_ids[]}`. Facts capped (~40 / ~800 tokens).
- [ ] Groundedness gate: any fact without evidence IDs is dropped; the cron logs precision (facts with evidence / total proposed) — target ≥0.9 before the doc feeds the bundle.
- [ ] The chat context bundle includes the top profile facts (budgeted inside the existing 2000-token cap); A/B-observable via a `profile_version` field in the bundle for debugging.
- [ ] Pilot-facing "What Crystal remembers" screen: view / edit / delete the doc; delete → personalization falls back to v1 rules (verified by test).
- [ ] Bayesian per-category adjustment in `scoreCandidate`: Beta posterior from outcome history, bounded (±15 pts), minimum-evidence gate (≥5 outcomes), explicit mutes dominate; with zero history the score is bit-identical to today's rules (regression test against current `CATEGORY_BASE_SCORES`).
- [ ] Quiet-hour *suggestion* (not auto-change) when snooze patterns show a consistent shift — pilot taps to accept.

### Phase v3 — Corrections + recall + ARRANGE input (ship criteria)

- [ ] Correction extraction: "don't X" / "I prefer Y" in chat produces structured preference updates with message evidence; measured extraction precision ≥0.85 on a labeled eval set before it writes without review.
- [ ] Semantic recall over the pilot's own history via in-account embeddings (retrieval only); embeddings stored pilot-scoped, never exported, and the *model* remains the readable doc.
- [ ] First generated `cockpit_layouts` row from usage aggregates + profile: regenerate ≤ monthly, with visible undo; pilot override persists (explicit beats inferred — always).
- [ ] Drift/staleness review: facts older than 90 days without re-evidence are flagged for re-confirmation or pruned by the summarizer.

---

## 6. Bottom line

The KNOW layer today is an explicit-preference skeleton (half of it unwritten) plus a situational context bundle with no memory. The single-user constraint makes the choice clean: **rules + explicit now, LLM-summarized preference documents as the core learned representation next, Bayesian outcome-learning scoped to nudge ranking alongside it, and embeddings only ever as in-account retrieval — never as the model.** The highest-ROI near-term work isn't algorithmic at all: capture name/timezone at first login, stand up the `pilot_events` log and the empty versioned profile schema, and let the outcome stream the nudge engine already records start compounding. Everything the system "learns" must be something the pilot can read, edit, and delete — that inspectability *is* the personalization strategy, and it's the only one compatible with a profile that never leaves the account.
