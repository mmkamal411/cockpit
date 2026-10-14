# TEAM 1 AUDIT — Shell, Navigation & New-User Experience

**Team:** 3-expert panel (frontend architect · UX flows · auth/app-state), embodied by Team 1 Lead
**Branch audited:** `staging/crystal-robot-improved` @ `5f7e7fa` (the live code)
**Method:** read-only source audit. Every claim below was verified against the actual code via `git show origin/staging/crystal-robot-improved:<path>`. No code was changed.
**Date:** 2026-10-13 ~21:15 EDT

---

## 1. Surface inventory (what exists)

### Toolbars (5 variants, active: `panoramic`)
All five (`toolbar-console/dash/hologlass/legacy/panoramic.tsx`) render the same tab set:
**Home · Today · Crystal · Progress · (+ School, conditional)**. The `More` tab was retired in e13f099.
The School tab renders **iff** `useHasLinkedChildren()` — i.e. `!loading && members.length > 0` (`src/lib/use-crew-roster.ts:69`).
Identical gating logic in all 5 variants. Verified per-file.

### Home stations
`src/lib/station-categories.ts` defines 6 category buttons: **My Day · Family & School · Home & Money · Health & Habits · Go & Explore · Messages & Mail**, each opening a `StationCategoryOverlay` with subcategory buttons that open applets.
Post-5f7e7fa: **no category is gated**. Only two *subcategories* are `childrenOnly`: `school-station` and `sync` (both inside Family & School). The add-child path (Family & School → Family settings → Crew applet) is reachable by every user. Verified via node execution of the actual filter logic against the real data file:
- childless pilot sees: Family settings, Sharing & grants
- pilot with child sees: School station, Family settings, Sharing & grants, Sync

### Applet registry (`applet-content.tsx`)
Every `appletId` referenced in `station-categories.ts` resolves to a registered applet. Registry also contains:
- `settings` → **`SettingsPlaceholderApplet`** ("coming soon" — the real 7-panel Settings lives on branch `phase-d-rebuild`, never merged)
- `more` → `MoreApplet` (tab retired; only caller is the dead `school-overview` applet)
- `school-overview` → **zero callers** (dead)
- `data-review`, `station-category`, `class-detail` (live)

### Routes (`src/app/`)
`/` (landing, session-gated) · `/home` (the ship) · `/login` (magic link + Google, plain-English errors) · `/invite/[token]` (handles new users: "New to Cockpit? Signing in creates your free account") · `/admin/*` · `/auth/callback`.
**No `/school`, `/crew`, `/today` routes exist.** The applet bus (`applet-bus.ts:153`) intercepts those *hrefs inside applets* and opens them as overlays — but a typed/pasted/bookmarked `/school` URL hits Next.js's **default 404**. There is **no `not-found.tsx`**.

### Auth gate + new-user provisioning
- `/` and `/home` are session-gated server-side; signed-out users redirect to `/login`. Auth failures degrade to landing/login, never 500 (verified in `page.tsx` and `home/page.tsx`).
- **Pilot-row provisioning has two safety nets:** migration 034's `auth.users` trigger (file exists in `supabase/migrations/`) **and** a fail-loud upsert in `/auth/callback` (`route.ts:44-53`) backed by the `pilots_insert_own` RLS policy (`auth.uid() = id`). A brand-new user gets a pilot row on first sign-in even if 034 was never run. If provisioning fails, the user is bounced to `/login?error=provision` with plain-English copy — never into a silently broken app.
- `getPilotId()` (`src/lib/crew/auth.ts`) uses the auth user ID directly; **no API depends on the pilots row existing**. New-user APIs degrade gracefully.
- **There is NO onboarding.** A brand-new user lands on the identical home as a veteran: vista + glass pane + 6 station buttons, zero guidance, zero "start here."

### Conditional-gate inventory (complete)
| Gate | Location | Effect |
|---|---|---|
| `useHasLinkedChildren()` → School tab | all 5 toolbars | tab hidden for childless users |
| `childrenOnly` (category) | `home-stations.tsx:227` | **no category currently uses it** (footgun remains) |
| `childrenOnly` (subcategory) | `home-stations.tsx:261` | hides `school-station`, `sync` for childless users |
| `members.length === 0` empty states | `school-station.tsx:237`, `sync-data-review.tsx:338` | honest "No school life here yet" + **Add a child** button → crew applet |
| roster fetch failure | `use-crew-roster.ts:38` | catch → `[]` → treated as "no children" (silent) |

---

## 2. Logical check (fairness doctrine: same app for every user)

**PASS — the catch-22 class.** I hunted every `childrenOnly` / `useHasLinkedChildren` / `members.length` gate. The just-fixed bug (Family & School hiding the only add-child path) was the **sole instance** of gating that hid the only path to an action. No other catch-22 exists: every gated surface either has an alternate reachable path or is not the sole path to its action.

**FAIL — School tab violates the doctrine.** The fairness doctrine says: *"ALL users should be able to see the standard modules… if a user has a child, that child menu will simply expand."* The School tab is hidden in all 5 toolbar variants for childless users. This is not a catch-22 (add-child is reachable via the station), but it is a **visible feature difference** between users with and without children — exactly what the doctrine forbids. Notably, the `school-station` applet **already handles the childless case gracefully** ("No school life here yet" + Add a child button), so showing the tab is safe and honest. → **P1**

**FAIL — Settings is a dead promise.** The glass-pane Settings gear is labeled the "primary entry" (`glass-pane.tsx:161`) but opens a placeholder. Meheldi already asked "What happened to User Settings?" — because the gear promises something that doesn't exist. The real implementation sits unmerged on `phase-d-rebuild`. Either merge it or remove the gear; a dead button on the home screen fails the grandmother test. → **P1**

**FAIL — no first-run experience.** A new user gets zero orientation. Nothing says "add a child here," nothing explains the stations. This is the root cause of tonight's incident: Meheldi (an expert user) could not find add-child. A new user has no chance. The app relies entirely on discovery. → **P1**

---

## 3. Functional check

| # | Issue | Severity | Catch-22? | Proposed fix |
|---|---|---|---|---|
| 1 | School tab hidden for childless users in all 5 toolbars (doctrine violation) | **P1** | No (alt path exists) | Render the tab always; childless tap shows the existing empty state + Add a child CTA |
| 2 | Settings gear → placeholder; real Settings unmerged on `phase-d-rebuild` | **P1** | No | Merge the real Settings module, or remove/relabel the gear until it ships |
| 3 | Zero onboarding for new users | **P1** | No | First-run "mission briefing" overlay: 3-step (meet Crystal → tour stations → "add a child or skip, your call") |
| 4 | School tab **flicker**: `useHasLinkedChildren()` returns `false` while `loading`, so users *with* children see the tab pop in after every page load | P2 | No | Render a disabled/skeleton tab while loading instead of hiding |
| 5 | Roster fetch failure → silently treated as "no children": School tab vanishes with no explanation and no retry | P2 | No | Distinguish error from empty; keep the tab, show "couldn't load" state with retry |
| 6 | Dead applets in registry: `more` (retired tab, only reachable from dead `school-overview`), `school-overview` (zero callers) | P2 | No | Remove both, or wire `school-overview` back into the school station |
| 7 | No `not-found.tsx`: typed/pasted `/school`, `/crew`, `/today` URLs hit Next's default 404 | P2 | No | Branded 404 with recovery path (violates NO BLANK PAGES spirit) |
| 8 | Category-level `childrenOnly` field + filter remain in code with zero users — a footgun inviting the next catch-22 | P2 | **Latent** | Delete the category-level field; keep gating at subcategory level only, with a comment |
| 9 | `npm test` on staging references `src/lib/auth/ensure-pilot.test.ts`, which **does not exist** → test script is broken on the live branch | P2 | No | Remove the stale entry or restore the test |

**Verified working (no action):** pilot provisioning (dual safety net), auth callback cookie handling, login error copy, invite `?next=` flow, crew API for fresh pilots (401-when-signed-out, `[]`-when-new), school-station & sync-review empty states, glass-pane weather failure state, applet-link interception, toolbar rendering only `inShip`.

---

## 4. UX improvements (make the shell inevitable + viral)

1. **First-run mission briefing.** One overlay, three beats: "I'm Crystal" → "Your ship has six stations" → "Kids? Add them under Family & School — or skip, everything else works the same." Dismiss forever. This single change would have prevented tonight's incident.
2. **Family & School blurb for childless users.** Currently "Your crew, school logins, and sync." For zero-crew pilots, change the *category* blurb to an invitation: "Flying solo or with crew — add family anytime." The button should *recruit*, not just sit there.
3. **School tab always visible (doctrine).** Tapping it childless shows the existing empty state. When the first child is added, the tab *expands* — same tab, more content. That's the doctrine made visible.
4. **Ship the real Settings or kill the gear.** A dead primary control on the home screen erodes trust faster than a missing feature.
5. **Deep-linkable applets.** Give applets URL-addressable state (`/home?station=family-school`) so users can share "look at this" links — the cheapest viral loop available.
6. **Cross-promoting empty states.** Every empty module should point at one next action (Today → "connect your calendar"; Bills → "add your first bill"). Empty states are onboarding in disguise.

---

## 5. Bottom line

The shell is **structurally sound**: auth, provisioning, routing, and the applet system all degrade gracefully, and the catch-22 bug class has exactly one member (already fixed). The remaining gaps are **doctrine gaps, not crash gaps**: the School tab hides from childless users against the founder's explicit rule, Settings is a dead button, and new users get no orientation whatsoever. Fix issues 1–3 and the shell meets the fairness doctrine; issues 4–9 are hygiene.
