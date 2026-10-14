# Cockpit Product Roadmap

**2026–2028 strategic plan** · *From staging build to the pilot's daily command center.*

> **Product principle:** *The pilot flies. Cockpit handles the rest.* Build what earns the morning ritual. Phase what doesn't.

| | |
|---|---|
| **Current phase** | Foundation — 10 modules live on staging |
| **Phases** | 5, sequenced by product maturity |
| **Horizon** | Staging → public launch → platform |
| **North star** | The addictive morning ritual — the pilot opens Cockpit first, every day |

---

## 01 · Current state

*The foundation is already in motion.*

**What's live on staging** (`cockpit-10c.pages.dev`):

- **Crystal Chat** — warm AI co-pilot (llama-3.3-70b), Fireball direct mode; 100% code-complete
- **Weather** — home glass pane, 7-day strip, Marietta-local; 90%
- **To-dos** — lists with persistence; 95%
- **Today** — attention briefing, overdue/schedule/due/nudges/school rollup; 85%
- **Nudges** — proactive engine scaffold; 100% code-complete
- **Shopping Lists** — Groceries/Household/Pharmacy, sharing Tier 1 built; 90%
- **Health Basics** — MED BAY gauges (weight/sleep/water/exercise/blood sugar), glucose/A1C; 95%
- **Money/Bills** — bills tracking, 7-day horizon; 85%
- **Crew/School** — add-a-child flow, Supabase-backed (localStorage trap fixed); 70%
- **Calendar** — agenda/day/week applet, Google OAuth flow; 60% (sync engine pending)

**Platform truths already locked:**

- **User-first, not parent-first.** Cockpit is the pilot's personal assistant. Children are an opt-in module, never the core. Nothing in design, IA, or copy assumes parenthood.
- **Spacecraft cockpit.** Dark instrument panels, subtle neon, a different space vista per page, black-hole page transits, applet overlays — never full-page reloads.
- **Crystal & Fireball.** Warm/soothing vs. direct — two modes, one intelligence, unfiltered.
- **No blank pages, ever.** Every error is caught, plain-English, with a recovery path. Structured logging with traceable IDs.
- **Security baseline.** RLS enforced, anon locked down, share RPCs hardened, tokens encrypted (Phase 0 in progress).

**Guiding themes:**

- **Outcome** — the pilot feels in command of their day within 60 seconds of opening
- **Behavior** — check Cockpit before the day checks you
- **Growth** — the cockpit rearranges itself around the pilot's real life (personalization)
- **Trust** — Crystal never invents data; honest about what it can and can't see

---

## 02 · Product roadmap

*Capabilities arrive when they can change the outcome.*

### Phase 1 — Foundation (Oct 2026) · *Make it real*

**Status: in progress (~85%)**

- [x] Next.js 16 + Cloudflare Pages staging pipeline
- [x] Supabase `cockpit` project, RLS on all tables
- [x] Google sign-in (OAuth), pilot-first IA (Home/Today/Crystal/Progress/More)
- [x] 10 module shells + applet framework
- [x] Security Phase 0 (A1–A4: anon lockdown, RPC hardening, token encryption)
- [ ] Admin panel fully operational (env var wiring)
- [ ] Migration 018 applied + anon-denial proofs
- [ ] Browser verification sign-off on all 10 modules

→ **Verifiable output:** staging green, all modules verified in a signed-in browser session, zero 500s.

### Phase 2 — Intelligence (Nov–Dec 2026) · *Make it personal*

**Status: planned (~10% — evaluation complete, build starting)**

The 4-layer personalization stack:

1. **User model** — identity, integrations, conversation history, usage behavior (partially live)
2. **AI-arranged cockpit** — Crystal composes the layout around the pilot's life (biggest gap; `cockpit_layouts` exists, nothing writes to it yet)
3. **Proactive nudge engine** — urgency × importance scoring, morning digest (scaffold live)
4. **Learning from corrections** — automatic, not manual toggles

- [ ] Phase 0 security gating complete (A5, W1, C1)
- [ ] Signal collection pipeline (7d vs 14d retention — decision pending)
- [ ] Layout engine v1 (ARRANGE)
- [ ] Context pipeline (KNOW) — Crystal reads real calendar/todo/health data
- [ ] **Anti-hallucination contract** — Crystal never invents events, bills, or grades; says what it can see
- [ ] Adaptive layer (ADAPT) — learns from dismissals and corrections
- [ ] Hardening (Phase 5) — load, chaos, red-team

→ **Verifiable output:** two pilots with different lives see different cockpits; Crystal answers "what's on my calendar" from real data or says it can't see it.

### Phase 3 — Connections (Q1 2027) · *Make it aware*

- [ ] **Calendar, multi-provider** — Google (OAuth client + sync engine), Outlook/Graph (Azure app registration), iCloud (CalDAV + app-specific passwords); provider-agnostic sync interface
- [ ] **Health integrations** — Apple HealthKit / Google Health Connect (sleep, steps, workouts feed the readiness model)
- [ ] **School sync, district-agnostic** — ParentVUE fallback pipeline live, district-adapter pattern (Cobb = adapter #1, any district pluggable)
- [ ] **Email intelligence** — bills, flights, receipts auto-extracted (district-agnostic class matcher rebuilt)
- [ ] **Sync installer v1** — parent's computer, hourly + boot sync, self-signed

→ **Verifiable output:** a pilot connects Google Calendar and sees real events in Today within 5 minutes; a parent's school data flows without manual pulls.

### Phase 4 — Family & Sharing (Q2 2027) · *Make it shared*

- [ ] **Crew full** — multi-child, per-child school links, grade intelligence per crew member
- [ ] **Sharing** — shopping lists, bills, calendars shared via invite links (Resend domain live)
- [ ] **Child access authority** — child-made grants, age-tier rules (under-13 stewardship → 18+ independence), "Go independent" graduation flow
- [ ] **Support** — Help Center + FAQ (plain-language legal), AI support chat, tickets
- [ ] **Invite system** — viral invites, onboarding for invited pilots

→ **Verifiable output:** a pilot shares a grocery list via link; a 16-year-old manages their own sharing grants.

### Phase 5 — Launch (Q3 2027+) · *Make it public*

- [ ] **Polish pass** — design review against reference, motion/video verification, accessibility audit
- [ ] **App Store / Play** — 12+ rating, submission
- [ ] **Custom domain** — cutover from pages.dev
- [ ] **Pricing & tiers** — free vs paid (Supabase tier decision informs this)
- [ ] **Public launch** — marketing site, onboarding funnel, analytics
- [ ] **Platform API** — third-party integrations

→ **Verifiable output:** Cockpit in the App Store; a stranger signs up and flies within 3 minutes.

---

## 03 · Platform layer

*The architecture should age as well as the roadmap.*

- **Privacy by design** — behavioral profile never leaves the pilot's account; no cross-user learning; teen health privacy tiers
- **Resilient access** — offline-tolerant reads, honest "last synced Xh ago" (never fake freshness), graceful degradation everywhere
- **One timeline, many views** — Today, Calendar, Nudges, and Crystal all read the same underlying data
- **Explainable AI** — Crystal cites what it looked at; nudges show why they fired
- **Portable by design** — data export from day one; no lock-in
- **Quiet by default** — notifications earn their interruption; silent on routine success

---

## 04 · Product governance

*Measure progress without turning the build into a feature factory.*

**Outcome scorecard:**

| Dimension | Signal |
|---|---|
| Morning ritual | % of pilots opening Cockpit before 9 AM daily |
| Command | Time from open to "I know what matters today" (target: <60s) |
| Trust | Crystal correction rate (target: falling); zero invented-data incidents |
| Connection | % of pilots with ≥1 live integration (calendar, health, school) |
| Retention | 7-day and 30-day return rates |

**Decision cadence:**

- **Daily** — staging health, error review, blocker unblock
- **Weekly** — phase progress vs. roadmap, risk register update
- **Monthly** — outcome scorecard review, roadmap reprioritization
- **Quarterly** — phase-gate review: ship, pivot, or kill per phase

**Change control:** scope changes go through the MD (Mehedi). The roadmap is a living document — phases move, but the north star doesn't.

---

## Immediate build sequence

*Start with what unblocks everything else.*

1. **Migration 018 + proofs** — close the security hole, verify anon denial (Mehedi: run the SQL)
2. **Admin panel live** — env var wiring, Git-connected deploys (kills the whole env-var class of bugs)
3. **Anti-hallucination contract** — Crystal reads real data or says it can't (trust is the product)
4. **Google Calendar sync engine** — first live integration, proves the provider pattern
5. **Personalization Phase 1–2** — layout engine + context pipeline (the "cockpit arranges itself" moment)

---

*Roadmap horizon: staging → public launch → platform. Reviewed October 2026.*
*Companion docs: `01-project-management.md` (WBS) in mmkamal411/pookie-project · `PERSONALIZATION-BUILD-PLAN.md` · `STATUS.md`*
