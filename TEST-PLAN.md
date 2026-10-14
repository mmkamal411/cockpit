# CRYSTAL v2 — Formal Test Plan

**Document Version:** 1.0
**Date:** 2026-10-14
**Companion Documents:** BRD.md · MCP.md · SOLUTION-PLAN.md · TDD.md

---

## 1. Test Strategy

We follow a **shift-left** strategy: unit → integration → E2E → non-functional, with quality gates at each phase boundary. No phase is "done" until its test gate passes.

**Standing rule (founder directive):** TEST BEFORE YOU CLAIM. Nothing is reported as working until verified in a real browser session.

## 2. Test Levels

### 2.1 Unit Tests
**Scope:** Isolated logic — no I/O, no DOM.
**Framework:** Vitest
**Location:** Co-located `*.test.ts` next to source.

| Area | What's Tested |
|------|---------------|
| Grade math | GPA calc, letter grades, gap-to-90, tier thresholds |
| Date/time | Bell schedules, due-date logic, briefing windows, timezone handling |
| Formatters | Currency, percentages, relative time ("2h ago") |
| Validators | Task input, email, link codes, file types |
| Sound engine | Oscillator params, envelope shapes (mocked AudioContext) |
| Cooldown logic | Ability grid state machine transitions |

**Gate:** 100% of new logic has unit tests; all pass.

### 2.2 Integration Tests
**Scope:** JSON → renderer → DOM; API → Supabase → app reads.
**Framework:** Vitest + Testing Library

| Area | What's Tested |
|------|---------------|
| Applet registry | Every registered applet renders without crash |
| Task flow | Create → list → complete → persists to Supabase |
| Auth flow | Google OAuth callback → session → pilot row provisioned |
| Sign out | Session cleared → redirect to /login |
| RLS | User A cannot read User B's tasks (service_role bypass test) |
| Mascot moods | Mood prop → correct SVG layers visible |
| Toolbar widgets | Ability click → cooldown → ready; radar renders blips |

**Gate:** All integration tests pass; no applet crashes on open.

### 2.3 End-to-End Tests
**Scope:** Real browser, real staging deploy.
**Framework:** Manual browser verification (founder directive) + Playwright for regression.

**Critical paths:**
1. **First login:** Landing → Google/OTP → Home loads → briefing visible
2. **Daily use:** Add task → check off → appears in briefing tomorrow
3. **Education:** School tab → classes load → study plan generates → check-in with photo → OCR text appears
4. **Sign out/in:** More → Settings → Sign out → /login → sign in → data intact
5. **Child flow:** Parent adds child → link code → child claims → child sees school, no "Add a child"
6. **Red Alert:** Urgent item → DEFCON 1 visual + sound → dismiss → normal
7. **Offline:** Go offline → add task → reconnect → syncs

**Gate:** All critical paths verified in browser on staging by a human.

### 2.4 Non-Functional Tests

| Category | Method | Target |
|----------|--------|--------|
| Performance | Lighthouse CI | p95 load <2s; LCP <2.5s |
| Load | k6 simulation | 100K concurrent; p95 API <300ms |
| Accessibility | axe-core + manual | WCAG 2.1 AA; keyboard-only full flow |
| Mobile | Real devices (iOS Safari, Chrome Android) | No layout breakage; PWA installable |
| Reduced motion | `prefers-reduced-motion` emulation | Still images; no animation |
| Security | RLS verification queries; OWASP ZAP scan | Zero critical findings |

## 3. Phase Test Gates

| Phase | Gate |
|-------|------|
| Foundation | Landing renders; auth works; toolbar + mascot + Home browser-verified |
| Hardening | All migrations applied; RLS verified per-table; rate limits tested; staging deploy green |
| Education | School data loads from ≥1 source; study plan generates; OCR reads a real photo |
| Comms + Shopping | Gmail/Outlook connect; lists share via link |
| Health + Finance | Manual entry persists; bills remind; stocks display |
| Launch | Load test passes; security review clean; legal signs off; founder approves |

## 4. Regression Strategy

- **On every commit:** Unit + integration suites run (CI)
- **On every staging deploy:** Smoke test (/, /login, /auth/callback, key applets) + manual spot-check
- **Weekly:** Full E2E critical-path sweep on staging
- **Pre-launch:** Full regression + load + security + accessibility

## 5. Defect Management

| Severity | Definition | SLA |
|----------|------------|-----|
| S1 | Data loss, auth broken, blank page | Fix + deploy <4h |
| S2 | Feature broken, workaround exists | Fix <24h |
| S3 | Cosmetic, minor UX | Next phase |
| S4 | Enhancement request | Backlog |

**Rules:**
- Every S1/S2 gets a root-cause note in the repo
- No S1/S2 open at phase gate
- Repro steps + screenshot required on every defect

## 6. Test Environments

| Env | URL | Purpose |
|-----|-----|---------|
| Local | `localhost:3000` | Developer iteration |
| Staging | `crystal-staging.pages.dev` | Phase gates; browser verification |
| Production | `crystal.pages.dev` | Launch only; founder approval required |

## 7. Roles

| Role | Responsibility |
|------|---------------|
| Build teams | Unit + integration tests for their code |
| Build coordinator | Phase gate verification |
| Founder (Mehedi) | Final browser verification; launch approval |

---

*Requirements: BRD.md · Design: TDD.md · Execution: MCP.md*
