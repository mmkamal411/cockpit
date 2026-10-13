# AI Scientist Eval 02 — Ranking & Feedback-Loop Learning (ARRANGE + ADAPT)

**Evaluator:** AI Scientist (2 of 2) · **Date:** 2026-10-13 · **Status:** evaluation only — no production code written.

**Product context:** Cockpit's personalization stack — KNOW (user model) → ARRANGE (layout engine: what surfaces where) → ANTICIPATE (nudge engine) → ADAPT (learning from corrections). ADAPT is not built. `cockpit_layouts` exists (`supabase/migrations/001_pilot_foundation.sql` §8, one active row per pilot) but nothing writes to it. This eval covers the ARRANGE ranking problem and the ADAPT feedback-loop design, auditing the existing ANTICIPATE engine so the two rankers stay consistent.

**Privacy constraint (non-negotiable):** the behavioral profile never leaves the pilot's account; no cross-user learning; no LLM training on user data. All learning below is per-`pilot_id`, server-side, arithmetic only.

---

## 1. Nudge-engine audit (what scores/ranks today)

### 1.1 Files reviewed

| File | Role |
|---|---|
| `src/lib/nudges/engine.ts` | Scoring, quiet-hours, dedupe, expiry, `whyLine`, prefs fetch |
| `src/lib/nudges/engine.test.ts` | Unit tests (self-runnable via `node`) |
| `src/lib/nudges/route-helpers.ts` | Auth (`requirePilot`), structured errors |
| `src/lib/nudges/PRODUCERS.md` | Producer contract v1.0 |
| `src/app/api/nudges/route.ts` | GET lists; pending sorted `score DESC`, `why` attached per row |
| `src/app/api/nudges/center/route.ts` | Nudge-center payload: active/queued/history/stats (7-day totals, ack rate, per-category counts)/prefs |
| `src/app/api/nudges/candidates/route.ts` | Producer ingestion endpoint |
| `src/app/api/nudges/[id]/acknowledge/route.ts` | "got it, stand down" → `acknowledged` (+ legacy `dismissed_at`) |
| `src/app/api/nudges/[id]/snooze/route.ts` | `snoozed` until a future ISO time; sweep resurfaces |

### 1.2 Scoring formula (exact)

`scoreCandidate(candidate, now)` = **base × urgency**, rounded to 2 dp:

```
base = CATEGORY_BASE_SCORES[category]   // static, editorial
     = meeting 80 | bill 70 | weather 50 | todo 40 | school 60 | health 30 | system 90
mult = 1.5  if msLeft < 1h (past-due also lands here)
     = 1.2  if msLeft < 24h
     = 1.0  otherwise                       // deadline = candidate.deadline ?? scheduled_for
score = round(base * mult * 100) / 100     // range: 30.0 – 135.0
```

Submission pipeline (`submitCandidate`): **score → category gate** (`isCategoryEnabled`, absent = on) → **min-score gate** (pilot's `nudge_preferences.min_score`) → **dedupe** by (`pilot_id`, `dedup_key`), live = status ∉ {expired, muted}; 23505 race handled → **quiet-hours scheduling** (`applyQuietHours`: inside 22:00–07:00 default window → pushed to quiet end; `urgent` tier + `breakthrough_allowed` passes through; never returns past times) → **insert**.

Expiry sweep (`expireOld`): past-`expires_at` → `expired`; elapsed snoozes → back to `pending`. The GET list route runs this opportunistically, best-effort, never failing the read.

### 1.3 Explainability today

`whyLine` produces: `"From {source} — flagged as {tier}."` where tier = ≥85 urgent · ≥65 important · ≥40 "worth a look" · else "low-key", and `source` is used verbatim only when ≠ `"system"`. **This is attribution of the verdict, not the cause** — it never says *why* the score is what it is (deadline proximity? category importance?). For ARRANGE, which reorders the pilot's entire cockpit, this is too thin (see §6).

### 1.4 Gaps found (relevant to ADAPT design)

1. **No feedback-to-weight path.** `engine.ts` header is explicit: "Push delivery and learning-to-rank are Phase 2 — deliberately not here." Acknowledge/snooze/expire are terminal states; nothing updates any weight, preference, or category score. ADAPT has no hooks.
2. **No "that nudge was wrong" signal.** Statuses are pending/delivered/acknowledged/snoozed/expired/muted. `acknowledge` = "got it"; there is no distinct negative signal (dismiss-as-irrelevant). And `muted` appears in the DB constraint + history filter, but **no route or producer sets it** — the per-nudge mute path is dead code in practice; only per-category disable exists via preferences.
3. **Scores are static across pilots.** Two pilots with identical deadlines get identical scores; a pilot who opens health nudges daily gets no lift. Sensitivity slider is on prefs? Task says "sensitivity slider" exists — `min_score` is the mechanism, but nothing learns it.
4. **Dedupe is exact-key only** — near-duplicates (same bill, new key) pass through.
5. **No per-pilot usage capture anywhere** — no `usageEvents` table, no open counts (grep confirms). v2 learning needs a signal source built first (§4.4).
6. **Base scores are tuned for "a pilot's average day"** (per code comment) — the exact prior v2 should decay toward.

**Verdict:** the nudge engine is a clean, well-tested *rules* ranker with the right pipeline shape. Its `score = importance × urgency` and tier bands are the consistency anchor — ARRANGE v1 should reuse the same scale, tiers, and quiet-hours math rather than inventing a second ranking language.

---

## 2. The ARRANGE ranking problem

### 2.1 Inputs

| Signal | Source | Type |
|---|---|---|
| Local time of day (morning 05–10 / day 10–17 / evening 17–22 / night 22–05) | pilot timezone | context |
| Module usage: opens in last 7/30 days, last-opened timestamp | new `pilot_module_usage` capture (does not exist yet) | implicit |
| Explicit pins / hides | layout overrides, stored in `cockpit_layouts.layout` | explicit |
| Event triggers: bills due ≤48h, meetings <1h, grade-drop events, unread school mail, severe weather | producers (reuse nudge candidate producers) | triggers |
| Pending-nudge pressure per module | `nudges` table, status=pending, by source/category | trigger |
| Pilot preferences: quiet hours, sensitivity (`min_score`) | `nudge_preferences` | guardrail |

### 2.2 Output

An **ordered module list with prominence tiers**, persisted as the active row of `cockpit_layouts`:

```
HERO      — explicit pins only, in the pilot's pin order. Never rescored.
SPOTLIGHT — top ≤2 non-pinned modules, score ≥ 85. Home-glass prominence.
STANDARD  — score ≥ 45. Visible on home / first screen.
QUIET     — score < 45. Not on home; reachable in More menu. Still ≥ floor.
```

`SPOTLIGHT + STANDARD` = what the pilot sees without opening More. Everything else stays reachable — nothing is ever *hidden* (invariant §7.2).

---

## 3. v1 — rules-based scoring (explainable by construction)

### 3.1 Design principles

- **Same scale as the nudge engine:** 0–135, same tier bands (≥85 urgent · ≥65 important · ≥40 worth-a-look). One ranking language across ANTICIPATE and ARRANGE.
- **Additive components.** Every point comes from a named component that emits its own reason string. Attribution is free — the score *is* the sum of its explanations.
- **Explicit > triggers > habits > editorial.** Ordering of component precedence mirrors the product rule "AI proposes, user disposes."

### 3.2 Formula

```
arrange_score(m, ctx) =
    PIN_OVERRIDE                     // HERO tier; score := +∞ (handled before ranking)
  + BASE[m]                          // editorial prior, static, 0–100
  + time_of_day_fit(m, slot)         // −10 … +15, from time-of-day templates
  + trigger_pressure(m, ctx)         // 0 … +35, from live events (capped)
  + usage_recency(m)                 // 0 … +10
  + usage_frequency(m)               // 0 … +10, log-scaled over 7 days
  − neglect_penalty(m)               // 0 … −10, only after 14d+ untouched AND no triggers
```

Clamped to [5, 135]. Floor 5 = "never invisible" (invariant §7.4).

**Component definitions:**

- `BASE[m]` — editorial defaults, deliberately parallel to `CATEGORY_BASE_SCORES`:
  `chat(crystal) 85 | calendar 75 | today/briefing 80 | todos 65 | bills 70 | crew/school 60 | weather 50 | health 45 | shopping 40 | email 55 | support 30`. Tuned for the average pilot's day; the learning layer will personalize deltas on top.
- `time_of_day_fit` — templates (only the top-fitting slot applies, no stacking):
  - morning: weather +12, briefing/today +10, calendar +8
  - day: todos +10, calendar +8, bills +6
  - evening: health +8, crew/school +10 (homework hour), todos +6
  - night: all non-system −10 (suppress), system/urgent unaffected
- `trigger_pressure` — sum of live triggers, **capped at +35**:
  - bill due ≤24h: +25 · ≤48h: +15 · ≤7d: +8 (per module, take max, not sum)
  - meeting/event <1h: +20 · today: +10
  - school trigger (grade drop, missing assignment): +25
  - severe weather alert today: +20
  - unread school/teacher mail: +12
  - pending nudge pressure: +3 per pending nudge for that module, cap +12
- `usage_recency` — last opened: <24h → +10 · <72h → +7 · <7d → +4 · else 0
- `usage_frequency` — opens in trailing 7d: `min(10, 4 × log2(1 + opens))` → 1 open ≈ +4, 3 opens ≈ +8, 6+ ≈ +10
- `neglect_penalty` — untouched 14d+ with zero live triggers → −10 (drifts to QUIET); **never applies to pinned or safety modules**

### 3.3 Pseudocode

```python
def rank_modules(pilot, ctx) -> LayoutDecision:
    pins = get_pins(pilot)                       # explicit order, [] if none
    slot = time_slot(ctx.local_time)             # morning | day | evening | night
    usage = get_usage(pilot, trailing_days=30)
    triggers = collect_triggers(pilot, ctx)      # bills, calendar, school, weather, nudges

    scored = []
    for m in ALL_MODULES:
        if m in pins or m in get_hidden(pilot):
            continue                             # explicit state bypasses scoring (§7.1, §7.3)
        parts = score_parts(m, slot, usage[m], triggers[m])
        total = clamp(sum(parts.values()), 5, 135)
        scored.append((m, total, parts))

    scored.sort(key=lambda t: (-t[1], t[0].id))  # deterministic tie-break
    tiers = assign_tiers(scored)                  # HERO=pins; ≥85 SPOTLIGHT (≤2); ≥45 STANDARD; else QUIET
    return LayoutDecision(order=pins + [m for m,_,_ in scored],
                          tiers=tiers,
                          reasons={m: top_reasons(parts, k=2) for m,_,parts in scored},
                          generated_at=ctx.now)

def score_parts(m, slot, u, trig) -> dict[str, tuple[float, str]]:
    parts = {}
    parts["base"]      = (BASE[m], f"Baseline importance for {m.label}")
    parts["time"]      = (TOD_FIT[m][slot],
                          f"{'Good' if TOD_FIT[m][slot] > 0 else 'Lower'} fit for {slot_name(slot)}")
    tp, why = trigger_pressure(trig)              # capped +35, returns winning trigger's text
    parts["trigger"]   = (tp, why)
    parts["recency"]   = (recency_pts(u.last_opened), recency_text(u.last_opened))
    parts["frequency"] = (freq_pts(u.opens_7d), f"Opened {u.opens_7d}× this week")
    parts["neglect"]   = (neglect_pts(u, trig), "Not used lately — tucked out of the way")
    return {k: v for k, v in parts.items() if v[0] != 0}
```

Reasons with zero contribution are dropped so the explanation stays short (§6).

### 3.4 Worked example

**Pilot:** Mehedi, Tue 2026-10-13, **07:42 EDT** → slot = `morning`. Pins: none. Usage: opens bills daily, calendar 3×/wk, health untouched 21d. Triggers: electric bill $142 due tomorrow (bill ≤48h), no meetings today, 1 pending bill nudge.

| Module | base | time | trigger | recency | freq | neglect | total | tier |
|---|---|---|---|---|---|---|---|---|
| Bills | 70 | +6 (day? no → morning +0… use morning table: bills +0) | +15 (due ≤48h) + 3 (1 pending nudge) = **+18** | +10 | +10 | 0 | **108** | SPOTLIGHT |
| Calendar | 75 | +8 (morning) | 0 | +7 | +8 | 0 | **98** | SPOTLIGHT |
| Weather | 50 | +12 (morning) | 0 | +4 | +4 | 0 | **70** | STANDARD |
| Todos | 65 | 0 | 0 | +10 | +8 | 0 | **83** | STANDARD |
| Crystal chat | 85 | 0 | 0 | 0 | 0 | 0 | **85** | STANDARD* |
| Health | 45 | 0 | 0 | 0 | 0 | −10 | **35** | QUIET |

\* Tie at exactly 85 with SPOTLIGHT full (≤2) → Crystal chat stays STANDARD; deterministic tie-break by module id if scores tie.

Home glass shows: **Bills** ("$142 electric due tomorrow" +18 trigger, "you check this daily" +freq), **Calendar** ("morning planning time" +time). Health slides to More with the honest line: "Not used lately — tucked out of the way."

Note the trigger cap: if Mehedi had 5 bills due, trigger_pressure still caps at +35 — urgency never lets one module permanently colonize SPOTLIGHT on volume alone.

---

## 4. v2 — learned weights (bandit, not deep learning)

### 4.1 What we learn

Keep every v1 component; learn **per-pilot, per-module engagement weights** that scale the habit components. Concretely: a **contextual Beta-Bernoulli bandit** (Thompson sampling) — one bandit per time-slot (morning/day/evening; night is suppressed anyway), arms = modules.

- **State:** per (pilot, slot, module): `a` (successes), `b` (failures). θ_m ~ Beta(a, b) = learned engagement propensity.
- **Reward r ∈ {0,1}:** module *surfaced in SPOTLIGHT/STANDARD* then **opened within 30 min** (or engaged >30s) → 1; surfaced but ignored for 24h → 0. Opening via More menu (self-directed, not surfaced) → weak 0.2 credit to `a` (they still value it; don't punish the ranker for being wrong).
- **Ranking:** `final_score = v1_score × (0.75 + 0.5 × θ_sample)` — learned term is a **±25% modulation**, never a replacement. Cold start: `a0 = BASE[m]/10`, `b0 = 10 − BASE[m]/10` (editorial prior baked in as pseudo-counts).
- **Update:** `a += r`, `b += (1 − r)`; then **weekly decay toward prior**: `a ← 0.9a + 0.1a0`, `b ← 0.9b + 0.1b0`, floored at `0.5×` prior. Habits fade; editorial judgment persists.

Why Thompson sampling and not a neural ranker: (a) per-pilot sample sizes are tiny (tens of events/week) — a bandit converges, a network memorizes noise; (b) Beta(a,b) is inspectable — "we think you open Bills 8 mornings out of 10" is a sentence a human can audit; (c) sampling gives exploration *for free* with the right posterior, and the residual ε-greedy (§5) covers cold modules; (d) arithmetic runs on the existing stack with no new infra, and per-account state stays per-account.

### 4.2 What v2 does NOT learn

- Never learns pins, hides, quiet hours, or `min_score` — explicit state is invariant (§7.3).
- Never learns across pilots (§7.6).
- Never learns the trigger component — a bill due tomorrow is urgent regardless of habit.

### 4.3 Convergence behavior

Simulated expectation (acceptance §8.3): with pseudo-counts of 10, a module opened 4 of 5 surfacings reaches θ≈0.73 within 2 weeks; a module ignored 6 straight surfacings drops θ≈0.15 → ~12-point demotion at v1=80, enough to move STANDARD→QUIET but never below the floor.

---

## 5. Feedback loops — ADAPT update rules

### 5.1 Signal taxonomy (what each user action means)

| Action | Meaning for ADAPT | Update |
|---|---|---|
| Open surfaced module (≤30 min) | positive implicit | `a += 1` for (slot, module) |
| Open via More (not surfaced) | weak positive — ranker under-surfaced | `a += 0.2` |
| Surface ignored 24h | negative implicit | `b += 1` |
| **Dismiss module** (new UI affordance) | explicit negative | demote −8 pts learned offset, floor at QUIET (never auto-hide); see 5.2 |
| **Pin module** | explicit positive, hard | HERO tier; bandit updates for it suspended |
| **Unpin / unhide** | explicit state change | resume bandit; reset its (a,b) to prior (fresh start, no grudge) |
| Hide module | explicit negative, hard | removed from home; stays in More; bandit frozen |
| Snooze nudge | timing feedback, not relevance | feed ANTICIPATE only (reschedule), not ARRANGE |
| Acknowledge nudge | "got it" — weak positive for source module | `a += 0.2` for that module |
| Nudge expires unopened (×3 same category) | relevance decay | suggest category mute; do NOT auto-mute (ask once) |

### 5.2 Anti-runaway rules

1. **Diminishing returns on repeated dismissals:** the 2nd dismissal of the same module within 7 days counts ×0.5, 3rd ×0.25. A frustrated evening can't zero a module's standing.
2. **Demote, never disappear:** dismissals move STANDARD→QUIET, never QUIET→hidden. Only an explicit *hide* removes from home.
3. **Learned delta cap:** the bandit's total modulation is bounded to ±25% of v1 score (§4.1) and the absolute learned offset ≤ 15 points. Learning *tunes* editorial judgment; it never overrules it.
4. **Decay to prior:** weekly 0.9/0.1 decay (§4.1). A bad week in March doesn't haunt October.
5. **Explicit feedback is absorbing:** after pin/unpin/hide, the bandit for that module resets to prior — learning restarts from a clean slate rather than fighting the user's stated will.
6. **Rate limit on changes:** the active layout recomputes at most hourly and only persists when the top-3 order actually changes (no churn from noise; no layout thrash while the pilot is looking at it).

### 5.3 Exploration vs exploitation

Thompson sampling explores naturally (uncertain arms get sampled), but two failure modes need explicit handling:

- **Cold modules** (never surfaced in 30d): pure exploitation buries them forever. Fix: **one exploration slot per day**, filled only from modules untouched ≥14d with no active triggers and not explicitly hidden. Surfaced in STANDARD with a distinct, honest frame: *"Worth another look? You haven't opened Health in 3 weeks — tap to keep it handy, or dismiss."*
- **Exploration budget:** ≤1 exploration promotion per day, ≤1 slot on the home glass, never during night slot, never displacing a HERO pin or a module with an active urgency trigger. Repeated ignores double the backoff: 14d → 28d → 56d before the next probe.
- **Reward:** opened within 24h → `a += 1` (strong signal — they did still care); ignored → `b += 1` and backoff applies. This is the "check if the user still cares" mechanism the product asked for.

---

## 6. Explainability scheme — reason attribution

### 6.1 Principle

v1's additive formula makes attribution exact: **the explanation is the top contributing components, in plain words.** No post-hoc rationalization, no LLM-generated excuses — the reasons are read off the score parts.

### 6.2 Schema

Every layout decision stores per module:

```json
{
  "module": "bills",
  "score": 108,
  "tier": "SPOTLIGHT",
  "reasons": [
    {"component": "trigger",   "points": 18, "text": "Electric bill $142 due tomorrow"},
    {"component": "frequency", "points": 10, "text": "You check Bills most days"}
  ],
  "learned_note": null
}
```

- **UI line (glass):** top-2 reasons joined: *"Electric bill $142 due tomorrow · You check Bills most days"*
- **"Why this order?" sheet:** full component breakdown with points, mirroring the receipt style of the nudge `why` line but causal (extends `whyLine`'s spirit — source + tier — into source + *cause*).
- **v2 attribution:** when the bandit modulation moves a module across a tier boundary, append one learned reason: `{"component": "learned", "points": +9, "text": "Based on your habits — you usually open this in the morning"}`. Never fabricate specifics ("8 of 10 mornings") unless the counts are shown beside it.
- **Exploration frame:** distinct copy (§5.3) so a probe is never mistaken for a confident recommendation.
- **Invariant:** a module placed by automation with an empty reasons list is a bug (§7.5). Pins explain themselves: *"Pinned by you."*

### 6.3 Nudge-engine alignment

Recommend upgrading `whyLine` to the same causal format when ANTICIPATE gets its Phase-2 learning: `"Electric bill due tomorrow (+25 urgency) · Bills are important to you"` instead of today's `"From bills — flagged as important."` One explanation language across both rankers.

---

## 7. Guardrail invariants (ALWAYS hold)

1. **Pins are sacred.** A pinned module is never demoted, hidden, or rescored by learning. Pin order is the user's order.
2. **Safety modules are never hidden.** System/security-critical surfaces stay reachable within one tap from home regardless of score. (Mirrors the nudge engine: only `urgent` tier may break quiet hours.)
3. **Explicit beats implicit, always.** Pin / hide / unhide / category-disable override any learned weight, permanently, until the user changes them. Learning cannot re-surface a hidden module, ever.
4. **Floors, not cliffs.** Module score floor is 5; learning modulation is ±25% / ±15 pts; dismissals demote one tier at a time. No single action or bad week can make a module vanish.
5. **Every automated placement is explained.** Empty reasons = defect. Reasons are derived from the scoring components, not generated.
6. **No cross-pilot learning.** All (a, b) state is keyed by `pilot_id`. No shared models, no federated updates, no training on user data.
7. **Bounded exploration.** ≤1 exploration slot/day, honest framing, doubling backoff on ignores, never displacing pins or urgent triggers.
8. **Preferences gate everything.** Quiet hours, `min_score` sensitivity, and category disables apply to ARRANGE surfacing exactly as they do to nudges. Night slot suppresses non-urgent modules.
9. **Deterministic ties.** Identical scores break by module id — same input, same layout, every time. Reproducible for debugging and support.
10. **Monotonic response to explicit feedback.** More opens ⇒ non-decreasing learned weight; more dismissals ⇒ non-increasing; pin ⇒ top. If a user can observe the system moving *against* their feedback, trust is gone.
11. **Layout stability.** Recompute ≤ hourly; persist only on top-3 change; never reshuffle while the pilot is actively viewing home (defer to next idle recompute).

---

## 8. Acceptance criteria per phase

### Phase A — v1 rules engine (no learning)
- [ ] Unit tests (mirroring `engine.test.ts`'s self-runnable style): pins bypass scoring; time-slot templates produce expected deltas; trigger cap holds at +35 under trigger floods; neglect penalty never touches pinned/safety modules; scores clamp to [5, 135]; tie-break deterministic.
- [ ] The §3.4 worked example reproduces exactly (108 / 98 / 70 / 83 / 85 / 35) from a fixture.
- [ ] Every scored module carries ≥1 reason; the "why this order?" sheet renders from stored reasons alone.
- [ ] One active `cockpit_layouts` row per pilot; recompute is idempotent.

### Phase B — signal capture (ADAPT plumbing)
- [ ] `pilot_module_usage` (or equivalent) records opens with source (surfaced vs More), timestamps, slot; RLS per pilot.
- [ ] Dismiss / pin / hide affordances exist in UI and write explicit state (distinct from nudge acknowledge — the missing "this was wrong" signal from §1.4.2 is closed).
- [ ] Nudge outcomes (ack/snooze/expire/mute) are joined to source modules as weak signals per §5.1.

### Phase C — v2 bandit learning
- [ ] Simulation harness: 3 synthetic pilot personas (bills-focused, school-focused, erratic). Each converges to stable top-3 within 14 simulated days; no module breaches the floor; learned deltas stay within ±15 pts.
- [ ] Adversarial sim: "dismiss storm" (10 dismissals in an hour) — module drops exactly one tier, recovers no further; explicit hide still required to remove it.
- [ ] Exploration sim: cold module gets probed ≤1/day with honest framing; 3 consecutive ignores → 56-day backoff; 1 open → promotion sticks.
- [ ] Weekly decay verified: stale habits regress toward editorial prior within 4 weeks.

### Phase D — UX & trust
- [ ] "Why am I seeing this?" on every surfaced module; "Why this order?" sheet on home.
- [ ] User can pin/dismiss/hide from the explanation sheet itself (feedback at the point of curiosity).
- [ ] Support "view-as" shows the same reasons the pilot sees (debuggable personalization).

---

## 9. Risks & open questions for the parent orchestrator

1. **Signal source doesn't exist.** §1.4.5: no usage capture anywhere in the codebase. Phase B is prerequisite to all of v2 — recommend the KNOW-layer team own the event schema so ARRANGE and ANTICIPATE share it.
2. **Nudge/ARRANGE double-counting.** Pending-nudge pressure feeds `trigger_pressure`, and nudges have their own scores — ensure the same bill doesn't get +25 in ARRANGE *and* dominate the nudge list without the pilot perceiving why both fired. The shared reason text (§6.3) mitigates this.
3. **`muted` status is dead.** Either wire a per-nudge mute action or remove the status — currently dedupe treats it as non-live but nothing can set it.
4. **Time-slot boundaries** (morning/day/evening/night) should be pilot-tunable later; hardcoded now for v1 simplicity.
5. **Cold-start for brand-new pilots** is pure editorial (v1) — acceptable, and arguably desirable (no surveillance-feeling "we're watching you learn" period).
6. **Crystal chat's BASE of 85** makes the AI co-pilot nearly always STANDARD-or-better — deliberate (it's the product's core), but flag for Mehedi's review since it biases against the "AI proposes, user disposes" modesty.

---

*End of eval 02. No production code written. All formulas are implementable in the existing stack (TypeScript + Supabase + `cockpit_layouts`), consistent with `src/lib/nudges/engine.ts`'s scale, tiers, and quiet-hours semantics.*
