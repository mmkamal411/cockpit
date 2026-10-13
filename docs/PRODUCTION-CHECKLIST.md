# Cockpit Production Checklist

**Purpose:** everything that must be true before Cockpit serves real production users. Living document — add items as they surface; check them off only when verified, not when started.

**Owner:** Muse (Managing Director) · **Last updated:** 2026-10-13

---

## 🔴 Google OAuth verification (added 2026-10-13)

- [ ] **Consent-screen links:** add application home page, privacy policy URL, and terms-of-service URL to the OAuth consent screen (Google Cloud project `pookie-511319`).
- [ ] **Google verification:** complete Google's app verification for sensitive scopes before production launch. Scopes in use that trigger this: `.../auth/tasks` (sensitive), Calendar scopes.
- [ ] **Publish the app:** move the OAuth consent screen from **Testing** status to **Production**. (While in Testing, only test users can connect and refresh tokens expire after 7 days — this WILL break production users if forgotten.)
- [ ] Re-test Google Calendar + Google Tasks connect flows after publishing.

*Why this matters:* Google blocks unverified apps using sensitive scopes at production scale. Missing this gate = every Google integration breaks on launch day.

---

## Infrastructure

- [ ] **Supabase tier:** upgrade `cockpit` project off free tier (minimum Pro $25/mo). Free tier pauses the database after 7 idle days — an outage by design.
- [ ] **CI green:** first green CI run on `feature/ci-setup`, then branch protection on main/staging (no merge with red CI).
- [ ] **Env-var audit:** all required env vars present in Cloudflare Pages production (SUPABASE keys, CALENDAR_TOKEN_KEY, OUTLOOK keys, worker secrets). Additive PATCH only — never GET-and-rewrite.
- [ ] **Deploy path:** retire direct-upload deploys; git-connected Pages + CI before the second engineer or on-call rotation.
- [ ] **Backups:** confirm Supabase point-in-time recovery is enabled and tested (restore drill, not just the checkbox).

## Security & privacy

- [ ] **RLS re-audit** against production-shaped data (the 9-assertion CI suite runs on synthetic data; do a manual pass with real pilot/crew shapes).
- [ ] **Secret rotation:** rotate service_role key, worker secrets, OAuth client secrets; verify old ones are dead.
- [ ] **Data retention policies decided:** check-in text, emails, behavior signals (14-day raw-signal decision made 2026-10-13 — enforce it in code, not just docs).
- [ ] **COPPA/under-13 review:** production logins for under-13s (deferred-legal item from 2026-10-12).
- [ ] **Credit freeze + break-glass disclosure:** legal sign-off (deferred-legal from 2026-10-12).

## Product & launch

- [ ] **Custom domain:** cutover from `pages.dev` (dawsonkamal.com decision pending).
- [ ] **App Store / Play:** 12+ rating submissions.
- [ ] **Pricing & tiers:** free vs paid defined (Supabase tier decision informs unit cost — see `docs/SCALABILITY-STUDY.md`).
- [ ] **Support:** Help Center + FAQ with plain-language legal explanations; AI support chat; ticket flow.
- [ ] **Marketing site, onboarding funnel, analytics.**
- [ ] **Sync installer:** code-signing certs purchased before public launch (Windows EV + Apple Developer; currently shipping unsigned/self-signed per 2026-10-13 decision).

## Data & integrations

- [ ] **School-data partnerships:** official data-provider conversations started (scalability study's #1 risk — unofficial ParentVUE/StudentVUE scraping doesn't survive 10K families).
- [ ] **District-agnostic rebuilds:** email-class-matcher + cobb-calendar-sync rebuilt district-agnostic.
- [ ] **Outlook OAuth flow** built and verified (Azure app registered 2026-10-13; flow still queued).

---

*How to use this doc:* when a launch-blocking item surfaces anywhere (chat, build log, incident), add it here with the date found. Checking an item requires evidence (test output, screenshot, verification link) — "done" is not evidence.
