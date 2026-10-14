# Team 4 Audit — Family & School Station
**Date:** 2026-10-13 · **Branch audited:** `staging/crystal-robot-improved` @ `5f7e7fa` (live)
**Panel:** frontend expert · backend/API expert · UX expert (one lead, three lenses)
**Method:** read-only code audit. Every claim below is traced to a file:line. No assumptions.

---

## 1. End-to-end trace: add-a-child as a brand-new user (zero children)

Path: Home → **Family & School** station button → **Family settings** (Crew applet) → 3-step flow.

| Step | What happens | Verdict |
|------|--------------|---------|
| 0. Reachability | Family & School button now renders for childless users (fix `5f7e7fa`: `childrenOnly` removed from the category in `src/lib/station-categories.ts:104-122`; subcategory filter added at `src/components/home-stations.tsx:260-261`). Childless users see **Family settings** + **Sharing & grants**; **School station** + **Sync** stay hidden until a child exists. | ✅ FIXED & VERIFIED in code |
| 1. "Who's joining your crew?" | Name + birthdate fields. `nextFromBasics()` (`crew-applet.tsx:348-359`) validates both with plain-English errors. Back/Continue navigation works. | ✅ Works |
| 2. "School login" | District + calendar link + bell-schedule rows + **student portal username + password**. `nextFromSchool()` (`crew-applet.tsx:361-366`) advances regardless — login is optional. Small print says to use the desktop sync installer. | ⚠️ **P1 — the username/password fields are dead inputs.** `finish()` (`crew-applet.tsx:368-428`) POSTs only `{name, birthdate, relationship:"child"}`. The credentials are collected and silently discarded (code NOTE at line 418 admits it). The heading "School login" + sub-copy "so grades and assignments can sync" is a false promise: a parent types a password believing it syncs grades, and it goes nowhere. |
| 3. "What should Crystal watch?" | Toggles for Grades / Attendance / Assignments / School messages. Defaults: Grades + Assignments. | ⚠️ **P1 — choice theater.** The `sync` state (`crew-applet.tsx:197`) is never sent to the server and never persisted. It's used only to compose the confirmation sentence. The user's careful choices have zero effect. |
| Submit | `POST /api/crew/members` → 201 → confirmation screen: "[Name] is aboard", link-check results for calendar/bell URLs, roster, "Add another crew member". | ✅ Works, honest copy |
| After add | **School tab does NOT appear.** The toolbar's `useHasLinkedChildren()` reads the module-level `inflight` cache in `src/lib/use-crew-roster.ts:20-38`, which resolved to `[]` on page load and is **never invalidated**. The Crew applet keeps its own separate roster state. Result: the user must **reload the page** before the School tab and the gated subcategories appear. | 🔴 **P0 — breaks the founder's "child menu simply expands" promise.** The code comment at `use-crew-roster.ts:57-60` explicitly states the intent: "on child add, not after first sync". The implementation defeats the intent. |

### Edge cases traced
- **Bad input (empty name / missing birthdate):** blocked client-side with plain-English errors; server re-validates (`src/app/api/crew/members/route.ts:100-122`). ✅
- **Absurd birthdate (future date, year 3026):** `new Date("3026-01-01")` parses fine — **accepted with no sanity check.** A typo'd year creates a child born next millennium. ⚠️ P1.
- **API failure mid-add:** `finish()` catch sets "Couldn't add them right now. Try again." ✅ Grandmother-test pass.
- **Roster load failure:** `loadError` banner, "Couldn't load your crew right now. Try reopening this panel." ✅ No blank page.
- **Expired link codes:** n/a — redemption doesn't exist (see P0 #2).
- **Missing school credentials:** flow completes fine; member shows "Not connected yet". ✅ Correct per design (installer handles creds later).

---

## 2. LOGICAL check — fairness doctrine (all standard modules visible to all users)

| Module / surface | Visible to childless user? | Correct? |
|------------------|---------------------------|----------|
| Family & School station button (Home) | ✅ Yes (post-`5f7e7fa`) | ✅ |
| Family settings → add-child flow | ✅ Yes | ✅ |
| Sharing & grants (coming-soon panel) | ✅ Yes | ✅ (honest placeholder) |
| School toolbar tab (all 5 variants) | ❌ Hidden until ≥1 child | ✅ **Correct** — this is a *child menu*, and per the doctrine child menus *expand* when a child exists. Hiding it is the doctrine working as intended. |
| School station + Sync subcategories | ❌ Hidden until ≥1 child | ✅ **Correct** — same reason. |
| **But:** after adding the first child, none of the above appear without a page reload | — | 🔴 **P0** — the expand-on-add promise is broken by the stale roster cache. |

**Remaining unfair gating: none found.** `childrenOnly` now exists only at `home-stations.tsx:227` (categories) and `:261` (subcategories), both correctly scoped. The `5f7e7fa` fix is **correct and complete** for the gating logic — the only hole is the cache invalidation that prevents the *expansion* from being visible.

---

## 3. FUNCTIONAL check per module

### Crew applet (`src/components/applets/crew-applet.tsx`, 2921 lines)
- ✅ Add flow (steps 1–3 + confirmation) works end-to-end.
- ✅ Roster list with per-member sync status dots; tap-through to member detail.
- ✅ Remove member: two-tap confirm, never one stray tap (`removeMember`, line ~1338).
- ✅ Re-auth form (update school login) with "we'll test it right now" copy.
- 🔴 **Link-code mint works; redemption is a dead end.** `POST /api/crew/members/[id]/link-code` mints a 6-digit code (15-min expiry, single-use, steward-only — the crypto and invalidation logic is correct). The UI says *"The other person enters this code to link [name]'s profile"* (`crew-applet.tsx:2336`). **There is nowhere to enter it.** No claim API route, no claim UI, no `redeem_link_code` caller in `src/`. Migration `036_link_code_redemption.sql` (DB half) was written but the app half was never built. A parent mints a code, hands it to the other parent, and the other parent hits a wall.
- ⚠️ **Relationship hardcoded to `"child"`** (`crew-applet.tsx:373`; API defaults to `"child"` at `route.ts:130`). No relationship picker in step 1. Adding a spouse, a parent, or a roommate records them as "child". This violates the founder's own user-first / never-assume-parenthood principle, and it poisons downstream logic (School tab, age tiers) that keys off "child".
- ⚠️ **No under-13 enforcement anywhere.** The founder's age-tier rule (under-13 = parent stewardship, no child login) has zero code behind it. No age check in the API, no gate in the UI, no migration enforcing it. A 5-year-old and a 17-year-old are treated identically.

### School station applet (`src/components/applets/school-station.tsx`)
- ✅ Defensive empty state with an "Add a child" button → opens the Crew applet. Never blanks.
- ✅ Multi-child picker; gap-to-90 mission framing; honest "Syncing…" cards.
- ⚠️ **5 of 7 sections are placeholders** (Right now, This week, Attendance, Check-in, Messages). Honest, but the station is mostly skeleton. For a parent who just added a child and reloaded, the payoff is thin — mostly "syncing…" cards. (P2; expected for the build stage, but the *first impression after add-child* deserves priority.)

### Class detail pages (`src/components/applets/class-detail.tsx`)
- ✅ Error states present ("Couldn't open this class right now", checkbox save errors). Spot-checked; no blank-page risk observed.

### School-source intake (`src/components/applets/school-source-intake.tsx`)
- ✅ Calendar/bell URL verification with per-link check rows, retry, and file-upload fallback. The intake runs post-add and failures never block the add. Solid.

### API routes (`src/app/api/crew/`)
- ✅ `GET/POST /api/crew/members` — auth-gated, RLS-scoped, plain-English errors, structured server logging.
- ✅ `GET/DELETE /api/crew/members/[id]` — 404s cleanly on a stranger's UUID.
- ✅ `POST /api/crew/members/[id]/link-code` — correct mint logic.
- 🔴 **Missing:** `POST /api/crew/link-codes/claim` (or equivalent) — the redemption half.

---

## 4. Issues — severity, fix

| # | Severity | Issue | Proposed fix |
|---|----------|-------|--------------|
| 1 | 🔴 **P0** | **School tab + gated subcategories don't appear after adding first child without a page reload.** `useCrewRoster`'s module-level `inflight` cache is never invalidated; the Crew applet's roster state is separate. | Add a cache-busting export to `use-crew-roster.ts` (e.g. `invalidateCrewRoster()`) and call it in the Crew applet's `finish()` after a successful add (and in `removeMember` after delete). One line at the call site; ~10 lines in the hook. Re-verify: add child → School tab appears with no reload. |
| 2 | 🔴 **P0** | **Link-code redemption doesn't exist.** UI promises "the other person enters this code"; there is no input, no claim route. The 036 migration's app half was never built. | Build `POST /api/crew/link-codes/claim` calling `redeem_link_code()`, plus a claim panel in the Crew applet ("Enter a link code"). Confirm 036 is applied. Until then, either finish it or remove the "Share a link code" button — a promised feature that dead-ends is worse than a missing one. |
| 3 | 🟡 **P1** | **Step-2 username/password are dead inputs.** Collected, never sent; heading promises sync. | Remove the username/password fields from step 2. Replace with a clear installer CTA card ("Connect school logins securely → get the desktop installer"). Never ask for a password you're going to discard — it trains users to distrust the app's security promises. |
| 4 | 🟡 **P1** | **Step-3 sync preferences are never persisted** (choice theater). | Persist to `crew_members` (new `sync_preferences` jsonb) or `crew_school_links` on add; surface them in member detail as editable toggles. If not persisting yet, remove the step — don't ask questions you ignore. |
| 5 | 🟡 **P1** | **No birthdate sanity bounds.** Future/absurd dates accepted. | Clamp: not in the future, not more than ~25 years past (configurable per relationship). Plain-English error: "That birthdate doesn't look right — check the year." |
| 6 | 🟡 **P1** | **Relationship hardcoded to "child"** — no picker; violates never-assume-parenthood. | Add a relationship picker to step 1 (Child / Spouse / Parent / Other). Default: ask, don't assume. Gate school-specific logic on `relationship === "child"` explicitly. |
| 7 | 🟠 **P2** | **No under-13 enforcement.** Founder rule exists only in docs. | Decide the enforcement point (API insert check + UI notice: "Under 13 — you'll manage this profile; they won't sign in separately"). Implement in `POST /api/crew/members` + step-1 helper text. Needs founder sign-off on exact behavior. |
| 8 | 🟠 **P2** | **School station is 5/7 placeholder** — thin payoff right after add-child. | Prioritize the first-sync experience: when a child is added, the confirmation screen should set the expectation ("School station lights up after the first sync — usually within X") and the station's "syncing…" cards should link to the Sync/connection status. |

---

## 5. UX — how adding a child should FEEL

The current flow is *competent* (plain-English errors, no blanks, honest placeholders) but *transactional*. Adding a child is the moment a parent decides whether to trust this app with their family. Right now the emotional arc is: form → form → toggles → "is aboard" → …nothing visibly changes (P0 #1 makes this literal).

**Proposed arc:**

1. **Before:** The Family & School button should carry a quiet invitation for childless users, not just availability. One line under the button or in the overlay: *"Add your first child — school life appears here."* The current overlay lists "Family settings" (jargon-adjacent) — rename the entry point to **"Add a child"** for the zero-child state. "Family settings" means nothing to a new user; "Add a child" is the job they came to do.
2. **During:** Step 2 needs truthfulness surgery (P1 #3). The single most trust-destroying thing in this flow is typing a password into a field that does nothing. Either connect it or remove it — today.
3. **The moment:** After "is aboard", **the app should visibly change around the user.** Fix P0 #1, then add a 3-second beat: the School tab slides into the toolbar, the Family & School overlay gains the School station entry, and a single line says *"School station is ready — it'll fill in after the first sync."* That visible expansion is the product keeping its promise in real time. It's also the viral moment: the app *grew* because of something the user did.
4. **After:** The confirmation screen should answer the only question the parent has: *"what happens now?"* — not "School sync will pick up grades… once the school connection is switched on" (passive, vague), but: **"Next: connect Dawson's school login (2 min, on your computer) → grades appear here."** with the installer as the primary button. The current screen buries the lede.

**The trust principle:** every field must either *do something* or *not exist*. Dead inputs (password) and dead choices (sync toggles) are not neutral — each one is a small lesson that the app doesn't mean what it says. For a family product, that's fatal.

---

## Appendix — verification notes
- `5f7e7fa` is HEAD of `origin/staging/crystal-robot-improved` (confirmed via `git log`).
- The 5f7e7fa gating fix was re-verified by importing `station-categories.ts` in Node and simulating both pilots: childless → category visible, only `family` + `sharing` subcategories shown; with child → all four shown. Logic correct.
- Dead-input claims verified by tracing state: `username`/`password` (lines 195-196) have setters wired only to inputs; `finish()` (368-428) sends only name/birthdate/relationship. `sync` state (197) is read only in the confirmation copy.
- Stale-cache claim verified: `inflight` (use-crew-roster.ts:20) has no invalidation path; toolbar variants (`toolbar-{console,dash,hologlass,legacy,panoramic}.tsx`) all gate the School tab on `useHasLinkedChildren()`; applet overlays don't remount the toolbar.
- Link-code claim verified: `grep` for redeem/claim across `src/` finds only the shopping-list invite flow; no child-code redemption route or UI exists.
- Read-only: no files modified, nothing committed, nothing pushed, nothing deployed.
