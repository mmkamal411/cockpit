# 08 — Frontend: Transparency & Preference Surfaces

**Evaluator role:** Frontend Developer (2 of 2)
**Date:** 2026-10-13
**Status:** Evaluation only — no production code written. All findings below are grounded in the current `main` of `mmkamal411/cockpit`.

**Stack context:** 4-layer personalization (KNOW, ARRANGE/layout engine, ANTICIPATE/nudge engine, ADAPT). Only ANTICIPATE exists today. Non-negotiables: every automated decision explains itself in plain English (grandmother test), the user can always ask WHY, no blank pages ever, clean code (no dead code, no `console.log`s).

---

## 1. Nudge Center Audit — how it works today

### 1.1 "Why am I seeing this?" (the transparency affordance)

**Location:** `src/components/applets/nudge-center-applet.tsx:265–270`

```tsx
<details className="mt-1.5">
  <summary className="cursor-pointer text-[11px] text-dim hover:text-stardust">
    Why am I seeing this?
  </summary>
  <p className="mt-1 text-[11px] leading-relaxed text-dim">{n.why}</p>
</details>
```

- Native `<details>` element — expandable, inline, no JS needed, keyboard- and screen-reader-accessible. Appears on every active nudge card, collapsed by default.
- The `why` string is **computed server-side at read time, not stored**: `GET /api/nudges/center` (`src/app/api/nudges/center/route.ts:23–30`) maps every row through `withWhy()`, which calls `whyLine()` from `src/lib/nudges/engine.ts:398–404`:

```ts
export function whyLine(nudge: { source?: string | null; score?: number | null; category?: string | null }): string {
  const source = nudge.source && nudge.source !== "system" ? nudge.source : "Cockpit";
  const score = typeof nudge.score === "number" ? nudge.score : 0;
  const tier = score >= 85 ? "urgent" : score >= 65 ? "important" : score >= 40 ? "worth a look" : "low-key";
  return `From ${source} — flagged as ${tier}.`;
}
```

- Example output today: **"From bills — flagged as urgent."**

**Verdict on the current implementation:** The *mechanism* (server-composed plain-English reason string → `<details>` affordance per decision) is exactly the right primitive. The *content* is too thin — two facts (source, tier), no trigger detail, no composition, no "why this and not something else". It fails the grandmother test in spirit: a grandmother reading "flagged as urgent" still doesn't know *what actually happened*.

**Available but unused data:** the `nudges` table (`supabase/migrations/009_nudges.sql`) already stores `source_ref jsonb`, `score`, `dedup_key` per nudge. The engine has the raw material for a real explanation ("Your electric bill of $184 is due Thursday — it scored 92 because it's due in 3 days and over $150"); it just doesn't surface it. The frontend never fetches `source_ref` (the center route's `SELECT` doesn't even request it).

### 1.2 Per-category toggles

**Location:** `src/components/applets/nudge-center-applet.tsx:331–356`

- Seven categories in fixed order (`CATEGORY_ORDER`): Meeting, Bill, Weather, To do, School, Health, System — each with a neon color chip (`CATEGORY_META`).
- Each row is a real switch (`role="switch"`, `aria-checked`, keyboard-tappable).
- `categoryEnabled()` treats *missing* `false` as enabled — opt-out model, new categories default on.
- Changes persist via **debounced PATCH** (600 ms) to `/api/nudges/preferences` (`src/app/api/nudges/preferences/route.ts`) into `nudge_preferences.categories jsonb`. UI updates optimistically; a "Saved." / error note confirms (`prefsNote`).

### 1.3 Sensitivity slider

**Location:** `src/components/applets/nudge-center-applet.tsx:379–402`

- `min_score` range input, 0–150 step 5, same debounced PATCH path.
- Label is dynamic plain English: "Everything comes through" at 0, "Only scores 150+" at max — good grandmother-test labeling.

### 1.4 Supporting surfaces in the same applet

- **Quiet hours** (time inputs, `22:00`–`07:00` defaults) + "Let truly urgent nudges break through quiet hours" checkbox — `breakthrough_allowed` gives the *user*, not the engine, final say over the top of the priority ladder.
- **Quiet-hours honesty line** (`nudge-center-applet.tsx:233–238`): "2 nudges waiting for morning — held back by your quiet hours, not lost." This is a transparency gem — it explains a *withholding* decision, not just a showing decision. Automated silence also needs explaining.
- **Stats + history**: 7-day totals, ack rate, per-category counts; acknowledged/expired/muted history capped at 10.
- **Empty states done right** (no-blank-pages compliant): "All quiet on the flight deck." when nothing is active; "Nothing in the log yet — acknowledged and expired nudges land here."

### 1.5 What's missing today

- No **mute duration** ("don't show me bills for a week") — toggles are binary, forever.
- No **"you got this wrong"** correction — acknowledging a nudge is not the same as flagging it as wrong/irrelevant.
- No **reset learned preferences** — nothing to reset yet, since ADAPT doesn't exist, but the prefs area has no "start over" control.
- No **per-nudge granular control** (mute *this kind* of nudge, e.g. "never nudge me about water again" vs. all of Health).
- No **why for suppressed items**: muted/expired nudges in history don't say *why they were muted* (category off vs. score too low vs. expired).
- `whyLine` is a dead-end template — it ignores `category` entirely (parameter accepted, unused) and can't represent multi-factor reasons.

### 1.6 Crystal Chat transparency: absent

**File:** `src/components/applets/crystal-applet.tsx`

- Chat has personas (Crystal warm / Fireball direct), a mode-flip pill, suggestion chips, thread list. **Zero transparency affordances**: no "why did you say that", no citation of data sources, no way to ask "why did you arrange it this way?".
- The chat backend (`POST /api/chat`, spec §5, behind `NEXT_PUBLIC_CHAT_SERVER_API` flag) streams from the worker. Even if the UI added a "why" affordance, the backend currently has no mechanism to attach decision provenance to a response — that needs to be designed into the chat context/tool-call layer.

### 1.7 Can the pattern generalize to layout decisions ("why is Crew at the top?")?

**Yes — the ARRANGE engine can reuse the exact contract.** The generalizable primitive is:

> Every automated decision ships with a server-composed, plain-English `why` object; the UI renders it in a consistent expandable affordance; the user can act on it (override/mute/correct) right there.

ARRANGE doesn't exist yet, so "why is Crew at the top?" has no backend to consult — but the contract is the same shape as nudges:

- nudge: `{ decision: "showed this nudge", why: { trigger, factors, score, alternative } }`
- layout: `{ decision: "placed Crew first", why: { trigger, factors, override } }`
- briefing: `{ decision: "led with the electric bill", why: { trigger, factors, your_tuning } }`

The key design change: **`why` must become a structured object**, not a flat string. The flat string survives as the collapsed one-liner (grandmother test), and the structure powers the expanded view plus machine actions ("move it", "stop doing that").

---

## 2. Generalized "Why this?" system design

### 2.1 The `WhyInfo` contract (backend → frontend)

Every automated decision endpoint attaches `why` of this shape:

```ts
interface WhyFactor {
  /** Plain-English cause, one sentence. "Your electric bill of $184 is due Thursday." */
  text: string;
  /** Optional weight: how much this factor contributed, 1–100, for the expanded view. */
  weight?: number;
}

interface WhyAction {
  /** Machine label for the correction surface. "mute_category" | "move_module" | "lower_sensitivity" | ... */
  kind: string;
  /** Plain-English button text. "Don't show bills for a week" */
  label: string;
  /** Prefilled params so the UI can act in one tap. */
  params?: Record<string, unknown>;
}

interface WhyInfo {
  /** One-liner, collapsed view. Grandmother test. ≤140 chars. */
  summary: string;
  /** 1–4 ordered factors, most important first. */
  factors: WhyFactor[];
  /** What data was looked at. ["Your bills", "Your calendar"] — honest source list. */
  sources: string[];
  /** Timestamp the decision was made. */
  decided_at: string;
  /** Optional: what would have changed it. "If it were under $100, I wouldn't have flagged it." */
  counterfactual?: string;
  /** Actions the user can take from this explanation. */
  actions: WhyAction[];
}
```

**Backend rules:**
1. `summary` is composed server-side (as `whyLine` is today), but from the structured factors — the UI never writes explanations.
2. `why` is computed at read time for freshness (existing behavior — keep it), but producers **must also persist** the factors they used at decision time (`nudges.source_ref` today is write-side storage that read-side ignores — wire it up). Persisted provenance survives preference changes; computed summaries stay fresh.
3. `sources` is mandatory. If a decision looked at Bills, Bills appears. No "and other signals" hand-waving. This is the trust line.

### 2.2 The UI pattern: one component, three placements

**`<WhyThis>`** — a reusable client component (lives in `src/components/` shared, not per-applet):

- **Collapsed:** inline `<details>`-style row: `Why am I seeing this?` (keeping today's exact wording — it's already plain English and tested).
- **Expanded:** the `summary` sentence, then factors as a short bulleted list (each with optional "matters most" weight bar), a "Looked at: …" source line, the counterfactual in italics, then 1–3 action buttons ("Don't show bills for a week", "Move Health lower", "Tell Crystal this was wrong").
- **Styling:** same neon-dim treatment as today — `[11px] text-dim`, expands inside the card. Consistency *is* the pattern: wherever Cockpit decides something for the pilot, the same affordance appears in the same place.

**Three placements:**

| Surface | Where it sits | Example |
|---|---|---|
| Nudge placement | On each nudge card (today's position) | "Why am I seeing this?" |
| Layout ordering | On each **section header** in Today/Home (small "why this order?" affordance) and in the Layout/Arrange editor per module | "Why is Crew at the top?" |
| Briefing composition | At the top of the briefing, per item: "why lead with this?" — plus a master "why this briefing looks the way it does" covering order, omitted items, and time budget | "Why did today's briefing lead with the bill?" |

**Interaction escalation ladder** (same everywhere):
1. Inline expand (cheap, private, instant) — covers ~90% of curiosity.
2. One-tap action from inside the explanation (mute / move / correct) — covers preference expression *in the moment*, which is the highest-quality preference signal.
3. "Ask Crystal about this" — deep-link into Crystal Chat with the decision context preloaded, so the pilot can interrogate it conversationally ("why did you arrange it this way?"). This closes the Crystal Chat gap (§1.6): the chat backend needs a context-injection path for `WhyInfo` so Crystal can answer from the same structured facts instead of hallucinating a reason.

### 2.3 What the expanded explanation looks like (mock)

> **Why am I seeing this?** ▸
>
> *Your electric bill of $184 is due Thursday.*
> - **Due in 3 days** — the biggest reason
> - **$184 is over your $150 "big bill" line**
> - You've acknowledged the last 3 bill reminders
>
> *Looked at: your bills, your calendar.*
> *If it were under $150 or due next week, I wouldn't have flagged it.*
>
> [ Don't show bills for a week ] [ This was wrong ] [ Ask Crystal ]

That is the whole design: summary → ranked factors → honest sources → counterfactual → actions. Every line passes the grandmother test.

---

## 3. Preference-surface IA

**Recommendation: hub + spokes, not hub-only and not spokes-only.**

- **Hub:** one "Personalization" area under **More → Personalization** (single destination, discoverable, deep-linkable). This is where the pilot reviews everything at once, sees the user model (§4), and resets things.
- **Spokes:** every applet keeps *in-context* controls for the decisions it makes — the per-card "why" actions (§2.2 ladder step 2). Preference expressed in the moment is worth 10× a preference expressed in a settings screen.

The hub must never be the *only* way to change something; the spoke must never be the *only* place it lives.

### 3.1 Hub structure (More → Personalization)

1. **Nudges** — the existing nudge-center prefs, upgraded:
   - Per-category toggles (keep the switches, keep `role="switch"` a11y)
   - **Mute durations**: each category row gets "Off for a week / Off for a month / Until I turn it back on" — replaces the binary forever-off. Stored as `muted_until` per category.
   - Sensitivity slider (keep; improve labels — see §5)
   - Quiet hours + breakthrough (keep; add per-category quiet hours? No — v1 keep simple)
   - **"Start over"**: reset all nudge preferences to defaults + clear learned weights. Confirm in plain English ("This turns everything back to how it was on day one. Your data stays — only the tuning goes.")
2. **Layout** — per-module prominence override:
   - List of modules (Crew, Bills, Health, Today…) each with a prominence control: **Pin to top / Normal / Hide** — plus "Back to automatic" to re-enable the engine's ordering. This is the manual override layer for ARRANGE; the engine's suggestion stays visible as a ghost ("Crew would be here automatically") so the override is legible.
   - "Why this order?" links each row to its `WhyInfo`.
3. **Briefing** — briefing composition prefs: items to always include / never include, max length ("quick / normal / deep"), morning vs evening.
4. **What Crystal knows about me** (§4) — the user-model view, with per-item delete and full reset.
5. **Correction history** — a log of every "you got this wrong" (§5): what was flagged, what changed as a result. Closes the loop visibly ("Because you flagged 2 water reminders, I stopped nudging you about water").
6. **Data & privacy** — what's stored where, export, full delete (account-level, separate from preference reset).

### 3.2 Control catalog (what exists per layer)

| Control | Nudges | Layout | Briefing |
|---|---|---|---|
| Category/module on-off | ✅ today (switches) | Pin / Normal / Hide | Always / Never include |
| Temporary mute | ❌ **add** (durations) | ❌ add (snooze module 1 week) | — |
| Sensitivity dial | ✅ today (min_score) | ❌ add (novelty vs stability) | Length: quick/normal/deep |
| Quiet hours | ✅ today | — | Delivery window |
| In-the-moment correct | ❌ **add** | ❌ add | ❌ add |
| Reset to defaults | ❌ **add** | ❌ add | ❌ add |

---

## 4. "What does Crystal know about me?" — view design

This is the highest-trust surface in the app. Design principles: **honest, complete, plain-English, actionable.** No marketing copy. No "to serve you better" — say what it is.

### 4.1 Structure

One screen, sections in this order:

1. **The basics you told me** — name, timezone, household/crew members, children linked. Each row: the fact, *where it came from* ("You typed this during setup" / "From your school sync"), and a per-row **Edit / Delete**. 
2. **What I've noticed** — learned patterns, each with a confidence note and its evidence:
   - "You usually check bills on Sunday evenings." — *Noticed from your last 6 weeks. Confidence: medium.* [ Keep ] [ Forget this ]
   - Every learned item gets **Keep / Forget this** — individual deletion is the correction affordance for the KNOW layer. ADAPT reads these deletes as negative training signals.
3. **What I've been told not to do** — the pilot's explicit rules, mirrored back verbatim: "Don't show me bills for a week (until Oct 20)", "Health reminders: off". With **Undo** on each. This proves the app listened.
4. **Connected data** — per integration: what it can see, last sync, **Disconnect** (integration-level kill switch, keeps history unless "delete its data" is also chosen).
5. **What I don't know / can't see** — *explicit negatives*. "I can't see your location. I can't read your texts. I don't know your health conditions unless you add them." This section is unusual and is exactly why it builds trust — it bounds the model.
6. **Danger zone** — **"Forget everything I've learned"** (clears learned patterns, keeps facts and integrations) and **"Delete my data"** (account-level, plain-English consequences, typed confirmation). Both explain *what survives*.

### 4.2 Rules for the copy

- Every fact has a **provenance line**: "You told me" / "I noticed" / "From [integration]". Never present learned things as told things.
- Confidence is stated for learned items ("medium" not "87%") — grandmothers don't do percentages.
- Nothing is described by its table name. `nudge_preferences.min_score` → "How picky I am about bothering you".
- The empty learned-state is explicit: "I haven't noticed any patterns yet — there's nothing to forget." (No blank sections, ever.)

### 4.3 Backend needs

- A `GET /api/me/model` endpoint returning the categorized user model: facts (source: explicit), learned patterns (source: inferred, with confidence + evidence window), rules (source: preference), integrations (source: connection). 
- Per-item delete: `DELETE /api/me/model/:id` with a reason captured ("wrong" / "private" / "outdated") — the reason feeds ADAPT.
- Today: none of this exists. The nearest structures are `nudge_preferences` (explicit rules, nudge-scoped) and integration rows (`pilot_integrations`). The KNOW layer is the build; this view is its frontend contract.

---

## 5. Correction affordances — "you got this wrong"

Corrections are the fuel for ADAPT. The design goal: **make being wrong cheap to report and visibly useful.**

1. **Per-decision "This was wrong"** — inside every expanded `<WhyThis>` (§2.2). One tap opens a 3-choice sheet, plain English:
   - "Not relevant to me" → mutes the pattern, not just the instance (e.g. water reminders generally, not this one)
   - "Wrong timing" → feeds scheduling (not now ≠ never)
   - "Just wrong" → flags for review, lowers the producer's confidence
2. **Visible consequence** — after a correction, the UI says what changed: "Got it — I won't nudge you about water on weekdays anymore." Then the Correction history (§3.1.5) shows it permanently. *A correction that disappears into a void teaches the user that corrections don't work.*
3. **Undo window** — every automatic consequence of a correction gets an Undo (5s inline, permanent in history). Misclicks must be free.
4. **No punishment UX** — corrections never read as complaints. Copy is grateful and brief: "Thanks — that's helpful." Never "We're sorry for the inconvenience."

---

## 6. Nudge center as template — copy vs. improve

**Copy:**
- The `<details>` "Why am I seeing this?" affordance — position, wording, collapsed-by-default. It's already right.
- Server-composed explanations (UI never invents reasons).
- Debounced preference PATCH with optimistic UI + "Saved." confirmation.
- Real switches (`role="switch"`), quiet-hours honesty line ("held back by your quiet hours, not lost"), non-blank empty states.
- The "Stats + history" section — proof-of-work for the engine, and the ack-rate line gives the pilot a sense of the relationship.

**Improve:**
- **Explanation depth**: wire `source_ref` into `whyLine`'s successor — triggers, ranked factors, counterfactual. Today's two-fact template is the floor, not the ceiling.
- **Mute durations** on every category (the binary switch is too blunt).
- **Why for suppressed items**: history rows should say *why* they were muted/expired ("Bill reminders are off" / "Score 30 was under your 50 line").
- **Sensitivity slider labeling**: the endpoints ("Everything" / "Only urgent") are good; add a live preview — "At 60, you'd have seen 11 of last week's 14 nudges." The 7-day stats already exist; this is one query away and makes the abstract number concrete.
- **Per-nudge "wrong" flow** (§5) — acknowledge ≠ correct.
- **Reset**: "Start over" for when the tuning drifts.

---

## 7. Per-phase acceptance criteria

### Phase 1 — Richer explanations on the existing nudge center (no new screens)
- [ ] `whyLine` replaced by structured `WhyInfo` (§2.1): summary + ≥1 factor + sources + counterfactual, composed server-side from `source`, `score`, `source_ref`, and the pilot's current thresholds.
- [ ] Every active nudge card renders `<WhyThis>` with the same "Why am I seeing this?" wording; expanded view shows factors, "Looked at: …", counterfactual.
- [ ] Quiet-hours honesty line kept; history rows show suppression reason ("muted — Bill reminders off" / "expired" / "score 30 under your 50 line").
- [ ] Sensitivity slider shows live preview ("At 60, you'd have seen 11 of 14").
- [ ] Grandmother test: 3 non-technical readers can paraphrase any explanation correctly. No jargon ("score" is allowed only with its plain label, e.g. "Only scores 60+" → "Only fairly important and up").
- [ ] No blank pages: API failure → the existing retry UI; zero nudges → the existing "All quiet" state.

### Phase 2 — In-the-moment preference actions (spokes)
- [ ] Every expanded `<WhyThis>` offers contextual actions: mute category for a week/month, "This was wrong" (3-choice sheet), and where applicable "Move lower" / "Show less like this".
- [ ] Every action confirms with a plain-English consequence line + Undo.
- [ ] Correction history section exists in the nudge center ("Because you flagged X, I stopped Y").
- [ ] Mute durations persist (`muted_until` per category); expired mutes auto-restore with a quiet note, not a nudge.

### Phase 3 — Personalization hub (More → Personalization)
- [ ] Hub IA per §3.1 ships: Nudges (with reset), Layout (pin/normal/hide + back-to-automatic), Briefing, "What Crystal knows about me", Correction history, Data & privacy.
- [ ] Layout rows link to their `WhyInfo` ("Why is Crew at the top?") once ARRANGE ships; before ARRANGE, layout prefs store overrides the engine will honor later (schema-first, engine-later).
- [ ] "Start over" resets each section independently with plain-English confirmation; data is never touched by a preference reset.

### Phase 4 — "What does Crystal know about me?" + ADAPT wiring
- [ ] `GET /api/me/model` returns facts / learned / rules / integrations with provenance on every item; UI renders §4.1 sections with per-item Edit/Delete/Forget.
- [ ] "What I don't know" explicit-negatives section ships.
- [ ] Every correction (§5) and every per-item delete lands in the ADAPT training signal store with its reason; Correction history shows the loop closing.
- [ ] Crystal Chat: "Ask Crystal about this" deep-link from any `<WhyThis>` preloads the decision context; Crystal answers from the structured `WhyInfo`, and chat gains a "why did you say that?" affordance on assistant messages backed by the same contract.

### Cross-phase gates (every phase)
- [ ] No `console.log`s, no dead code (standing rule).
- [ ] Every new automated decision anywhere in the app ships with `WhyInfo` — no explanation-less automation merges.
- [ ] Accessibility: switches keep `role="switch"`, expandables keyboard-operable, all controls labeled for screen readers.
- [ ] Plain-English review: no shipped string fails the grandmother test.

---

## Appendix: files cited

| File | What it shows |
|---|---|
| `src/components/applets/nudge-center-applet.tsx` | "Why am I seeing this?" `<details>` (:265–270), category switches (:331–356), sensitivity slider (:379–402), quiet-hours honesty line (:233–238), empty states |
| `src/lib/nudges/engine.ts` | `whyLine()` (:398–404) — current explanation composer; `getPreferences()` (:407+) |
| `src/app/api/nudges/center/route.ts` | `withWhy()` (:23–30) — server-side `why` attachment at read time |
| `src/app/api/nudges/preferences/route.ts` | Debounced PATCH target for category/min_score/quiet-hours prefs |
| `supabase/migrations/009_nudges.sql` | `nudges` table: `source`, `source_ref jsonb`, `score`, `dedup_key` — unused explanatory raw material |
| `src/components/applets/crystal-applet.tsx` | Chat UI — no transparency affordances today; personas, mode pill, suggestions |
| `src/components/applets/today-applet.tsx` | Fixed section rendering — no layout engine, nothing to explain yet |

---

*End of eval 08 — Frontend: Transparency & Preference Surfaces.*
