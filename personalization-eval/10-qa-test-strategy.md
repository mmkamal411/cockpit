# QA Test Strategy — Cockpit Personalization Stack (KNOW / ARRANGE / ANTICIPATE / ADAPT)

**Author:** QA Engineer (subagent evaluation)
**Date:** 2026-10-13
**Scope:** Test strategy only — no test code in this document. Evaluation, not implementation.
**Bloker note:** Staging (`cockpit-10c.pages.dev`) is 500ing as of this writing; browser-level verification gates in this plan wait for recovery. Mehedi's standing rule applies: **TEST BEFORE YOU CLAIM** — no layer is "done" until its checks are executed against a live build, not reasoned about.

---

## 1. Test-infrastructure audit (grounded in the real repo)

### 1.1 What exists today

| Fact | Evidence |
|---|---|
| No test framework (no vitest/jest/mocha), no `test` script in `package.json` | `package.json` scripts: `dev`, `build`, `start`, `lint`, `postinstall` only; zero test-related devDependencies |
| Test convention: hand-rolled runner, each `*.test.ts` is self-executing with `node <file>.test.ts` and exits non-zero on failure | Header comment in `src/lib/nudges/engine.test.ts`: "No test runner in this repo — run directly with Node's type stripping" |
| 5 test files, 733 lines total | `src/lib/nudges/engine.test.ts` (397), `src/lib/bills/logic.test.ts` (111), `src/lib/health/glucose.test.ts` (104), `src/lib/chat/sse.test.ts` (68), `src/lib/chat/mode.test.ts` (53) |
| Nudge engine: 28 named tests, all passing | Verified by running `node src/lib/nudges/engine.test.ts` → "28 passed, 0 failed" |
| Bills + glucose test files are **currently broken under plain `node`** | They `import ... from "./logic"` (extensionless), which Node type-stripping rejects (`ERR_MODULE_NOT_FOUND`). The nudge test file works only because it imports `"./engine.ts"` with the explicit `.ts` extension. Bills' header says `npx tsx`, but `tsx` is not in devDependencies, so that path is fragile too. |
| Nudge tests mock Supabase at the client-injection boundary (`dedupeCheck`, `submitCandidate`, `getPreferences` take a client) | `src/lib/nudges/engine.ts:247, 288, 406` — DB-touching functions are async and injectable, so pure-logic tests never hit the network |
| RLS is enforced explicitly per table with `auth.uid() = pilot_id` policies | `supabase/migrations/001_pilot_foundation.sql:238–265`, `009_nudges.sql` |

### 1.2 Coverage culture

The repo's culture is "module ships with a hand-rolled test file." Verified examples: bills logic, glucose logic, chat SSE/mode, nudge engine. The nudge engine (ANTICIPATE layer) is the best-covered personalization surface today. **No test code exists for the other three layers** — KNOW (no user-model module found in `src/lib`), ARRANGE (no layout/ranking module found in `src/lib` — confirmed the biggest gap), ADAPT (not built).

### 1.3 Infrastructure verdict and recommendations

1. **Standardize the runner contract.** The `.ts`-extension import requirement (needed by Node type-stripping) is a foot-gun; two of five files already violate it. Recommendation: add an npm `test` script that discovers `src/**/*.test.ts` and runs them all, e.g. `node --test` on a glob or a tiny `scripts/run-tests.mjs`, and document the `.ts`-extension rule in a `TESTING.md`. (This is infra, not test code — a build-squad change.)
2. **Fix the two broken test files now** (`bills/logic.test.ts`, `health/glucose.test.ts`) by adding `.ts` extensions to their imports — currently they cannot run at all. This is a red flag for the coverage culture: tests that can't run are worse than no tests because they imply coverage that doesn't exist.
3. **Keep the hand-rolled style** — it matches the team's velocity and has zero dependency risk — but add a tiny shared assertion helper (`src/lib/test-helpers.ts`) so new layer tests don't re-invent `eq`/`check` per file.
4. **CI gate (when ready):** `npm test` must run on every PR to `main` before staging deploy. Personalization layers without passing tests do not merge.

---

## 2. Per-layer test plans

### 2.1 KNOW — user-model correctness (not built yet)

Target module shape (for test planning): a pure `buildUserModel(rawSignals): UserModel` function plus a `mergePreferences(stored, incoming): Preferences` function, with a Supabase read/write boundary like the nudge engine's `getPreferences`.

| # | Test | Why it matters |
|---|---|---|
| K1 | Cold start: empty/null signals → valid model with safe defaults (all modules unpinned, default sensitivity, default quiet hours 22:00–07:00) | No blank pages — a brand-new pilot must get a complete, sane model, never `null` |
| K2 | Profile assembly: signals from N sources (prefs row, usage counters, integrations) merge into one model with no field dropped | Regression guard against the "cruft dropped" class of error (cf. the parent_sync/student_sync split lesson) |
| K3 | Preference merge precedence: explicit user override > inferred > default, field-by-field | Direct implementation of "AI proposes/user disposes" at the data layer |
| K4 | Malformed stored prefs (bad `quiet_hours_start`, unknown category keys) → fall back to `DEFAULT_PREFS` for that field, never throw | Mirrors the existing nudge test "malformed deadline does not throw" — the bar is set |
| K5 | Idempotent assembly: `buildUserModel` on the same input twice → deep-equal models (no timestamp leakage into the model) | Required for ARRANGE determinism downstream |
| K6 | Preference write round-trip: set → save → read back → identical | Guards against the quiet-hours string truncation bug class (`slice(0,5)` in `engine.ts:421` shows the team already hit format drift) |

### 2.2 ARRANGE — AI layout engine (not built; the biggest gap)

This layer needs the most testing investment because it is the least specified and most user-visible. Assume a pure `rankModules(userModel, modules, ctx): RankedModule[]` where each `RankedModule = { id, rank, reason: string, pinned, score }`.

| # | Test | Why it matters |
|---|---|---|
| A1 | **Determinism:** same `(userModel, modules, ctx)` → byte-identical ordering and reasons | Layout must not shuffle between renders; nondeterminism reads as the AI "changing its mind" |
| A2 | **Pin precedence:** any pinned module sorts before every unpinned module, regardless of scores | Hard rule; also a property (see §3) |
| A3 | **Override precedence:** explicit user hide/demote always beats AI ranking, even if the AI score is maximal | "AI proposes/user disposes" in its purest form |
| A4 | **Explanation invariant:** every ranked module carries a non-empty, plain-language `reason` string (≤ 8th-grade reading level per the FAQ standard) | Principle: "every automated decision explainable in plain English" |
| A5 | **Cold-start layout:** empty user model → fixed sensible default order (Home/Today/Pookie/Progress/More rhythm), all reasons present | No blank pages; a new pilot sees a complete cockpit |
| A6 | **Graceful degradation:** missing signal for a module → module falls back to default rank with a "we don't know enough yet" reason, never dropped | Modules never silently vanish |
| A7 | **Recompute performance:** layout recompute p95 < 300 ms on a mid-range device with 31 modules (see acceptance criteria §5) | Layout recompute happens on navigation; jank kills the ritual |
| A8 | **Tie-breaking:** equal scores → stable, documented tie-break (e.g., alphabetical by module id) so A1 holds | Unspecified tie-breaks are the #1 source of flaky determinism tests |

### 2.3 ANTICIPATE — nudge engine (built; 28 tests passing)

Existing coverage in `src/lib/nudges/engine.test.ts` (verified passing): scoring base + urgency multipliers, malformed deadlines, category enable flags, HHMM parsing, 8 quiet-hours cases (wrap/non-wrap windows, boundaries, urgent breakthrough opt-in, stale desired roll-forward), dedup live-row check + DB-error propagation, `submitCandidate` (insert, dedup, 23505 race safety, min-score swallow, disabled-category skip, error propagation), `expireOld`, `whyLine` plain-language, `getPreferences` fallback + row mapping, base-score coverage of all categories.

**Gaps to close:**

| # | Test | Gap |
|---|---|---|
| N1 | **Sensitivity slider → `min_score` mapping:** define the slider positions (e.g., Low/Med/High → min_score 80/50/20) and test that a candidate at score 60 is delivered at Med but swallowed at Low, with the reason naming the sensitivity setting | `min_score` exists in prefs and "below min_score is swallowed" is tested, but the user-facing slider mapping is untested |
| N2 | **Snooze lifecycle:** snoozed nudge is not redelivered until `snoozed_until`; after expiry it re-enters scoring (not auto-dismissed) | `expireOld` covers unsnooze-on-elapsed, but the full snooze→resurface loop isn't |
| N3 | **Dedup key collision across categories:** two candidates with the same `dedup_key` but different categories → dedup wins (one nudge) | Dedup semantics under adversarial input |
| N4 | **Quiet-hours + breakthrough audit:** urgent-tier breakthrough writes an audit/log entry (per the standing admin-audit culture, `003_admin_audit.sql`) | Breakthrough is the one quiet-hours violation path; it must be observable |
| N5 | **Score monotonicity in urgency:** for fixed importance, nearer deadline ⇒ score never decreases (property, see §3) | The ranking half of scoring is only spot-checked today |
| N6 | **`whyLine` coverage for every status:** pending/delivered/acknowledged/snoozed/expired/muted each produce a distinct plain-language line | "100% of automated decisions carry explanations" — `whyLine` is that guarantee for nudges |

### 2.4 ADAPT — learning from corrections (not built)

Target: a pure `applyFeedback(model, event): ModelUpdate` where events are `{ type: 'dismiss' | 'snooze' | 'act' | 'explicit_pin' | 'explicit_hide' | 'sensitivity_change', moduleId, ... }`, plus guardrail rules.

| # | Test | Rule under test |
|---|---|---|
| D1 | Dismiss the same nudge category twice → that category's base weight is demoted (score multiplier < 1) | "Dismiss twice → demote" |
| D2 | Demote has a floor: no amount of dismissals hides the category entirely; `isCategoryEnabled` stays true and the module still appears | "demote but never hide" — explicit disable is the only hide path |
| D3 | Explicit disable (`isCategoryEnabled → false`) immediately beats any learned weight | Explicit overrides always win — same principle as A3, at the ADAPT layer |
| D4 | **Monotonic explicit feedback:** raising sensitivity (lowering `min_score`) never *reduces* the set of delivered nudges for a fixed candidate set; lowering it never *increases* the set | Monotonic response to explicit feedback |
| D5 | Acting on a nudge (tap-through) reinforces: same-category future scores increase, bounded above (cap the multiplier, e.g., ≤ 1.5×) | Prevents runaway positive feedback loops |
| D6 | Feedback is per-pilot: applying pilot A's dismissals never changes pilot B's model | Privacy invariant at the learning layer (see §4) |
| D7 | Feedback events are explainable: `applyFeedback` returns a human-readable `whatChanged` string ("You'll see fewer weather nudges because you dismissed 2") | "Every automated decision explainable" applies to learning too |

---

## 3. Property-based tests — ranking invariants

The hand-rolled runner can host a minimal property harness (~40 lines): a seeded PRNG (mulberry32), a `forAll(generator, property, iterations)` helper, and shrinking on failure (optional; at minimum print the failing seed). Until ARRANGE ships, these are specified against the planned `rankModules` signature in §2.2. The same harness should cover nudge scoring monotonicity (N5).

### Generators

- **`genUserModel()`**: random subset of 31 module ids pinned (0–5 pins), random usage counts (0–500), random explicit hides (0–3), random sensitivity tier, random quiet-hours window. Must include edge cases: empty model, all-pinned, all-hidden.
- **`genModules()`**: 5–31 modules with random base scores (0–100), random categories, random `lastUsed` timestamps.
- **`genNudgeCandidate()`**: random category, deadline offsets (−2d … +14d), importance 0–100, random prefs (min_score 0–100, quiet-hours windows incl. wrap/non-wrap, disabled categories).
- **Seed strategy:** fixed seed list in CI (deterministic) + one random seed per local run, printed on failure for reproduction.

### Invariants (each is a property: "for all generated inputs, …")

| # | Property | Layer |
|---|---|---|
| P1 | **Pin precedence:** every pinned module appears before every unpinned module in the output order | ARRANGE |
| P2 | **Explanation presence:** every ranked module has a non-empty `reason` string (length ≥ 10 chars, no template placeholders like `{x}` left unfilled) | ARRANGE |
| P3 | **Usage monotonicity:** increasing one module's usage count, all else equal, never decreases its rank position | ARRANGE |
| P4 | **Override dominance:** adding an explicit hide for module M, all else equal, removes M from the ranked list regardless of its score | ARRANGE |
| P5 | **Determinism:** `rankModules` called twice on deep-equal inputs returns deep-equal outputs (run each property's input twice) | ARRANGE |
| P6 | **Permutation stability:** shuffling the *input* module array order does not change the *output* ranking (ranking must not depend on input order) | ARRANGE |
| P7 | **Score monotonicity (nudges):** for fixed category/importance/prefs, moving the deadline earlier never decreases `scoreCandidate` | ANTICIPATE |
| P8 | **Sensitivity monotonicity:** lowering `min_score`, all else equal, never decreases the count of delivered candidates from `submitCandidate` over a generated batch | ANTICIPATE |
| P9 | **Quiet-hours containment:** no generated candidate is ever scheduled for delivery inside the generated quiet-hours window unless tier=urgent AND `breakthrough_allowed=true` | ANTICIPATE |
| P10 | **Demote floor:** after N generated dismissals of a category (N up to 100), the category is still enabled and still rankable (weight > 0) | ADAPT |
| P11 | **No cross-pilot leakage in learning:** `applyFeedback(modelA, eventsA)` deep-equals `modelA`'s projection when `eventsB` (another pilot) are applied to a separate instance — i.e., feedback application is a pure function of (own model, own events) | ADAPT + privacy |

---

## 4. Privacy / RLS test plan

Principle under test: **pilot-isolated, no cross-user learning.** Every personalization table keys off `pilot_id` with `auth.uid() = pilot_id` RLS (established pattern in `001_pilot_foundation.sql:238–265`).

### 4.1 RLS isolation tests (two-user proof)

Tables in scope: `pilots`, `nudge_preferences`, `nudges`, `todos`, `cockpit_layouts`, plus every KNOW/ADAPT table added later (user models, feedback events, layout overrides).

**Method** (no browser needed; runs against a staging/preview Supabase project, never production):
1. With the **service_role** key (server-side only, in CI secrets), create two auth users: Pilot A and Pilot B. Mint a JWT / session for each.
2. As Pilot A (anon key + A's JWT): insert a `nudge_preferences` row, a `nudges` row, a `cockpit_layouts` row. Assert writes succeed.
3. As Pilot B: `select *` from each table → assert **zero rows** returned (not an error — RLS silently filters; asserting empty is the correct check).
4. As Pilot B: attempt `update`/`delete` on A's row ids (ids learned via service_role) → assert **0 rows affected**.
5. As Pilot B: attempt `insert` with `pilot_id = <A's id>` → assert **rejected** (RLS `with check` violation).
6. Repeat 3–5 with the roles swapped (symmetric — catches policies accidentally scoped to one direction).
7. **Negative control:** run the same suite with RLS temporarily *disabled* on a scratch schema to prove the tests actually detect leakage (a test that can't fail is not a test).

New personalization tables must add their RLS test to this suite in the same migration PR — "no RLS test, no merge."

### 4.2 LLM context-bundle test (Crystal/Fireball prompt assembly)

The personalization stack feeds an LLM (llama-3.3-70b via the `crystal` worker). The context bundle assembler must be unit-tested as a pure function:

- **T1:** bundle for Pilot A contains only rows where `pilot_id = A` — generate fixtures with interleaved A/B rows, assert no B field (name, email, nudge text, layout) appears in the serialized bundle (string search on B's unique fixture markers).
- **T2:** bundle size cap — assert the assembler truncates at a documented token/byte budget rather than growing unboundedly (cost + leakage surface).
- **T3:** no raw credentials or tokens in the bundle — scan the bundle for key-like patterns (`sk-`, `eyJ`, `password`) against fixtures that contain them in adjacent columns.
- **T4:** the assembler takes `pilot_id` as an explicit argument (never ambient/global), so a caller can't "forget" whose data it's bundling — enforce by type signature review + a test that omits the argument fails to compile/run.

### 4.3 No cross-user learning (ADAPT-specific)

Covered by property P11 plus an integration check: train ADAPT updates on Pilot A's dismissal fixtures, then assert Pilot B's `rankModules`/`scoreCandidate` outputs are byte-identical before and after A's training. Any shared weight table (if one is ever introduced) must be per-pilot keyed; a global weight table is a design violation to be caught in review, not just in tests.

---

## 5. Phased acceptance criteria (concrete gates)

Each phase is **done** only when its gates are green on staging *and* verified in a real browser session per TEST BEFORE YOU CLAIM (staging is 500ing at the time of writing — these gates wait for recovery).

### Phase 0 — Test infrastructure (unblocks everything)
- [ ] `npm test` runs **all** `src/**/*.test.ts` files in one command and exits non-zero on any failure
- [ ] `src/lib/bills/logic.test.ts` and `src/lib/health/glucose.test.ts` import with explicit `.ts` extensions and pass (currently broken — see §1.1)
- [ ] CI runs `npm test` on every PR to `main`; a red suite blocks merge
- [ ] Minimal property harness (`forAll` + seeded PRNG + seed printed on failure) available to all layer tests

### Phase 1 — KNOW (user model)
- [ ] K1–K6 passing; cold start renders a complete Home with zero `null` crashes (browser-verified)
- [ ] 100% of model fields have documented defaults; malformed stored data never throws (falls back per-field)
- [ ] Profile assembly is idempotent (K5) — verified over 1,000 randomized inputs via the property harness

### Phase 2 — ARRANGE (layout engine — biggest gap)
- [ ] A1–A8 passing, including browser-verified cold-start layout
- [ ] Properties P1–P6 hold over ≥ 1,000 generated inputs each, on the fixed CI seed list
- [ ] **100% of ranked modules carry a non-empty plain-language reason** (P2 — this is the measurable form of "every automated decision explainable")
- [ ] Layout recompute **p95 < 300 ms** with 31 modules on a mid-range Android device (measured in-browser, not in Node)
- [ ] Pin/hide overrides verified end-to-end in the browser: pin → reload → still first; hide → reload → still gone

### Phase 3 — ANTICIPATE (nudge engine — harden what exists)
- [ ] Existing 28 tests still green; N1–N6 added and green
- [ ] Properties P7–P9 hold over ≥ 1,000 generated inputs each
- [ ] Sensitivity slider mapping documented and tested end-to-end: Low/Med/High positions produce strictly nested delivery sets on a fixed candidate fixture
- [ ] Quiet-hours violation audit: every urgent breakthrough produces a queryable audit row
- [ ] `whyLine` distinct and plain-language for all 6 nudge statuses

### Phase 4 — ADAPT (feedback learning)
- [ ] D1–D7 passing; properties P10–P11 hold over ≥ 1,000 generated inputs
- [ ] Demote-floor proven: 100 consecutive dismissals of a category still leave it enabled and rankable
- [ ] Explicit-feedback monotonicity (D4) verified on generated candidate batches
- [ ] Every `applyFeedback` returns a user-facing `whatChanged` string; shown in the UI where the change is visible (browser-verified)
- [ ] Cross-pilot learning isolation proven: A's 100 dismissals produce zero change in B's rankings/scores

### Phase 5 — Privacy (runs across all phases, gates launch)
- [ ] Two-user RLS suite (§4.1) green for **every** personalization table; new tables cannot merge without their RLS test
- [ ] Negative control (RLS-off scratch schema) proves the suite detects leakage
- [ ] LLM context-bundle tests T1–T4 green; bundle assembler takes explicit `pilot_id`
- [ ] No cross-user learning (P11 + integration check) green

### Standing gates (every phase, every deploy)
- [ ] `npm test` green on the PR before staging deploy
- [ ] No blank pages: every new surface has an error/empty state with a recovery path (per Mehedi's NO BLANK PAGES rule)
- [ ] Plain-English errors: every new user-facing string passes the grandmother test
- [ ] Browser verification by the agent (sign in, click through) before Mehedi is told anything works

---

## 6. Risks and open questions for the parent orchestrator

1. **Two broken test files** (`bills/logic.test.ts`, `health/glucose.test.ts`) — recommend a build-squad fix in the next deploy train; they currently provide zero coverage despite existing.
2. **Staging 500s** block all browser-verification gates; the separate recovery team owns that. Pure-function gates (Phases 0–4 unit/property tests) can proceed now since they run in Node without staging.
3. **ARRANGE is unspecified** — the test plan assumes a `rankModules` pure-function shape. If the build squad chooses a different architecture (e.g., LLM-ranked layouts), properties P1–P6 need re-derivation, especially determinism (P5) and input-order independence (P6), which an LLM ranker would violate by default.
4. **Property harness is new** — the team's hand-rolled style can absorb it, but someone must write the ~40-line `forAll`/PRNG helper (flagged as infra, not test code, so it belongs to the build squad, not this evaluation).
5. **RLS tests need a scratch Supabase project + service_role in CI** — confirm with Mehedi that CI may hold the service_role key (server-side only, never in the bundle) before Phase 5 work starts.
