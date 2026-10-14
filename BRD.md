# CRYSTAL v2 — Business Requirements Document (BRD)

**Document Version:** 1.0
**Date:** 2026-10-14
**Project:** Crystal — Personal Productivity & Life-Management Platform
**Companion Document:** MCP.md (Master Control Plan — technical execution)

---

## 1. Purpose

This BRD defines the **business requirements** for Crystal v2: what the product must do, who it serves, and how success is measured. It is the business counterpart to the MCP (which covers technical execution). All build decisions trace back to requirements in this document.

---

## 2. Business Objectives

| ID | Objective | Success Metric |
|----|-----------|----------------|
| BO-1 | Launch a unified life-management app for busy individuals and families | 10,000 registered users within 90 days of public launch |
| BO-2 | Differentiate through AI co-pilot + immersive cockpit UX | ≥4.5★ average app-store rating; ≥40% DAU/MAU |
| BO-3 | Build a platform that scales to 1M+ users without re-architecture | Load test passes at 1M simulated users; p95 API latency <300ms |
| BO-4 | Establish trust via privacy-first design (family + health data) | Zero data-breach incidents; COPPA/FERPA/HIPAA-style audit passes |
| BO-5 | Create a monetizable foundation (freemium → premium) | Premium conversion ≥5% within 6 months of launch |

---

## 3. Stakeholders

| Stakeholder | Role | Interest |
|-------------|------|----------|
| Mehedi Kamal | Founder / Product Owner | Vision, final approval on all releases |
| End Users (Pilots) | Primary users | Manage tasks, school, health, money, comms in one place |
| Parents | Secondary users | Oversee children's school life (opt-in) |
| Children (13+) | Secondary users | Own school dashboard with parent visibility |
| Children (<13) | Protected users | Parent-managed only (COPPA) |
| Build Teams | Delivery | Theme, Landing, Mascot, Toolbar, Modules |

---

## 4. User Personas

### 4.1 The Pilot (Primary)
- **Who:** Busy adult managing work, family, health, money
- **Needs:** One place for priorities, calendar, bills, messages — not 6 apps
- **Pain:** Context-switching; things fall through cracks
- **Crystal helps:** Daily briefing, smart reminders, everything searchable

### 4.2 The Parent Pilot
- **Who:** Parent with school-age children
- **Needs:** Visibility into grades, assignments, teacher comms — without hovering
- **Pain:** School portals are fragmented; email from teachers gets lost
- **Crystal helps:** Unified school dashboard, AI study plans, gentle nudges

### 4.3 The Student (13+)
- **Who:** Teen managing their own school life
- **Needs:** Know what's due, what's at risk, how to get to 90%+
- **Pain:** Doesn't know where they stand until report card
- **Crystal helps:** Gap-to-goal framing, top-3 actions, shame-free language

---

## 5. Functional Requirements

### 5.1 Authentication & Onboarding

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-AUTH-1 | Sign up / log in with Google OAuth | Must |
| FR-AUTH-2 | Sign up / log in with emailed one-time code | Must |
| FR-AUTH-3 | Log out accessible from every authenticated page | Must |
| FR-AUTH-4 | Session persists across visits (30-day default) | Must |
| FR-AUTH-5 | New users land on Home with guided first-run (no child questions) | Must |
| FR-AUTH-6 | MFA available for admin accounts | Should |

### 5.2 Landing & Marketing (Pre-Login)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-LAND-1 | Hero section with looping space video background | Must |
| FR-LAND-2 | Features section: scannable cards for each module | Must |
| FR-LAND-3 | Sales pitch: value proposition in ≤3 sentences | Must |
| FR-LAND-4 | Crystal sales-support chat (pre-login, answers product questions) | Must |
| FR-LAND-5 | Legal pages: Terms, Privacy, Cookies, Accessibility, Do Not Sell/Share | Must |
| FR-LAND-6 | Mobile: lighter video; `prefers-reduced-motion`: still image | Must |

### 5.3 Cockpit Shell (Post-Login)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-SHELL-1 | Bottom toolbar, edge-to-edge, on desktop and mobile | Must |
| FR-SHELL-2 | Home accessible from every page | Must |
| FR-SHELL-3 | Apps open in minimizable/closable windows (no full-page reloads) | Must |
| FR-SHELL-4 | Crystal command bar available on every screen | Must |
| FR-SHELL-5 | 3×3 ability grid with visible cooldown timers | Must |
| FR-SHELL-6 | 360° radar sweep animation (tactical display) | Must |
| FR-SHELL-7 | Squad status indicators (family/crew presence) | Should |
| FR-SHELL-8 | Tactical feed + comms feed tickers | Should |
| FR-SHELL-9 | Red Alert (DEFCON 1) mode: visual + audio alarm for urgent items | Must |
| FR-SHELL-10 | Sound effects via built-in synthesizer (no audio files) | Should |
| FR-SHELL-11 | Crystal mascot in pilot seat, reactive to interactions | Must |

### 5.4 Crystal AI Assistant

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-AI-1 | Plain-English understanding ("remind me Friday to pay the water bill") | Must |
| FR-AI-2 | OCR: extract text from uploaded photos and documents | Must |
| FR-AI-3 | Animated moods reflecting context (happy, curious, sleepy, excited, celebrating, thinking) | Must |
| FR-AI-4 | Runs on Cloudflare Workers AI (free open models) | Must |
| FR-AI-5 | Grok fallback slot for complex questions | Should |
| FR-AI-6 | Rate limits enforced per user | Must |

### 5.5 Home Module

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-HOME-1 | Top priorities (AI-ranked, top 3 visible) | Must |
| FR-HOME-2 | Weather (current + 7-day) | Must |
| FR-HOME-3 | Calendar (today's events + upcoming) | Must |
| FR-HOME-4 | To-dos (quick add, check off) | Must |

### 5.6 Education Module

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-EDU-1 | Pull classes from ParentVUE | Must |
| FR-EDU-2 | Pull classes from StudentVUE | Must |
| FR-EDU-3 | Pull classes from CTLS Learn | Should |
| FR-EDU-4 | Pull classes from Office 365 | Should |
| FR-EDU-5 | Learn section: AI study plan targeting 90%+ per class | Must |
| FR-EDU-6 | Daily check-ins with handout photo upload; Crystal reads uploads | Must |
| FR-EDU-7 | School calendars + bell schedules | Should |
| FR-EDU-8 | Grade display leads with gap-to-goal (not raw grade) | Must |
| FR-EDU-9 | Shame-free language throughout | Must |

### 5.7 Health Module

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-HEALTH-1 | Manual step entry + file import | Must (Phase 4) |
| FR-HEALTH-2 | Blood glucose logging with A1C estimate | Must (Phase 4) |
| FR-HEALTH-3 | Medication list with reminders | Must (Phase 4) |
| FR-HEALTH-4 | Dexcom integration | Should (post-launch) |
| FR-HEALTH-5 | Apple Health integration | Should (post-launch) |

### 5.8 Communications Module

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-COMM-1 | Gmail: read, triage, search | Must (Phase 3) |
| FR-COMM-2 | Outlook: read, triage, search | Must (Phase 3) |
| FR-COMM-3 | Google Drive: file access | Should (Phase 3) |
| FR-COMM-4 | Physical mail tracking (photo intake → action items) | Should (Phase 3) |

### 5.9 Finance Module

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-FIN-1 | Bills list with due dates + reminders (7-day, 2-day) | Must (Phase 4) |
| FR-FIN-2 | Stock tracker (watchlist, prices) | Must (Phase 4) |
| FR-FIN-3 | Bank account links via Plaid | Deferred (post-launch) |
| FR-FIN-4 | Credit monitoring | Deferred (post-launch) |

### 5.10 Shopping Module

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-SHOP-1 | Shopping list (add, check off, share) | Must (Phase 3) |
| FR-SHOP-2 | Wish list (add, share) | Must (Phase 3) |
| FR-SHOP-3 | Shareable via link | Must (Phase 3) |

### 5.11 New v2 Features

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-NEW-1 | Daily Crystal briefing (morning digest) | Must |
| FR-NEW-2 | Installable PWA with offline support | Must |
| FR-NEW-3 | Push reminders (web push) | Must |
| FR-NEW-4 | Global search across all modules | Must |

---

## 6. Non-Functional Requirements

| ID | Category | Requirement |
|----|----------|-------------|
| NFR-1 | Performance | p95 page load <2s; p95 API latency <300ms |
| NFR-2 | Scale | Support 1M+ users without re-architecture |
| NFR-3 | Availability | 99.9% uptime (staging + production separated) |
| NFR-4 | Accessibility | WCAG 2.1 AA; keyboard nav; screen-reader labels; reduced-motion support |
| NFR-5 | Mobile | Fully responsive; installable PWA; lighter video assets |
| NFR-6 | Security | RLS on every table; encrypted credential storage; audit logs; MFA for admins |
| NFR-7 | Privacy | FERPA (education), COPPA (under-13), HIPAA-style (health) |
| NFR-8 | Reliability | No blank pages; every error has recovery path; plain-English error messages |
| NFR-9 | Observability | Structured error logging; alerting on failure; deploy health checks |

---

## 7. Data Requirements

| ID | Requirement |
|----|-------------|
| DR-1 | All user data isolated by `user_id` (RLS enforced) |
| DR-2 | Schema supports future sharding by user |
| DR-3 | Third-party credentials encrypted at rest (Supabase Vault) |
| DR-4 | Audit log on all sensitive data access |
| DR-5 | 14-day retention on raw behavioral signals |
| DR-6 | Child (under-13) data: parent-managed only; excluded from behavioral collection |

---

## 8. Assumptions & Constraints

| ID | Description |
|----|-------------|
| AC-1 | Cloudflare Workers AI free tier is sufficient for v1 AI load (with rate limits) |
| AC-2 | School data sources (ParentVUE, StudentVUE) remain accessible via existing methods |
| AC-3 | Supabase free tier supports development; Pro tier before public launch |
| AC-4 | All builds target modern browsers (Chrome, Safari, Firefox, Edge — last 2 versions) |
| AC-5 | iOS PWA push notifications subject to Apple platform constraints |

---

## 9. Out of Scope (v2)

- Native iOS/Android apps (PWA only for v2)
- Bank account aggregation (deferred to post-launch via Plaid)
- Credit monitoring (deferred)
- Multi-language support (English only for v2)
- Public API for third-party developers

---

## 10. Acceptance Criteria (Launch Gate)

The product is launch-ready when ALL of the following are true:

1. [ ] All Must-priority FRs implemented and browser-verified on staging
2. [ ] Load test passes at 100K concurrent users (1M simulated)
3. [ ] Security review complete with zero critical findings
4. [ ] Legal review signs off on Terms, Privacy, Cookies, Accessibility, Do Not Sell/Share
5. [ ] Accessibility audit passes WCAG 2.1 AA
6. [ ] Staging → production deploy pipeline verified end-to-end
7. [ ] Founder (Mehedi Kamal) approves launch

---

## 11. Traceability

Each build phase in MCP.md maps to FRs in this BRD:

| MCP Phase | BRD Sections |
|-----------|--------------|
| Foundation | FR-AUTH, FR-LAND, FR-SHELL (base), FR-AI (base), FR-HOME |
| Hardening | NFR-1 through NFR-9 |
| Education | FR-EDU-1 through FR-EDU-9 |
| Communications & Shopping | FR-COMM, FR-SHOP |
| Health & Finance | FR-HEALTH, FR-FIN |
| Scale & Launch | §10 Acceptance Criteria |

---

*This is a living document. Requirements change via founder approval only.*
