# Cockpit UX Audit — Consolidated Action Plan (2026-10-13)

5 teams × 3 experts. Read-only audit of every station on `staging/crystal-robot-improved` @ `5f7e7fa`.
Team reports: `docs/audit/team1-shell-navigation.md` … `team5-health-travel-ai-settings.md`.

**Fairness doctrine (Meheldi, 2026-10-13):** ALL standard modules visible to ALL users.
No feature difference for childless users; child menus EXPAND when a child exists.

## Headline findings

- The catch-22 bug class (gating that hides the only path to an action) had **exactly one member** — the Family & School station, fixed in `5f7e7fa`. No other instance found anywhere.
- The deeper disease is different: **dead inputs, dead choices, and dead stations.** Modules that render beautifully with no pipeline behind them (Nudges with no scheduler, add-child collecting passwords it discards, two home stations that are 100% coming-soon panels).
- **Good news:** pilot provisioning has a dual safety net (034 trigger + `/auth/callback` upsert), so new users get pilot rows even if migration 034 never ran. The 034 question is closed.

## P0 — fix before anything else

| # | Issue | Team | Fix |
|---|-------|------|-----|
| 1 | **School tab + gated subcategories don't appear after adding the first child without a page reload.** Stale `useCrewRoster` module cache is never invalidated. Breaks the "menu simply expands" promise literally. | 4 | Add `invalidateCrewRoster()` to the hook; call it in Crew applet `finish()` after add and in `removeMember`. ~10 lines. Browser-verify: add child → School tab slides in, no reload. |
| 2 | **Link-code redemption doesn't exist.** UI promises "the other person enters this code" — there is no input, no claim route. Mint works; the app half was never built. | 4 | Build `POST /api/crew/link-codes/claim` + claim panel in Crew applet. Until then, remove the "Share a link code" button — a promised feature that dead-ends is worse than a missing one. |
| 3 | **Crystal chat worker path unverified.** Code is perfect (contract v2, fail-closed secret); but if `CRYSTAL_WORKER_SECRET` isn't in Pages env or the worker wasn't redeployed with the v2 contract, EVERY chat message fails. | 5 | Confirm secret in Pages env + worker redeployed; send one test message in the browser. Do not claim chat works until this passes. |

## P1 — the fairness + trust list

| # | Issue | Team | Fix |
|---|-------|------|-----|
| 4 | **School tab hidden for childless users** — visible feature difference, against the doctrine. The school-station applet already has a graceful childless empty state with an Add-a-child CTA, so showing it is safe. | 1 | Render the School tab always in all 5 toolbar variants. Childless tap → existing empty state. |
| 5 | **Add-child step 2: username/password are dead inputs.** Collected, never sent. Heading promises "so grades and assignments can sync." A parent typing a password that goes nowhere is the single most trust-destroying thing in the flow. | 4 | Remove the fields; replace with an installer CTA card. Never ask for a password you discard. |
| 6 | **Add-child step 3: sync preferences never persisted** — choice theater. Toggles only compose the confirmation sentence. | 4 | Persist to `crew_members.sync_preferences` (jsonb) and surface as editable toggles in member detail — or remove the step. |
| 7 | **No birthdate sanity bounds** — future dates accepted. | 4 | Clamp: not future, not >~25y past. Plain-English error. |
| 8 | **Relationship hardcoded to "child"** — no picker; adding a spouse records "child". Violates never-assume-parenthood. | 4 | Add relationship picker to step 1 (Child/Spouse/Parent/Other); gate school logic on `relationship === "child"`. |
| 9 | **Nudges: no producer scheduler.** `POST /api/nudges/producers/run` is never called by anything — Nudge Center is permanently empty ("All quiet" forever). | 2 | Build the Cloudflare Worker cron trigger, or per-pilot run on briefing load as stopgap. Highest-leverage fix on My Day. |
| 10 | **Nudges 404 "Pilot profile not found"** when pilot row missing — jargon + a "Try again" that can never succeed. | 2 | Tolerate missing row (like todos/today do) or auto-create; replace jargon. |
| 11 | **Calendar OAuth env vars unverified** on Pages (`GOOGLE_CALENDAR_CLIENT_ID` / `OUTLOOK_CLIENT_ID`) — connect buttons may be dead ends. | 2 | Verify both in Pages env; add env audit to deploy script. |
| 12 | **Go & Explore: 100% dead** — 4/4 coming-soon, zero code behind the button. | 5 | Ship gas-price lookup first (founder's canonical example, weekend build) or pull the button until something real lands. |
| 13 | **Messages & Mail: 100% dead** — 4/4 coming-soon. Inbox backend is incoming (graph-mail-sync merged; needs 040 + Azure consent). | 5 | Wire Inbox to the Graph sync the moment 040 + consent land. Then Support, physical-mail intake, teacher messages. |
| 14 | **Settings gear → dead placeholder** (3 entry points). Real 7-panel Settings sits unmerged on `phase-d-rebuild`. | 1+5 | Surgical port, NOT a merge: 16 files + 1 fresh staging-aware migration with only `pilot_settings` (+RLS). Branch is 21 ahead/90 behind with migration-number conflicts — do not merge it whole. |
| 15 | **Zero onboarding.** New users land on the veteran home with no guidance — root cause of tonight's incident. | 1 | First-run mission-briefing overlay: meet Crystal → tour the six stations → "add a child or skip, everything works the same." |

## P2 — hygiene (batch into one cleanup pass)

School-tab flicker on load · roster-fetch failure silently treated as "no children" · dead `more` + `school-overview` applets in registry · no `not-found.tsx` (typed `/school` URLs hit default 404) · category-level `childrenOnly` field is a footgun (delete it; keep subcategory-level only) · `npm test` broken (references non-existent `ensure-pilot.test.ts`) · "Today's briefing" vs "Tasks & to-dos" open the same applet · hardcoded Marietta weather fallback (use geolocation-first) · `window.confirm()` on list delete · health subcategories don't deep-link · under-13 rule unenforced in code (needs founder sign-off on behavior) · school station 5/7 placeholder.

## Standing rule proposed (from Team 5)

**No station button ships without at least one working module behind it.** Dead buttons teach users the app is a mockup.

## Viral-UX direction (synthesized from all 5 teams)

1. **First-run briefing** — the one overlay that prevents the next "how do I add a child" incident.
2. **The expansion moment** — after "is aboard," the School tab visibly slides in: "School station is ready — it'll fill in after the first sync." The app *growing* in front of you is the viral clip.
3. **Seed the empty states** — sample task, built-in nudges (connect calendar, add a to-do), weather asking for your city. Empty states that *teach* beat ones that merely reassure.
4. **Order Today by action** — capture box first, briefing second. Unload the mind, then read the report.
5. **Close the loops** — Calendar↔Tasks ("slot it at 2pm?"), Weather→Nudges (rain warning), Nudges→Crystal chat deep-links.
6. **Inbox as triage, not a client** — "3 need you, 12 handled" over the Graph sync.
7. **Physical-mail photo intake** — the 30-second demo clip no competitor has.
8. **Health auto-import** (HealthKit/Health Connect skills exist) — manual logging churns users in week one.
9. **Gas prices first** in Go & Explore — "cheapest fill-up near you," then proactive price nudges.
10. **Crystal proactive openers + starter chips** — empty chat box converts poorly.

## Recommended sequencing

**Wave 1 (trust):** P0 #1, #2 · P1 #5, #6, #7, #8 (add-child honesty) · P1 #4 (School tab always visible)
**Wave 2 (alive):** P0 #3 (chat verify) · P1 #9, #10 (nudges pipeline) · P1 #14 (Settings port) · P1 #15 (onboarding)
**Wave 3 (complete):** P1 #12, #13 (dead stations) · P1 #11 (env audit) · P2 hygiene batch
**Parallel (needs Meheldi):** 040 migration + Azure Mail.Read consent (unblocks inbox) · `CRYSTAL_WORKER_SECRET` in Pages env + worker redeploy (unblocks chat) · under-13 enforcement behavior sign-off
