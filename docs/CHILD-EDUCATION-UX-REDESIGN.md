# Child Education UX Redesign — Workstream 2 Design Document

**Project:** Cockpit · **Workstream:** Child Education UX Strike Team, Workstream 2 (Parent/child IA redesign)
**Author:** Workstream 2 subagent · **Date:** 2026-10-13
**Status:** Design only — no code. For expert-panel review (child psychologist, Ivy League counselor, pediatrician, education specialist).

---

## 1. Executive summary

**The problem.** A parent checking their child's school life must tap More → Crew → [child name] → Classes — four levels deep, inside a roster-management screen. School is a daily concern; it deserves a daily surface.

**The proposal.** A conditional **School station** in the toolbar that appears *only* when the pilot has linked children, plus a "School this morning" module in the Home glass pane for parents, plus the first concrete **child login & consent model** per age tier (under-13 stewardship, 13–15 shared agency, 16–17 independence, 18+ adult continuity).

**Non-negotiables honored.** User-first: a pilot with no children never sees a single parenting pixel. Dark cockpit theme. Plain-English copy (grandmother test). No blank pages — every empty/error state has a recovery path. Shame-free, gap-to-90 framing everywhere (mission, not judgment).

**What this reuses.** The existing `SchoolOverviewApplet` content (stats, class grid, weekly priorities, gap-to-90) is good — it just needs a front door. The existing `ClassDetail` (mission header, grade hero, Path-to-90 top-3 with Supabase-persisted checkboxes) is good — it needs the Learn & resources layer. The schema already anticipates child pilots: `link_codes` (6-digit claim codes), `crew_access_grants.granted_by ∈ {crew_member, steward}`, `path_to_90_checks.checked_by ∈ {pilot, crew}`.

---

## 2. Current state (as found, 2026-10-13)

### 2.1 Navigation shell

Toolbar (all pilots, always): **Home | Today · Crystal | Progress · More**

- **Home** — idle space vista + floating glass pane (weather + day). No school content.
- **Today** — read-only daily briefing. Has a "School items" section (due today, overdue, school nudges) — already wired, but its items have no deep links into a school surface.
- **Crystal** — the AI co-pilot.
- **Progress** — growth tracking.
- **More** — module grid. Contains the **Crew** module (add-a-child roster, school-login connect, link codes) and the **School Overview** applet.

Applets open as temporary overlays (minimize + close, no full-page navigation) via the applet bus (`src/lib/applet-bus.ts`). The bus comment explicitly notes there is "no child/crew scoping anywhere in this bus" — child scoping is passed as `params.memberId`, which `SchoolOverviewApplet` already accepts.

### 2.2 The school surface today (4 taps)

```
Toolbar: More
  └─ Crew applet (roster mgmt + "add a child" 3-step form + school-login connect)
       └─ [tap child name] → member detail (sync status + Classes list)
            └─ [tap class] → ClassDetail applet
                 (mission header · grade hero · Path-to-90 top-3 · missing ·
                  upcoming · recently graded · teacher · sync footer)
```

The School Overview applet (`school-overview-applet.tsx`) exists with strong content — quick stats (on track / needs work / missing / coming up), class cards with gap-to-90 progress bars, weekly priorities with checkboxes persisted via the Path-to-90 API — **but nothing links to it from the toolbar, Today, or Home.** It's reachable only from More. That is the core IA failure: the content is built; the front door is missing.

### 2.3 Auth model (as found)

- **Supabase Auth.** Magic-link email OTP + Google OAuth (`src/app/login/page.tsx`, `/auth/callback` with the Cloudflare Workers cookie fix). No passwords.
- **`pilots` table** — one row per signed-in user (id = `auth.users.id`). The pilot is the center of everything.
- **`crew_members`** — opt-in children, keyed by UUID, `pilot_id` = the steward parent. **Children are data rows, not auth users. No child login exists.**
- **`crew_access_grants`** — who may see a child's data; `granted_by ∈ {crew_member, steward}`; only the granter may revoke. The CHILD is the access authority (locked decision).
- **`link_codes`** — 6-digit, 15-minute-expiry, single-use codes the steward pilot generates; the redeemer path exists as an API route.
- **Age tiers live only in comments/memory:** birthdate column comment says "Used for age-tier rules (under 13 / 13-15 / 16-17 / 18+)." No enforcement in code.
- **School data** arrives via sync workers (student login via desktop installer; ParentVUE parent-portal pull) into `crew_grade_syncs`; `checked_by` on `path_to_90_checks` already allows `'crew'` — forward-compatible with child pilots.

---

## 3. Design principles applied

1. **User-first, always.** Cockpit is the pilot's personal assistant. Children are an opt-in module. A childless pilot's toolbar, Home, and Today must be *identical* to today's — zero parenting surface.
2. **Adaptive cockpit.** When children ARE linked, the cockpit reshapes around the pilot's actual life (this is personalization layer 2 — the AI-arranged layout — applied by rule today, learned later). School earns a top-level station *because the pilot's life includes it*, not because the product is parent-centric.
3. **Mission, not judgment.** Every grade surface leads with the gap to 90 ("4.2 points to the goal — here's the path"), never with raw judgment. Copy passes the grandmother test.
4. **Two surfaces, two jobs.** The **parent surface** answers "what does my child need, and how do I help?" The **child surface** answers "what do I do today?" They share data, not layout.
5. **Consent is the architecture.** The child (or their steward, under 13) is the access authority. Every visibility decision flows through `crew_access_grants`; the UI never bypasses it.
6. **No dead ends.** Every state — unsynced, unlinked, revoked, signed-out — gets plain-English copy plus one clear next action.

---

## 4. Proposed IA

### 4.1 Toolbar — conditional School station

```
PILOT WITH NO CHILDREN (unchanged, forever):

  ┌──────┬───────┬─────────┬──────────┬──────┐
  │ Home │ Today │ Crystal │ Progress │ More │
  └──────┴───────┴─────────┴──────────┴──────┘
  Glass pane: weather + day (unchanged)


PILOT WITH ≥1 LINKED CHILD:

  ┌──────┬───────┬─────────┬────────┬──────────┬──────┐
  │ Home │ Today │ Crystal │ School │ Progress │ More │
  └──────┴───────┴─────────┴────────┴──────────┴──────┘
       │                              │
       │  "School this morning"       │  NEW — appears only when
       │  module in glass pane        │  crew_members ≥ 1
```

**Placement rationale.** School sits in the middle group (Today · Crystal · School) — the daily-rhythm cluster — not with Progress (reflective) or More (occasional). Suggested glyph: a graduation-cap / schoolhouse outline in the station readout style (`SKL` is already the School Overview applet's readout; keep it for continuity). The toolbar component switches on a single server-provided flag (`has_crew`), so the childless experience is provably untouched.

**Why a conditional tab, not always-visible:** Meheldi's user-first principle is a product invariant, not a preference. An always-visible School tab tells every childless pilot "this product assumes you have kids" — the exact failure the 2026-10-12 course correction killed. Conditional rendering is the IA expression of "opt-in module that surfaces smartly."

**Why not a Home-widget-only solution:** Home's glass pane is the morning ritual — perfect for a *glance* ("3rd period now · 2 things due today"), but classes, assignments, priorities, resources, and attendance need room to breathe. The pane teases; the station delivers. One tap from the pane's "School this morning" module opens the School station (deep link, not a dead card).

### 4.2 Applet tree (parent pilot)

```
Toolbar: School  ──────────────────────────────────────────────┐
  (conditional tab)                                            │
                                                               ▼
┌─ SCHOOL STATION (applet id: "school") ───────────────────────────────┐
│ 0. Header: [child chips: Dawson | Eli] · sync freshness · Refresh    │
│ 1. NOW strip — bell-schedule context (see §9.2)                      │
│    "You're in 3rd period now · lunch in 25 min" / "No school today   │
│    (Fall break)" / "Sync is 2 days old — numbers may be stale"        │
│ 2. TODAY'S MISSION — top priorities, missing first, ranked (max 5)   │
│    checkboxes persist to Supabase (existing Path-to-90 API)           │
│ 3. CLASSES — grid of class cards (gap-to-90 hero, tap → class page)  │
│ 4. THIS WEEK — district calendar events + due-soon rollup            │
│ 5. ATTENDANCE — absences/tardies this term (or honest empty state)    │
│ 6. CHECK-IN — "Dawson checked in at 4:12 PM ✓" / "No check-in yet —  │
│    nudge sent at 3:45 PM"                                            │
│ 7. SCHOOL MESSAGES — latest teacher/counselor mail (3-line preview)  │
└──────────────────────────────────────────────────────────────────────┘
         │ tap class                        │ tap "Family settings"
         ▼                                  ▼
  ┌─ CLASS PAGE ─────────────┐     ┌─ FAMILY (More → Crew, renamed) ─┐
  │ (applet id: "class",     │     │ roster · school connect ·       │
  │  params: memberId+class)  │     │ link codes ("Invite to          │
  │ 1. Mission header        │     │ Cockpit") · sharing/grants      │
  │ 2. Grade hero            │     │ · sync installer link           │
  │ 3. Path-to-90 top 3      │     └─────────────────────────────────┘
  │ 4. Check-in (per class)  │
  │ 5. Missing · Upcoming ·  │
  │    Recently graded       │
  │ 6. LEARN & RESOURCES     │
  │    [Files | Links] tabs  │
  │ 7. Teacher card          │
  │ 8. Sync footer           │
  └──────────────────────────┘
```

**Tap counts (the acceptance metric):**

| Goal | Today | Proposed |
|---|---|---|
| See all classes + gaps | More → Crew → name → (classes are here) = 3 | School tab = **1** |
| Open one class's assignments | 4 | School → class = **2** |
| See today's priorities | Today briefing (no deep link) or 4 | School tab = **1** |
| Check attendance | 4 (buried) | School tab = **1** |
| Upload a handout to Geometry | impossible | School → Geometry → Learn & resources → Files = **3** |
| See bell schedule / "what period now" | impossible | School tab NOW strip = **1** |

### 4.3 Home glass pane — "School this morning" module (parent pilots only)

The existing pane (weather + day) gains one compact module, below the fold of the glance:

```
┌─ GLASS PANE ──────────────────────────┐
│ 72° · Sunny · Marietta                │  ← existing weather
│ Tuesday — 3 meetings, school pickup   │  ← existing day
│ ───────────────────────────────────── │
│ 🎒 SCHOOL THIS MORNING                │  ← NEW, parents only
│ In 3rd period now · 2 due today       │
│ Geometry needs 4.2 to 90 →            │  ← tap opens School station
└───────────────────────────────────────┘
```

Morning-ritual fit: the pilot sees weather, their day, and their child's school in one glance — then moves on. The module collapses to a single line when there's nothing urgent ("All quiet — no missing work").

### 4.4 Today briefing — keep, deepen links

Today's existing "School items" section stays (it's the right surface for due-today/overdue), but each item deep-links to the School station / class page instead of being plain text. No-school days from the district calendar suppress school nudges automatically ("No point nagging about homework on Fall break").

### 4.5 Crew applet → "Family" (rename + re-scope)

More → **Family** (renamed from Crew — plain English beats nautical jargon for settings):

- Roster: who's linked, sync status dots (existing — keep).
- **School connect**: ParentVUE + student login (existing two-login flow — keep, it's correct).
- **"Invite [name] to Cockpit"**: generates the 6-digit link code (15-min, single-use) — the entry to the child claim flows (§8).
- **Sharing**: who can see [name]'s school life (grants list, scopes, revoke) — read-only for the steward except their own grants.
- **Sync installer** link (desktop worker).

Family is *administration*. School is *daily life*. The current design's core mistake was making the admin screen the daily screen.

---

## 5. Parent school surface — section order and why

The School station opens to the **default child** (first crew member; multi-child pilots get chips at the top — one tab, not per-child tabs, to keep the toolbar calm). Sections in order:

1. **NOW strip.** Context before data. "In 3rd period now" or "Fall break — no school" or "School's out — 2 things due tomorrow." Rationale: a parent opening this at 10:14 AM needs orientation, not a grade table. The strip is driven by the bell schedule + district calendar + clock; if sync is stale, a plain-English note says so ("These numbers are 2 days old").
2. **Today's mission (top 5 priorities).** Missing work first, ranked by grade impact, each with a checkbox (persisted to Supabase via the existing Path-to-90 API). Shame-free: "Missing" not "Overdue/Failing"; the header reads "Today's mission," not "Problems." Rationale: Meheldi's class-page directive — "what do I do next" stays first; a parent's scarcest resource is attention, so the surface triages.
3. **Classes grid.** Existing class cards (numeric + letter side by side, gap-to-90 progress bar, missing/upcoming counts). Tap → class page. Order: biggest gap-to-90 first ("needs the most help" at top), on-track classes after — mission framing in the sort itself.
4. **This week.** District calendar events (no-school days, early dismissal, picture day) + the week's due-soon assignments. Rationale: parents plan around the school calendar; today it's invisible in the app.
5. **Attendance.** Absences/tardies this term, plain-English ("3 absences, 1 tardy — all excused" or "Attendance hasn't synced yet"). Rationale: attendance is an early-warning signal counselors watch; currently it's a sync checkbox with no surface.
6. **Check-in.** "Dawson checked in at 4:12 PM ✓ — 'Geometry quiz went okay'" or "No check-in yet today." Rationale: closes the loop with the existing 4pm briefing cross-check; the parent sees the child's own words.
7. **School messages.** Latest teacher/counselor mail, 3-line previews, tap to the per-teacher thread (existing Dawson Comms pattern). Rationale: the inbox is where surprises live; surfacing it prevents "I didn't know" moments.

**Empty states (no blank pages, ever):** no sync yet → "No school data yet — connect [name]'s school login to see classes here. [Connect school login]". No classes → same with the Family deep link. Revoked sharing (child 16+ paused) → "Dawson paused school sharing. You'll see updates here if they turn it back on." — honest, not an error.

---

## 6. Class page — updated section order + Learn & resources

The existing ClassDetail sections 1–3 and 5–8 are kept. Insertions:

```
1. Mission header — gap to 90 first (KEEP)
2. Grade hero — numeric | letter | to-90 (KEEP)
3. Path-to-90 top 3 — checkboxes → Supabase (KEEP)
4. ★ CHECK-IN (per class) — NEW
   "How's Geometry going?" [😟 Struggling] [😐 Okay] [🙂 Good] [🤩 Great]
   + optional note: "__________________"
   Saves to Supabase (checkins table). The note feeds Path-to-90
   recommendations (Meheldi's standing rule) and the 4pm briefing cross-check.
   Parent view: read-only ("Dawson's check-in: 'quiz went okay'").
5. Missing · Upcoming · Recently graded (KEEP)
6. ★ LEARN & RESOURCES — NEW (see §9.5–9.7)
   [Files | Links] tabs · per-unit tags · upload or paste URL
7. Teacher card (KEEP) + "Ask Crystal to draft a message" affordance
   (draft-only; Meheldi approves exact text — existing rule)
8. Sync footer (KEEP)
```

Check-in input design: four plain-word options (no clinical scale, no numbers — a 15-year-old shouldn't feel graded on their feelings). The free-text note is where the value is; Crystal reads it (with the child's knowledge — the UI says "Crystal reads check-ins to suggest next steps") and it becomes Path-to-90 recommendation input, stored in Supabase indefinitely per Meheldi's standing rule (retention: indefinite until he decides otherwise).

---

## 7. Child dashboard — the child's own Cockpit

When a child (13+) claims their profile and signs in, they get **their own pilot account** — same app, same 5-tab shape, school-first content. User-first applies to them too: they're a pilot, not a "managed object."

### 7.1 Child toolbar

```
┌──────┬───────┬─────────┬────────┬──────────┬──────┐
│ Home │ Today │ Crystal │ School │ Progress │ More │
└──────┴───────┴─────────┴────────┴──────────┴──────┘
```

Same six tabs. Differences: School is always present (their life is school); More → Family is replaced by **My sharing** ("Who can see my school life" — grants they granted, revoke switches); no "add crew member"; no teacher-draft approval queue (parent-only); no access to siblings' data, parent's modules, or health/finance modules beyond their own granted scope.

### 7.2 Child Home — "My school day"

```
┌─ HOME (child) ─────────────────────────────┐
│ Morning vista (same spacecraft)            │
│ ┌─ GLASS PANE ─────────────────────────┐  │
│ │ ☀️ Good morning, Dawson              │  │
│ │ ✨ MORNING SPARK                      │  │ ← §9.1 fun fact + quote
│ │ "Honey never spoils — archaeologists │  │
│ │  tasted 3,000-year-old honey."       │  │
│ │ "Small steps every day." — quote     │  │
│ │ ─────────────────────────────────── │  │
│ │ 🕙 IN 3RD PERIOD NOW · lunch 25 min  │  │ ← bell strip
│ │ ─────────────────────────────────── │  │
│ │ ✅ CHECK IN — How was today?         │  │ ← prominent, one tap
│ │    [takes 30 seconds]               │  │
│ │ ─────────────────────────────────── │  │
│ │ 🎯 TODAY'S MISSIONS (3)              │  │ ← their Path-to-90
│ │ □ Finish Geometry worksheet (missing)│  │
│ │ □ EnvSci flashcards — 10 min         │  │
│ └──────────────────────────────────────┘  │
└────────────────────────────────────────────┘
```

Order rationale: **delight first** (morning spark — the ritual hook), **orientation** (where am I in my day), **the one job** (check in — prominent and 30 seconds), **the missions** (what to do). The child's surface never leads with a grade number — it leads with *today*. (Counselor lens: adolescents engage with proximal, actionable goals, not cumulative judgments.)

### 7.3 Child School tab

Same 7-section structure as the parent surface (§5) minus section 7's parent-only elements, with copy in second person ("Your mission" not "Dawson's mission"). The child sees their own check-in history; resources/uploads are fully theirs to add.

### 7.4 What the child does NOT see

- Parent's modules (bills, shopping, health beyond granted scope).
- Siblings' school data.
- Teacher-draft emails awaiting parent approval.
- Grant details of other viewers ("Mom can see grades" is shown; the *scope negotiation UI* is the parent's Family screen).

---

## 8. Child login & consent — per age tier

### 8.1 Current auth (recap)

Supabase Auth: magic-link email OTP or Google OAuth → `auth.users` row → `pilots` row. No passwords anywhere. Children are `crew_members` data rows with no login. The schema is already consent-ready (`granted_by`, `link_codes`, `checked_by='crew'`).

### 8.2 Tier 0 — Under 13: parent stewardship. NO child login.

**Flow:** There is none — deliberately. When the parent adds a child whose birthdate computes to under 13, the "Invite to Cockpit" button is replaced with plain-English copy:

> "Cockpit accounts start at 13. Until then, everything about [name]'s school lives right here in your cockpit — you're their steward."

**Why:** COPPA. Operating a child-directed account under 13 triggers verifiable-parental-consent obligations and data-minimization duties that the steward model avoids cleanly. The parent's `crew_members` row + `granted_by='steward'` grants already encode this legally: the *pilot* is the account holder; the child is the data subject under stewardship. No code change needed beyond the birthdate gate on the invite button.

**Panel note (pediatrician/legal):** this is the only compliant posture without a full COPPA consent apparatus. Revisit only if Meheldi wants under-13 accounts as a product bet — it would require verifiable parental consent infrastructure, not just a login form.

### 8.3 Tier 1 — Ages 13–15: shared agency (claim + consent)

**Step 1 — Parent invites.** In Family → [child] → "Invite [name] to Cockpit." Requirements: birthdate shows 13–15. The app shows a 6-digit code, 15-minute expiry, single-use (existing `link_codes` table + API route).

**Step 2 — Child signs up.** On their own device, the child opens Cockpit → **Sign in** (same login page; magic link to *their* email or their Google account). New `auth.users` + `pilots` row — a normal pilot account. Minimum-age attestation: the signup form asks birth year; under-13 is refused with the stewardship message (belt + suspenders with the invite gate).

**Step 3 — Child claims.** First-run onboarding for the new pilot detects no crew profile and offers "Link my school." Two paths:
- **(a) Link code (v1, recommended):** enter the 6 digits from the parent's screen → code redemption links `pilots.id` → `crew_members` row, marks code used.
- **(b) Email match (v2):** child signs in with the email matching the school email the parent stored for them → app shows the consent screen → "Yes, link my school."

**Step 4 — Consent screen (the important one).** Plain-English, ≤8th-grade, exactly what's visible:

> "**Link your school to Cockpit?**
> Your parent will be able to see:
> ✓ Your classes and grades
> ✓ Missing and upcoming assignments
> ✓ Attendance
> ✓ Your daily check-ins (so the 4pm summary matches what you said)
> They will NOT see:
> ✕ Your Crystal chats
> ✕ Anything you delete
> You can change this anytime in **More → My sharing**.
> [Yes, link my school]  [Not now]"

On "Yes": a `crew_access_grants` row is written with `granted_by='crew_member'` (the child consented), scope `{grades: true, attendance: true, checkins: true, health: false}`. The steward's existing rows remain.

**Step 5 — Shared agency rules (13–15).**
- Either side can check Path-to-90 boxes; `checked_by` records who.
- The child can **revoke** the parent's grant anytime (their right); the UI frames it as "pause sharing," reversible in one tap.
- **Parent revoke has a 7-day cooling-off** (locked tier rule): the parent taps "remove access," the UI shows "Sharing ends in 7 days — [child] has been notified," with an undo. Rationale: prevents heat-of-the-moment punishment-by-surveillance-removal, which the psychologist panel will recognize as autonomy-thwarting.
- Check-in text is visible to the parent (it's the basis of the 4pm cross-check) — and the consent screen says so explicitly. No hidden surveillance.

### 8.4 Tier 2 — Ages 16–17: independence (instant, reversible)

Same claim flow as 13–15. Differences:

- **First-login Sharing screen.** Positively framed — "You're in charge of who sees your school life" (independence framing, never "cut off your parents"). Shows each viewer (Mom, Dad), their scope toggles (grades / attendance / check-ins), and one-tap revoke.
- **Instant revoke, fully reversible.** No cooling-off (locked rule). Revoke → the parent's School tab for that child shows the honest paused state (§5), never an error, never stale data masquerading as fresh.
- **Scope negotiation.** The 16-year-old can turn off check-in visibility while keeping grades on — granular `scope` JSON, not all-or-nothing.

### 8.5 Tier 3 — Age 18+: adult continuity

On the first login at/after the 18th birthday (computed from birthdate), one clear prompt:

> "You're an adult now — you're in control. Mom and Dad can still see what they saw before. Change that anytime in **More → My sharing**."

Parents keep existing access by default (continuity, not a breakup screen — locked "Go independent" framing). The young adult can remove or re-add either parent anytime. The crew_members row is untouched (history preserved); only grants change.

### 8.6 Second parent / other viewers

Per the locked MD decision (D5): second parent is invite-only in v1. The steward sends an invite; the second parent signs up as a pilot; the **child (13+) or steward (under 13)** approves the grant — never the first parent alone. The child remains the authority: Parent A cannot veto Parent B's child-granted access.

---

## 9. Meheldi's 7 Pookie features — placement map

| # | Feature | Where it lives | Input type | Notes |
|---|---|---|---|---|
| 1 | **Fun facts + daily quote** | Child Home → "Morning spark" card (top of glass pane). NOT on the parent surface (parent delight = mission progress). | Read-only, daily rotation | Bundled, pre-reviewed daily pack v1 — no live LLM generation for kids' delight content. Cached per-day; works offline. |
| 2 | **Bell schedule** | (a) NOW strip on School tab + child Home ("In 3rd period now · lunch in 25 min"); (b) full schedule under School tab → "Today's schedule" (Daily/WEB tabs for Walton) | Read (+ parent-editable seed) | District-agnostic: `school_schedules` per crew member (district, schedule JSON, source URL). Walton Daily + WEB seeded from the prior extraction; parent can correct times. |
| 3 | **Cobb district calendar** | School tab → "This week" section; child Home shows "No school Friday (Fall break)" chips; Today briefing suppresses school nudges on no-school days; early-dismissal days flagged in NOW strip | Read (synced) | District-agnostic: `district_calendars` per crew member. Sync from district feed where available; parent-editable fallback. |
| 4 | **Daily check-in** | Child: Home hero card (prominent, 30 seconds) + per-class check-in on class page (§6.4). Parent: School tab check-in section + 4pm briefing cross-check (existing) | Rating (4 plain words) + free text → **Supabase** (`checkins`), never localStorage | Check-in text feeds Path-to-90 recommendations (standing rule). Retention indefinite until Meheldi decides. |
| 5 | **Handout uploads** | Class page → Learn & resources → **Files** tab | File upload → Supabase Storage, tagged per class + unit | Parent or child can upload. Thumbnails for PDFs/images; plain list otherwise. |
| 6 | **Resources page** | Class page → Learn & resources → **Links** tab; also aggregated per-unit in the Learn hub (v2) | URL + title + source picker | Sources: YouTube, Khan Academy, Kahoot, Blooket, DeltaMath, Desmos, PhET, Quizlet, AP Classroom, Cobb CTLS, Other. v1: user-added; v2: Crystal-curated 2–3/type/week (Learn plan). |
| 7 | **Upload vs URL** | Input type is per-resource, chosen by a two-option picker at add time: [📎 Upload a file] [🔗 Paste a link] — never a single ambiguous field | File → Storage; URL → validated link row | Same `class_resources` table, `kind ∈ {file, link}`. Unit tag required at add (defaults to current unit). |

### Data model deltas (new tables)

```sql
school_schedules   -- per crew member: district, name ("Daily"/"WEB"), periods JSONB, source_url
district_calendars -- per crew member: district, events JSONB (date, title, kind: no_school|early_dismissal|event), synced_at
checkins           -- crew_member_id, class_name (nullable for general), date, rating, note text, created_by pilot|crew, created_at
class_resources    -- crew_member_id, class_name, unit_tag, kind file|link, title, url|storage_path, source, added_by pilot|crew, created_at
```

RLS mirrors `path_to_90_checks`: steward full access; grantees read with `grades` scope; the linked child pilot reads/writes their own rows (`checked_by`/`added_by='crew'` pattern). Storage bucket for handouts: private, same RLS.

---

## 10. What changes vs today

| Current | Proposed | Why |
|---|---|---|
| More → Crew → name → Classes (3–4 taps) | School tab → classes (1 tap) | Daily surface deserves a front door |
| Crew applet = roster + connect + classes (mixed jobs) | Crew → **Family** (admin only); School = daily surface | Admin ≠ daily; the mix was the core mistake |
| School Overview applet unreachable except via More | School station in toolbar (conditional) | Content exists; front door was missing |
| Today school items are plain text | Deep-link to School station / class page | Briefing should be a launcher, not a dead end |
| No bell schedule anywhere | NOW strip + full schedule (Daily/WEB) | "What period is it" is the #1 school micro-question |
| No district calendar | "This week" section; nudge suppression on no-school days | Parents plan around it; app currently ignores it |
| Check-in exists only as parent-side concept | Child hero card + per-class check-in → Supabase | Standing rule: check-ins feed Path-to-90 |
| No resources/uploads | Learn & resources per class (Files/Links, unit-tagged) | The Learn plan's home |
| No child login | Tiered claim + consent flows (13–15 / 16–17 / 18+) | Locked: child is the access authority |
| No fun/quote element | Morning spark on child Home | Ritual hook; adolescents open apps that greet them |
| Attendance = sync checkbox, no surface | Attendance card on School tab | Early-warning signal counselors watch |

**What does NOT change:** the 5-tab toolbar for childless pilots (pixel-identical); the applet overlay model (minimize/close, no full-page nav); the Cloudflare cookie auth fix; the Supabase singleton; Path-to-90 checkbox persistence; the teacher-email draft-approval flow; the 6 AM–10 PM send window.

---

## 11. Reasoning appendix (for the expert panel)

**Child psychologist — autonomy & motivation.** The design is built on self-determination theory: adolescents sustain effort when they feel *autonomy* (their missions, their check-ins, their sharing controls), *competence* (gap-to-90 as a winnable mission, not a verdict), and *relatedness* (the check-in is a conversation, not surveillance — the consent screen names exactly what the parent sees). The 7-day cooling-off on parent revoke (13–15) prevents surveillance from becoming a punishment lever, which research links to secrecy rather than compliance. The child's surface leads with *today's actions*, never cumulative grades — proximal goals beat distal judgments for teen engagement.

**Ivy League counselor — triage & signal.** The parent surface sorts by *need* (biggest gap first, missing work first) because counselor triage is always missing/zeros first, then high-weight assessments — the existing Path-to-90 ranking already encodes this. Attendance gets a first-class card because it's the earliest leading indicator counselors watch (grade drops lag 2–4 weeks behind attendance changes). The district calendar + bell schedule aren't decoration: "is today even a school day" and "early dismissal Friday" change what a family does *this week*.

**Pediatrician — sleep, screens, and delight.** The morning spark (fun fact + quote) is a deliberate *positive* phone interaction — the first school-related thing the child sees is delight, not a grade. Check-in uses plain words, not numeric scales, avoiding the quantified-self anxiety loop. No recommendation here increases screen time at night: check-in nudges default to after-school (~3:45 PM), never after 9 PM; the design defers notification-timing policy to the nudge engine. Under-13: no accounts, period — COPPA posture is the only safe default.

**Education specialist — resources & units.** The Learn & resources section implements the 2026-10-09 Learn plan at the class level: INTERNAL (handout uploads, teacher materials) + EXTERNAL (YouTube, Khan, Kahoot/Blooket, Desmos, PhET, DeltaMath, AP Classroom) with **unit tags** so resources attach to what the class is studying *now*, not a generic pile. Upload-vs-link as an explicit per-resource choice matches how families actually have materials (a photographed worksheet vs. a video link). v1 is user-added; Crystal-curated (2–3 per type per week) is the v2 that makes it sustainable.

**Legal (COPPA/FERPA) — consent as architecture.** Under-13 = stewardship only (no child accounts; the pilot is the account holder). 13+ = the child holds their own auth account and grants access explicitly; `granted_by='crew_member'` rows are the consent receipts. FERPA: education records flow to the child first, then outward by grant — matching the locked "child is the access authority" decision. The consent screen's ≤8th-grade plain language with an explicit NOT-visible list is the enforceable version of "informed."

---

## 12. Open questions for Meheldi

1. **School tab trigger:** appear when ≥1 crew member exists (empty state invites school connect), or only after the first successful sync? *Recommendation: on crew-member add — the empty state is the onboarding.*
2. **Child email at add-a-child time:** needed for the email-claim path (v2). Storing kids' emails has privacy weight. *Recommendation: link-code-only for v1; email claim in v2.*
3. **Default scope for 13–15:** grades + attendance + check-ins visible to parent; health off; Crystal chats never. OK? *(Check-in visibility is load-bearing for the 4pm cross-check.)*
4. **Bell schedule source:** seed Walton Daily/WEB from the prior extraction and let the parent correct, or manual entry per district? *Recommendation: seed + correct; district-agnostic table either way.*
5. **Resource curation:** user-added only in v1, Crystal-curated (2–3/type/week) in v2 — or curated from day one?
6. **Morning spark content:** bundled pre-reviewed daily pack (recommended — no live generation for kids' delight content) — who reviews the pack?
7. **Check-in nudge time:** default ~3:45 PM on school days (after school, before the 4pm briefing)? Opt-out per family?
8. **16+ Sharing screen in v1?** *Recommendation: yes — without it the tier model's consent authority isn't enforceable in UI.*
9. **Multi-child default:** first crew member, or "all children" rollup at the top of the School tab? *Recommendation: per-child chips, default to first; rollup only for the mission list (v2).*
10. **Crystal for child pilots:** Crystal is locked as unfiltered/intelligent-first. For 13–17 pilots, does the panel want age-appropriate guardrails on school/life advice, or hold the lock? *(Flagged for the panel — not decided here.)*

---

## 13. Reconciliation notes (for the archaeology workstream)

- The **content** of `SchoolOverviewApplet` and `ClassDetail` is kept and extended — do not rebuild; reconcile Pookie's exact implementations (fun-fact rotation, quote source, bell-schedule tables, check-in flow, handout upload, resource cards) into the *sections and placements* specified here (§5, §6, §9).
- Pookie's daily-update audit items (quote, bell schedule, district calendar) map 1:1 to §9 rows 1–3 — the audit's source/pull/storage/render checklist should be re-run against the new placements.
- `link_codes` + the claim API route already exist — the archaeology team should check whether Pookie had a child-facing redemption UI to port.
- If Pookie's implementation put any of the 7 features somewhere this doc doesn't (e.g., bell schedule on a calendar page), prefer **this doc's placement** (front-and-center daily surfaces) unless the panel overrules — placement is the point of this workstream.

---

*End of design document. No code was written. All section orders, flows, and placements are proposals for panel review and Meheldi's approval.*
