# Team 5 Audit — Health & Habits · Go & Explore · Messages & Mail · Crystal AI · Settings

**Team:** 5 (lead) — 3-expert panel: frontend, backend/API, UX (single agent, all three lenses)
**Scope branch:** `staging/crystal-robot-improved` @ 5f7e7fa (live staging code)
**Date:** 2026-10-13 ~21:15 EDT
**Rules:** read-only. Every claim below was verified against the code, not assumed.

---

## Executive summary

| Module | Reachable by all? | Actually works? | Verdict |
|---|---|---|---|
| Health & Habits | ✅ Yes | ✅ Yes (4/5 subcats) | Healthy; 1 nav papercut, 1 coming-soon |
| Go & Explore | ✅ Yes | ❌ No — 0/4 work | **P1: entire station is dead panels** |
| Messages & Mail | ✅ Yes | ❌ No — 0/4 work | **P1: entire station is dead panels** |
| Crystal AI chat | ✅ Yes | ✅ Yes (code-complete) | Healthy; **P0: verify worker secret is live** |
| Settings | ✅ Gear visible to all | ❌ Dead-end placeholder | **P1: gear opens nothing actionable** |

**Catch-22-class bugs on this surface: NONE.** The only children-gating left is the toolbar School tab (`useHasLinkedChildren()` in all 5 toolbar variants), which is compliant with the fairness doctrine — it is child content that *expands* when a child exists, and the add-child path is now reachable via Family & School (fixed in 5f7e7fa). No module on this surface hides itself or its entry point from childless users.

**The real disease on this surface is different: dead stations.** Two of the six home-station buttons (Go & Explore, Messages & Mail) and the Settings gear lead to "coming soon" panels with zero working function behind them. That's 3 of ~8 primary navigation targets — over a third of the app's front door — that do nothing.

---

## 1. Health & Habits (`health-habits`)

### LOGICAL check — reachable by every user?
**PASS.** No gating of any kind. The station button renders for all users (`STATION_CATEGORIES` has no `childrenOnly` on this category). Subcategories: metrics, steps, sleep, workouts → `health` applet; meals → coming-soon panel. A brand-new user with no data and no children sees the full station.

### FUNCTIONAL check — does it work end-to-end?
**PASS (with one nav papercut).** Verified:
- `src/components/applets/health-applet.tsx` (1,509 lines): 6 metrics (weight, sleep, water, exercise, blood_glucose, steps), per-metric log sheets with validation, goal editor (PUT /api/health/goals), 30-day trends, streaks, blood-glucose A1C estimate, entry edit/delete.
- API routes all present: `/api/health/log`, `/api/health/logs`, `/api/health/goals`, `/api/health/streaks`, `/api/health/trends`, `/api/health/a1c`.
- Empty states are real UI, not dead ends: skeleton tiles while loading, "Tap to log your first entry" captions, error panel with **Try again** button (grandmother test: passes).
- Steps are first-class (today's total on the tile, "tap to log more").

### Issues

**P2 — Four station buttons, one destination.** `metrics`, `steps`, `sleep`, `workouts` all call `openStationModule("health")` with **no params**, and the health applet doesn't read params at all. Tapping "Sleep" vs "Workouts" vs "Steps" lands on the identical generic view. Not broken, but misleading navigation — the buttons promise deep links they don't deliver.
- *Fix:* pass `{ focus: "sleep" }`-style params from `station-categories.ts`, have the health applet accept an initial-focus param (open the right log sheet or scroll to the metric). ~1 hour.
- *Catch-22 class?* No.

**P2 — "Meals" is a coming-soon panel** (`appletId: null`). Honest copy, acceptable interim state. Noted for completeness.

### UX notes (health)
- The single biggest habit-forming unlock: **watch/app import**. The workspace already has `apple_healthkit` and `google_health_connect` skills — steps/sleep/workouts could auto-populate instead of requiring manual logging. "Connect your watch, we do the rest" is the viral loop this module is missing; manual logging churns users out in week one.
- Streaks (🔥) are already in the tile UI — good. Missing: streak *celebrations* (confetti moment exists in the check-in flow; reuse the pattern) and weekly recap nudges.

---

## 2. Go & Explore (`go-explore`)

### LOGICAL check
**PASS.** Visible to all users, no gating.

### FUNCTIONAL check
**FAIL — the entire station is decorative.** All four subcategories are `appletId: null`:
- Flights → "Flight tracking is being built"
- Trips → "Trip planning is on the way"
- Gas & EV charging → "We're wiring fuel prices up"
- Vacation deals → "Vacation deals are coming"

There is no travel code anywhere behind this button. No API routes, no applet, no data model.

### Issues

**P1 — Dead station on the home screen.** One of six primary station buttons does literally nothing functional. The soon-panels are honest copy (not blank pages), but a third of the home grid being Potemkin modules trains users that the app is a demo, not a tool. This is the same trust class as the catch-22 bug: the app *advertises* capability it doesn't have.
- *Fix (recommended):* **Ship one working module before keeping the button.** The founder's own canonical example is "cheapest gas/EV charging nearby" — a gas-price lookup (public APIs exist: EIA, GasBuddy-affiliate feeds, OpenStreetMap + station data) is a weekend build and is the single most "average American day" feature on this station. Alternative: temporarily remove the station button until the first module lands. Do not leave a dead button as the long-term state.
- *Catch-22 class?* No — no gating. Dead-surface class.

### UX notes (travel)
- If gas prices ship: the viral loop is "Crystal noticed gas is $0.40 cheaper 2 miles off your route" — proactive, money-saving, shareable. That's the module that makes someone text a friend.
- Flights/trips/deals without a booking or price-tracking engine are just lists; don't build them as CRUD — build price-drop *alerts* (the nudge engine already exists).

---

## 3. Messages & Mail (`messages-mail`)

### LOGICAL check
**PASS.** Visible to all users, no gating.

### FUNCTIONAL check
**FAIL — the entire station is decorative.** All four subcategories are `appletId: null`:
- Inbox → "Your unified inbox is being wired up"
- Teacher messages → "Teacher messages land with the next school upgrade"
- Physical mail → "Photo mail intake is coming"
- Support → "Support is being built"

### Issues

**P1 — Dead station on the home screen.** Same as Go & Explore: a primary home button with zero working function behind it.

**However — the inbox has a live backend incoming.** The graph-mail-sync work just merged (branch `graph-mail-sync`, migration `040_outlook_mail.sql` in Meheldi's SQL-editor queue, `Mail.Read` delegated permission pending his Azure admin consent). Once 040 runs and he grants consent, there is a real Outlook mail pipeline with no UI. 
- *Fix (recommended):* Wire the **Inbox** subcategory to the Graph sync the moment 040 + Azure consent land — even a simple reverse-chron list with the triage copy ("the important stuff floats up") turns this station from dead to the app's stickiest surface. Until then, either hide the station or keep the honest soon-panel. Priority order: Inbox first (backend exists), Support second (7th-menu-category requirement already spec'd), Physical mail third (photo→action-items is high-viral), Teacher messages last (needs children + school upgrade anyway).
- *Fairness note:* "Teacher messages" is implicitly child-scoped (no child → no teachers). That's compliant — child content that expands. But its soonNote should say so plainly for childless users instead of implying a general feature is missing.
- *Catch-22 class?* No.

### UX notes (mail)
- The founder's standing vision: Action-based Gmail organization (to-do/pending labels, nested Banks/Travel/Shopping labels). The inbox shouldn't be "another email client" — it should be **the triage layer**: "3 emails need you, 12 are handled." Build the triage, not the client.
- Physical mail photo intake ("snap a letter → logged with action items, amounts, due dates") is a genuine differentiator — no consumer app does this well. High viral/demo value.

---

## 4. Crystal AI chat

### LOGICAL check
**PASS.** Reachable from all 5 toolbar variants (`openApplet("crystal")` in console, dash, hologlass, legacy, panoramic). No gating, no child dependency. The toolbar orb/robot is the entry point and it renders for every user.

### FUNCTIONAL check
**PASS (code-complete) — with one P0 verification outstanding.**
- `src/app/api/chat/route.ts` (304 lines): auth via `requirePilot()`, per-thread RLS scoping, streaming SSE responses, thread create/find/pin/delete (`/api/chat/threads`), Crystal/Fireball persona modes (keyword-triggered, sticky, persisted per message).
- Phase 0 hardening verified in code: **C1** context contract v2 (`src/lib/chat/contract.ts` + `toWireResponse` validation, loud `ContractViolationError`, child names/relationships no longer sent to worker); **W1** shared-secret auth (`Authorization: Bearer <CRYSTAL_WORKER_SECRET>`, fail-closed when unset, zero client-direct worker calls).
- Client (`crystal-applet.tsx`, 540 lines): thread list with pin/delete, loading states, plain-English error extraction from `{ error }` bodies with a sane fallback. No blank screens. Grandmother test: passes ("Type a message first — I can't read minds yet.", "Couldn't open a conversation. Try again in a moment.").

### Issues

**P0 (VERIFY, not yet proven) — Is the worker path actually live?** The app side fails closed if `CRYSTAL_WORKER_SECRET` is unset in Cloudflare Pages env, and the worker side needs the matching wrangler secret + redeploy (staged in the d-dash repo as `phase0/w1-worker-secret-auth`). The Phase 0 completion doc lists both as still-needed Meheldi-side steps. **If either is missing, every chat message fails** — with a plain-English error, but still a dead AI. This is the highest-risk item on my surface because the code is perfect and the deployment may not be.
- *Fix:* Confirm `CRYSTAL_WORKER_SECRET` is set in Pages env **and** the worker has the secret + v2 contract redeployed; then send one test message end-to-end in the browser. Do not claim chat works until that test passes.
- *Catch-22 class?* No.

**P2 — Mode switching is keyword-only.** Fireball mode flips on keyword with a confirmation line; there is no visible toggle. This is a product decision, not a bug — but discoverability is zero. A new user will never find Fireball.
- *Fix:* Add a small mode pill in the chat header (Crystal | Fireball) reflecting the current persona. 30 minutes.

### UX notes (Crystal)
- Chat is the retention engine. The missing loop: **proactive openers**. The nudge engine + behavioral signals (personalization Phase 1–4) should let Crystal open with "Your electric bill posted — $40 higher than usual. Want me to look?" instead of waiting for input. The plumbing exists (nudges, chat threads); the wiring (nudge → chat deep-link with context) doesn't.
- Suggested-message chips on empty thread ("What's on my calendar today?", "Anything need my attention?") would 3x first-message conversion for new users. Currently an empty thread is just an input box.

---

## 5. Settings — merge assessment

### What's on staging now
A **dead-end placeholder** (`SettingsPlaceholderApplet` in `src/components/applet-content.tsx`): a heading, one paragraph ("Your settings station is taking shape…"), zero controls. It is reachable from **three** places: the glass-pane settings gear (`glass-pane.tsx:168`), `station-deck-grid.tsx:229`, and `station-deck-bays.tsx:271`. Every one of them opens the same nothing.

**P1 — The settings gear opens a dead end.** Users tap a gear icon — the most action-promising icon in UI — and get a paragraph. This is worse than a coming-soon panel because the affordance promises function.

### What exists on `phase-d-rebuild`
A complete, well-built 7-panel Settings applet:
- Panels: **profile, connections, alerts, crystal, cockpit, family, privacy** (`src/components/applets/settings/` — 226-line applet shell + per-panel components + `settings-ui.tsx` shared controls + `use-panel-settings.ts` hook)
- 6 API routes: `/api/settings` (all namespaces, merged over defaults — "a missing row is never a blank screen"), `/api/settings/profile`, `/api/settings/connections`, `/api/settings/export`, `/api/settings/layout`, `/api/settings/account`
- `src/lib/pilot-settings.ts`: typed namespaces, defaults, merge + sanitize
- Quality: search across panels, per-panel live summaries, empty states with recovery copy, no blank panels. This code honors the standing rules.

### Ship-readiness: NOT ship-ready as a merge — needs a surgical port. Blockers:

1. **`pilot_settings` table does not exist on staging.** It's created in the branch's `027_education_tables.sql`, which was never merged. Every settings API route would 500 on staging today. The migration must ship with the code.
2. **Migration numbering conflict on the branch.** The branch contains *two* `027` files (`027_checkins_class_resources.sql` and `027_education_tables.sql`). Worse, `027_education_tables.sql` also creates education tables (school_schedules, district_calendars, checkins, class_resources) — some of which may already exist on staging via other migrations. A blind merge would 500 on `CREATE TABLE` conflicts. The port needs a fresh, staging-aware migration containing **only** `pilot_settings` (+ RLS), numbered above staging's current max.
3. **Branch drift.** `phase-d-rebuild` is 21 commits ahead / 90 behind `staging/crystal-robot-improved`. A full merge drags in unrelated work (school reauth, credential types, class-manual-missing, etc.) that staging teams may have superseded. **Do not merge the branch.** Surgically port: the 16 settings files + 1 new migration.
4. **Staleness check — mostly clean.** The settings code imports `@/lib/crew/auth` (`getPilotId`) which **exists** on staging. It does not depend on station-deck components (the "station deck's pinned footer" comment in the placeholder refers to the *staging* placeholder, not the branch code). One thing to verify during the port: `station-family.tsx` reads crew members + grants + link codes — confirm those tables/RPCs match staging's current schema (039 fixed the crew RLS recursion; the settings family panel should be re-tested against it).

### Recommended port plan (for the consolidation team)
1. New migration `04X_pilot_settings.sql`: `pilot_settings` table only (pilot_id, namespace, settings jsonb, updated_at; RLS pilot-scoped; unique(pilot_id, namespace)). Number above staging max.
2. Port 16 files: `src/lib/pilot-settings.ts`, `src/components/applets/settings-applet.tsx`, `src/components/applets/settings/*` (9 files), `src/app/api/settings/*` (6 files).
3. Replace `SettingsPlaceholderApplet` in `applet-content.tsx` with the real import.
4. Re-test the family panel against post-039 crew RLS; run settings API routes against staging DB.
5. Browser-verify: gear → real panels, change a setting, reload, confirm persistence.
- *Catch-22 class?* No — but note the placeholder is reachable, so no hidden-path issue.

---

## Fairness-doctrine compliance (this surface)

| Check | Result |
|---|---|
| Any module hidden from childless users? | **No.** Zero `childrenOnly` gates on Health, Go & Explore, Messages & Mail, Crystal, Settings. |
| Any add/find path hidden until a precondition? | **No** (the family-school catch-22 was the instance; fixed in 5f7e7fa; none on this surface). |
| Child content that expands? | School tab (toolbar) + teacher-messages (implicit). Compliant. |
| Same app for all users? | **Yes, structurally.** The gap is not fairness but *completeness*: 2 dead stations + 1 dead settings gear affect everyone equally. |

---

## UX improvements — making these modules habit-forming and viral

1. **Health: connect, don't type.** Wire Apple HealthKit / Google Health Connect (skills already in the workspace) for automatic steps/sleep/workout import. Manual logging is a week-one churn machine; auto-import is the retention loop. Then: Crystal surfaces the insight ("Sleep down 1.5h this week — want a wind-down reminder?").
2. **Go & Explore: ship gas prices first.** It's the founder's canonical example, it's a weekend build, and "cheapest fill-up near you" is inherently shareable. Then make it proactive: price-drop / cheap-station-near-route nudges.
3. **Inbox: triage, not a client.** Don't rebuild Gmail. Build "3 need you, 12 handled" — action extraction over the Graph sync that's already landing. This becomes the morning-ritual hook alongside the briefing.
4. **Physical mail: the demo moment.** "Snap a bill → amounts, due dates, action items logged" is the single most demoable 30-second viral clip in the backlog. Prioritize it within Messages & Mail.
5. **Crystal: proactive openers + starter chips.** Empty chat box converts poorly. Suggested chips for new users; nudge-driven openers for returning users ("Your bill posted 40% high — investigate?"). Wire nudges → chat deep-links.
6. **Settings: ship the port.** A settings gear that opens a paragraph is a trust leak on every tap. The branch code is good; the port is small (16 files + 1 migration). This is the cheapest trust win on the surface.
7. **Kill or fill the dead stations.** Standing rule proposal for the consolidation: **no station button ships without at least one working module behind it.** Dead buttons teach users the app is a mockup. Either build the first module or pull the button until it's real.

---

## Raw file references (for the consolidation team)

- Stations: `src/lib/station-categories.ts` (all 6 categories; `go-explore` L73–106, `health-habits` L128–145, `messages-mail` L146–179)
- Overlay/filter: `src/components/home-stations.tsx` (category filter L227, subcategory filter post-5f7e7fa)
- Registry: `src/components/applet-content.tsx` (settings placeholder L29–45, registry L137–142)
- Health: `src/components/applets/health-applet.tsx`, `src/app/api/health/*`
- Chat: `src/app/api/chat/route.ts`, `src/components/applets/crystal-applet.tsx`, `src/lib/chat/contract.ts`
- Settings (branch): `phase-d-rebuild:src/components/applets/settings-applet.tsx`, `phase-d-rebuild:src/components/applets/settings/*`, `phase-d-rebuild:src/app/api/settings/*`, `phase-d-rebuild:src/lib/pilot-settings.ts`, `phase-d-rebuild:supabase/migrations/027_education_tables.sql` (pilot_settings DDL — needs extraction)
- Gating: `src/lib/use-crew-roster.ts` (`useHasLinkedChildren`), all 5 `src/components/toolbar-*.tsx`
