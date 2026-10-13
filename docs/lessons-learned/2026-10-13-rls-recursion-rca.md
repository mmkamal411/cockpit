# RCA: RLS infinite recursion hid the Family & School surface (2026-10-13)

| Field | Value |
|---|---|
| Date | 2026-10-13 |
| Severity | High — entire Crew/School surface vanished from the pilot's app |
| Duration | ~75 min (17:12–18:27 EDT; broken from 036 apply, fixed by 039 apply) |
| Detected by | Browser verification (~18:00); the app deploy pipeline cannot see this class |
| Fixed by | Migration `039_fix_crew_rls_recursion.sql` — SECURITY DEFINER helper `has_live_crew_grant(uuid)` |
| Status | Fixed and verified (policies `crew_members_grantee_select` + `crew_members_pilot_all` confirmed) |

## 1. Summary

Migration `036_link_code_redemption.sql` added an RLS policy `crew_members_grantee_select`
on `public.crew_members` whose expression subqueries `public.crew_access_grants`. But
`crew_access_grants`' own policy `grants_steward_manage` (from migration 001)
subqueries `crew_members`. The two policies reference each other → **infinite policy
recursion**: every `SELECT` on `crew_members` aborts, PostgREST returns 500, and
`/api/crew/members` answered `{"error":"Couldn't load your crew right now. Try again."}`.
The app renders the "Family & School" home button, the School dock tab, and the
Crew/School applets only when the crew roster loads — so a database policy bug made
entire UI surfaces disappear. It worked at 16:52 (user's phone screenshots) and was
broken from the 17:12 migration apply until the 039 fix at 18:27.

## 2. Timeline (EDT)

| Time | Event |
|---|---|
| 16:52 | Crew applet working (user screenshots from iOS app). |
| 17:12 | Migrations 034/035/036 applied via Supabase SQL editor. "Success. No rows returned." |
| 17:12–18:00 | Every `crew_members` SELECT 500s. App hides Family & School surfaces. Nobody is alerted — no monitor watches this path. |
| ~18:00 | Browser verification (for the school-sources fix) finds: `/api/crew/members` → 500 JSON error; "Family & School" home button missing; School dock tab missing. |
| ~18:05 | Bug squad dispatched. Route code (`src/app/api/crew/members/route.ts`) byte-identical between working and broken deploys → purely database-side. |
| ~18:20 | Root cause identified: 036's new policy × 001's existing policy = recursion. |
| 18:27 | Migration `039_fix_crew_rls_recursion.sql` applied ("Success. No rows returned"); `pg_policies` verified: `crew_members_grantee_select` + `crew_members_pilot_all`. Roster, button, dock tab, applets all restored. |

## 3. Root cause

The cycle, step by step:

```
1. App: SELECT * FROM crew_members WHERE ...
2. → policy crew_members_grantee_select evaluates:
     USING (EXISTS (select 1 FROM public.crew_access_grants g WHERE ...))
3. → to evaluate the EXISTS, PostgreSQL checks crew_access_grants' policies:
     policy grants_steward_manage evaluates:
       USING (auth.uid() = (select cm.pilot_id FROM public.crew_members cm WHERE ...))
4. → step 3's subquery on crew_members re-triggers step 2's policy
   → INFINITE RECURSION → query aborted → PostgREST 500
```

The two policy expressions, verbatim from the migration files:

**036** (`036_link_code_redemption.sql`, the trigger):

```sql
create policy crew_members_grantee_select on public.crew_members
  for select to authenticated
  using (
    exists (
      select 1 from public.crew_access_grants g
      where g.crew_member_id = crew_members.id
        and g.grantee_pilot_id = auth.uid()
        and g.revoked_at is null
    )
  );
```

**001** (`001_pilot_foundation.sql:274`, the pre-existing other half):

```sql
create policy grants_steward_manage on public.crew_access_grants
  for all
  using (
    auth.uid() = (
      select cm.pilot_id from public.crew_members cm
      where cm.id = crew_access_grants.crew_member_id
    )
  )
  ...
```

Each policy is reasonable in isolation. Together they form a 2-cycle. PostgreSQL
does not warn at `CREATE POLICY` time — the recursion only manifests at query time,
as a hard failure (not degraded results).

**The fix** (`039_fix_crew_rls_recursion.sql`): a `SECURITY DEFINER` helper that
checks `crew_access_grants` **bypassing RLS**, breaking the cycle:

```sql
create or replace function public.has_live_crew_grant(p_crew_member_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.crew_access_grants g
    where g.crew_member_id = p_crew_member_id
      and g.grantee_pilot_id = auth.uid()
      and g.revoked_at is null
  );
$$;
```

The policy was dropped and recreated as
`USING (public.has_live_crew_grant(crew_members.id))`. Because the function is
`SECURITY DEFINER`, the grants-table check runs outside RLS — no recursion. And
`auth.uid()` still reads the *caller's* JWT inside a definer function, so the
security semantic is unchanged: a pilot only ever sees grants where they are the
grantee. (This is the same pattern migration 003 already used for `is_admin()`.)

## 4. Blast radius

Every query path that transitively reached the cycle broke — not just the roster:

- `crew_members` SELECTs → `/api/crew/members`, `/classes`, `/class-detail`,
  `/link-code` routes (500/404 for stewards AND grantees)
- `crew_access_grants` SELECTs, `path_to_90_checks` grantee reads,
  `crew_grade_syncs` grantee reads, `link_codes` SELECTs
- UI: "Family & School" home button hidden, School dock tab gone, Crew and School
  applets unreachable — the app gates all of these on a successful crew roster load

Why a DB bug hid UI: the frontend treats "crew API errored" the same as "pilot has
no children" for the conditional surfaces. There is no distinction between "zero
rows" and "query failed" in the gating logic — a hardening opportunity (show an
error state instead of silently hiding).

## 5. Why it wasn't caught

- The migration looked harmless: a SELECT-only policy granting roster visibility to
  grantees. Nothing in the apply flow evaluates **policy interactions** — each
  policy is reviewed (if at all) in isolation.
- `CREATE POLICY` succeeds; the cycle is invisible until a query runs. The
  apply-time verification ("Success. No rows returned") cannot catch it.
- The app deploy pipeline is blind to it: the route code was byte-identical, so
  "staging first" and smoke tests would have passed against a database without the
  policy.
- It shared the hour with the crypt() outage (035), which drew all diagnostic
  attention to the worker-push path.

## 6. The rule

**Never write an RLS policy whose expression queries a table whose own policies
query back.** Grant-checks inside policy expressions must go through `SECURITY
DEFINER` helper functions that bypass RLS (`auth.uid()` still reads the caller's
JWT inside them, so the security semantic is unchanged).

This is now a standing engineering rule (recorded in `~/AGENTS.md`).

## 7. Detection recipe

**Review-time (before apply):** build the policy reference graph. For the new
policy, list every table named in its `USING`/`WITH CHECK` expression. For each of
those tables, list every table named in *their* policies' expressions. If the new
policy's own table appears anywhere in that second list, you have a cycle — stop.

**SQL audit (run in the editor, read-only):**

```sql
-- Show every policy expression on the crew tables; look for A→B→A references
select tablename, polname, pg_get_expr(polqual, polrelid) as expression
from pg_policies
where schemaname = 'public'
  and tablename in ('crew_members','crew_access_grants','link_codes','pilots')
order by tablename, polname;
-- crew_members policies must reference crew_access_grants ONLY through
-- has_live_crew_grant (or another definer helper), never via raw subquery.
```

**Post-apply canary (< 1 min):**

```sql
select count(*) from public.crew_members;        -- must return, not 500
select count(*) from public.crew_access_grants;  -- must return, not 500
```

And in the app: `/api/crew/members` must return the roster (not the JSON error),
and the "Family & School" button must render on Home.

## 8. Prevention checklist for this class

1. Pre-apply: run the §7 SQL audit for every new/changed policy; draw the two-hop
   reference graph; no cycles allowed.
2. New policies that need cross-table grant checks use the definer-helper pattern
   (template: `has_live_crew_grant(uuid)` in 039; precedent: `is_admin()` in 003).
3. Post-apply: run the §7 canary queries + the app-level roster check before
   declaring the migration done.
4. Structural: extend the migration lint script (see the crypt() RCA doc §9c) with
   policy-expression → table reference extraction and 2-cycle detection against a
   `policy-edges.json` snapshot regenerated after each apply.
5. App hardening (follow-up): distinguish "crew query failed" from "no crew" in the
   Family & School gating logic — show an error state instead of silently hiding
   the surface.

## 9. Related incidents

- `2026-10-13-sync-outage-rca.md` — the same-day `crypt()` outage (migration 035):
  same "migration looks harmless, breaks production silently" pattern, same
  prevention-plan family (pre-apply checklist, post-apply canary protocol, lint
  script, CI-canary flow).

---
*Investigated 2026-10-13. Policy expressions quoted verbatim from
`036_link_code_redemption.sql`, `001_pilot_foundation.sql`, and
`039_fix_crew_rls_recursion.sql`.*
