# Team 3 Audit — HOME & MONEY Station (team3-home-money)

**Team:** 3-expert panel (frontend · backend/API · UX), embodied by Team 3 Lead
**Date:** 2026-10-13 ~21:15 EDT
**Scope:** `home-money` station on `origin/staging/crystal-robot-improved` (the live branch). All file reads below are the staging versions (`git show origin/staging/crystal-robot-improved:<path>`), not the local working tree, which is stale for this surface.
**Method:** read-only. No code changed, nothing committed, nothing deployed.

**Verdict up front:** this is the healthiest surface in the app. Zero P0s, zero P1s. No catch-22-class bugs. The fairness doctrine PASSES here — every module reveals itself to every user, child or not. Findings are P2 polish items plus UX upgrades.

---

## 0. Station-level logical check

`src/lib/station-categories.ts` — the `home-money` category has **no `childrenOnly` gate**. It renders for every pilot in `HomeStations` unconditionally (filter at `home-stations.tsx:227` only hides categories that opt into `childrenOnly`; home-money doesn't). All five entries are visible to a brand-new user with zero data and zero children:

| Entry | appletId | New-user experience |
|---|---|---|
| Bills | `bills` → BillsApplet (registered in applet-content.tsx) | Full module |
| Subscriptions | `subscriptions` → SubscriptionsApplet (registered) | Full module |
| Spending | `null` → honest "coming soon" panel with `soonNote` | Placeholder, not a dead end |
| Shopping lists | `shopping` → ShoppingApplet (registered) | Full module |
| Properties | `null` → honest "coming soon" panel with `soonNote` | Placeholder, not a dead end |

The `null`-applet path is handled by `StationCategoryOverlay`: tapping shows the label, the plain-English `soonNote`, and a "Back to Home & Money" button. Never blank, never a dead end. Grandmother-test compliant.

**API layer:** every route under `/api/bills/*`, `/api/subscriptions/*`, `/api/shopping/*` is scoped by `pilot_id = auth.uid()` (via `pilotRoute` or `requirePilot`). Zero references to crew/children in any handler. A pilot with no `pilots` table row (migration 034 status) still works — auth is by `auth.uid()`, not by row lookup. **No unfair gating at any layer.**

---

## 1. Bills

### Logical check — PASS
Reachable: Home → Home & Money → Bills. No gating of any kind. Reveals itself to new users immediately.

### Functional check — PASS
- **Loading:** "Checking what's due…" — real UI, not blank.
- **Error:** inline banner with the error + "Try again" button wired to `refresh()`.
- **Empty:** "No bills tracked yet." + what the module will do for them + "Add your first bill" CTA that jumps to the add view.
- **CRUD:** POST /api/bills, PUT/DELETE /api/bills/[id], mark-paid, snooze — all wired, all with `busyId` disabled states, all with plain-English errors ("Give the bill a name.", "Couldn't mark that paid.").
- **Views:** Bills list (Overdue / Due this week / Upcoming / Paid this month, each with its own empty line), Month view with month navigation, Add bill form.
- **Scan a bill:** on-device Tesseract.js OCR — the photo is never uploaded (in-memory object URL, revoked after the pass). Pre-scan consent dialog with focus trap, Esc = "Not now", camera-denied fallback ("pick a photo instead — or type it in"), failure fallback ("type it in below"). OCR fills only empty fields, never overwrites typing. This is privacy-correct and well handled.
- **Detected tray ("Found in your email"):** only renders when `drafts.length > 0`; the email parser is deferred, so the tray is invisible — not a dead end, not a broken promise.
- **Hygiene:** no TODOs, no console.logs, no dead buttons. `tsc`-clean logic in `src/lib/bills/logic.ts` (effectiveStatus, grouping, next-occurrence derivation for monthly/quarterly/annual cadences).

### Issues
None at P0/P1.

### UX improvements (what would make it habit-forming)
1. **Recurring auto-rollover:** marking a monthly bill paid should offer/auto-create next month's occurrence (the `cadence` + `nextOccurrence` math already exists in `logic.ts`). Today the user re-adds it by hand — that's the #1 friction.
2. **Station-button attention figure:** surface "due in 7 days: $X" on the Home & Money button so the module pulls the user in instead of waiting to be opened.
3. **Bill total forecasting:** "you owe $1,240 before the 1st" — one calm number, the reason to open the app on payday.

---

## 2. Subscriptions

### Logical check — PASS
No gating. Reachable by every user. Registered applet, working route.

### Functional check — PASS
- **Loading:** "Tallying your subscriptions…". **Error:** inline + "Try again". **Empty:** "No subscriptions tracked yet." + value prop ("what they cost — per month and per year") + "Add your first" CTA.
- **CRUD + lifecycle:** add, edit, remove (with confirm), **pause / resume / cancel** — all wired to `/api/subscriptions/[id]` with plain-English validation ("Pick monthly, quarterly, or annual for how often it renews.").
- **Totals:** monthly + annual totals computed over active subscriptions only; header shows "$X per year · N active".
- **Validation:** mirrored client/server, grandmother-test clean.

### Issues
None at P0/P1.

### UX improvements (the viral hooks for this module)
1. **Trial-ending alerts:** "Your free trial ends in 3 days" is the single highest-value notification a subscription tracker can send. Doesn't exist yet — build it.
2. **Paused-but-paying nudge:** "You're paying $14.99/mo for 2 paused subscriptions" — found money, shareable win.
3. **Annual-prepay math:** "Paying yearly would save you $36" next to monthly subs — the kind of line people screenshot.

---

## 3. Spending

### Logical check — PASS (honest placeholder)
Visible to all users; tapping shows the coming-soon panel with a plain-English note. Not hidden, not a dead end, not gated.

### Functional check — N/A (not built)

### Issues
- **P2:** Two of the five Home & Money entries (Spending, Properties) are placeholders — the station reads as 40% unfinished. Acceptable for now (honest > fake), but it's the thinnest station once a user taps through.

### UX improvements (when built)
1. Build it on data that already exists: `purchase_history` (already collected for shopping suggestions) + `bills`. "Where did it go" weekly digest — no new data entry required.
2. Make it the payoff for the other two modules: Bills says what you *will* pay, Spending says what you *did* pay. One sentence each, side by side.

---

## 4. Shopping lists

### Logical check — PASS
No gating. The strongest new-user onboarding on this surface: first open **seeds three starter lists** (Groceries 🛒, Household 🧹, Pharmacy 💊) via POST, so a brand-new pilot never sees an empty module. If the pilot deletes all lists, re-seeding is correctly suppressed (`skippedSeed`).

### Functional check — PASS (most complete module audited)
- **Lists:** create (name + icon picker), rename, delete, archive-filtered, sorted; tab switcher with unchecked-count badges.
- **Items:** add (with qty), check/uncheck, edit (name/qty/unit/notes/recurring), swipe-to-delete on touch + delete button + **undo toast** ("Couldn't bring that item back" recovery path exists).
- **Autocomplete:** pilot's own `purchase_history` first ("Crystal notices what you buy often"), then built-in catalog — via `/api/shopping/suggestions`.
- **In-store mode:** enlarges rows/targets for one-handed use. Genuinely thoughtful.
- **Voice dictation:** Web Speech API, **hidden entirely where unsupported** (correct — no dead mic button on iOS Safari gaps).
- **Sharing:** view/edit permissions, email invites (10/day rate limit, SHA-256 hashed tokens), share management UI, deep-link from invite (`?list=`), "🎉 X shared … with you — welcome!" banner. View-only lists render with a "view" badge and disabled editing (`canEdit`).
- **States:** skeleton tabs while loading, inline errors with retry, item empty state ("Nothing on this list yet. Start with the thing you always forget."), list empty state ("Your lists live here. Add the first thing you need below.").
- **Hygiene:** no TODOs, no console.logs, no dead buttons.

### Issues
- **P2:** Uses `requirePilot` from `@/lib/api-auth` while Bills/Subscriptions use `pilotRoute` from `@/lib/api/pilotRoute`. Both work; the inconsistency is a maintenance smell (two error-format paths, two 401 wordings).

### UX improvements (viral loop lives here)
1. **Shared list = acquisition loop:** "Share a list" already invites by email — when the invitee signs up, that's a new user. Make the invite landing page sing; this is the app's natural viral mechanic.
2. **"Usuals" one-tap re-add:** purchase_history knows what they buy weekly — a "add your usuals" row turns a 20-tap grocery run into 3 taps.
3. **Store-aisle grouping:** group unchecked items by aisle/category for the in-store mode — the difference between a list app and a shopping companion.

---

## 5. Properties

### Logical check — PASS (honest placeholder)
Same pattern as Spending — visible, honest coming-soon panel, not a dead end.

### Functional check — N/A (not built)

### Issues
- **P2:** Same "40% placeholder" note as Spending.

### UX improvements (when built — this one matters personally)
The founder is a real-estate investor managing multiple properties. This module should be *his* module:
1. **Rent roll:** expected vs received per property per month.
2. **Bill linkage:** assign bills to properties ("which place is leaking money").
3. **Pulse view:** the blurb already promises "Your places and their pulse" — deliver it as one calm card per property: occupancy, rent status, open maintenance.

---

## 6. Cross-cutting findings

| # | Severity | Finding | Proposed fix | Catch-22 class? |
|---|---|---|---|---|
| 1 | P2 | **Stale layout comment** in `home-stations.tsx` (~line 222): the comment describes button arrangement "left = My Day · Home & Money · Go & Explore…" but `DISPLAY_ORDER` is `[my-day, family-school, home-money, …]` — the comment doesn't match the code. Cosmetic, but it's the kind of rot that confuses the next team. | Update the comment to match `DISPLAY_ORDER`. | No |
| 2 | P2 | **Two auth wrappers** on one surface: `pilotRoute` (bills, subscriptions) vs `requirePilot` (shopping). Both enforce pilot scoping correctly today. | Standardize on one (recommend `pilotRoute` — it has the better plain-English error taxonomy). | No |
| 3 | P2 | **40% of the station is placeholder** (Spending, Properties). Honest placeholders, correctly implemented — but the station's perceived completeness suffers. | Build Spending first (data already exists); Properties second. | No |

**Explicitly checked and clear:** no `childrenOnly`/child-gating anywhere on this surface (UI or API); no blank-page paths (every applet has loading/error/empty states); every user-facing error passes the grandmother test with a recovery action; no dead buttons; no TODO/console.log rot; no dependency on the `pilots` table row (works regardless of migration 034 status).

---

## 7. Fairness-doctrine verdict (the core principle)

**PASS.** A user with zero children sees the exact same Home & Money station as a user with children: same five entries, same functionality, same API behavior. Nothing hides, nothing silently gates, nothing reveals itself only after some other action. This surface is the model the other teams should match.

## 8. What would make this station habit-forming (UX panel summary)

1. **One calm money number** on the station button ("$1,240 due before the 1st") — the reason to open the app daily.
2. **Trial-ending alerts** in Subscriptions — the highest-value notification in personal finance apps.
3. **Recurring bill auto-rollover** — remove the #1 repetitive chore.
4. **Shared shopping list as the viral loop** — the invite flow already exists; polish the landing.
5. **Build Spending on existing data** — purchase_history + bills = zero-entry spending insight.
6. **Properties for the investor** — rent roll + per-property bill linkage; this is the founder's own use case and the premium-tier anchor later.
