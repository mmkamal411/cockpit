# Child Education UX — Expert Panel Report

**Project:** Cockpit · **Workstream:** Child Education UX Strike Team, Workstream 3 (Expert Panel)
**Panel:** Child Psychologist · Ivy League Admissions Counselor · Pediatrician (adolescent health) · Child Education Specialist
**Date:** 2026-10-13 · **Subject of review:** `CHILD-EDUCATION-UX-REDESIGN.md` (Workstream 2) + `pookie-archaeology-report.md` (Workstream 1) + Meheldi's new 6-button home-layout mandate (2026-10-13)

**Status:** Review only. No code written.

---

## 1. Expert 1 — Child Psychologist (Self-Determination Theory lens)

### Strengths
- **Gap-to-90 framing is psychologically sound.** Achievement-goal research consistently favors mastery framing ("4.2 points to the goal — here's the path") over performance judgment ("you have an 85.8"). It supports *competence* (the goal feels winnable) and keeps the raw grade honest without leading with it. The design honors this everywhere — keep it, and keep the archaeology's exact copy lines ("points to your goal," never "you are at 69.5").
- **The consent screen names exactly what the parent sees.** Covert surveillance is what produces secrecy cycles in teens; explicit, plain-language visibility lists ("They will NOT see: your Crystal chats, anything you delete") convert surveillance into an agreed contract. This is the single most autonomy-supportive element in the design.
- **The child's surface leads with today's actions, not cumulative grades.** Proximal, actionable goals beat distal judgments for adolescent engagement. The Home order (spark → orientation → check-in → missions) is correct.
- **The 7-day cooling-off on parent revoke (13–15) is excellent.** Using surveillance removal as punishment is autonomy-thwarting and reliably produces secrecy rather than compliance. The cooling-off converts a heat-of-the-moment lever into a deliberated decision with an undo. Keep it.
- **Plain-word check-in (no numeric scales).** A 15-year-old shouldn't feel graded on their feelings. The four-word picker avoids the quantified-self anxiety loop that sliders produce.

### Concerns
- **⚠️ CONFLICT — Path-to-90 checkbox ownership.** §8.3 says "either side can check Path-to-90 boxes." The archaeology (Workstream 1, §3) records the locked Pookie rule: **the teen owns the checkboxes; parents are read-only**, enforced by a DB trigger — because a parent checking off a child's task boxes is experienced as control, not help, and it robs the child of the competence feedback of completing their own missions. The psychologist sides with the archaeology, not the design doc. **§8.3 must change:** teen (or steward, under 13) owns all check-ins/mission checkboxes; parents get read-only visibility plus their own support actions ("I emailed the teacher," "printed the study guide"). `checked_by` already records who — keep the column, change the permission.
- **⚠️ Check-in honesty requires a private channel.** §6.4 makes check-in text parent-visible, and the consent screen says so honestly — but a teen who knows every word goes to a parent will write performative check-ins ("quiz went okay") instead of honest ones ("I didn't understand any of the proofs"). d-dash solved this with *Dawson's Word* (parent sees the shared check-in) while Pookie's rebuild made check-ins teen-private — the archaeology carries both legacies, and the design doc picked the d-dash side without resolving the tension. **Recommendation: two explicit channels.** (1) The shared check-in (4 plain words + optional note) — parent-visible, feeds the 4pm cross-check, named in the consent screen. (2) A clearly labeled **"Just for me"** private note field per check-in — the consent screen's NOT-visible list gains one line: "✕ Notes you mark 'just for me.'" Teens are honest where they feel safe; the private channel is what makes the shared channel trustworthy too.
- **The 4pm cross-check must never be shown to the child as verification.** §5.6 frames check-in as "closing the loop with the 4pm briefing cross-check." If a teen ever sees "we compared your words to the gradebook," the check-in becomes a lie-detector and honesty dies. Keep the cross-check parent-side, keep its tone curious and non-accusatory (already Meheldi's standing rule), and never surface the *comparison* in the child's UI — only the *conversation*.
- **Gap-sorted class grids on the child's own surface.** §5.3 sorts classes biggest-gap-first ("needs the most help at top"). For the parent that's triage; for a child with Geometry at 69.5, it's a judgment wall every time they open their own app. **Recommendation:** the child's surface sorts by *today's relevance* (has due work, current focus class, recently active) — the full gap-sorted grid lives one tap deeper in the School tab. Parents can have the triage sort; children get the mission sort.
- **Streaks are brittle motivation.** The archaeology's d-dash check-in had a streak counter with confetti. Streaks motivate until one missed day breaks them — then they demotivate (all-or-nothing compliance). **Replace streaks with rhythm framing:** "Checked in 4 of 5 school days this week" survives a missed day; "12-day streak" doesn't. Keep the confetti (harmless delight), kill the streak counter.

### Recommendations (psychologist)
1. **Fix §8.3:** teen owns Path-to-90/mission checkboxes; parent read-only. Align with the archaeology's locked role rule (don't regress a decided fight).
2. **Add the "Just for me" private check-in channel** and name it on the consent screen's NOT-visible list.
3. **Child's class grid sorts by today's relevance, not gap size.** Triage sort is parent-only.
4. **Never surface the check-in-vs-gradebook cross-check to the child.** Curious conversation in, verification out.
5. **Replace streak counters with weekly-rhythm framing** ("4 of 5 days") everywhere check-ins are counted.

---

## 2. Expert 2 — Ivy League Admissions Counselor ("what actually moves grades")

### Strengths
- **The triage order matches how successful students actually work.** Missing/zeros first, ranked by grade-point impact, is exactly the recovery sequence that moves a GPA: a zero turned into average work is the highest-leverage point in any gradebook. The design's "Today's mission — missing first, ranked" is the right algorithm, and the archaeology's `buildPathActions` impact math (opportunity = weight × gap, "fewer, specific > more, vague") is the right engine. Port it verbatim — the LLM must never compute grades; it only writes the action words.
- **"Tonight's ONE action" is the highest-value pattern in the archaeology — and the design doc dropped it.** d-dash shipped a picker that chose tonight's single focus action. Decision fatigue is the #1 killer of teen study sessions; high-achieving students don't work from a list of five, they work from *the* next action. §5.2 ("Today's mission, max 5") is right for the parent; the child needs the ONE action restored on their Home. **Flag as a must-add, not a nice-to-have.**
- **Attendance as a first-class card is correct and rare.** Grade drops lag attendance changes by 2–4 weeks; counselors watch attendance as the earliest leading indicator. Surfacing "3 absences, 1 tardy — all excused" beats every grade chart for early warning.
- **The What-If simulator is exactly how counselors show students what's possible.** "If you score an 85 on the Unit 4 test, Geometry moves to 76" converts despair into a plan. The archaeology says port it (prefer live weights, fall back to curated). The design doc doesn't mention it — add it to the class-page spec as a lower section.

### Concerns
- **A class in real trouble (Geometry 69.5) needs a different surface than a fine class (Chinese 97.1) — the design gives both the same 8-section page.** For a fine class, Path-to-90 top-3 is noise; for a crisis class, the page needs an explicit **recovery plan**: fastest-lever math up top ("turning in the 2 missing proofs recovers ~6 points"), a "talk to the teacher" prompt with draft help, and office-hours/tutoring info. **Recommendation:** crisis mode triggers below 75 (amber zone): the class page gains a "Recovery plan" hero — one fastest lever, one teacher conversation, one study action — and the standard sections collapse beneath it. Above 90: a compact "Holding the 90 line — steady as she goes" state with sections collapsed. The middle band keeps the full page.
- **The manual missing-assignment logger is missing from the design.** The archaeology (§2.8, approved by Meheldi) records that students know about missing work the sync doesn't show yet. Counselor view: the kid always knows about the worksheet in their backpack before ParentVUE does. Port the logger; it feeds the same impact math.
- **"Talk to the teacher" is under-built.** Top students proactively talk to teachers — office hours are the most underused grade lever in high school. The design has "Ask Crystal to draft a message" on the teacher card (good), but the higher-value action is in-person: surface *what to ask* (weakest topic cluster from subskill diagnosis, e.g. "ask about proofs — you're at 62%") and *when* (office hours if known). Draft-the-email is the fallback, not the lead.
- **Peer tips ("98% Playbook") placement.** The archaeology shows they belonged directly under Path-to-90 on the class page, aligned to weakest units — peer explanations of the exact topic you're failing are pedagogically gold. The design doc doesn't place them. Put them back where d-dash had them.

### Recommendations (counselor)
1. **Restore "Tonight's ONE action"** on the child's Home (single focus action; parents keep the 5-item mission list).
2. **Crisis-mode class pages below 75:** recovery-plan hero (fastest lever + teacher conversation + one study action); collapse everything else. Steady-state above 90: compact "holding the line" state.
3. **Port the manual missing-assignment logger** — it feeds Path-to-90 math and captures what sync misses.
4. **Teacher card leads with "what to ask in office hours"** (weakest topic cluster, specific), with email-draft as the secondary action.
5. **Keep the What-If simulator and per-category opportunity bars** ("costing ~X% of grade") — they're the "show me it's possible" engine. Scope them into the class-page build explicitly.

---

## 3. Expert 3 — Pediatrician (adolescent health)

### Strengths
- **The morning spark is a genuinely healthy first interaction.** The first school-related thing the child sees is delight (fun fact + quote), not a grade. Positive phone interactions in the morning routine are protective; grade-first routines are not. Bundled pre-reviewed content (no live LLM generation for kids' delight) is the right call — deterministic, reviewable, zero surprise risk.
- **COPPA posture is the only safe default.** Under-13: no accounts, steward model, parent as account holder. Correct — and the design is right to say a full verifiable-parental-consent apparatus would be needed to revisit it. Don't revisit it in v1.
- **Plain words instead of numeric mood scales** avoids the quantified-self anxiety loop. (And the design correctly does *not* re-add the energy slider Meheldi explicitly killed.)
- **The amber ramp, never red, for low grades** matters more than it looks. Red is a threat signal; adolescents with grade anxiety fixate on it. The archaeology's explicit "never red, even for low grades" code comment is a health decision disguised as a design decision. Keep it as a hard rule.
- **Check-in nudges default to after-school (~3:45 PM), never at night.** The design defers notification timing to the nudge engine — acceptable only if the engine carries hard rules (see recommendations).

### Concerns
- **"Delight-first" needs a boundary: delight the ritual, not the work.** Confetti on check-in submit and a morning fun fact are healthy. But streak counters, gamified point-chasing, and delight wrapped around *grade outcomes* convert intrinsic motivation into extrinsic reward dependence — the psychologist's concern is the pediatrician's too. **Rule: delight lives in greetings, rituals, and completion of effort (showing up); never in grade numbers or streaks.**
- **Grade visibility is a fire hose pointed at the parent.** Real-time visibility into a 69.5 doesn't by itself help the child — it helps the parent worry faster. The design should include parent-side *cool-down copy* where grades are shown: "Grades refresh with each sync — one grade is a snapshot, not a verdict." The crisis-mode recovery plan (counselor's recommendation) doubles as anxiety containment: a plan replaces rumination.
- **Screen-time and sleep need hard rules, not deferred policy.** §11 says the design "defers notification-timing policy to the nudge engine." For a teen product, the panel wants the rules *in the design*: no school nudges 9 PM–7 AM local; no check-in nudges after the evening; "Tonight's ONE action" framed as after-school completable before dinner, never as late-night work. The dark cockpit theme is night-friendly (less blue light), which helps — but a dark theme is not a sleep policy.
- **Health-adjacent copy must pass the pediatrician test, not just the grandmother test.** If the app ever surfaces sleep/energy/weight-adjacent data near school content (Dawson's health context includes weight at 250 lbs), it must never present correlations as medical insight ("your grades dip when you sleep less" is a medical-adjacent claim — don't). Keep school and health data visually and logically separated.

### Recommendations (pediatrician)
1. **Hard notification rules in the design:** no school nudges 9 PM–7 AM local; check-in nudge default 3:45 PM on school days only, family-opt-out. Don't defer this to "the nudge engine will decide."
2. **Delight boundary:** delight in rituals and effort (showing up, checking in); never gamify grade outcomes or streaks.
3. **Parent-side cool-down copy** adjacent to grade displays ("one grade is a snapshot, not a verdict") + crisis-mode recovery plans as anxiety containment.
4. **Keep the amber-never-red rule as a hard design token**, and keep school/health data separated — no medical-adjacent claims from school data.
5. **COPPA: hold the under-13 line.** No accounts, no persistent identifiers beyond the steward row, data minimization on every kids' surface. (FTC's updated COPPA Rule makes this non-optional.)

---

## 4. Expert 4 — Child Education Specialist (curriculum & pedagogy)

### Strengths
- **Per-unit resource tagging is the right granularity.** Curricula are organized by unit; class-level resource piles are where links go to die. Tagging to the *current unit by default* (auto-tag at upload, proven in d-dash and Pookie) is the detail that makes the whole thing work — the resource is there when the unit is live.
- **INTERNAL (handouts) + EXTERNAL (YouTube/Khan/Kahoot/Blooket) split is correct** and matches the Learn plan. The explicit upload-vs-link picker matches how families actually hold materials (a photographed worksheet vs. a video link).
- **v1 user-added → v2 Crystal-curated (2–3 per type per week) is the sustainable sequence.** Curated-only overwhelms maintainers; student-added-only stagnates. The weekly curated cadence matches how units actually turn over.
- **"Explain It Back" belongs in the UI — retrieval practice is the highest-evidence study technique in the literature** (Dunlosky et al.: practice testing and distributed practice are the only two strategies rated high-utility). The archaeology notes d-dash's mic flow shipped broken — fix it, and add a **type-it-back text alternative**: voice self-testing is socially awkward for a teen in a shared room, and the text version is equally effective for retrieval.

### Concerns
- **Resources need a usage loop or they decay.** The 2026-10-09 Learn plan says "track what Dawson uses" — the design doc's Learn & resources section (§6.6, §9.5–9.7) specifies adding and tagging but not *usage*. **Recommendation:** lightweight "used it / this helped" taps on resources; usage feeds Path-to-90 recommendations ("students who used the proofs playlist recovered faster") and lets stale resources sink. Without the loop, the library becomes a link graveyard by December.
- **Parent-visible vs student-private learning activity is unspecified — and it matters.** The design says resources are "fully theirs to add" but never states what the parent sees. **Recommendation:** the child's study activity (which resources they opened, Explain-It-Back attempts, private notes) is **student-private by default**; the parent sees *aggregates* ("Geometry: 3 resources used this week") not play-by-play. Handouts the *parent* uploads are parent-visible; the *child's* uploads stay child-private unless shared. Rationale: a study corner that feels watched stops being used — the same honesty mechanism as the check-in private channel. The consent screen should name this: add "✕ Which study resources you open" to the NOT-visible list.
- **Curated resources need a unit-alignment check, not just a class match.** A generic "Geometry proofs" video is useless if the class is on triangle congruence this week. The v2 Crystal curation must match the *current unit topic* (from the syllabus/current-unit field), and every curated item carries its unit tag visibly so misalignment is obvious and correctable.
- **Unit tags must survive teacher restructuring.** Units get renamed and reordered mid-semester. Make the unit tag editable at add-time and re-taggable later; never hard-delete resources when a unit label changes — orphan them to "earlier units," don't destroy them.
- **Peer tips need the same unit alignment** as resources — a tip about Unit 2 is noise during Unit 4. The weekly peer-tips pipeline already tags by unit (per the 2026-10-11 plan); the class page must filter tips to the current + weakest units.

### Recommendations (education specialist)
1. **Add the usage loop:** "used it / helpful" taps on every resource; usage data feeds Path-to-90 and sinks stale items.
2. **Student-private by default for learning activity** (resources opened, Explain-It-Back attempts, private notes); parent sees weekly aggregates only. Name it on the consent screen.
3. **Fix Explain It Back and add type-it-back** as a first-class alternative to voice.
4. **Curated resources match the current unit topic** (not just the class); unit tag visible and editable; orphan-on-rename, never delete.
5. **Filter peer tips to current + weakest units** on the class page.

---

## 5. Consensus recommendations (2+ experts agree)

| # | Recommendation | Who agrees |
|---|---|---|
| C1 | **Teen owns Path-to-90/mission checkboxes; parent read-only.** The design doc's "either side can check" (§8.3) regresses the archaeology's locked role rule. Fix §8.3. | Psychologist, Counselor |
| C2 | **Two-channel check-ins: shared (parent-visible, feeds 4pm cross-check) + "Just for me" private.** Name the private channel on the consent screen's NOT-visible list. Teens are honest where they feel safe. | Psychologist, Education specialist, Pediatrician |
| C3 | **Restore "Tonight's ONE action"** on the child's Home. Five-item mission lists are for parents; the child gets one focus action. | Counselor, Psychologist |
| C4 | **Crisis-mode class pages below 75** (recovery-plan hero: fastest lever + teacher conversation + one study action; collapse the rest). Steady-state above 90 gets a compact "holding the line" state. One page shape does not fit 69.5 and 97.1. | Counselor, Pediatrician (as anxiety containment), Psychologist |
| C5 | **No streak counters; weekly-rhythm framing instead** ("4 of 5 days"). Delight in rituals and effort, never in grade outcomes. | Psychologist, Pediatrician |
| C6 | **Hard notification rules in the design:** no school nudges 9 PM–7 AM; check-in nudge ~3:45 PM school days, opt-out. Don't defer to the nudge engine. | Pediatrician, Psychologist |
| C7 | **Child's class grid sorts by today's relevance, not gap size.** Triage sort is parent-only; children get the mission sort. | Psychologist, Counselor |
| C8 | **Learning activity is student-private by default** (resources opened, Explain-It-Back attempts); parent sees aggregates. Add to consent screen. | Education specialist, Psychologist |
| C9 | **Keep the proven d-dash components in build scope:** What-If simulator, per-category opportunity bars ("costing ~X% of grade"), manual missing-assignment logger, peer tips under Path-to-90 filtered to current/weakest units, comeback sparkline. The design doc's IA is good but several proven components aren't in its class-page spec — scope them explicitly. | Counselor, Education specialist |
| C10 | **Amber ramp, never red** stays a hard design token; shame-free copy lines ported verbatim from the archaeology. | Pediatrician, Psychologist |

## 6. Disagreements (flagged for Meheldi)

**D1 — How much should the parent see of the child's words?**
The design doc (d-dash legacy) makes check-ins parent-visible; Pookie's rebuild made them teen-private. The panel's consensus (C2) is a split channel — but the *default* is undecided: should the shared check-in be the full check-in with an opt-in private field, or should the check-in be private by default with an opt-in "share with parent" toggle? The psychologist leans private-by-default (honesty first; the 4pm cross-check can run on the shared subset). The counselor leans shared-by-default (the parent's ability to help depends on seeing the struggle early, and Dawson's actual history is shared check-ins). **Meheldi decides the default; the panel insists the private channel exists either way.**

**D2 — Crystal for 13–17: hold the unfiltered lock or add a youth safety layer?**
The design doc punts this to the panel (§12.10). The panel splits on framing, not substance: the psychologist and pediatrician want an explicit youth safety layer — no methods for self-harm, eating-disorder safeguards, no sexual content involving minors, abuse disclosures routed toward a trusted adult, crisis resources (988) — and note this is *duty of care*, not the content filtering Meheldi killed. The counselor and education specialist note that none of this touches academic usefulness: full intelligence on schoolwork, no dumbing down, no canned messages. **Panel recommendation: hold "intelligent-first, no canned messages" AND add the youth safety layer** — framed as the pediatrician's floor, not a filter. **Meheldi decides;** the panel flags that operating an unfiltered LLM for 13–17 without a self-harm/eating-disorder floor is the one item in this design with genuine safety risk.

**D3 — Consent-screen default scope for 13–15 (design §12.3).**
The design proposes grades + attendance + check-ins visible, health off, Crystal chats never. The panel agrees on the shape but the education specialist would move *check-in detail* to summary-level for 13–15 ("checked in 4/5 days + this week's themes") with full text at 16+; the counselor wants full text at 13–15 because early struggle visibility is when intervention works. **Meheldi decides.**

---

## 7. Cross-cutting questions — direct answers

### Q1. Conditional 6th "School" tab — good call, or visible differently?
**Good call — keep it, with one adjustment.** The user-first invariant (childless pilots see zero parenting pixels) is a product principle, not a preference; the conditional tab is its IA expression. All four experts agree school is a *daily* surface for parents and a daily surface needs one-tap access — burying it behind category → subcategory → applet (3 taps) would recreate the exact 4-tap problem this redesign kills. **Recommendation: School keeps its conditional toolbar tab (one tap to the School station).** Under the new 6-button home mandate, the School tab *is* the school category control — rendered in the toolbar rather than the home grid. The home glass-pane "School this morning" module stays as the secondary path with a deep link. Do not also add a School home button (two front doors is fine; three is clutter).

### Q2. Child login per age tier — sound? Gaps?
**Sound, with gaps to close:**
- **Under-13 stewardship (no login):** correct, hold the line. COPPA-clean.
- **13–15 claim + consent:** sound. **Gap:** the design's §8.3 lets "either side" check mission boxes — fix per C1. **Gap:** birth-year attestation at signup is self-reported; pair it with the parent-side birthdate gate (already planned) and don't over-engineer — but log mismatches for the steward to resolve.
- **16–17 instant revoke + granular scopes:** sound and the independence framing ("You're in charge of who sees your school life") is exactly right. **Gap:** the design recommends building the Sharing screen in v1 (§12.8) — the panel upgrades this to **required**: without it the tier model's consent authority isn't enforceable in UI, and "you can change this anytime in More → My sharing" on the consent screen is a promise the app must keep on day one.
- **18+ continuity:** sound. One prompt, no breakup screen, history preserved.
- **Second parent (D5):** the child-as-authority rule is sound; ensure the UI makes "Parent A cannot veto Parent B's child-granted access" *visible* (a plain-English line on the Sharing screen), or families will fight about it in support tickets.
- **Missing:** the claim/redeem screens and the consent screen are new user-facing surfaces — per the standing rule, the login/landing aesthetic redesign must cover them. Flag for the design team.

### Q3. Crystal unfiltered for 13–17 — hold or guardrail?
See **D2** above. Panel recommendation: **intelligent-first, no canned messages, plus a youth safety layer** (self-harm/eating-disorder/sexual-content-with-minors/abuse-disclosure floor + 988 routing). Not a filter on ideas or school help — a duty-of-care floor. Also: the consent screen already promises "your Crystal chats" are never parent-visible — that promise must be architecturally enforced (no parent-side read path, no "summarize my child's chats" feature, ever). **Meheldi decides.**

### Q4. Meheldi's non-negotiables — honored?
- **Shame-free gap-to-90:** honored throughout. Keep the archaeology's verbatim copy lines.
- **Plain-English:** honored; "Family" rename is right. Watch for jargon leaking into user copy ("applet," "station," "crew," "scope," "grantee") — user-facing strings should say "app," "screen," "family," "who can see."
- **No blank pages:** honored — every empty/revoked/stale state has copy + one next action. The revoked-sharing state ("Dawson paused school sharing…") is exactly right.
- **Dark cockpit theme:** honored. Note for the 6-button mandate: the physical controls must match — lit buttons and toggles in neon-on-black, not a "boring list" — and the *content areas behind them stay calm* (see §8).

---

## 8. The 6-button home mandate — panel assessment

### 8.1 The right 6 categories (parent's and teen's mental model, not the engineer's taxonomy)
The panel proposes categories organized around **the rhythm of a day and the domains of a life**, with identical category names for parent and teen pilots (consistency reduces cognitive load; *contents* adapt):

| # | Side | Category | Subcategories (examples — planner to validate against the module registry) |
|---|---|---|---|
| 1 | Left | **My Day** | Today's briefing · Calendar · Tasks & to-dos · Nudges · Weather |
| 2 | Left | **Home & Money** | Bills · Subscriptions · Spending · Shopping lists · Properties · Purchase tracking |
| 3 | Left | **Go & Explore** | Flights · Trip planner · Gas / EV charging nearby · Vacation deals · Places |
| 4 | Right | **Family & School** *(conditional — parents/linked teens only)* | School station · Family settings · Crew roster · Sharing & grants · Sync installer |
| 5 | Right | **Health & Habits** | Health metrics · Sleep · Meals · Workouts · Medications |
| 6 | Right | **Messages & Mail** | Inbox · Teacher comms · Physical-mail intake · Support center |

Notes:
- **Crystal stays central** (the toolbar's AI control) — it's cross-cutting, not a category. **Settings** is a persistent corner control, not a category. **Progress** stays a toolbar tab (reflective, not a module).
- For a **childless pilot**, only 5 buttons render (Family & School is absent — zero parenting pixels, per the invariant). For a **teen pilot**, the same 6 names appear; Family & School becomes school-first ("My School," "My sharing"), Home & Money hides or limits to age-appropriate content.
- **The implementation planner must validate these groupings against the actual ~31-module registry** — the panel worked from the product areas named in project memory, not a module list. If a module doesn't fit cleanly, that's a signal to rename the category, not to force the module.
- Plain-English test: every category name passes the grandmother test. "Go & Explore" is the weakest — alternatives: "Trips & Travel."

### 8.2 Does category → subcategory → applet work for the school surface?
**No — school keeps its dedicated tab.** Category → subcategory → applet is a fine flow for *occasional* modules (booking a flight, checking a subscription). School is a *daily mission surface*: the counselor and psychologist agree that every added tap measurably reduces daily use, and the whole point of Workstream 2 was collapsing 4 taps to 1. **Resolution of the conflict with the design doc:** the design doc's conditional School tab (§4.1) *supersedes in the other direction* — the School tab IS the school category control, rendered in the toolbar for one-tap access. The home button grid covers the other five categories. The "School this morning" glass-pane module remains the secondary path. **Do not** route school through button → subcategory → applet; **do not** also add a School home button.

### 8.3 Psychologist: do physical cockpit controls increase engagement or add cognitive load?
**Both — novelty first, then whichever the design earns.** Skeuomorphic lit controls produce a real novelty-engagement bump (roughly 2–3 weeks), then they become either *instrument* (trusted, low-friction) or *clutter* (visual noise competing with content — particularly costly for ADHD users). The difference is functional honesty:
- **Do:** use the lit state to mean something — a softly lit category = "has attention items" (2 bills due, 1 missing assignment). The control becomes an instrument you read at a glance. Keep labels + icons + text always (never icon-only). Keep placement spatially stable.
- **Don't:** animate controls continuously, pulse glows without meaning, or let the panel's decoration compete with the content area. The delight belongs in the *controls*; the *content* behind them stays calm and readable.
- Keep the 6-button grid **below the glass pane** on Home so the morning ritual (weather → day → school glance) stays a sub-60-second glance, not a cockpit checklist.

### 8.4 Accessibility concerns with the cockpit-button aesthetic
1. **Touch targets ≥ 44×44pt** (WCAG 2.5.8). Physical-button aesthetics tempt small jewel-like controls — enforce the minimum on the *hit area* even if the visual is smaller.
2. **Every control has a visible text label + accessible name/role.** No icon-only buttons; screen-reader names match visible labels; use real `button` semantics (keyboard operable, visible focus ring).
3. **Color is never the only signal.** "Lit" must also change shape/label/state text ("2 due"), not just glow color — for color-blind users.
4. **Reduced motion:** honor `prefers-reduced-motion` — no pulsing glows, no orb drift, no space-video background motion (static frame fallback). The "soothing drift" is a vestibular hazard for some users; the off-switch must be automatic via the OS setting, not buried in app settings.
5. **Contrast:** neon-on-black is naturally high-contrast — good. But *dimmed* button states must still meet 4.5:1 for their labels; "unlit" can't mean "unreadable."
6. **No light-on-white anywhere** (standing rule) — the dark panel aesthetic complies by construction; audit any subcategory screens that might revert to light cards.

### 8.5 Conflicts between the 6-button mandate and the Workstream 2 design doc
| # | Conflict | Panel resolution |
|---|---|---|
| 1 | Design doc keeps a **More tab** holding modules (§4.5 "More → Family"). The mandate **kills More entirely**. | Mandate wins: More disappears; modules move to the 6 home buttons. "Family" admin becomes Home → Family & School → Family settings. Toolbar becomes Home · Today · Crystal · [School?] · Progress. |
| 2 | Design doc's **conditional School tab** vs the mandate's button grid. | Both survive, reconciled: the School tab *is* the school category control (toolbar-rendered, one tap). No School home button. |
| 3 | Design doc §4.5 routes **Family admin through More**. | Re-route: Family & School button → subcategory → Family applet. Same content, new path. |
| 4 | Design doc §7.4 mentions **"More → My sharing"** for the teen. | Re-route: teen's Family & School button → "My sharing." The consent screen's promise ("change this anytime in More → My sharing") must be reworded to the new path before it ships — a stale pointer on a consent screen is a trust violation. |
| 5 | The mandate's **button → subcategory → applet** flow adds taps vs the design doc's deep links (glass pane → School station, Today items → class pages). | Keep all deep links. The button grid is the *browse* path; deep links are the *daily* path. Never remove a 1-tap daily path to satisfy the browse path. |

---

## 9. Verdict: ready to build?

**Not yet — five items must be resolved first.** The IA is strong, the consent architecture is sound, and the archaeology gives the build proven components to port. But shipping as-written would bake in two regressions of already-decided fights and leave one safety question open. The build is unblocked once Meheldi rules on the items marked **(Meheldi decides)** and the planner applies the rest.

**Must change before build (planner applies, no decision needed):**
1. **Fix Path-to-90 checkbox ownership** (§8.3): teen owns, parent read-only — align with the archaeology's locked role rule (C1).
2. **Reconcile the 6-button mandate with the design doc** per §8.5: kill More, keep the conditional School tab as the school category control, re-route Family/My sharing, keep all deep links.
3. **Add the "Just for me" private check-in channel** and the student-private learning-activity default (C2, C8); update the consent screen's NOT-visible list accordingly.
4. **Scope the proven components into the class-page spec:** Tonight's ONE action (child), What-If simulator, opportunity bars, manual missing logger, peer tips (current/weakest units), comeback sparkline, crisis-mode (<75) and steady-state (>90) page variants (C3, C4, C9).
5. **Write the hard notification rules into the design** (no school nudges 9 PM–7 AM; check-in nudge ~3:45 PM school days, opt-out) and the delight boundary (rituals/effort, never grade outcomes or streaks) (C6, C5).

**Decisions for Meheldi:**
- **D1:** Check-in default — shared-by-default with private opt-in, or private-by-default with share opt-in? (Panel split; private channel exists either way.)
- **D2:** Crystal for 13–17 — panel recommends intelligent-first + youth safety layer (duty-of-care floor, not a filter). Hold the unfiltered lock or add it?
- **D3:** Consent-screen default scope for 13–15 — full check-in text, or summary-level until 16+?
- **Design §12 open questions** (School tab trigger, link-code-only v1, bell-schedule seeding, resource curation v1/v2, morning-spark reviewer, multi-child default) — panel endorses the doc's own recommendations on all six; no panel objection.

**After those five changes + three decisions, the design is ready to build.** The panel's overall assessment: this is a strong, evidence-aligned design — the consent architecture, the gap-to-90 framing, and the daily-surface IA are all correct. The remaining work is conflict resolution and scoping, not redesign.
