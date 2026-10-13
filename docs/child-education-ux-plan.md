# Child Education UX — Implementation Plan

**Project:** Cockpit · **Date:** 2026-10-13 · **Status:** Ready for Meheldi's decisions, then build
**Strike team:** 4 workstreams (Pookie archaeology · IA redesign · Expert panel · Settings spec)
**Branch:** `feature/child-education-ux`
**Companion docs:** `docs/CHILD-EDUCATION-UX-REDESIGN.md` (WS2 design) · `docs/CHILD-EDUCATION-UX-PANEL-REPORT.md` (WS3 panel) · `docs/SETTINGS-SPEC.md` (settings) · `~/workspace/pookie-archaeology-report.md` (WS1)

---

## 1. Executive summary

**The problem Meheldi named:** a parent checking their child's school taps More → Crew → [child] → Classes — 4 levels deep inside a roster screen. Unacceptable for a daily surface. Plus: the "More" pattern itself buries all 31 modules. Plus: 7 proven Pookie features (quotes, bell schedule, district calendar, check-in, handouts, resources, upload/link) never made it to Cockpit. Plus: no child login exists.

**What this plan delivers:**
1. **Navigation overhaul** — kill the More tab; 6 cockpit-style category buttons on Home (3 left / 3 right); conditional School tab in the toolbar (only when the pilot has linked children); Settings as a gear on the home glass pane.
2. **Parent school surface** — one-tap School station: NOW strip → Today's mission → Classes (gap-sorted) → This week → Attendance → Check-in status → Messages.
3. **Child dashboard + login** — per-age-tier auth (under-13 stewardship / 13–15 claim+consent / 16–17 independence / 18+ continuity); child's Home leads with morning spark → bell strip → check-in → Tonight's ONE action.
4. **7 Pookie features ported** — with exact implementation details from the archaeology.
5. **Settings** — 7 instrument stations, re-themed for the cockpit aesthetic.
6. **Expert-panel hardening** — all 5 must-fix items applied; 3 decisions queued for Meheldi.

**Expert panel verdict:** "Strong, evidence-aligned design — consent architecture, gap-to-90 framing, and daily-surface IA are all correct. Remaining work is conflict resolution and scoping, not redesign."

---

## 2. Key decisions (planner's resolutions)

### 2.1 Navigation: 6 buttons + conditional School tab (reconciled)

The panel resolved the conflict between WS2's design and Meheldi's 6-button mandate:

- **More is dead.** The toolbar becomes: Home · Today · Crystal · [School?] · Progress. Five keys max.
- **Home gets 6 cockpit-style category buttons** (3 left, 3 right), below the glass pane:

| # | Side | Category | Subcategories |
|---|------|----------|---------------|
| 1 | Left | **My Day** | Today's briefing · Calendar · Tasks & to-dos · Nudges · Weather |
| 2 | Left | **Home & Money** | Bills · Subscriptions · Spending · Shopping lists · Properties |
| 3 | Left | **Go & Explore** | Flights · Trips · Gas/EV charging · Vacation deals |
| 4 | Right | **Family & School** *(conditional — only when pilot has linked children)* | School station · Family settings · Sharing & grants · Sync |
| 5 | Right | **Health & Habits** | Health metrics · Steps · Sleep · Meals · Workouts |
| 6 | Right | **Messages & Mail** | Inbox · Teacher comms · Physical-mail intake · Support |

- **School does NOT go through button → subcategory → applet.** School is a daily mission surface — it keeps its **conditional toolbar tab** (one tap). The School tab *is* the school category control, toolbar-rendered. No School home button (two front doors max: tab + glass-pane deep link).
- **Childless pilots see 5 buttons** — zero parenting pixels (user-first invariant holds).
- **Buttons are instruments, not decoration:** the lit state means "has attention items" (2 bills due, 1 missing assignment). Labels + icons always. Stable placement. Delight in the controls, calm content areas.
- **Accessibility:** ≥44pt touch targets, visible text labels, real button semantics, color never the only signal, `prefers-reduced-motion` honored automatically, dimmed states meet 4.5:1.

### 2.2 Panel's 5 must-fix items — applied

1. **Checkbox ownership:** teen owns Path-to-90/mission checkboxes; parent read-only. (Fixes WS2 §8.3 regression; aligns with Pookie's locked role rule + DB trigger.)
2. **6-button reconciliation:** per §2.1 above; consent screen's "change this anytime in More → My sharing" pointer reworded to the new path before ship.
3. **Two-channel check-ins:** shared (parent-visible) + "Just for me" private; student-private learning activity by default; consent screen's NOT-visible list updated.
4. **Class-page component scope:** Tonight's ONE action (child Home), What-If simulator, opportunity bars, manual missing-assignment logger, peer tips (current/weakest units), comeback sparkline, crisis-mode (<75) and steady-state (>90) page variants.
5. **Hard notification rules:** no school nudges 9 PM–7 AM local; check-in nudge ~3:45 PM school days, opt-out; delight in rituals/effort only, never grade outcomes or streaks (weekly-rhythm framing: "4 of 5 days").

### 2.3 What we port vs rebuild (from archaeology)

**Port directly (proven, Meheldi-approved):**
- Grade header: `80.2 | B` — numeric + letter, same size, separated by a line
- Gap-to-90 framing + exact copy strings ("X.X points to your goal")
- `buildPathActions` deterministic math (zeros → missing → study levers by opportunity; top-3; `+X.X pts` pills; skip categories with no graded data)
- Amber ramp, never red (hard design token)
- Assignment grouping: Missing (zeros first) → Upcoming → Past (collapsed), inline in class page, never a third route
- What-If simulator + GPA simulator + per-category opportunity bars + comeback sparkline
- Manual missing-assignment logger
- Tonight's ONE action picker
- 98% Playbook peer tips under Path-to-90, filtered to current/weakest units
- Teacher inbox + weekly student-voiced email draft + approval flow (draft → "Approve exact text" → "Send now") + quiet-hour holds (10 PM–6 AM → 6 AM) + send window 6 AM–10 PM
- Comms voice rules: gratitude-first, first-person, short sentences, no em dashes/colons, specific numbers, never ask when ungraded work will be graded
- Dawson's Word panel (child's last 3 check-ins per class)
- Check-in: 3-question chip version (what worked on / what's confusing / what's due next); text optional; confetti; NO energy slider (Meheldi killed it)
- Check-in → guidance wiring (`extractTopicsFromCheckin` → "You flagged this" tags on Path-to-90)
- UploadZone pattern (drag-drop, byte-level progress, retry, 10MB caps)
- Resource visual identities (13 types, each with color+icon+glow)
- "Your words above · your files below" divider (Meheldi's distinction)
- Fun facts + 30 quotes (Meheldi wrote them; port as-is, zero infra)
- Bell schedule + district calendar as collapsed reference (district-keyed, not Cobb-only)
- "Flight-Deck View" (child) vs "Command View" (parent) language
- Cool-down copy: "Grades refresh with each sync — one grade is a snapshot, not a verdict"

**Keep from Pookie rebuild:** role gating (teen-owned check-ins/checkboxes, DB-trigger enforced), counselor-mail segregation (ASCA B.2), provenance labels, deterministic forecast engine with `inputs_hash` + citations, freshness strip, never-blank fallbacks.

**Do NOT rebuild:** generic advice ("Push Tests Higher"), energy slider, red for low grades, light-on-white, data dumps (cap top-3), localStorage-only persistence.

---

## 3. Parent school surface (one tap)

**Entry:** Toolbar School tab (conditional) → School station applet. Secondary: Home glass-pane "School this morning" module → deep link.

**Section order (parent):**
1. **NOW strip** — bell-schedule aware: "3rd period · Geometry · ends 10:42" (from `school_schedules`)
2. **Today's mission** — top 5 across classes, missing first, ranked by grade-point impact (ports `buildPathActions` cross-class)
3. **Classes grid** — sorted by gap-to-90 (triage sort, parent-only); each card: `80.2 | B`, gap bar, missing count
4. **This week** — 7-day due scan + district calendar events (from `district_calendars`)
5. **Attendance card** — absences/tardies, excused status (leading indicator)
6. **Check-in status** — "Dawson checked in 4 of 5 days this week" (rhythm framing, not streaks)
7. **School messages** — teacher inbox threads + drafted weekly email awaiting approval

**Tap a class → ClassDetail** (existing `class-detail.tsx`, extended):
- Header: name, teacher · period · room, `80.2 | B`, gap-to-90 bar
- **Crisis mode (<75):** recovery-plan hero (fastest lever + teacher conversation + one study action); rest collapsed
- **Steady state (>90):** compact "Holding the 90 line" state; sections collapsed
- **Middle band:** full page — comeback sparkline → This Week strip → Path-to-90 top-3 (teen-owned checkboxes, parent read-only) → peer tips → Tonight's ONE action → assignments by impact → opportunity bars → subskill diagnosis → What-If → GPA sim → Explain It Back → Study Materials → My Resources → check-in → words/files divider → private notes → uploads → Dawson's Word → student email draft → Teacher Inbox → curated resources → syllabus

---

## 4. Child dashboard + login

### 4.1 Child Home (13+ own pilot account)

1. **Morning spark** — fun fact + quote of the day (delight before grades; bundled content, no live LLM)
2. **Bell strip** — "2nd period · Lit & Comp · ends 9:35"
3. **Check-in hero** — prominent 30-second check-in (4 plain words + optional note + "Just for me" private field)
4. **Tonight's ONE action** — single focus action (not a 5-item list)
5. Classes sorted by **today's relevance** (not gap) → School tab for the full grid

### 4.2 How the child logs in (per age tier)

| Tier | Model | Flow |
|------|-------|------|
| **Under 13** | No account (COPPA) | Parent stewardship only. "Invite" button gated with plain-English why: "Accounts start at 13 — for now, you manage everything." |
| **13–15** | Claim + consent | Parent generates 6-digit link code (15-min expiry) → child signs up (email + code) → **explicit consent screen** naming exactly what's visible ("They WILL see: grades, attendance, shared check-ins" / "They will NOT see: your Crystal chats, 'just for me' notes, which resources you open") → 7-day cooling-off on parent revoke |
| **16–17** | Independence | Instant reversible revoke; Sharing screen ("You're in charge of who sees your school life"); "Parent A can't veto Parent B's child-granted access" shown in plain English |
| **18+** | Adult continuity | One prompt: "You're an adult — you're in control." Keep history, add/remove parents anytime |

**Schema readiness:** `link_codes`, `crew_access_grants.granted_by`, `path_to_90_checks.checked_by` already exist. **New:** age-tier enforcement in code (currently comments only), Sharing screen (required v1 — the consent screen promises "change this anytime"), claim/redeem + consent screens with the login-aesthetic redesign.

---

## 5. The 7 Pookie features — implementation details

| # | Feature | Pookie implementation | Cockpit plan |
|---|---------|----------------------|--------------|
| 1 | **Fun facts + daily quote** | Curated arrays (`trivia.ts` ~14 facts; `quotes.ts` = 30 quotes Meheldi wrote); seeded RNG, same quote per calendar day; `DidYouKnow` card on school overview | Port as-is. New table not needed — ship as curated constants; `morning_spark` picker in the child Home + parent glass pane |
| 2 | **Bell schedule** | Hardcoded `bell-schedules.ts` (WALTON_DAILY + WALTON_WEB from cobbk12.org); collapsed Reference section, Daily/WEB tabs + source link | New `school_schedules` table (district-keyed, not Cobb-only); NOW strip reads current period; full schedule in School station reference |
| 3 | **District calendar** | Hardcoded `COBB_EVENTS` (categorized, color-coded); month grid collapsed; API prefers `school_calendar` table, falls back to curated | New `district_calendars` table (district-keyed); "This week" section + nudge suppression on no-school days |
| 4 | **Daily check-in** | 3 questions + quick-tap chips; streak + confetti; stored per-class (`studied`, `minutes`, `note`); text → guidance via keyword extraction | New `checkins` table (Supabase, never localStorage); two channels (shared + "Just for me"); ~3:45 PM nudge; rhythm framing |
| 5 | **Handout uploads** | Supabase buckets `class-handouts`/`class-files` at `<uid>/<slug>/<date>/<file>`; auto-tagged to class + current unit; signed URLs; 10MB/5-per-session caps; neon UploadZone | Same pattern; Files tab on class page; parent uploads visible, child uploads private-by-default |
| 6 | **Resources page** | 13 types (Khan/YouTube/Quizlet/Kahoot/Blooket/Desmos/DeltaMath/AP Classroom/Clever/ebook/cheat sheet/game), each with color+icon+glow; unit-tagged; seeded "Pookie Picks" + user CRUD; collapsible TopicSections | New `class_resources` table; Links tab on class page; **usage loop** ("used it / helpful" taps feed Path-to-90, sink stale); v1 user-added → v2 Crystal-curated (2–3/type/week, matched to current unit topic) |
| 7 | **Upload vs URL** | Type picker at add-time: handouts = file upload; ebooks/cheat sheets = either (URL-validated link or drag-drop upload); Khan/YouTube/games = URL only; deleting a resource removes its stored file | Same picker UX; explicit per-type input |

---

## 6. Settings — 7 instrument stations

Full spec in `docs/SETTINGS-SPEC.md`. Summary:

1. **Your profile** — name, email (read-only), photo, timezone, coarse home location, °F/°C
2. **Connections** — Google/Outlook calendars, Gmail, per-child school portals (re-auth, never raw passwords), health, bank, shopping, travel; "last synced Xh ago" per row
3. **Alerts** — per-domain categories, grade-drop threshold (default 90), due-soon, daily reminder, quiet hours (10 PM–7 AM), urgent breakthrough (off), sensitivity slider
4. **Crystal (AI)** — Crystal/Fireball mode, proactive-help level (Off/Gentle/Eager), learn-from-corrections consent
5. **Your cockpit (ship)** — home station reorder (→ `cockpit_layouts`, fills the layer-2 gap), hero widgets, neon accent, reduce motion, celebrations, orb behavior (Calm/Lively)
6. **Family & sharing** — crew rows, per-child school logins, who-can-see-what + audit history, second-parent invites, go-independent graduation
7. **Privacy & data** — retention, download my data, cookies, sign out, DangerZone delete (type-to-confirm, 30-day grace)

**Placement:** primary = persistent gear + "Settings" on the home hero glass pane; secondary = pilot avatar menu. Not a toolbar key, not inside any category button. Every setting gets a plain-English "what this does" line; honest "not connected yet" / "still being built" states — never blank.

---

## 7. Phased implementation plan

### Phase A — Navigation foundation (week 1)
**Goal:** Kill More; 6 buttons on Home; conditional School tab; Settings entry.

| Task | Files | Notes |
|------|-------|-------|
| Remove More tab; add conditional School tab | `src/components/toolbar-console.tsx` (+ dash/hologlass/legacy variants) | School tab renders iff pilot has ≥1 linked `crew_members`; query on mount |
| Build `HomeStations` 6-button grid | New `src/components/home-stations.tsx` | 3-left/3-right; cockpit-button aesthetic; lit = has attention items; below glass pane; childless → 5 buttons |
| Category → subcategory → applet flow | Extend `src/lib/applet-bus.ts` | Subcategory as intermediate overlay; deep links preserved (glass pane → School, Today → class pages) |
| School station applet (parent) | New `src/components/applets/school-station.tsx` | NOW strip → mission → classes → week → attendance → check-in → messages; reuses existing `SchoolOverviewApplet` content |
| Settings gear on glass pane | `src/components/glass-pane.tsx` | Gear + "Settings" top-right; avatar menu secondary |
| Consent-screen pointer rewrite | Consent copy | "Change this anytime in Family & School → My sharing" (More is dead) |
| Migrations | `02x_school_station_prefs.sql` | `cockpit_layouts` writes for station order (fills layer-2 gap) |

### Phase B — Class pages + Pookie ports (week 2)
**Goal:** Crisis/steady class variants; proven components; 7 features.

| Task | Files | Notes |
|------|-------|-------|
| Crisis-mode (<75) + steady-state (>90) variants | `src/components/applets/class-detail.tsx` | Recovery-plan hero; collapse logic by band |
| Port `buildPathActions` verbatim | New `src/lib/path-to-90.ts` | Deterministic math; LLM writes words only; teen-owned checkboxes (fix ownership) |
| What-If + opportunity bars + sparkline + missing logger + peer tips + ONE action | `class-detail.tsx` sections | Scope per panel C9; peer tips filtered to current/weakest units |
| Teacher card: office-hours lead | `class-detail.tsx` | "What to ask" from subskill diagnosis; email draft secondary |
| Tables: `school_schedules`, `district_calendars`, `checkins`, `class_resources` | `02x_*.sql` | RLS mirrors existing patterns; district-keyed |
| Morning spark (facts + quotes) | New `src/lib/morning-spark.ts` + constants | Port `trivia.ts`/`quotes.ts` as-is |
| Check-in flow (two-channel) | New `src/components/checkin-flow.tsx` | 3 questions + chips; shared + "Just for me"; ~3:45 PM nudge |
| Uploads (UploadZone) + resources (Links tab) | `class-detail.tsx` tabs | Supabase buckets; usage loop taps; upload-vs-URL picker |
| Dawson's Word panel | `class-detail.tsx` | Last 3 check-ins per class |

### Phase C — Child login + consent (week 3)
**Goal:** Per-tier auth; Sharing screen; consent architecture.

| Task | Files | Notes |
|------|-------|-------|
| Link-code claim flow | `src/app/invite/[token]/page.tsx` (extend) | 6-digit code → signup → consent screen |
| Consent screen (explicit visibility lists) | New `src/components/consent-screen.tsx` | WILL see / will NOT see; login-aesthetic redesign |
| Sharing screen (16–17, required v1) | New settings section | "You're in charge"; Parent A/B veto visibility |
| Age-tier enforcement | Auth middleware + RLS | Under-13 gate; 13–15 cooling-off; birthdate mismatch logging |
| Child Home | `src/app/home/page.tsx` (pilot-type aware) | Morning spark → bell strip → check-in hero → ONE action |
| Teen-owned checkboxes (DB trigger) | Migration | Port Pookie's `study_plans_guard_teen_checkboxes` pattern |

### Phase D — Settings build (week 4)
**Goal:** 7 instrument stations.

| Task | Files | Notes |
|------|-------|-------|
| Settings applet shell | New `src/components/applets/settings-applet.tsx` | 7 stations; search; honest states |
| Stations 1–7 | Section components | Per SETTINGS-SPEC.md; `pilot_settings` JSONB table |
| Crystal preferences | `crystal_preferences` namespace | Mode, proactive level, learning consent |
| Family & sharing | Settings station 6 | Crew rows, grants, audit, invites, go-independent |

### Phase E — Polish + verification (week 5)
- Notification rules hardening (9 PM–7 AM blackout; 3:45 PM check-in nudge)
- Reduced-motion audit; 44pt targets; contrast audit
- Browser-verify every surface per Meheldi's TEST BEFORE YOU CLAIM rule
- Staging deploy + smoke test

---

## 8. Decisions needed from Meheldi

**D1 — Check-in default:** shared-by-default with private opt-in (counselor: early struggle visibility) vs private-by-default with share opt-in (psychologist: honesty first)? *Private channel exists either way.*

**D2 — Crystal for 13–17:** hold the unfiltered lock, or add the panel's youth safety layer (self-harm / eating-disorder / sexual-content-with-minors / abuse-disclosure floor + 988 routing — framed as duty-of-care, not a filter)? *Panel flags unfiltered-for-13–17 without this floor as the one genuine safety risk.*

**D3 — 13–15 check-in scope:** full check-in text visible to parent, or summary-level ("checked in 4/5 days + themes") until 16+?

**D4 — School tab trigger:** on crew-member add (recommended) vs after first successful sync?

**D5 — Claim v1:** link-code only, email-claim path deferred to v2 — OK?

Also endorsed by the panel (no objection): bell-schedule seeding, resource curation v1/v2 cadence, morning-spark reviewer, multi-child default.

---

## 9. Constraints honored

- **User-first, not parent-first:** childless pilots see zero parenting pixels (5 buttons, no School tab).
- **Shame-free, gap-to-90:** mission framing everywhere; amber never red; cool-down copy on grade displays.
- **Plain-English:** grandmother test on every label; scrub "applet/station/crew" from user copy.
- **No blank pages:** every empty/error/revoked state has copy + one next action.
- **Dark cockpit theme:** black panels, subtle neon; content areas calm behind delightful controls.
- **Child is the access authority:** `granted_by` enforced; no parent veto of child grants.
- **TEST BEFORE YOU CLAIM:** browser-verify every surface before announcing.

---

*Plan synthesized 2026-10-13 from 4 workstreams. Awaiting Meheldi's decisions (D1–D5) before build begins.*
