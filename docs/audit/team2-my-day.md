# Team 2 Audit — MY DAY Station

**Team:** 3-expert panel (frontend · backend/API · UX), Team 2 Lead
**Date:** 2026-10-13 ~21:15 EDT
**Scope:** station id `my-day` in `src/lib/station-categories.ts` — Today's briefing / Today applet, Calendar applet, Tasks & to-dos (TodoApplet), Nudges applet, Weather applet + their API routes
**Code audited:** `origin/staging/crystal-robot-improved` @ `5f7e7fa` (the live deploy). Files extracted via `git show` — NOT the working tree, which had diverged.
**Mode:** read-only. No code changed.

## Verdict up front

My Day is the **healthiest station in the app**. No catch-22-class bugs found: the `my-day` category carries **no `childrenOnly` gate**, none of its five subcategories gate on children, and none of the applets query crew/children to decide what to render. The "School items" section in Today is data-driven (empty list for childless users) — exactly the expand-don't-hide behavior the fairness doctrine requires. A brand-new user with zero data sees every module, each with a real empty state. **No blank pages anywhere on this surface.**

Two real functional gaps were proven from the code (both P1), plus four P2s. Details below.

---

## Module 1 — Today's briefing / Today applet

**Files:** `src/components/applets/today-applet.tsx` (live), `src/app/api/today/route.ts`, `src/lib/today-types.ts`

### Logical check — PASS
- Reachable by every user: station subcategory `briefing` → appletId `today`, registered in `applet-content.tsx:60`. No gating of any kind.
- Reveals itself to new users: yes. A signed-in new user with zero data gets all five sections with friendly empty lines ("Nothing overdue. Clear skies.", "Nothing on the schedule today.", "No school items due today.").
- Unfair gating: none. The school section renders from `crew_grade_syncs` rows; zero children → zero rows → the section shows its empty line. Correct.

### Functional check — PASS (with notes)
- `/api/today` is genuinely well-built: each source (todos, calendar, nudges, school) is isolated in its own try/catch — one failing source degrades to an empty section **plus a plain-English warning**, never a broken briefing. Verified in code.
- Unauthenticated → 401 `"You need to be signed in to see today's briefing."` → the applet shows a **Sign in** button (not a dead "Try again"). Good.
- Loading state: skeleton pulse rows. Error state: panel with message + retry. No dead ends.
- Timezone-aware day boundaries via the pilot's saved timezone, UTC fallback. Date header uses the server-computed date so it can't disagree with sections.
- Auto-refresh every 60s.

### Issues
- **P2 — "Today's briefing" and "Tasks & to-dos" open the identical applet.** Both station subcategories map to `appletId: "today"`, and `TodayApplet` renders the briefing sections *and* the full `TodoApplet` below. Tapping "Tasks & to-dos" shows the whole briefing first — the two entries are indistinguishable. Not a bug, but it makes the station feel like it has 5 entries and 4 destinations.
  - *Fix:* pass a param (e.g. `{ focus: "todos" }`) on the tasks entry that scrolls to / expands the to-do manager, or consolidate into one entry. `TodayApplet` already accepts `params` (used for invite deep-linking), so the plumbing exists.
- **P2 — 60s refetch runs even when the tab is hidden.** Minor battery/network waste.
  - *Fix:* pause the interval on `document.hidden`, refetch on `visibilitychange`.

### UX — making it the morning ritual
- This is the closest thing the app has to a daily habit already. The single biggest viral lever: **make the briefing the first thing a new user sees after signup**, pre-seeded with one sample task ("Try me — tap to complete") so the "Handled" section and check-off animation demo themselves on day one.
- The "Nothing is asking for you right now. The bridge is quiet." empty state is genuinely good copy — keep that voice.

---

## Module 2 — Calendar applet

**Files:** `src/components/applets/calendar-applet.tsx` (live), `src/app/api/calendar/*` (14 routes)

### Logical check — PASS
- Reachable by every user: subcategory `calendar` → appletId `calendar`, registered (`applet-content.tsx:108`). No gating.
- New user, no connections: gets a clear "Your calendar isn't connected yet" panel with **Connect Google Calendar** and **Connect Outlook** buttons. Not hidden, not dead.

### Functional check — PASS (one config dependency)
- Agenda/day/week views, prev/next day navigation, event expand rows, free-time ("Open water") finder, connected-accounts management (sync now, disconnect, per-calendar visibility + Personal/Work/Family/School tagging). All wired to real routes.
- OAuth round-trip feedback via `?cal=` param notices ("connected" / "reconsent" / "error") in plain English. Reconsent path links directly back to the connect route.
- Missing OAuth client IDs degrade to a plain-English 503 ("Google Calendar isn't configured yet…"), not a stack trace. Verified in `connect/route.ts` and `connect/outlook/route.ts`.

### Issues
- **P1 — Calendar connect depends on `GOOGLE_CALENDAR_CLIENT_ID` / `OUTLOOK_CLIENT_ID` env vars on the Pages deployment.** Code handles absence gracefully, but if either var is unset in Cloudflare Pages env, the corresponding connect button is a dead end that always 503s. This is a *config* check, not a code bug — but it must be verified on the live deployment. (Memory says OUTLOOK_CLIENT_ID/SECRET were saved to Pages env on 2026-10-13; Google calendar client ID status unconfirmed.)
  - *Fix:* verify both vars exist in the `cockpit` Pages project env; add a deploy-time env audit.
- **P2 — Calendar is read-only.** There is no "add event" in-app; events only arrive via connected Google/Outlook accounts. For an app that wants to "run your life," not being able to jot "Dentist Thursday 3pm" without leaving the app is a real gap.
  - *Fix:* local event creation into a built-in "Cockpit" calendar (pilot-owned rows in `calendar_events`), offered when no account is connected and as an option always.
- **P2 — The Outlook "Sync mail" button lives inside the calendar applet's Connected accounts panel** (`syncMail` → `/api/mail/sync/outlook`). It works, but a mail sync button inside Calendar is surprising placement; it belongs to a mail surface when one exists.

### UX — making it the morning ritual
- The "Next up" hero card + "Open water" free windows are the right morning content. Viral lever: a **one-line "plan my day" prompt** — "You have 3 free hours; your top overdue task is X. Slot it at 2pm?" — that writes back to the to-do list. Closes the loop between Calendar and Tasks, which currently don't talk to each other in the UI.

---

## Module 3 — Tasks & to-dos (TodoApplet)

**Files:** `src/components/applets/todo-applet.tsx` (live, 1522 lines), `src/app/api/todos/*`, `src/lib/use-todos.ts`, `src/lib/parse-todo.ts`

### Logical check — PASS
- Reachable by every user: subcategory `tasks` → appletId `today` → `TodayApplet` renders `TodoApplet`. No gating.
- New user: "Your list is empty. Add the first thing on your mind — Crystal will keep it in sight all day." Real empty state, immediate capture box.

### Functional check — PASS (strongest module on the surface)
- Full-featured: lists, Today/Upcoming/Assigned-to-me views, P1–P4 priorities, sections, sub-tasks, recurrence, reminders, list sharing with permission levels, Crystal task breakdown (`/api/todos/breakdown`), Google Tasks sync panel.
- **Offline-first done right:** `use-todos` keeps a localStorage mirror + an op queue that uploads on sign-in and merges by timestamp. The header is honest: "Saved on this device — sign in to sync to your cloud." Sync failures show an amber banner with "Try syncing again" — failures never block the list.
- `/api/todos` `requirePilot` needs only the auth user (no `pilots` row dependency), so todos work even if migration 034 never ran. Good defensive design.
- Quick-add parses natural language ("tomorrow", "p1", "#project", "every Friday") with tap-to-revert chips. Delightful.

### Issues
- **P2 — Google Tasks sync end-to-end not verifiable from code alone.** The panel, routes, and token plumbing exist; whether the OAuth token exchange + task push actually works needs a live browser test with a real Google account.
  - *Fix:* browser-verify on staging (sign in → Google Tasks → push a task → confirm in Google Tasks).
- **P2 — `window.confirm()` for list deletion** ("Delete this list and all its to-dos? This can't be undone."). Native confirm dialogs are jarring and unstyled; the codebase otherwise uses custom UI everywhere.
  - *Fix:* replace with the app's own confirm pattern.

### UX — making it the morning ritual
- Quick-add with natural-language parsing is the killer feature — it should be **above** the briefing sections, not below them. Right now a new user sees five briefing sections before the capture box. Flip it: capture box first (the thing you do), briefing second (the thing you read).
- Viral lever: streaks. "3-day clear-everything streak" on the Handled section costs nothing and is the oldest habit trick in the book.

---

## Module 4 — Nudges applet

**Files:** `src/components/applets/nudge-center-applet.tsx` (live), `src/app/api/nudges/*` (7 routes), `src/lib/nudges/*`

### Logical check — PASS (with one backend caveat)
- Reachable by every user: subcategory `nudges` → appletId `nudges`, registered (`applet-content.tsx:126`). No gating.
- The "School" reminder toggle appears in preferences for all users — harmless (it simply never fires without children), and consistent with the fairness doctrine.

### Functional check — MIXED: two P1s
- The center UI itself is excellent: active/queued/history sections, acknowledge + snooze actions, quiet hours, sensitivity slider, per-category toggles, "Why am I seeing this?" provenance on every nudge. Loading/error/empty states all real ("All quiet on the flight deck.").
- **P1 — Nothing generates nudges. `POST /api/nudges/producers/run` has no scheduler.** The route requires the service-role key and is designed for a cron/worker to hit every ~15 min. I searched the repo and the goal's cron directory: no scheduler, no worker, no cron job calls it. `cockpit-scheduler` was a Phase 1 checklist item (PERSONALIZATION-PROGRESS.md, unchecked). Until it exists, the producers (meeting-soon, bill-due) never run and the Nudge Center is **permanently empty** — a beautiful shell with no data pipeline. Every new user will see "All quiet" forever and conclude the feature is decorative.
  - *Fix:* build the scheduler (Cloudflare Worker cron trigger → service-key POST to `/api/nudges/producers/run`), or as a stopgap, trigger a per-pilot producer run on briefing load. This is the single highest-leverage fix on the My Day surface.
- **P1 — 404 "Pilot profile not found" when the `pilots` row is missing.** `src/lib/nudges/route-helpers.ts` `requirePilot()` does `.from("pilots").select("id,timezone").eq("id", userId).maybeSingle()` and returns 404 `"Pilot profile not found."` when the row doesn't exist (i.e. migration 034 never ran for that user). The applet renders that string with a "Try again" button — retrying can never succeed, and "Pilot profile" is jargon that fails the grandmother test. Compare: `/api/todos` and `/api/today` don't need the row at all.
  - *Fix (pick one):* (a) make `requirePilot` tolerate a missing row (fall back to `userId` + `"UTC"`, matching the todos/today pattern); or (b) auto-create the pilot row on first hit (upsert); or at minimum (c) replace the message with "Your account isn't fully set up yet — sign out and sign back in." Option (a) is the smallest correct change.
  - *Catch-22-class?* Adjacent but not the same class: it's a missing-row dependency, not a child gate. Still, it's the same *shape* of failure — a module that silently doesn't work for new users.

### UX — making it the morning ritual
- Proactive beats reactive: once producers actually run, the Nudge Center is the most viral surface here ("it tapped my shoulder before I forgot"). Until then, consider seeding **two built-in nudges for brand-new users** (e.g. "Connect your calendar so I can warn you before meetings" / "Add your first to-do") — generated client-side on first run, no scheduler needed. Turns the empty state into an onboarding checklist.

---

## Module 5 — Weather applet

**Files:** `src/components/applets/weather-applet.tsx` (live), `src/app/api/weather/*` (4 routes), `src/lib/weather.ts`

### Logical check — PASS
- Reachable by every user: subcategory `weather` → appletId `weather`, registered (`applet-content.tsx:102`). No gating.
- Works fully signed-out: location search + detail endpoints need no auth; prefs PATCH is best-effort (fails silently, falls back to defaults). A logged-out user still gets weather. Exemplary.

### Functional check — PASS
- Open-Meteo for forecast + geocoding — **no API key required**, so there's no key-expiry failure mode. 15-min server cache on detail. Stale-data banner ("showing last good data") when the upstream is slow.
- Failure state: "The skies are quiet — weather is unavailable right now." + Try again. Search failure: plain-English note. Loading: "Reading the skies…". No blank card ever (renders with fallback location while prefs load).
- Hourly strip, 7-day, details grid (wind/humidity/sunrise/sunset), °F/°C toggle persisted per pilot.

### Issues
- **P2 — Hardcoded `Marietta, GA` fallback.** `const FALLBACK = { lat: 33.9526, lon: -84.5499, label: "Marietta, GA" }`. A brand-new user in another city silently sees Marietta weather until they think to search. It's not wrong (it's labeled), but it's wrong-*looking* and every non-Marietta user pays a confusion tax on first open.
  - *Fix:* on first load with no saved prefs, request browser geolocation (permission-gated, coarse) and fall back to Marietta only on denial; label the fallback honestly ("Showing Marietta, GA — search your city above").
- **P2 — Signed-out users lose location/units on reload** (PATCH 401s, silently swallowed). Acceptable, but the units toggle could persist to localStorage as well as the server attempt.
  - *Fix:* mirror prefs to localStorage; server PATCH remains best-effort.

### UX — making it the morning ritual
- Weather is already the home glass-pane content — that's the morning hook, and it's the right call. Viral lever: **weather-aware nudges** ("Rain at 3pm — bring the umbrella" as a nudge, not just a forecast line). This is exactly what the nudge producer pipeline is for — another reason the P1 scheduler fix matters.

---

## Cross-module findings

1. **No catch-22-class bugs on My Day.** Verified: `childrenOnly` appears nowhere in the my-day category or its subcategories, and no applet on this surface branches on crew/children/pilot-row except the nudge 404 noted above.
2. **Error-voice consistency is high.** Every failure message I found passes the grandmother test ("Today's briefing didn't load. Please try again.", "Couldn't sync right now — try again in a bit.", "The skies are quiet — weather is unavailable right now."). The sole exception is the nudge 404 "Pilot profile not found." (P1 above).
3. **Station-entry redundancy:** "Today's briefing" and "Tasks & to-dos" are two doors to one room (P2 above).
4. **The two P1s are both "module present, pipeline missing":** nudges have no producer scheduler; calendar connect has an unverified env-var dependency. The pattern to hunt on other surfaces: *beautiful UI, empty pipe behind it.*

## Prioritized fix list (My Day only)

| # | Severity | Module | Fix |
|---|----------|--------|-----|
| 1 | P1 | Nudges | Build the producer scheduler (or per-pilot run on briefing load) — the center is permanently empty without it |
| 2 | P1 | Nudges | `requirePilot` 404 on missing pilot row → tolerate/auto-create; replace jargon error |
| 3 | P1 | Calendar | Verify `GOOGLE_CALENDAR_CLIENT_ID` + `OUTLOOK_CLIENT_ID` are set in Pages env; add env audit to deploy |
| 4 | P2 | Today | "Today's briefing" vs "Tasks & to-dos" open the same applet — deep-link param or consolidate |
| 5 | P2 | Weather | Replace hardcoded Marietta fallback with geolocation-first (permission-gated) |
| 6 | P2 | Tasks | Replace `window.confirm()` on list delete with app-styled confirm |
| 7 | P2 | Tasks | Browser-verify Google Tasks sync end-to-end |
| 8 | P2 | Weather | Mirror units/location to localStorage for signed-out users |
| 9 | P2 | Today | Pause 60s refetch when tab hidden |

## UX direction — the viral morning

My Day already has the right *shape* for a daily ritual: glanceable briefing → capture → calendar → proactive taps. Three moves would make it addictive:

1. **Order by action, not by category.** Today: capture box first, briefing second. The first thing a user does in the morning is *unload their mind*, not read a report.
2. **Close the loops.** Calendar ↔ Tasks (schedule a task into "Open water"), Weather → Nudges (rain warning), Briefing → Nudges (overdue escalation). The modules are individually good but don't talk to each other; the viral feeling is "it connected the dots for me."
3. **Seed the empty states.** A brand-new user's My Day should demo itself: one sample task, two built-in nudges (connect calendar, add a to-do), and the weather asking for their city. Empty states that *teach* beat empty states that merely *reassure*.
