# Cockpit — Master Status

**Last updated:** 2026-10-13 ~01:20 EDT by Fireball
**Staging:** https://cockpit-10c.pages.dev — 🔴 500s on `/`, `/login`, `/auth/callback` (deep-dive team active)
**Repo:** `mmkamal411/cockpit` (main) — tsc clean as of 01:14 EDT

---

## Phase 1 Modules

| Module | % | Status | Blocker |
|---|---|---|---|
| Weather | 90% | Expanded views, hourly/7-day, location picker, °F/°C — done | Migration 006 + staging verify |
| Calendar | 60% | UI + 7 API routes + OAuth flow built | Google OAuth client (Mehedi), sync engine, migration 013, staging verify |
| To-dos | 95% | Unified hook, 5 API routes, NL parser, localStorage dedupe done | Migration 011 + staging verify |
| Today Briefing | 85% | Composer + briefing UI done | Staging verify |
| Crystal Chat | 100% (code) | Mode pill, thread persistence, /api/chat (flag-gated), context bundle, streaming — done | Migration 014 + staging verify |
| Nudges | 100% (code) | Scoring engine, 6 API routes, nudge-center applet, producer docs — done | Migration 009 + producers + staging verify |

## Phase 2 Modules

| Module | % | Status | Blocker |
|---|---|---|---|
| Shopping Lists | 90% | 6 API routes, applet, in-store mode — done | Migration 010 + staging verify |
| Health Basics | 90% | 6 API routes, 4-metric logging, trends, streaks — done | Migration 012 + staging verify |
| Money/Bills | 85% | 10 API routes, applet, 38/38 tests — done | Migration 007 + staging verify |
| Crew/School | 70% | **localStorage trap FIXED** — writes to DB now; 9 API routes, link codes, path-to-90 table | Migration 008 + staging verify |

## Infrastructure & Parallel Workstreams

| Workstream | Status |
|---|---|
| **Staging 500s** | 🔴 Deep-dive team (edge runtime + build + error audit) investigating. Blocks ALL browser verification. |
| **Migrations 003–015** | ✅ **APPLIED 2026-10-13 ~01:30 EDT** — verified via REST: all tables exist (bills, chat_threads, calendar_events, nudge_preferences, path_to_90_checks, link_codes, health_streaks, etc.). 016 (shopping shares) pending build. |
| **Supabase egress** | ✅ **CLEARED ~01:30 EDT** — VM→Supabase reachable again after block since 2026-10-12 22:40 EDT. ParentVUE pushes, watchdog, and all background Supabase jobs unblocked. |
| **ParentVUE fallback** | ✅ Rebuilt 2026-10-13. Pull script tested 7/7, merge spec written (`~/workspace/cockpit-sync/parent/`). Staged locally — blocked on Supabase egress + Dawson's crew_member_id (needs Mehedi sign-in). 4x-daily cron drafted, awaiting approval. |
| **Sync installer** | Docs revised: no CA certs for v1 (Mac: free self-signed for Keychain stability — Mehedi approved), parent's computer, hourly sync + boot sync. Phase 1 locked. (`~/workspace/cockpit-installer/`) |
| **Hourly updates** | Crons `phase1-progress-update` + `phase2-progress-update` firing hourly. |
| **Laptop deployment** | Python expert deploying to MacBook/Windows; blocked on Dawson's crew UUID (needs staging). |

## Mehedi's Action Items

1. ⬜ Run migration bundle (003–014) in Supabase SQL editor
2. ⬜ Create Google Cloud OAuth client (Calendar API scope) → provide client ID/secret
3. ⬜ Decide: school 2FA support in installer (ship with or without?)
4. ⬜ Decide: final company name for future code-signing identity
5. ⬜ Approve ParentVUE 4x-daily cron (after egress clears)

## Key Decisions (2026-10-13)

- Sync installer: **no code-signing certs for v1**; buy before public launch (Win EV ~$300–500/yr, Apple $99/yr)
- Sync installer: **parent's computer**, hourly sync while on + immediate sync on boot; self-signed update packages
- ParentVUE fallback **restored as priority** — standing directive since 2026-10-06; dual-source merge on `crew_grade_syncs.pull_method` (student wins conflicts, fresh parentvue beats >24h-stale student)
- Supabase outage diversion: Tier 1 stage-locally + briefings from snapshots (live); Tier 2 MacBook relay (unverified); Tier 3 egress canary (to build)
- Migration numbering: single sequence 001–014 (fixed 013 collision)

## Notes

- Six parallel teams caused repo collisions (006/007/008, 013, wiped files once). All resolved; tsc clean. Serialize shared-file work if collisions recur.
- `crew_grade_syncs` replaces old `parent_sync`/`student_sync`/`merged_syncs`. Key = `crew_member_id` UUID, never names.
- Old Supabase project dead (NXDOMAIN). VM→Supabase egress blocked since 2026-10-12 ~22:40 EDT.
