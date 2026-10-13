# Cockpit CI Pipeline Handbook

**Audience:** Meheldi (the plain-English parts) and the engineering team (the SOP parts).
**Status:** Built and committed 2026-10-13. First green run: **pending** (the CI database is being provisioned; this doc will be updated when the first run goes green).
**Related docs:** `docs/CI-SECRETS.md` (threat model + secret rules) · `docs/CI-ROTATION.md` (key rotation runbook)

---

## In plain English: what is CI and why do we have it now?

Before CI, our quality control was a person (me, the agent) remembering to run checks before every deploy. It worked — until the day it wouldn't. CI ("continuous integration") is a robot that runs the same checks automatically every single time anyone pushes code, and refuses to stay quiet when something breaks. It never forgets, never gets tired, never skips a step because it's 11pm.

The most important thing CI does for Cockpit that we never had before: **it tests the database's security rules.** Our app stores family data — kids' grades, health info, to-dos — and the database has locks ("row-level security") that are supposed to guarantee one family can never see another family's data. Before CI, nobody ever *tested* those locks automatically. We just believed they worked. CI now attacks those locks on every push, pretending to be a stranger, and fails the build if any lock is open.

---

## 1. Before: what we used to do

### The old quality gate, step by step

1. A developer (or an agent team) wrote code and committed it to a branch.
2. Before deploying, someone ran three checks by hand on their own machine:
   - `npx tsc --noEmit` — "does the TypeScript compile?"
   - `npx eslint` — "does the code follow our style/correctness rules?"
   - `npm test` — "do the ~200 unit tests still pass?"
3. If those looked fine, `python3 deploy/deploy-staging.py` ran the deploy pipeline:
   - Rebuild the app from source (it refuses to deploy a stale build — a lesson from the 2026-10-13 outage where a dirty build shipped).
   - Upload the build to Cloudflare Pages (`cockpit-10c.pages.dev`).
   - Run `deploy/smoke-test-staging.py`, which makes 5 real HTTP assertions against the live site: `/` responds, `/login` renders a real page, `/auth/callback` redirects gracefully, videos and static assets serve correctly.
4. Separately, database migrations (SQL schema changes) were applied by **pasting SQL into the Supabase dashboard's SQL editor by hand** — by Meheldi himself in several cases — and verified by eyeballing the "Success" message.
5. Finally, I verified important changes end-to-end in my own browser before anything was announced ("test before you claim").

### What was wrong with it (honest assessment)

- **A human had to remember.** If anyone skipped step 2 — or ran the tests but didn't notice a failure scroll by — broken code shipped. There was no enforcement, no record, no second pair of eyes.
- **Zero database verification.** Migrations were pasted and eyeballed. Nothing ever *tested* whether the row-level security policies actually locked out strangers. A typo in a policy could expose one family's data to another and nothing in the process would catch it.
- **"Worked on my machine."** Tests ran on a developer's laptop with their local setup. The build that shipped was only as clean as that one machine.
- **Incident: the missing-pilots-row bug class.** New users (Sabah's broken chat, Dawson's missing classes) were admitted with no `pilots` row because the signup code swallowed errors silently. Nothing in the old process tested "sign up a user, then verify their data is isolated and present." CI's RLS suite exists precisely to catch this class of bug — it creates two fake users and verifies each can only see their own data.
- **Incident: stale-deploy confusion.** A deploy once shipped mismatched assets (new HTML, old JavaScript) because a version-bump script silently skipped files. The deploy script now refuses dirty builds, but the lesson is the same: humans miss things; robots don't.
- **Incident: the env-var activation trap.** A key was set in the Cloudflare dashboard but didn't take effect until the next deploy — "deployed" and "live" were silently different things for an hour. Manual processes have invisible gaps like this.
- **Secrets traveled by hand.** Keys moved dashboard → chat/notes → config files. Every hop was a chance to leak the most powerful credential we have.

The old process got us here and deserves credit — but it doesn't scale past one careful person watching everything.

---

## 2. What we built

### Architecture

```
Developer pushes code
        │
        ▼
┌─────────────────────────────┐
│  GitHub Actions: "ci"       │  runs on EVERY push and EVERY pull request
│  workflow (.github/         │
│  workflows/ci.yml)          │
└────────┬────────────┬───────┘
         │            │
         ▼            ▼
   ┌──────────┐  ┌──────────────┐
   │  build   │  │  rls-tests   │  (runs only if build passes)
   │  job     │  │  job         │
   └──────────┘  └──────┬───────┘
                       │ talks to
                       ▼
              ┌──────────────────┐
              │  cockpit-ci      │  dedicated Supabase project (FREE tier)
              │  Supabase        │  synthetic data ONLY — fake pilots,
              │  project         │  fake students, made-up grades
              └──────────────────┘
```

**Job 1 — `build`** (no secrets needed): checks out the code, installs dependencies with `npm ci` (clean, reproducible install — not "whatever is on my laptop"), then runs `tsc --noEmit`, `eslint`, and `npm test` on GitHub's servers. If any of these fail, the run stops here.

**Job 2 — `rls-tests`** (needs the CI secrets): runs only after `build` passes. It executes `scripts/ci/rls-tests.mjs` — a zero-dependency Node script that:

1. Creates two synthetic auth users (`ci-pilot-1@example.invalid`, `ci-pilot-2@example.invalid`) via the Supabase Auth Admin API.
2. Seeds synthetic fixtures (fake pilots, fake students, fake todos, fake grade snapshots) with fixed UUIDs that match `supabase/seed-ci.sql`.
3. Runs **9 PASS/FAIL assertions** against the live RLS policies (see §4).
4. Deletes the synthetic users (which cascades and cleans up their data). Exit code 0 only if all 9 pass.

### The isolated CI database

`cockpit-ci` (Supabase project ref `phvooaayyueobofhwxyi`) is a **separate Supabase project** from the real `cockpit` project. It runs on the **free tier** and holds **synthetic data only** — fictional pilots, students with names like "Sample Student One", made-up grades, `@example.invalid` email addresses (a domain guaranteed to never resolve, per RFC 2606).

Why a separate project? **Blast-radius bounding.** The test job needs the `service_role` key, which bypasses *all* database security — it's the master key. Instead of trying to make the master key weaker (impossible), we shrank what it can reach: even if the CI key leaked completely, there is nothing real to steal. CI holds **no credential at all** for the real `cockpit` project — by design, not by accident.

The old `pookie` Supabase project was deleted (it was empty — test-era accounts only) to free the account's free-tier project slot for `cockpit-ci`.

### How secrets flow (the important part)

```
Supabase dashboard (cockpit-ci → Settings → API)
        │  Meheldi copies the key
        ▼
GitHub repo → Settings → Environments → "ci"
        │  pasted directly into encrypted environment secrets:
        │  CI_SUPABASE_URL / CI_SUPABASE_ANON_KEY / CI_SUPABASE_SERVICE_ROLE_KEY
        ▼
GitHub Actions injects them ONLY into the rls-tests job, at run time
```

**The rules (from `docs/CI-SECRETS.md` — read the 🔴 RED INK header there):**

- Never in chat, email, or messages. If a key appears in chat, treat it as compromised: regenerate it in the dashboard and update GitHub.
- Never in logs — the test script masks keys to their last 4 characters.
- Never in files or code — `.env*` is gitignored; verify before every push.
- Only the `ci` **environment** gets these values — not repo-level secrets, not forks, not Codespaces. The `build` job never sees them.
- Rotate quarterly (`docs/CI-ROTATION.md`).

**The risk Meheldi accepted:** the `service_role` key bypasses all row-level security — anyone holding it can read/write/delete everything in `cockpit-ci`. The mitigations are: (1) it only ever touches the synthetic-data project, (2) it's injected only into the one job that needs it, (3) it's never written down anywhere, (4) it's rotated quarterly. If real data is ever found in `cockpit-ci`, that's a stop-everything incident: wipe the project, regenerate all keys, re-seed synthetic.

---

## 3. Detailed benefits

### For Meheldi (founder)

- **Bugs get caught before deploy, not after.** A broken commit is flagged on the pull request within minutes, with the exact failing check named. No more "did anyone run the tests?"
- **The family's data locks are tested, not trusted.** Every push re-proves that one pilot can't see another pilot's data — the exact class of bug that broke Sabah's chat and hid Dawson's classes.
- **A written record.** Every check, on every push, is logged in the GitHub Actions tab with timestamps. When something breaks, the history shows when it started.
- **Cheaper than the alternative.** No new vault product, no paid CI minutes at our scale, free-tier Supabase for the CI database. The whole setup costs $0/month.

### For developers

- **Fast feedback loop.** Push → ~2–5 minutes → green or red with the failing assertion named. No waiting for someone to manually verify.
- **Clean-room builds.** `npm ci` on a fresh GitHub runner means "worked on my machine" stops being an excuse — if it passes CI, it builds from scratch.
- **Merge with confidence.** A green CI run on a pull request means: it compiles, it lints, unit tests pass, *and* the database security rules hold. That's a merge checklist no human has to maintain.
- **The RLS suite is a specification.** The 9 assertions document what "secure" means for this app in executable form. New tables/policies get new assertions (see SOP §5d).

### For security

- **Adversarial testing of RLS on every change.** The suite doesn't just test the happy path — it signs in as Pilot A and tries to read Pilot B's rows, and calls the grade-sync RPC as an anonymous stranger without the worker secret. Any migration that weakens a policy turns the build red.
- **Least-privilege secret scoping.** The powerful key exists only inside the one job that needs it, in the one environment that holds it, for the minutes the job runs.
- **Synthetic-data-only blast radius.** Documented, enforced by convention, and declared a stop-everything incident if violated.

---

## 4. How it operates

### Triggers

The workflow runs on **every `push`** (any branch) and **every `pull_request`**. There is no schedule and no manual trigger needed — pushing code *is* the trigger.

### The job graph

| Job | Runs when | Needs secrets? | What it does |
|---|---|---|---|
| `build` | always | No | `npm ci` → `tsc --noEmit` → `eslint` → `npm test` |
| `rls-tests` | only if `build` passes | Yes (`ci` environment) | Creates 2 synthetic users → seeds fixtures → 9 RLS assertions → cleans up |

### The 9 RLS assertions (what "secure" means, in code)

From `scripts/ci/rls-tests.mjs` — each prints `PASS` or `FAIL`, and any `FAIL` fails the whole job:

1. **Project reachable** — `service_role` can read `pilots` (sanity: we're talking to the right project).
2. **Anon lockdown: grade syncs** — anonymous (no login) requests to `crew_grade_syncs` get denied or zero rows (post-018 expectation).
3. **Anon lockdown: pilots** — anonymous requests to `pilots` get denied or zero rows.
4. **Self-access** — Pilot A can read exactly their own pilot row.
5. **Cross-pilot isolation** — Pilot A querying Pilot B's row gets zero rows.
6. **Crew isolation** — Pilot A sees exactly their own 2 crew members, nothing else.
7. **Grade-sync isolation** — Pilot A sees only grade syncs belonging to their own crew.
8. **Mirror isolation** — Pilot B sees exactly their own 1 crew member.
9. **Worker-secret hardening** — calling `rpc_get_latest_crew_grade_sync` anonymously *without* the worker secret returns `{}` (empty — never data).

### Reading a run

GitHub repo → **Actions** tab → click the run → two jobs listed. Green check = passed, red X = failed. Click a job to see the step log; the RLS job prints each assertion as `PASS <name>` / `FAIL <name> — <detail>`.

### The CI database lifecycle

- `cockpit-ci` is a **long-lived** project (not wiped per run). Its schema is maintained by applying the repo's migrations to it (see SOP §5c).
- Each `rls-tests` run is **self-seeding and self-cleaning**: it upserts its fixtures via the API (idempotent — safe to re-run after a partial failure) and deletes the two synthetic auth users at the end, which cascades and removes their pilots, crew, todos, and syncs.
- The repo's `supabase/seed-ci.sql` is the human-readable twin of the script's fixtures (same fixed UUIDs, same fake names). If you change one, change the other.

### Honest note on scope

CI **does not** currently rebuild the database from scratch on each run, and it **does not** deploy anything. It verifies code + database security. Deploys remain the manual `deploy-staging.py` script + my browser verification, per Meheldi's "test before you claim" rule.

---

## 5. SOP — Standard Operating Procedures

### (a) Developer workflow: branch → push → CI → merge

1. Create a feature branch from the current staging branch (`git checkout -b feature/<name> origin/staging/crystal-robot-improved`).
2. Make changes. Keep code clean: no dead code, no commented-out blocks, no unused imports, no `console.log`s (Meheldi's standing rule — CI's eslint enforces part of this).
3. **Before pushing**, run the secret check: `git diff --cached | grep -iE "service_role|secret|password"` — expect nothing back.
4. Push: `git push origin feature/<name>`. **Every commit gets pushed** (Meheldi's standing rule — no commit sits unpushed).
5. Watch the Actions tab. Both jobs must be green before merge.
6. Open a pull request against the staging branch if the change is meant for others to review; otherwise merge when green.
7. Deploy to staging remains manual (`deploy/deploy-staging.py`) + browser verification. CI passing ≠ deployed.

### (b) When CI is red — triage

1. **Open the failing run** (Actions tab) and identify which job failed: `build` or `rls-tests`.
2. **If `build` failed:** read the failing step's log.
   - `tsc` failure → a type error; fix the types, push again.
   - `eslint` failure → rule violation named in the log; fix, push again.
   - `npm test` failure → the failing test name is printed; fix the code *or* the test (if the test's expectation is outdated, update the test deliberately — never delete a failing test to make CI green).
   - Owner: the developer who pushed. No escalation needed for routine failures.
3. **If `rls-tests` failed:** read which assertion(s) failed.
   - A `FAIL` naming anon access (assertions 2, 3, 9) → a migration likely loosened a policy. **Do not merge.** Find the migration, fix the policy, re-apply to `cockpit-ci` (SOP §5c), re-run.
   - A `FAIL` naming cross-pilot isolation (5, 6, 7, 8) → **treat as a potential data-exposure bug.** Stop, investigate, fix, re-verify. If the same failure reproduces against the real project's policies, escalate to Meheldi immediately.
   - A `FAIL` on assertion 1 (project reachable) or a `fatal` → infrastructure problem (cockpit-ci down, key rotated without updating GitHub, network). Check the key first (did someone rotate it?), then the project status.
   - Owner: the developer who pushed, with the security-minded reviewer looped in for isolation failures.
4. **Re-running:** Actions tab → the failed run → **Re-run failed jobs**. You can also just push an empty commit (`git commit --allow-empty -m "ci: re-run" && git push`) — a fresh push always triggers a fresh run.
5. **Flaky or infra failure?** If a re-run goes green with no code change, note it in the run's annotation. Two flakes in a week → file it as a CI reliability bug; don't normalize re-running.

### (c) Adding a new migration to CI

The CI database does **not** auto-apply migrations — its schema is maintained deliberately. When you add `supabase/migrations/NNN_*.sql`:

1. Apply it to the **cockpit-ci** project via the dashboard SQL editor (same browser flow as production migrations). Confirm "Success".
2. If the migration adds tables with RLS or changes policies, add corresponding assertions to `scripts/ci/rls-tests.mjs` (follow the existing `check(...)` pattern) — a migration without a test is a policy without a guard.
3. If the migration adds tables the fixtures should cover, update both `scripts/ci/rls-tests.mjs` (the `seed()` function) and `supabase/seed-ci.sql` (keep UUIDs and fake names in sync).
4. Push. CI runs the new assertions against the updated `cockpit-ci`.
5. **Never** apply CI-only or test-only migrations to the real `cockpit` project, and never apply real-data backfills to `cockpit-ci`.

### (d) Adding tests

- **Unit tests** live wherever the code is (`*.test.ts`), run by `npm test` (`node scripts/ci/unit-tests.mjs`). Add a test file next to the module it covers; the runner picks it up automatically.
- **RLS assertions** go in `scripts/ci/rls-tests.mjs` using the `check(name, ok, detail)` helper. Each assertion should test one security property, use the synthetic fixtures, and print a name that says what's being protected.
- **Rule of thumb:** if a PR changes a database policy, a migration, or an auth-adjacent API route, it should change or add an RLS assertion. Reviewers should ask for it.

### (e) Secret rotation

Follow `docs/CI-ROTATION.md`: quarterly (Jan/Apr/Jul/Oct, first Monday), owner Meheldi or his designated engineer. Regenerate the `service_role` key in the cockpit-ci dashboard → update the `CI_SUPABASE_SERVICE_ROLE_KEY` environment secret in GitHub → re-run CI to confirm green. Skipping a quarter breaks nothing — the old key keeps working — but don't skip twice.

### (f) CI database recovery (cockpit-ci is in a bad state)

Symptoms: `rls-tests` fails on assertion 1, fixtures conflict, or the dashboard shows unexpected tables/data.

1. **Diagnose first.** Most "bad state" is leftover synthetic users from a crashed run (cleanup is best-effort). Check Authentication → Users for `ci-pilot-1` / `ci-pilot-2` and delete them — cascade removes their data. Re-run CI.
2. **Schema drift** (cockpit-ci missing migrations the repo has): apply the missing migrations in numeric order via the SQL editor, then re-run CI.
3. **Real data found in cockpit-ci:** stop-everything incident. Wipe the project (or delete and recreate it), regenerate **all** its API keys, update all three GitHub `ci` secrets, re-apply all 27 migrations, re-seed, confirm a green run. Then write up how real data got there.
4. **Nuclear option** (project corrupted beyond repair): delete `cockpit-ci`, create a fresh free-tier project with the same name, re-apply migrations 001→033 in order (skipping the retired numbers), create the two auth users, run `seed-ci.sql`, update the three GitHub secrets, confirm green. Note: a fresh project gets a new ref/URL — the `CI_SUPABASE_URL` secret must be updated too.

### (g) Cost and blast-radius notes

- **Cost: $0/month.** GitHub Actions free-tier minutes (well within limits at our volume), Supabase free tier for `cockpit-ci`.
- **Free-tier limits to know:** 500 MB database, 1 GB storage, 2 GB bandwidth/month, 50,000 monthly active users. CI uses a tiny fraction of all of these — synthetic fixtures are kilobytes.
- **The 7-day idle pause:** free-tier Supabase projects pause after 7 days without activity. A paused `cockpit-ci` makes `rls-tests` fail on assertion 1 ("project reachable") with a connection error — **that looks like a CI failure but it's just a sleeping database.** Unpause it in the dashboard (one click) and re-run. If CI runs at least weekly, it never sleeps.
- **Blast radius, restated:** the worst case — a full leak of all three CI secrets — exposes only synthetic data in an isolated project. The real `cockpit` project, production data, and staging deploys are untouched. This is the entire point of the separate project.

---

## 6. Known limitations / honest caveats

- **First green run pending (as of 2026-10-13).** The workflow, tests, secrets model, and CI database all exist; the `cockpit-ci` migrations were being applied when this was written. This doc gets updated when the first run goes green.
- **No browser end-to-end tests.** CI verifies code compiles, unit tests pass, and database locks hold. It does not open a browser, sign in, or click through the app — that remains my manual verification before anything is announced.
- **No deploy automation.** CI doesn't deploy to staging or production. Deploys stay manual and gated on Meheldi's word (production) and my browser verification (staging).
- **Migrations aren't applied by CI itself.** The `cockpit-ci` schema is maintained by hand (SOP §5c). A migration that's in the repo but not applied to `cockpit-ci` will make `rls-tests` fail confusingly — check schema parity first when debugging.
- **Unit tests are code-level only.** They don't catch visual bugs, broken layouts, or "the button does nothing" — the browser pass catches those.
- **The RLS suite tests the policies we wrote assertions for.** A brand-new table with no assertion is untested until someone adds one (SOP §5d). The suite is a floor, not a ceiling.

---

*Last updated: 2026-10-13. Owner: Meheldi. When the first CI run goes green, update the status line at the top and check off the review list in `docs/CI-SECRETS.md`.*
