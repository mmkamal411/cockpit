# 🔴 RED INK — EXTRA REVIEW REQUIRED
> This document describes how Cockpit's CI handles its most sensitive credential.
> Meheldi: please read this in full before considering the CI setup done.

## The decision

**GitHub-native secrets — no new vault product.** We looked at adding a
secrets manager (Infisical, Doppler, HashiCorp Vault) and decided against it:
those tools add moving parts without meaningful gain at our scale.

- **The vault is GitHub environment secrets.** The three CI credentials live
  in the GitHub **`ci` environment** of the `mmkamal411/cockpit` repo —
  not in repo secrets, not in code, not in files.
- **A dedicated Supabase project bounds the blast radius: `cockpit-ci`.**
  It runs on the free tier and holds **synthetic data only** — fictional
  pilots (`ci-pilot-1@example.invalid`), fictional students ("Sample Student
  One"), made-up grades. It is a sandbox that exists so CI can verify our
  row-level security without ever touching real data.

## The threat model, in plain words

The CI job needs a **service_role** key. That key is the most powerful
credential in a Supabase project: **it bypasses ALL row-level security.**
Anyone holding it can read, write, and delete **everything** in that project.
There is no way to make it less powerful — that is what the key is for.

So instead of weakening the key (impossible), we **shrank what it can reach**:

- **cockpit-ci holds ONLY synthetic data.** Even if the key leaked, there is
  nothing real to steal — no family data, no grades, no emails.
- **cockpit-ci can never see the real `cockpit` project.** They are separate
  Supabase projects with separate keys. A key for one is useless for the
  other. CI has no credential for the real project at all — by design, not
  by accident.
- **The key is injected only for the `rls-tests` job** via the `ci`
  environment. The build job (typecheck, lint, unit tests) never sees it.

## What CI can touch vs. can NEVER touch

| CI can touch (cockpit-ci only) | CI can NEVER touch |
|---|---|
| Synthetic pilots, crew members, todos, grade snapshots — all fictional | The real `cockpit` Supabase project |
| Creating and deleting synthetic auth users during the test run | Any real family data, grades, or emails |
| Reading its own test results | Production or staging deployments |

If the cockpit-ci project were ever found to contain real data, that would be
a **stop-everything incident**: wipe the project, regenerate all its keys,
and re-seed with synthetic data before CI runs again.

## Secret-handling rules

1. **Never in chat.** Do not paste the service_role key (or the anon key)
   into chat, email, or any message. If it appears in chat, treat it as
   compromised: regenerate it in the Supabase dashboard and update GitHub.
2. **Never in logs.** The RLS test script masks every key to its last 4
   characters in output. Do not `echo` or print the full value anywhere.
3. **Never in files or code.** No `.env` files in the repo, no hardcoded
   keys. `.env*` is gitignored — verify with `git check-ignore .env`.
   Before every push, run:
   `git diff --cached | grep -iE "service_role|secret|password"` and expect
   nothing back.
4. **GitHub `ci` environment only.** Repository-level secrets, Codespaces,
   and forks do not get these values — only workflow runs that target the
   `ci` environment.
5. **Rotate quarterly.** See `docs/CI-ROTATION.md`. Skipping rotation breaks
   nothing; the old key works until regenerated — but fresh keys are cheap
   insurance.

## Review checklist — Meheldi, please confirm each one

- [ ] **No real data in cockpit-ci.** The project contains only synthetic
  fixtures (`supabase/seed-ci.sql`: fictional names, `@example.invalid`
  emails, made-up grades).
- [ ] **Secrets live in the `ci` environment**, not in repo secrets, not in
  code, not in files. Three secrets: `CI_SUPABASE_URL`,
  `CI_SUPABASE_ANON_KEY`, `CI_SUPABASE_SERVICE_ROLE_KEY` (names only —
  values are never written down here).
- [ ] **The rotation runbook exists** (`docs/CI-ROTATION.md`) with a named
  owner and a quarterly cadence.
- [ ] **The first CI run is green.** The `rls-tests` job passes against
  cockpit-ci: 9/9 checks, including the post-018 anon lockdown assertions.
