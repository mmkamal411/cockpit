# CRYSTAL v2 — Master Control Plan (MCP)

**Document Version:** 1.0
**Date:** 2026-10-14
**Project:** Crystal — Personal Productivity & Life-Management Platform
**Repository:** `~/workspace/crystal-v2` (private)
**Live Proof of Concept:** crystal-7ot.pages.dev
**Reference Code:** iamrolanatl/starcraft (private repo)

---

## 1. Executive Summary

Crystal is a personal productivity and life-management application that unifies tasks, school, health, money, and communication into a single StarCraft-inspired cockpit interface. The v2 rebuild rebrands the existing Cockpit platform as "Crystal" with a complete visual overhaul, new landing experience, AI mascot, and expanded module set.

**Target:** 1M+ users | **Platform:** Web (PWA) + Mobile Installable | **Stack:** Next.js 16, React, TypeScript, Cloudflare Workers, Supabase Postgres

---

## 2. Product Vision

### 2.1 Name & Identity
- **Product Name:** Crystal
- **AI Assistant:** Crystal — snow-white fluffy body, colorful neon accents, big blue eyes, animated moods
- **Tagline:** *Your personal co-pilot for life*

### 2.2 Theme: StarCraft Cockpit
A pilot's-eye view looking out into space and nebulae:
- **Colors:** Deep space navy (#0a0e1a), translucent charcoal, glowing cyan (#22d3ee), mint teal (#5eead4), soft white, ice blue, muted slate, light ash gray
- **Materials:** Frosted glass panes (backdrop-blur), neon accents, particle sparks
- **Motion:** Seamless looping video backgrounds (lighter versions on mobile, still image on `prefers-reduced-motion`)
- **Feel:** Minimalist, high-tech, calm — not cluttered

### 2.3 Crystal, the AI Pilot Assistant
- **Personality:** Fun, warm, encouraging — a devoted co-pilot, not a protocol droid
- **Appearance:** Snow-white body, neon accents, big blue eyes, animated moods (happy, curious, sleepy, excited, celebrating, thinking)
- **Intelligence:** Cloudflare Workers AI (free open models) with Grok fallback slot for complex questions
- **Capabilities:**
  - Plain-English understanding ("remind me Friday to pay the water bill")
  - OCR: reads text from uploaded photos and documents
  - Contextual: knows your schedule, tasks, and priorities

---

## 3. User Experience

### 3.1 Before Login
| Surface | Description |
|---------|-------------|
| Hero Section | Full-viewport looping space video, headline, CTA |
| Features | Sales pitch: modules, AI, theme — scannable cards |
| Auth | Sign up / Log in with Google or emailed one-time code |
| Sales Chat | Crystal answers pre-login questions |
| Legal | Terms, Privacy, Cookies, Accessibility, Do Not Sell/Share pages |

### 3.2 After Login (Always Available)
- **Log out** and **Home** accessible from every page
- **Windows:** Apps open in minimizable/closable windows (not full-page nav)
- **Command Bar:** Crystal's command bar works on every screen

### 3.3 Cockpit Toolbar (Bottom, Edge-to-Edge, Desktop + Mobile)
A pilot's-eye view of the command center:
- **3×3 Ability Grid** — quick actions with cooldown timers
- **360° Radar Sweep** — animated tactical radar
- **Squad Status** — family/crew presence indicators
- **Tactical Feed** — system events ticker
- **Comms Feed** — messages/notifications ticker
- **Red Alert (DEFCON 1)** — urgent mode with visual + audio alarm
- **Sound Effects** — built-in Web Audio synthesizer (no audio files)
- **Crystal in Pilot Seat** — mascot anchored center, reactive

### 3.4 Modules

| Module | v2 Scope |
|--------|----------|
| **Home** | Top priorities, weather, calendar, to-dos |
| **Education** | Classes from ParentVUE, StudentVUE, CTLS, Office 365. Learn section with AI study plan targeting 90%+. Daily check-ins with handout uploads (Crystal reads them). School calendars + bell schedules. |
| **Health** | Steps, blood glucose with A1C estimate, medications with reminders. Manual entry / file import first; Dexcom + Apple Health links after. |
| **Communications** | Gmail, Outlook, Google Drive, physical mail tracking |
| **Finance** | Bills + due dates, stock tracker. Credit monitoring + bank links later via Plaid. |
| **Shopping** | Shopping list + wish list, both shareable |

### 3.5 New in v2
- **Daily Crystal Briefing** — morning digest (priorities, weather, calendar, nudges)
- **Installable PWA** — works offline, add to home screen
- **Push Reminders** — web push notifications
- **Global Search** — one search box across everything

---

## 4. Architecture

### 4.1 Frontend
- **Framework:** Next.js 16 (App Router), React, TypeScript
- **Hosting:** Cloudflare Pages (global edge network)
- **Styling:** Tailwind CSS + CSS custom properties for theme tokens

### 4.2 API Layer
- **Protocol:** Connect-RPC (typed contracts, gRPC semantics in the browser)
- **Contracts:** Versioned, code-generated clients

### 4.3 Backend
- **Compute:** Cloudflare Workers
- **Background Jobs:** Cloudflare Queues
- **Live Feeds:** Durable Objects (radar, comms, tactical)
- **Files & Videos:** Cloudflare R2

### 4.4 Data & Auth
- **Database:** Supabase (Postgres)
- **Security:** Row-Level Security (RLS) on every table, per-user isolation
- **Sharding:** Schema designed for future split by user_id
- **Auth:** Google OAuth + emailed OTP (Supabase Auth)

### 4.5 Scale Target: 1M+ Users
- Rate limits on all AI endpoints
- Edge caching (stale-while-revalidate)
- Monitoring + alerting (error tracking)
- Separate staging and production environments
- Feature flags for gradual rollouts

### 4.6 Security & Compliance
- Encrypted storage for third-party credentials (Supabase Vault)
- Audit logs on sensitive operations
- MFA for admin accounts
- **FERPA:** Education records access controls
- **COPPA:** Under-13 parent stewardship, no child ad targeting
- **HIPAA-style:** Health data encryption, minimum-necessary access

---

## 5. Build Phases

### Phase 0 — Foundation (DONE)
- [x] Landing page scaffold
- [x] Legal page drafts
- [x] Sign-in (Google + OTP)
- [x] Cockpit toolbar (base)
- [x] Crystal mascot (base)
- [x] Home module

### Phase 1 — Hardening (~1 week)
- [ ] Supabase tables activated (all migrations applied)
- [ ] Google sign-in production-ready
- [ ] AI rate limits enforced
- [ ] GitHub → automatic deploys (git-connected Pages)
- [ ] Error tracking (structured logging + alerting)
- [ ] Staging environment separated from production

### Phase 2 — Education (2–3 weeks)
- [ ] ParentVUE pull integration (existing scripts ported)
- [ ] CTLS Learn integration
- [ ] AI study plan generator (90%+ target)
- [ ] Daily check-ins with photo/handout upload + OCR
- [ ] School calendars + bell schedules

### Phase 3 — Communications & Shopping (~2 weeks)
- [ ] Gmail integration
- [ ] Outlook integration
- [ ] Google Drive file access
- [ ] Physical mail tracking
- [ ] Shopping lists (shareable)
- [ ] Wish lists (shareable)

### Phase 4 — Health & Finance (2–3 weeks)
- [ ] Health: manual entry + file import (steps, glucose, meds)
- [ ] Health: Dexcom link
- [ ] Health: Apple Health link
- [ ] Finance: bills + due dates
- [ ] Finance: stock tracker
- [ ] Finance: Plaid bank links (deferred)

### Phase 5 — Scale & Launch
- [ ] Load testing (1M user simulation)
- [ ] Security review (penetration test)
- [ ] Legal review (final ToS/Privacy)
- [ ] Public launch

---

## 6. Current Build Status (2026-10-14 ~02:15 EDT)

### Active Teams (Crystal v2 Rebuild)
| Team | Branch | Scope | Status |
|------|--------|-------|--------|
| Theme | `feature/v2-theme` | Cockpit→Crystal rebrand; StarCraft theme | RUNNING |
| Landing | `feature/v2-landing` | Landing page, auth, legal, sales chat | RUNNING |
| Mascot | `feature/v2-mascot` | Crystal mascot (snow-white, neon, moods) | RUNNING |
| Toolbar | `feature/v2-toolbar` | StarCraft toolbar (grid, radar, alerts, sounds) | RUNNING |

### Milestones Completed
- [x] Codebase copied to `~/workspace/crystal-v2` (457 files)
- [x] Git repository initialized
- [x] Build coordinator active
- [x] 4 parallel teams spawned

### Upcoming Milestones
- [ ] Teams merge to `main` after coordinator review
- [ ] Module builds (Home, Education, Health, Comms, Finance, Shopping)
- [ ] New features (briefing, PWA, push, global search)
- [ ] Architecture (Connect-RPC, Queues, Durable Objects, R2)
- [ ] Staging deploy + browser verification
- [ ] Production launch

---

## 7. Decisions & Constraints

1. **Original untouched:** `~/workspace/cockpit` is frozen; all v2 work in `~/workspace/crystal-v2`
2. **Small deployments:** One feature at a time — deploy, browser-verify, then next
3. **Test before claim:** Nothing is "done" until verified in a real browser
4. **No blank pages:** Every error caught with useful UI + recovery path
5. **Plain-English errors:** Grandmother test on all user-facing messages
6. **Code cleanliness:** No dead code, no console.logs, no commented blocks

---

## 8. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Scope creep (v2 is large) | Phased builds; each phase has explicit done-criteria |
| Theme performance (video + glass) | Lighter mobile videos; `prefers-reduced-motion` still image; GPU-composited layers only |
| AI cost at scale | Workers AI free tier + rate limits; Grok only for complex queries |
| School data source fragility | Multi-source with ParentVUE fallback; district-agnostic adapters |
| Child privacy (COPPA) | Parent stewardship for under-13; no behavioral collection on child accounts |

---

*This is a living document. Updated as milestones complete.*
