# Crystal v2 — Sync Compatibility

**Status:** ✅ COMPATIBLE — Crystal v2 accepts the exact same sync push format as Cockpit. No sync script changes required.
**Audited:** 2026-10-14 | **Branch:** `feature/v2-sync-compat`
**Auditors:** Postgres/Supabase expert, API integration expert, Python sync-systems expert

---

## 1. Data Flow Diagram

```
┌─────────────────┐     ┌─────────────────┐     ┌──────────────────┐
│  Windows laptop │     │  MacBook        │     │  MacBook         │
│  StudentVUE/    │     │  ParentVUE      │     │  StudentVUE/CTLS │
│  CTLS           │     │  (fallback)     │     │  /Outlook        │
└────────┬────────┘     └────────┬────────┘     └────────┬─────────┘
         │                       │                       │
         │ windows/              │ parentvue/            │ macbook/
         │ dawson-windows-       │ parentvue-laptop-     │ dawson-macbook-
         │ sync.py               │ sync.py               │ sync.py
         │ pull_method:          │ pull_method:          │ pull_method:
         │ "api"/"browser"       │ "parentvue-laptop"    │ "api"/"browser"
         └───────────┬───────────┴───────────┬───────────┘
                     ▼                       ▼
         ┌───────────────────────────────────────────────┐
         │  POST {supabase_url}/rest/v1/rpc/              │
         │       rpc_push_crew_grade_sync                 │
         │  Body: {"p_data": {...20 keys...}}            │
         │  Headers: apikey (anon) + Bearer               │
         │  Auth: p_data.worker_secret → bcrypt check     │
         │        against crew_sync_worker_secrets        │
         └───────────────────┬───────────────────────────┘
                             ▼
         ┌───────────────────────────────────────────────┐
         │  Supabase Postgres (cockpit project)           │
         │  Table: crew_grade_syncs (19 columns)          │
         │  RLS: has_live_crew_grant() /                  │
         │       has_live_grades_grant() (039, no         │
         │       recursion)                               │
         └───────────────────┬───────────────────────────┘
                             ▼
         ┌───────────────────────────────────────────────┐
         │  Crystal v2 Next.js API                       │
         │  /api/crew/members/[id]/classes               │
         │  /api/crew/members/[id]/class-detail          │
         │  /api/crew/members/[id]/school-overview       │
         │  /api/crew/members/[id]/syncs/latest          │
         │  /api/crew/members/[id]/syncs/review          │
         │  (+ 13 more crew routes — all intact)          │
         └───────────────────┬───────────────────────────┘
                             ▼
         ┌───────────────────────────────────────────────┐
         │  Education UI                                 │
         │  school-station · school-overview-applet      │
         │  class-detail · sync-data-review · crew-applet│
         └───────────────────────────────────────────────┘
```

---

## 2. Push Contract (Script → Supabase)

### RPC Signature
```sql
public.rpc_push_crew_grade_sync(p_data jsonb) returns uuid
-- language plpgsql, security definer, set search_path = public
-- grant execute to anon, authenticated
-- Source: 035_restore_worker_secret_check.sql (live body)
```

### Required `p_data` Keys
| Key | Type | Notes |
|-----|------|-------|
| `crew_member_id` | string (UUID) | **Required.** RPC raises `'p_data.crew_member_id is required'` if null. Dawson's: `91ea2b85-45c9-4f84-96c1-2829d30e5eb6` |
| `worker_secret` | string | **Required for anon callers.** Bcrypt-checked against `crew_sync_worker_secrets`. Never stored. service_role bypasses. |

### Optional `p_data` Keys (19 stored columns, all with coalesce defaults)
| Key | Default | Sent by ParentVUE script | Sent by laptop scripts |
|-----|---------|--------------------------|------------------------|
| `device_name` | `'unknown'` | ✅ | ✅ |
| `synced_at` | `now()` | ✅ | ✅ |
| `grades` | `[]` | ✅ | ✅ |
| `gpa` | `{}` | ✅ | ✅ |
| `due_next` | `[]` | ✅ | ✅ |
| `past_periods` | `[]` | ✅ (`[]`) | ✅ |
| `synergy_mail` | `[]` | ✅ | ✅ |
| `office365_emails` | `[]` | ✅ (`[]`) | ✅ |
| `class_details` | `[]` | ✅ | ✅ |
| `ctls_syllabi` | `{}` | ✅ (`{}`) | ✅ |
| `attendance` | `{}` | ✅ | ✅ |
| `ctls_announcements` | `[]` | ✅ (`[]`) | ✅ |
| `ctls_upcoming` | `[]` | ✅ (`[]`) | ✅ |
| `zero_guard_flags` | `[]` | ✅ (`[]`) | ✅ |
| `pull_method` | `'browser'` | ✅ `"parentvue-laptop"` | ✅ `"api"`/`"browser"` (+`+ctls-only`/`+outlook-only`) |
| `calendar_events` | `{"method":null,"events":[]}` | ✅ (P0) | ❌ → RPC default (safe) |
| `class_schedule` | `{"method":null,"raw":{}}` | ✅ (P0) | ❌ → RPC default (safe) |
| `student_info` | `{"method":null,"raw":{}}` | ✅ (P0) | ❌ → RPC default (safe) |

Unknown extra keys are silently ignored (explicit 19-column INSERT list).

### Worker-Secret Flow
1. **Source:** `"worker_secret"` in `parentvue-config.json` (or `PARENTVUE_WORKER_SECRET` env) / `sync-config.json` on laptops
2. **Transport:** top-level `"worker_secret"` key inside `p_data` jsonb
3. **Storage:** `crew_sync_worker_secrets` (`crew_member_id` PK, `secret_hash` bcrypt, RLS-forced, no policies — SECURITY DEFINER only)
4. **Verification:** `crypt(v_secret, s.secret_hash) = s.secret_hash` AND `revoked_at IS NULL`; mismatch → `'invalid worker credentials'`

---

## 3. Read Contract (Supabase → App)

### RLS (Migration 039 — Recursion-Free)
```sql
-- SECURITY DEFINER helpers (bypass RLS, auth.uid() still enforced):
has_live_crew_grant(p_crew_member_id uuid) → boolean
has_live_grades_grant(p_crew_member_id uuid) → boolean
-- Policies:
crew_members_grantee_select  → uses has_live_crew_grant()
grade_syncs_grantee_select   → uses has_live_grades_grant()
```
**Rule:** Never write an RLS policy whose expression queries a table whose own policies query back (lesson 2026-10-13).

### API Routes (All 18 Intact in v2)
| Route | Reads |
|-------|-------|
| `GET /api/crew/members` | `crew_members`, `my_granted_crew` RPC, `crew_school_links`, `crew_access_grants` → `viewer_is_family_member` |
| `GET /api/crew/members/[id]/classes` | `crew_grade_syncs` (newest 20, `grades neq []`) |
| `GET /api/crew/members/[id]/class-detail` | `crew_grade_syncs.class_details` |
| `GET /api/crew/members/[id]/school-overview` | `crew_grade_syncs` + `path_to_90_checks` |
| `GET /api/crew/members/[id]/syncs/latest` | `crew_grade_syncs` (latest full row) |
| `GET /api/crew/members/[id]/syncs/review` | `crew_grade_syncs` (latest 2 → sanitize) |
| `GET+POST /api/crew/members/[id]/path-to-90` | `path_to_90_checks` |
| *(+11 more: link-codes, sync status, school-sources, reauth, upload)* | *(all byte-identical to cockpit)* |

### UI → API Map (Education)
- `school-station.tsx` → `GET …/classes`
- `school-overview-applet.tsx` → `GET /api/crew/members`, `GET …/school-overview`, `POST …/path-to-90`
- `class-detail.tsx` → `GET …/class-detail`, `GET/POST …/path-to-90`
- `sync-data-review.tsx` → `GET …/syncs/review`
- `crew-applet.tsx` → members, link-codes, reauth, classes, school-sources, sync, link-code

---

## 4. What's Compatible

- ✅ All 36 migration files byte-identical (cockpit ↔ crystal-v2)
- ✅ `rpc_push_crew_grade_sync` signature, secret gate, 19-column contract — unchanged
- ✅ RLS recursion fix (039) intact — school data reads work
- ✅ All 18 `/api/crew/*` routes present and unmodified
- ✅ All Education UI components fetch the same endpoints
- ✅ `viewer_is_family_member` ("hide Add a child") intact
- ✅ `pull_method` display labels intact
- ✅ Rebrand touched only user-facing strings — zero DB/RPC/table/column renames

## 5. What Was Fixed

Nothing — no fixes were needed. The v2 copy inherited full compatibility.

## 6. Known Issues (Pre-Existing, Not v2 Regressions)

1. **Legacy Windows script is dead:** `windows-sync/dawson-windows-sync.py` targets `rpc_push_studentvue_sync` (doesn't exist). The live path is `windows/dawson-windows-sync.py`. Verify which file the laptop actually runs before v2 cutover.
2. **`src/lib/mail-sync.ts:142`** calls the push RPC without `worker_secret` — safe because it uses service-role client (documented in its docstring). Never switch to anon client.
3. **Merge RPC doesn't exist:** dual-source merge (student-precedence, >1.0pt rule) is a spec (`cockpit-sync/parent/MERGE-SPEC.md`), not code. Dashboard reads latest row unmerged. If v2 implements it, filter on real `pull_method` values (`"parentvue-laptop"`, `"api"`, `"browser"`, suffixed variants) — not the spec sketch's `'student'`/`'parentvue'`.
4. **Laptop dead fallbacks:** `fetch_previous_grades` anon GET and direct-INSERT fallback in laptop scripts are dead since 018 (fail gracefully, logged).

## 7. DO-NOT-TOUCH List (v2 Must Preserve)

1. `rpc_push_crew_grade_sync(p_data jsonb)` — name, single param name, `anon`+`authenticated` grant
2. `"worker_secret"` key name in `p_data`; `crew_sync_worker_secrets` table + bcrypt check
3. `crew_member_id` required + fail-loud raise
4. All 19 columns + coalesce defaults (especially 022 trio + `'browser'` pull_method default)
5. `has_live_crew_grant()` / `has_live_grades_grant()` + their policies
6. `cockpit_layouts` table refs, `cockpit.*` localStorage keys, `device_name:"cockpit-cloud"` — renaming orphans data
7. No anon direct-table policy on `crew_grade_syncs` (018 deliberately removed it)

## 8. Pre-Deploy Actions for Crystal

- [ ] Fix `wrangler.jsonc` `"name": "cockpit"` → Crystal Pages project (else deploys to wrong project)
- [ ] Set `OUTLOOK_REDIRECT_URI` to Crystal's callback URL + register in Azure (else calendar OAuth 400s)
- [ ] Confirm Windows laptop runs `windows/dawson-windows-sync.py`, not the legacy `windows-sync/` copy
- [ ] Confirm `"worker_secret"` present in each laptop's config (undocumented in `.example` files)

---

## Sync Compatibility Test Checklist

### Push Path (Script → DB)
- [ ] ParentVUE script pushes successfully (check `crew_grade_syncs` for new row with `pull_method='parentvue-laptop'`)
- [ ] Windows laptop script pushes successfully (`pull_method='api'` or `'browser'`)
- [ ] Push with missing `crew_member_id` → RPC raises (fail-loud, no silent insert)
- [ ] Push with wrong `worker_secret` → `'invalid worker credentials'`
- [ ] Push with missing `worker_secret` (anon) → rejected
- [ ] `calendar_events`/`class_schedule`/`student_info` land from ParentVUE script
- [ ] Laptop pushes get RPC defaults for 022 columns (no error, empty-shape defaults)

### Read Path (DB → App)
- [ ] `GET /api/crew/members/[id]/classes` returns 6 classes (no 500 — RLS recursion fixed)
- [ ] `GET …/school-overview` returns grades + path-to-90 state
- [ ] `GET …/syncs/latest` returns newest full row
- [ ] Child viewer: `viewer_is_family_member=true`, no "Add a child" button
- [ ] Parent viewer: `viewer_is_family_member=false`, "Add a child" visible

### Regression
- [ ] `npx tsc --noEmit` clean
- [ ] `diff -rq ~/workspace/cockpit/src/app/api ~/workspace/crystal-v2/src/app/api` → no unexpected diffs
- [ ] `diff -rq ~/workspace/cockpit/supabase/migrations ~/workspace/crystal-v2/supabase/migrations` → empty

---

*Full audit reports: Postgres expert (migrations/RPC/RLS), API expert (routes/UI map), Python expert (script contracts) — delivered 2026-10-14 ~02:23 EDT.*
