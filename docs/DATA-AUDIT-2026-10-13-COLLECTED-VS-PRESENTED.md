# Data Audit — Collected vs. Presented (School Data)

**Date:** 2026-10-13 ~19:00 EDT
**Trigger:** Meheldi — "We should have lot more data we are collecting. Why are we not presenting that data on the UI?" (URGENT)
**Scope:** `crew_grade_syncs` for Dawson (`91ea2b85-45c9-4f84-96c1-2829d30e5eb6`) → crew API routes → Crew/School applets + class-detail.
**Method:** Compared staged payload snapshots (`~/workspace/goals/dawson-grade-intelligence-tracker/hidden_files/`), the table schema (`supabase/migrations/002_crew_grade_syncs.sql`), the worker scripts (`cockpit-sync/parent/parentvue_pull.py`, `cockpit-sync/parentvue/parentvue-laptop-sync.py`), the API routes (`src/app/api/crew/members/[id]/{classes,class-detail,school-overview}/route.ts`), and the UI components — all read from `origin/staging/crystal-robot-improved`. No live DB reads; verification queries are listed at the end. Docs only, no code changes.

## The headline

Meheldi is right, three times over:

1. **We collect data nobody ever reads.** Four populated fields (`ctls_announcements`, `ctls_upcoming`, `past_periods`, and `due_next` on school surfaces) have **zero** API consumers — `git grep` across `src/` returns nothing for the first three.
2. **The newest pipeline collects LESS than the old one.** The 13:23 EDT parent pull flattened `class_details[].assignments` (a real array of {title, due, score, category}) into `recent_items` (display strings) and dropped `categories` entirely — silently breaking every API route that reads `entry.assignments`.
3. **The richest recent row was hand-assembled, not reproducible.** The 13:23 payload was built by an agent merging browser-task output; no checked-in worker produces that shape. The checked-in parent worker hardcodes `gpa`, `past_periods`, `synergy_mail`, `office365_emails`, `ctls_announcements`, `ctls_upcoming` to empty.

## Gap table

| Field | Collected? | In latest DB row? | API exposes? | UI renders? | Root cause / owner |
|---|---|---|---|---|---|
| `grades` (6 classes) | Yes — all workers | Yes | Yes — `classes` route | Yes — grids everywhere | — (working) |
| `class_details[].teacher` | Yes | Yes | Yes — teacher lookup map | Yes | — (working) |
| `class_details[].assignments` | MacBook: yes (12/class w/ title, due, score, category). **Parent pipeline: NO** — flattened to `recent_items` strings | Only if a MacBook row is latest | `class-detail` + `school-overview` read `entry.assignments` | Would render — gets `[]` | **Payload format regression**, no schema contract. Parent pipeline owner |
| `class_details[].categories` | MacBook: key present, always `{}`. Parent: key missing | Effectively no | `class-detail` returns `categories ?? {}` | Shows "no category data" | **Never meaningfully collected.** ParentVUE gradebook detail HAS real category weights (student-side path reads them per project memory) — nobody wired them into the parent pull. Worker owner |
| `due_next` (5–8 items) | Yes — all workers | Yes (13:23 row; 17:14 row failed to write in the crypt() outage) | **NO** — `classes` route never SELECTs it; only `/api/today` uses it | School "This week" reads `json.due_next` from `classes` → **always empty** | **One missing SELECT + one missing response field** in `classes/route.ts`. API owner |
| `gpa` | **NO** — hardcoded `{}` in every worker | `{}` | `classes` returns null for `{}` | Would render — gets null | Never collected. Worker owner |
| `synergy_mail` | MacBook: attempts extraction from ParentVUE messages. Parent: hardcoded `[]` | `[]` in parent rows | Yes — merged into `messages` (top 8) | Yes — "Messages" section | Pipeline works; parent source never wired. Worker owner |
| `office365_emails` | **NO** — hardcoded `[]` everywhere | `[]` | Yes — merged (always empty) | Yes — renders empty | Integration not built (Outlook OAuth app registered 2026-10-13; flow pending). Platform owner |
| `ctls_announcements` (6–7 items) | Yes — agent-assembled rows only | Yes (13:23 row) | **NO — zero references in `src/`** | No | Collected but dropped at API. API/UI owner |
| `ctls_upcoming` (4 items) | Yes — agent-assembled rows only | Yes (13:23 row) | **NO — zero references in `src/`** | No | Collected but dropped at API. API/UI owner |
| `past_periods` (1 item) | Yes | Yes | **NO — zero references in `src/`** | No | Collected but dropped at API. API/UI owner |
| `attendance` | **NO** — always `{}` | `{}` | `classes` returns null for `{}` | Honest "coming soon" | Never collected (ParentVUE has it). Worker owner |
| `ctls_syllabi` | **NO** — always `{}` | `{}` | Not selected anywhere | No | Never collected. Worker owner |
| `zero_guard_flags` | By design (anomaly flags only) | `[]` | Not selected | No | Working as designed |

### Dropped-at-each-stage counts

- **Never collected (worker):** 5 fields — `gpa`, `attendance`, `ctls_syllabi`, `office365_emails`, `categories` (meaningful values)
- **Collected but dropped at API:** 4 fields — `due_next` (school surfaces), `ctls_announcements`, `ctls_upcoming`, `past_periods`
- **Degraded at collection (format regression):** 1 field — `class_details[].assignments`
- **Working end-to-end:** `grades`, `class_details[].teacher`, `synergy_mail`/`office365_emails` plumbing (sources empty)

## Top 5 root causes

### 1. No payload schema contract (biggest)
The 13:23 and 17:14 parent payloads were assembled by an agent (merging browser-task output), not by a checked-in worker. The assembly changed the `class_details` shape — `assignments: [{title, due, score, category, …}]` became `recent_items: ["Quiz 3.1 (Week 09): 30.00% (10/01)", …]` strings and `missing: <count>`, and `categories` vanished. Nothing validates the payload shape before `rpc_push_crew_grade_sync` accepts it, so the API routes (written against the rich format) silently return empty `missing`/`upcoming`/`recent` arrays. **Fix:** a JSON-schema check in the push path (RPC or a validator the workers share) that rejects payloads missing `assignments[]` per class; pin the canonical shape in `docs/`.

### 2. `classes` route doesn't SELECT `due_next` (smallest fix, biggest visible win)
`src/app/api/crew/members/[id]/classes/route.ts` selects `grades, class_details, synced_at, gpa, attendance, synergy_mail, office365_emails` — no `due_next`. The deployed `school-station.tsx` does `setDueNext(json.due_next ?? [])` on that exact response, so "This week" can never populate. The data sits in the DB (8 items in the 13:23 row). **Fix:** add `due_next` to the SELECT and the JSON response.

### 3. The richest row isn't reproducible
`ctls_announcements` (7), `ctls_upcoming` (4), and the `due_next` carry-overs in the 13:23 row came from a one-off agent merge. The checked-in parent worker (`cockpit-sync/parent/parentvue_pull.py` lines 157–171) hardcodes all of them to empty. The next parent pull that overwrites the row **deletes that data**. **Fix:** port the CTLS scrape + merge logic into the checked-in worker (or a second pipeline stage) before the next run.

### 4. Last-writer-wins with no cross-method merge
Readers take the single latest row. The 13:23 degraded parent row shadows the 12:15 rich MacBook row — the API can't serve the MacBook's `assignments[]` once the parent row lands, and vice versa. **Fix (design):** readers should merge — e.g. prefer the latest row per `pull_method` per field — or all workers should emit the canonical shape so rows are interchangeable.

### 5. Collection without presentation
`ctls_announcements`, `ctls_upcoming`, `past_periods` are in the table, populated in recent rows, and referenced **nowhere** in `src/`. Someone built the collection and never built the surface. **Fix:** wire them into the School/Crew applets (announcements → a "School news" strip; upcoming → merge into "This week"; past_periods → a trend sparkline) — or stop collecting them.

## Also noted (worker gaps)

- `gpa`: ParentVUE exposes GPA; no worker reads it. The old Pookie app showed 2.33 / Weighted 2.58 / HOPE 2.42 — that data has no source in Cockpit today.
- `attendance`: ParentVUE has attendance; workers return `{}`. The UI's "coming soon" is honest, but the data is one scrape away.
- `office365_emails`: blocked on the Outlook OAuth flow (app registered 2026-10-13, `OUTLOOK_CLIENT_ID/SECRET` in Cloudflare env; no sync built yet).
- `categories`: the student-side (Windows laptop) path reads real category weights from the gradebook per project memory — the parent pull never attempted it.

## Live verification still needed (exact queries, read-only)

Run in the Supabase SQL editor (cockpit project):

```sql
-- Q1: which row is latest per pull_method, and what does each carry?
select pull_method, device_name, synced_at,
       jsonb_array_length(due_next) as due_next_n,
       jsonb_array_length(coalesce(class_details,'[]')) as classes_n,
       (select count(*) from jsonb_array_elements(class_details) c
         where c ? 'assignments') as classes_with_assignments
from crew_grade_syncs
where crew_member_id = '91ea2b85-45c9-4f84-96c1-2829d30e5eb6'
order by synced_at desc limit 6;

-- Q2: does ANY row have non-empty categories / gpa / attendance?
select count(*) filter (where class_details::text like '%"categories": {%') as rows_with_categories,
       count(*) filter (where gpa <> '{}') as rows_with_gpa,
       count(*) filter (where attendance <> '{}') as rows_with_attendance
from crew_grade_syncs
where crew_member_id = '91ea2b85-45c9-4f84-96c1-2829d30e5eb6';

-- Q3: confirm the 17:14 5pm parentvue row never landed (crypt() outage)
select count(*) from crew_grade_syncs
where device_name = 'parent-sync-5pm-cron';
-- expect 0
```

## Prioritized fix list

1. **API (small):** add `due_next` (+ `ctls_announcements`, `ctls_upcoming`, `past_periods`) to the `classes` route SELECT + response — unblocks "This week" and three dead fields.
2. **Contract:** JSON-schema validation on the push path rejecting `class_details` entries without `assignments[]`; canonical shape doc.
3. **Worker:** make the parent pipeline emit the canonical shape (restore `assignments[]` + `categories` per class) instead of `recent_items` strings.
4. **Worker:** port the CTLS announcements/upcoming merge into the checked-in worker so the 13:23 row's data survives the next pull.
5. **UI:** render announcements/upcoming/past_periods (or drop collection).
6. **Workers:** collect `gpa` + `attendance` from ParentVUE (one scrape away).
7. **Platform:** build the Outlook OAuth sync for `office365_emails`.
8. **Design:** cross-`pull_method` merge strategy so a degraded row can't shadow a rich one.
