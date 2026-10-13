# Rich To-Do — Design Document (v1)

**Status:** approved for build · **Date:** 2026-10-13 · **Owner:** Meheldi
**Research:** Todoist feature study (2026-10) + backend audit of current implementation — full reports held by the project coordinator.

## What we're building

The to-do list becomes: **shareable with another user, persisted in Supabase (not device-local), integrated with Google Tasks/Calendar, and rich** — informed by Todoist's best ideas, cut down to what fits a family/personal cockpit.

### v1 feature cut (from research, ranked)

1. **Quick Add with natural-language parsing** — extend `src/lib/parse-todo.ts`: dates, `#project`, `p1–p3`, `every Monday` recurrence, `+assignee`. Inline highlight + tap-to-revert on mis-parsed date words (Todoist's #1 trust lesson).
2. **Shared lists + assign-to-a-person** — the family primitive. One "Family" list, assign tasks to Meheldi/Dawson, "assigned to me" views. Flat permissions (owner + collaborators; everyone invited can add/complete/assign) like Todoist personal sharing.
3. **Rich recurring tasks** — Todoist's `every X` grammar with forward-roll semantics + start/end dates.
4. **Reminders with default automatic policy** — free (competitive wedge vs Todoist paywall). v1: email channel + in-app; mobile push later. Default: 30 min before timed tasks, morning digest for date-only.
5. **Two-way Google Tasks sync** — tasks ↔ Google Tasks, complete/edit from either side. (Calendar sync stays as-is.)
6. **Today / Upcoming rhythm views** — auto-generated from dates + priorities; the pilot's morning ritual.
7. **Crystal task breakdown** — "Plan the science fair" → Crystal proposes dated subtasks. The "rich" differentiator.
8. **Projects + sections + sub-tasks** — minimal hierarchy for household zones (Family, Bills, Dawson, Shopping).

### Explicitly v2 (cut, not forgotten)

Karma/streaks (shame-framing risk — needs shame-free Progress design first), board view, custom filter query language, templates, activity log, location reminders (needs geofencing + privacy story), email-to-task, role ladder beyond flat sharing, in-app calendar view (Google already gives this).

## Data model

New migration `035_todo_lists.sql` (+ `036` for Tasks columns if split is cleaner):

```sql
-- Lists (sharing granularity = whole list)
todo_lists(id uuid PK, pilot_id uuid FK pilots ON DELETE CASCADE, -- owner
  name text NOT NULL, color text, position int DEFAULT 0,
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());

-- Shares (clone of shopping_list_shares pattern)
todo_list_shares(id uuid PK, list_id uuid FK todo_lists ON DELETE CASCADE,
  owner_pilot_id uuid, shared_with_email text NOT NULL, -- lowercased
  shared_with_pilot_id uuid NULL, permission text CHECK (view,edit) DEFAULT 'edit',
  created_at timestamptz DEFAULT now());

-- todos additions
ALTER TABLE todos ADD COLUMN list_id uuid REFERENCES todo_lists(id) ON DELETE CASCADE;
ALTER TABLE todos ADD COLUMN parent_todo_id uuid REFERENCES todos(id) ON DELETE CASCADE; -- sub-tasks
ALTER TABLE todos ADD COLUMN section text;                       -- lightweight sections
ALTER TABLE todos ADD COLUMN assigned_to_pilot_id uuid REFERENCES pilots(id);
ALTER TABLE todos ADD COLUMN recurrence text;                    -- 'every Monday' rule
ALTER TABLE todos ADD COLUMN reminder_at timestamptz;             -- computed next reminder
ALTER TABLE todos ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE todos ADD COLUMN deleted_at timestamptz;              -- tombstones
ALTER TABLE todos ADD COLUMN google_task_id text;
ALTER TABLE todos ADD COLUMN google_tasklist_id text;
ALTER TABLE calendar_connections ADD COLUMN granted_scopes text[];
-- backfill: every existing pilot gets one default list; existing todos → default list
```

**Per-user completion:** shared lists use shared completion (one `done` flag, like Todoist personal sharing). Assignment is per-person; "assigned to me" is a view, not a separate completion state.

**Child safety:** sharing a list *with* a child follows the child-access authority rules — the child (or their parent steward if under 13) accepts; the `/invite/<token>` flow gets a todo renderer with plain-English copy. No child data exposed to non-granted users, ever.

## Sharing flow (reuse, don't reinvent)

Clone the `shopping_list_shares` email-claim pipeline with todo-scoped tables/RPCs:
`POST /api/todo-lists/[id]/shares` (owner-only, 10 invites/pilot/day, duplicate + self-share guards) → hashed-token `share_invites` row → `/invite/<token>` gains a todo renderer → `redeem_todo_share_invite(p_token_hash)` (SECURITY DEFINER, identity from `auth.uid()` + JWT email, single-use, idempotent) → membership row. Sign-in claim hook in `/auth/callback` extended to todo shares. RLS: owner `FOR ALL` stays; add `todos_shared_read` (SELECT via live share row naming `auth.uid()`) and edit-gated write policies via EXISTS on `todo_list_shares` — same template as `shopping_items_shared_write`.

## Persistence: Supabase-first with offline queue (fix the audit's defects)

1. **Queue signed-out writes** — `enqueue()` must not no-op when signed out; persist the pending queue in localStorage and flush on sign-in.
2. **True merge on sign-in** — replace "server overwrites local" with: upload pending ops first, then merge by `updated_at` (last-write-wins), tombstones for deletes. The one-time-import flag goes away.
3. **Client-generated UUIDs** — POST sends the client UUID; server uses it (fixes the broken `createdAt` dedupe → no more duplicates on re-flush).
4. **`updated_at` maintained** on every write (trigger or app-level); `deleted_at` tombstones instead of hard DELETE for shared lists.

## Google Tasks two-way sync

1. `src/app/api/calendar/connect/route.ts`: add `https://www.googleapis.com/auth/tasks` to `SCOPES` (new consents get both in one screen; `prompt=consent` already set).
2. `src/app/api/calendar/callback/route.ts`: persist Google's `scope` response into `calendar_connections.granted_scopes`.
3. New `src/lib/tasks-google.ts` (mirror `calendar-google.ts`): tasklists/tasks CRUD, reuse `refreshGoogleAccessToken()` unchanged.
4. New `src/app/api/tasks/sync/route.ts`: pull (upsert by `(google_tasklist_id, google_task_id)`, last-write-wins on `updated` vs `updated_at`), push (dirty = `updated_at > last_tasks_sync` watermark per connection).
5. UI: "Connect Google Tasks" re-consent prompt when `granted_scopes` lacks the tasks scope; sync errors in the existing `syncError` pattern. Manual trigger first (calendar sync is manual-only today); scheduler later.
6. Google Cloud console (Meheldi): add the Tasks scope to the Cockpit OAuth client's configured scopes.

## UX rules (standing)

No blank pages ever; every error plain-English with a recovery path; failures never block the list; offline banner when queued; conflicts resolve last-write-wins silently, surfaced in an activity line only if v2 ships it.

## Build order

1. Migration 035 (+036) → 2. todo_lists CRUD + default-list backfill → 3. persistence fixes (queue/merge/UUIDs/tombstones) → 4. sharing (tables, RPCs, API, invite renderer, UI) → 5. v1 features (priorities UI, recurrence engine, sub-tasks, assign, sections, reminders) → 6. Google Tasks sync → 7. Crystal breakdown.
