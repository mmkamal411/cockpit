# Data Resilience Implementation Checklist

**Plan:** `data-resilience-plan.pdf` (v1.0, 2026-10-13)
**Goal:** Unbreakable school data sync — no single point of failure across 6 data sources.

---

## Phase 1: Critical Bug Fixes (Week 1)

These are the CRITICAL/HIGH issues the Python expert team found in the current sync code. Fix before building anything new.

- [x] **C1:** Silent data erasure — empty API responses counted as success, overwriting good data. Add minimum-viable-payload gate. **DONE 2026-10-13:** `_is_viable_gradebook()` gate in `parentvue_pull.py` + abort-on-empty in `parentvue-laptop-sync.py`.
- [x] **C2:** Raw password in SOAP XML — special chars break login silently. Add XML escaping. **DONE 2026-10-13:** `xml.sax.saxutils.escape()` in `_soap_envelope()`.
- [x] **H1:** Auth-failure by substring causes extra bad logins (lockout risk). Catch `StudentVueAuthError` explicitly instead of substring matching. **DONE 2026-10-13:** `login()`, `_login_rest()`, `_call_rest()` now catch typed exception. Substring retained only for SOAP text errors.
- [x] **H2:** No laptop staging — pulls write directly to Supabase. Add local staging + verify before push. **DONE 2026-10-13:** `stage_payload()` writes to `staging/`, verifies round-trip, archives on success.
- [x] **H3:** Dead code marking failures as success. Remove or fix. **DONE 2026-10-13:** Audited — main case fixed by C1 gate. No other dead code found.
- [x] **H4:** Session nuking on transient errors. Don't clear session on network timeouts. **VERIFIED 2026-10-13:** Already correct — token only cleared on HTTP 401. No change needed.
- [x] **H5:** Race conditions in concurrent pulls. Add locking. **DONE 2026-10-13:** `acquire_lock()` with fcntl/msvcrt. Exit code 5 if already running.
- [x] **H6:** --env-file hard-fails even with env vars set. **DONE 2026-10-13:** `load_env_file()` takes `explicit` flag; only raises when user explicitly passed `--env-file`.

---

## Phase 2: Transport Fallback per Source (Weeks 2-3)

Each source gets 3 transport methods. If primary fails, auto-fallback to next.

### ParentVUE
- [ ] REST API primary (working — verify from laptop)
- [ ] SOAP API fallback (code exists in `parentvue_pull.py` — test it)
- [ ] Web scrape fallback (build if needed)

### CTLS Parent
- [ ] Form POST + session cookies primary
- [ ] Web scrape fallback

### StudentVUE (via SSO)
- [ ] Browser/SSO automation primary (laptop workers)
- [ ] Document: mobile REST API does NOT work for SSO — don't try

### CTLS Learn
- [ ] Browser/SSO automation primary

### Office 365 Email
- [ ] Microsoft Graph API primary
- [ ] IMAP fallback

### Office 365 Calendar
- [ ] Microsoft Graph API primary

---

## Phase 3: Laptop Backup Workers (Week 3) — IN PROGRESS

- [x] ParentVUE sync script built (`cockpit-sync/parentvue/parentvue-laptop-sync.py`)
- [x] MacBook files deployed + keychain credentials stored
- [x] MacBook scheduler configured
- [ ] Windows credential storage (keyring — Meheldi running now)
- [ ] Windows scheduler registration
- [ ] Dawson's crew UUID in both configs (blocked: needs crew member created in app)
- [ ] End-to-end test pull from at least one laptop
- [ ] Verify data lands in `crew_grade_syncs` with `pull_method='parentvue-laptop'`

---

## Phase 4: Cloud Sync Orchestrator (Weeks 4-6)

The missing piece for new user onboarding.

- [ ] Design: queue-based orchestrator (reads `crew_credential_pending`, dispatches workers)
- [ ] ParentVUE cloud worker (runs on VM or Cloudflare — needs egress fix)
- [ ] StudentVUE/SSO worker (requires browser automation in cloud — evaluate options)
- [ ] CTLS workers
- [ ] Office 365 Graph API workers (email + calendar)
- [ ] Initial data dump: < 15 min from credential entry
- [ ] Ongoing sync: hourly during school days

---

## Phase 5: Health Monitoring & Alerting (Week 6)

- [ ] `sync_health` table (schema in plan Appendix B)
- [ ] `credential_events` table (auth failures, lockout warnings)
- [ ] Standby promotion via `pg_try_advisory_lock`
- [ ] Dashboard: per-source "last synced Xh ago" indicators
- [ ] Alerts: > 4h stale grades → notify; auth failure → immediate alert, no retry
- [ ] Watchdog: existing `cockpit-sync-watchdog` extended for new sources

---

## Phase 6: New User Onboarding Pipeline (Week 7)

- [ ] Credential entry → immediate validation (fix ParentVUE API from Workers, or defer to worker)
- [ ] Queue in `crew_credential_pending`
- [ ] Orchestrator picks up within 5 minutes
- [ ] Initial dump: classes, grades, assignments, schedule
- [ ] Dashboard populates progressively (not blank → full)
- [ ] Path-to-90 calculates once grades land
- [ ] Welcome nudge: "Your data is ready"

---

## Phase 6b: Child Login Flow (Week 7)

Dawson (15, shared agency tier) needs his own sign-in. Backend exists (link_codes table, API route), UI does not.

- [ ] 6-digit link code generation UI (parent side, 15-min expiry)
- [ ] Child sign-in page (enter code → verify → create session)
- [ ] Email verification path (child signs in with school email matching crew record + consent screen)
- [ ] Child dashboard view (grades, Path-to-90, check-ins — scoped by sharing rules)
- [ ] Age-tier enforcement (under 13: no login; 13-15: shared agency + 7-day cooling; 16-17: instant revoke; 18+: adult prompt)
- [ ] "Go independent" graduation flow (18+)

---

## Phase 7: Testing (Week 8)

- [ ] Transport fallback: kill REST, verify SOAP takes over
- [ ] Source fallback: kill ParentVUE, verify StudentVUE fills gap
- [ ] Infra fallback: kill cloud worker, verify laptop workers continue
- [ ] Credential failure: wrong password → clean error, no lockout, no retry storm
- [ ] Onboarding: new test user → data in < 15 min
- [ ] Chaos: kill Supabase mid-sync → graceful degradation, auto-recovery
- [ ] Load: 100 concurrent syncs → no degradation

---

## Loopholes Identified (need solutions)

1. **Cobb Conditional Access:** New devices trigger "untrusted device" challenges. Laptops are trusted; cloud workers are not. May need device registration flow.
2. **Microsoft SSO in cloud:** StudentVUE/CTLS Learn require browser SSO. Headless browser in cloud worker? Or laptop-only for student sources?
3. **Rate limiting:** 6 sources × hourly = many requests. Cobb may throttle. Need backoff + jitter.
4. **Credential rotation:** When parent changes ParentVUE password, all workers fail. Need re-auth nudge flow (built — needs testing).
5. **Multi-child:** ParentVUE `GetChildListData` returns multiple children. Current code picks first. Need per-child routing.

---

## Sign-off

Each phase needs Meheldi's review before proceeding to the next.

- [ ] Phase 1 complete — Meheldi reviewed
- [ ] Phase 2 complete — Meheldi reviewed
- [ ] Phase 3 complete — Meheldi reviewed
- [ ] Phase 4 complete — Meheldi reviewed
- [ ] Phase 5 complete — Meheldi reviewed
- [ ] Phase 6 complete — Meheldi reviewed
- [ ] Phase 7 complete — Meheldi reviewed
- [ ] **Resilience plan fully implemented**
