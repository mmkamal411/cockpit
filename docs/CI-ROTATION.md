# CI Secret Rotation Runbook

The CI `rls-tests` job talks to a dedicated Supabase project (**cockpit-ci**)
using a **service_role** key stored as the GitHub environment secret
`CI_SUPABASE_SERVICE_ROLE_KEY`. That key bypasses all row-level security, so
it gets rotated on a schedule — same as any other powerful credential.

## When

**Quarterly** (every ~3 months). Put a recurring reminder on the calendar —
the first Monday of January / April / July / October works.

## Owner

Meheldi, or his designated engineer.

## Steps

1. **Regenerate the key.** In the Supabase dashboard, open the **cockpit-ci**
   project → Project Settings → API → under "API Keys", find the
   `service_role` key and regenerate it. Copy the new key.
2. **Update GitHub.** Go to the `mmkamal411/cockpit` repo → Settings →
   Environments → **ci** → update the environment secret
   `CI_SUPABASE_SERVICE_ROLE_KEY` with the new key. Save.
3. **Re-run CI.** Push any commit (or re-run the latest `ci` workflow run from
   the Actions tab) and confirm the `rls-tests` job goes green with the new
   key. If it is red, the new key did not take — repeat step 2.
4. **Done.** The old key stops working the moment Supabase regenerates it,
   so there is nothing else to revoke or clean up.

## What breaks if this is skipped

**Nothing breaks.** Rotation is hygiene, not an emergency. The old key keeps
working until the day it is regenerated in the dashboard. Skipping a quarter
just means the same key has been around longer — the blast radius stays the
same either way, because the key only ever touches the **cockpit-ci** project,
which holds synthetic data only (see `docs/CI-SECRETS.md`).

## Related

- `docs/CI-SECRETS.md` — the full threat model and secret-handling rules.
- `.github/workflows/ci.yml` — the workflow that consumes these secrets.
- `scripts/ci/rls-tests.mjs` — the RLS test script.
