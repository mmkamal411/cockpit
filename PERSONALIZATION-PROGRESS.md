# Personalization Stack — Progress Tracker

**STATUS: PHASE_0_IN_PROGRESS**

This is the living checklist for the personalization stack build. The build team updates the per-phase checkboxes; the hourly monitor parses the `STATUS:` line above.

Status values: `EVALUATING` → `PHASE_0_IN_PROGRESS` → `PHASE_1_IN_PROGRESS` → `PHASE_2_IN_PROGRESS` → `PHASE_3_IN_PROGRESS` → `PHASE_4_IN_PROGRESS` → `PHASE_5_IN_PROGRESS` → `COMPLETE`.

**Numbering note (2026-10-13):** migration `018_security_phase0.sql` takes 018 (it gates the build). The personalization data-layer draft in `personalization-eval/09-dbadmin-schema-rls.md` (§8, "018_personalization.sql") moves to **019**. Update the filename + header when that migration is written.

---

## Phase 0 — Security & integrity fixes (GATING)
- [x] A1 (CRITICAL): drop anon policies on `crew_grade_syncs`; revoke anon grant on `rpc_get_latest_crew_grade_sync`; add caller check for `authenticated` — DONE 2026-10-13 (migration 018, commit 0c10bda). Workers move to per-crew-member secrets (`crew_sync_worker_secrets` + `rotate_crew_worker_secret()`); push RPC requires `p_data.worker_secret`; get-latest RPC checks steward/grantee/secret. Laptop + ParentVUE scripts updated to send the secret. **Awaiting Meheldi running 018 in SQL editor, then anon-denial re-verification.**
- [x] A2 (HIGH): envelope-encrypt Google Calendar refresh tokens (KMS/data key) — DONE 2026-10-13 (commit 0c10bda). AES-256-GCM via `src/lib/token-crypto.ts`, key from `CALENDAR_TOKEN_KEY` env (fail closed). **Needs `CALENDAR_TOKEN_KEY` set in Cloudflare Pages env vars before calendar OAuth goes live.**
- [x] A3 (HIGH): `redeem_share_invite` — use `auth.uid()`/JWT email, require email match, revoke anon grant — DONE 2026-10-13 (migration 018, commit 0c10bda). `/invite/[token]` page updated to the 1-param signature.
- [x] A4 (MEDIUM): `find_pilot_by_email` — inline into share-creation RPC with ownership check — DONE 2026-10-13 (migration 018, commit 0c10bda) as list-scoped resolution: `find_pilot_by_email(p_email, p_list_id)` verifies the caller owns the list; uniform null otherwise. Shares route updated.
- [x] A5 (MEDIUM): admin `view-as` — require both auth layers — DONE 2026-10-13 (Phase 0 squad: `requireAdminBothLayers` = ADMIN_EMAILS allowlist + `is_admin` DB RPC, fail-closed, plain-English 403)
- [x] W1 (HIGH): Crystal worker `/chat` + `/quiz` shared-secret auth — DONE 2026-10-13 (Phase 0 squad: app attaches `Authorization: Bearer CRYSTAL_WORKER_SECRET` server-side, fail-closed when unset; zero client-direct worker URL hits; worker-side v2 contract + 400s in d-dash repo `phase0/w1-worker-secret-auth`, needs wrangler secret + redeploy)
- [x] C1 (HIGH): context contract v2 + privacy sign-off — DONE 2026-10-13 (Phase 0 squad: canonical `src/lib/chat/contract.ts` + CONTRACT.md field inventory; **P0 fixed: child names/relationships no longer sent to worker**; loud ContractViolationError guards)
- [x] Fix `bills/logic.test.ts` + `health/glucose.test.ts` (extensionless imports) — DONE 2026-10-13: explicit `.ts` extensions (repo convention); same-class fix applied to `subscriptions/logic.test.ts` and the `nudges/producers` sources so the whole suite runs under plain Node.
- [x] Resolve smoke-test URL mismatch (`cockpit-10c.pages.dev` vs `cockpit.pages.dev`) — DONE 2026-10-13: **https://cockpit-10c.pages.dev is canonical** (Meheldi confirmed); locked in DEPLOY.md, `deploy-staging.py`, `smoke-test-staging.py`, `src/lib/nudges/PRODUCERS.md`.
- [x] Re-audit A1–A5 after fixes; `npm test` green — DONE 2026-10-13 (coordinator re-audit: all five verified in code; 207/207 tests green; tsc + eslint clean)

## Phase 1 — Foundation
- [ ] Migration 018 applied (signals, aggregates, pilot_preferences, layout_versions, corrections, feature_flags) with RLS + indexes
- [ ] `POST /api/signals/batch` live; RLS cross-pilot tests pass
- [ ] First-run onboarding captures name + timezone
- [ ] `cockpit-scheduler` Cloudflare Worker deployed; `/api/cron/*` secured
- [ ] "Block the endpoint → app behaves identically" test passes

## Phase 2 — ARRANGE v1
- [ ] Module registry refactor (ordering no longer hardcoded); `useLayout()` hook
- [ ] Layout scoring engine (`src/lib/layout/engine.ts`); v1 formula; recompute-on-trigger
- [ ] `GET /api/layout`, `POST|DELETE /api/layout/override`, `POST /api/layout/recompute`
- [ ] Dynamic rendering: More applet + Home "Today's stations" deck; 3 tiers; FLIP transitions
- [ ] Override controls (pin/send-to-lower-deck/why) with undo; local-first persistence
- [ ] Generalized `<WhyThis>` component; causal `whyLine` for nudges
- [ ] 11 ranking invariants property-tested; layout p95 < 300ms; 100% explanation coverage
- [ ] Browser-verified on staging

## Phase 3 — KNOW v2
- [ ] LLM-summarized preference doc generated, pilot-editable, pilot-deletable
- [ ] "What does Crystal know about me?" view (provenance, Keep/Forget, kill switches)
- [ ] 5-layer context pipeline (L0→L4, ≤3,400 tok); real token counting enforced
- [ ] Per-source timeouts + provenance flags; rolling thread summaries; edge-cache fix
- [ ] Degraded-mode chaos drills pass; privacy invariant tests green

## Phase 4 — ADAPT
- [ ] Correction affordances ("This was wrong" 3-choice + undo) live
- [ ] Feedback update rules (diminishing dismissals, anti-runaway caps, ±15 learned-delta cap)
- [ ] Bayesian nudge weights (prior = today's scores; zero-history regression test)
- [ ] Thompson sampling layout bandit (±25% modulation, weekly decay)
- [ ] Exploration probes (≤1/day, honest framing, doubling backoff)
- [ ] Dark-launch shadow override <25% for 7 days

## Phase 5 — Hardening & verification
- [ ] 12 privacy acceptance criteria (AC-1…AC-12) green
- [ ] Kill-switch drill passes; fail-closed verified
- [ ] Rollout 10→50→100% complete
- [ ] Observability live (override rate, latency, explanation coverage, free-tier tripwires)
- [ ] Browser verification of every UI claim on staging

---

## Per-layer status

| Layer | Status | Notes |
|---|---|---|
| KNOW | Evaluation done; blocked on Phase 0 (A1–A4) | v1 = rules+explicit; v2 = LLM preference docs; embeddings deferred |
| ARRANGE | Evaluation done; unbuilt (zero writers to `cockpit_layouts`) | v1 formula validated; v2 bandit designed; UI can ship before engine |
| ANTICIPATE | Built (28 tests pass); gaps identified | Needs causal whyLine, impression tracking, learning hooks |
| ADAPT | Evaluation done; unbuilt | Correction affordances + update rules + Bayesian/bandit designed |

## Founder decisions needed
See `PERSONALIZATION-BUILD-PLAN.md` §8 (8 open questions: retention policy, cron-trigger budget, canonical smoke-test URL, CI service_role, crew/child signal scope, Crystal BASE 85, aggregation runtime, Phase 0 fix-squad approval).

## Source material
`personalization-eval/00-security-threat-model.md` … `11-devops-deploy-observability.md` (12 reports, ~4,000 lines).
