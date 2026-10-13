import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { refreshGoogleAccessToken } from "@/lib/calendar-google";
import {
  deleteTask,
  googleDueToMs,
  insertTask,
  listTasklists,
  listTasks,
  msToGoogleDue,
  patchTask,
  type GoogleTask,
} from "@/lib/tasks-google";

export const dynamic = "force-dynamic";

/**
 * POST /api/tasks/sync — two-way Google Tasks sync (manual trigger; the
 * calendar sync is manual-only today and Tasks follows the same pattern).
 *
 * Pull: every Google tasklist's tasks are upserted into the pilot's default
 * to-do list by (google_tasklist_id, google_task_id). Unlinked local todos
 * with an identical title + due day are linked instead of duplicated.
 * Google-side deletes become local tombstones.
 * Push: local todos with updated_at past the connection's last_tasks_sync
 * watermark go up — linked ones PATCH (content-compared, so timestamp-only
 * drift doesn't ping-pong), unlinked ones are created in the default
 * tasklist, tombstoned ones are deleted on Google.
 * Conflicts resolve last-write-wins on Google `updated` vs local
 * `updated_at`. The watermark advances only after a clean pass.
 */

const UNAUTH = { error: "Sign in to sync Google Tasks." };
const TASKS_SCOPE = "https://www.googleapis.com/auth/tasks";

interface ConnectionRow {
  id: string;
  pilot_id: string;
  provider: string;
  provider_account_email: string | null;
  refresh_token_enc: string | null;
  status: string;
  granted_scopes: string[] | null;
  last_tasks_sync: string | null;
}

interface LocalTodo {
  id: string;
  title: string;
  done: boolean;
  due_at: string | null;
  notes: string | null;
  updated_at: string;
  deleted_at: string | null;
  google_task_id: string | null;
  google_tasklist_id: string | null;
}

function sameDay(aMs: number | null, bMs: number | null): boolean {
  if (aMs == null || bMs == null) return aMs == null && bMs == null;
  const a = new Date(aMs);
  const b = new Date(bMs);
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Content comparison — timestamp-only drift must not ping-pong. */
function googleMatchesLocal(g: GoogleTask, l: LocalTodo): boolean {
  return (
    g.title === l.title &&
    (g.notes ?? null) === (l.notes ?? null) &&
    (g.status === "completed") === l.done &&
    sameDay(googleDueToMs(g.due), l.due_at ? Date.parse(l.due_at) : null)
  );
}

export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json(UNAUTH, { status: 401 });

  try {
    const { data: connections, error: connErr } = await supabase
      .from("calendar_connections")
      .select(
        "id, pilot_id, provider, provider_account_email, refresh_token_enc, status, granted_scopes, last_tasks_sync",
      )
      .eq("pilot_id", user.id)
      .eq("provider", "google")
      .eq("status", "active");
    if (connErr) throw connErr;

    // The pilot's default to-do list receives pulled tasks.
    const { data: defaultList } = await supabase
      .from("todo_lists")
      .select("id")
      .eq("pilot_id", user.id)
      .order("position", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    const defaultListId = (defaultList as { id?: string } | null)?.id ?? null;

    const results: {
      connection: string;
      pulled: number;
      pushed: number;
      skipped?: string;
    }[] = [];

    for (const conn of (connections ?? []) as ConnectionRow[]) {
      const granted = conn.granted_scopes ?? [];
      if (!granted.includes(TASKS_SCOPE)) {
        results.push({
          connection: conn.provider_account_email ?? "Google",
          pulled: 0,
          pushed: 0,
          skipped: "needs reconsent",
        });
        continue;
      }

      let accessToken: string;
      try {
        accessToken = await refreshGoogleAccessToken(conn, supabase);
      } catch (e) {
        results.push({
          connection: conn.provider_account_email ?? "Google",
          pulled: 0,
          pushed: 0,
          skipped: e instanceof Error ? e.message : "Couldn't refresh the Google connection.",
        });
        continue;
      }

      const watermarkMs = conn.last_tasks_sync ? Date.parse(conn.last_tasks_sync) : 0;
      const syncStart = Date.now();
      let pulled = 0;
      let pushed = 0;

      // ---- PULL ----
      const googleByKey = new Map<string, GoogleTask>();
      const tasklists = await listTasklists(accessToken);
      for (const tasklist of tasklists) {
        const tasks = await listTasks(accessToken, tasklist.id);
        for (const g of tasks) {
          const key = `${tasklist.id}:${g.id}`;
          googleByKey.set(key, g);

          const { data: existing } = await supabase
            .from("todos")
            .select("id,title,done,due_at,notes,updated_at,deleted_at,google_task_id,google_tasklist_id")
            .eq("pilot_id", user.id)
            .eq("google_tasklist_id", tasklist.id)
            .eq("google_task_id", g.id)
            .maybeSingle();
          const local = (existing ?? null) as LocalTodo | null;

          if (g.deleted) {
            if (local && !local.deleted_at) {
              await supabase.from("todos").update({ deleted_at: new Date().toISOString() }).eq("id", local.id);
              pulled += 1;
            }
            continue;
          }

          const googleMs = g.updated ? Date.parse(g.updated) : 0;
          const localMs = local ? Date.parse(local.updated_at) : 0;

          if (!local) {
            // Fuzzy link: same title + same due day, not yet linked — avoids
            // duplicating a task that exists on both sides.
            let linkId: string | null = null;
            if (defaultListId) {
              const { data: candidates } = await supabase
                .from("todos")
                .select("id,title,due_at")
                .eq("pilot_id", user.id)
                .eq("list_id", defaultListId)
                .is("google_task_id", null)
                .is("deleted_at", null)
                .eq("title", g.title)
                .limit(10);
              for (const c of (candidates ?? []) as { id: string; title: string; due_at: string | null }[]) {
                if (sameDay(googleDueToMs(g.due), c.due_at ? Date.parse(c.due_at) : null)) {
                  linkId = c.id;
                  break;
                }
              }
            }
            if (linkId) {
              await supabase
                .from("todos")
                .update({ google_task_id: g.id, google_tasklist_id: tasklist.id })
                .eq("id", linkId);
              pulled += 1;
            } else if (defaultListId) {
              const { error: insErr } = await supabase.from("todos").insert({
                pilot_id: user.id,
                list_id: defaultListId,
                title: g.title.slice(0, 500) || "Untitled task",
                notes: g.notes,
                done: g.status === "completed",
                due_at: g.due ? new Date(googleDueToMs(g.due) as number).toISOString() : null,
                source: "manual",
                google_task_id: g.id,
                google_tasklist_id: tasklist.id,
              });
              if (!insErr) pulled += 1;
            }
            continue;
          }

          // Last-write-wins; content-compared so timestamps alone don't churn.
          if (googleMs > localMs && !googleMatchesLocal(g, local)) {
            await supabase
              .from("todos")
              .update({
                title: g.title.slice(0, 500) || local.title,
                notes: g.notes,
                done: g.status === "completed",
                due_at: g.due ? new Date(googleDueToMs(g.due) as number).toISOString() : local.due_at,
              })
              .eq("id", local.id);
            pulled += 1;
          }
        }
      }

      // ---- PUSH ----
      const { data: dirty } = await supabase
        .from("todos")
        .select("id,title,done,due_at,notes,updated_at,deleted_at,google_task_id,google_tasklist_id")
        .eq("pilot_id", user.id)
        .gt("updated_at", new Date(watermarkMs).toISOString());
      const defaultTasklistId = tasklists[0]?.id ?? "@default";

      for (const row of (dirty ?? []) as LocalTodo[]) {
        try {
          if (row.deleted_at) {
            // Tombstoned locally: delete on Google, unlink.
            if (row.google_task_id && row.google_tasklist_id) {
              await deleteTask(accessToken, row.google_tasklist_id, row.google_task_id).catch(() => {});
            }
            await supabase
              .from("todos")
              .update({ google_task_id: null, google_tasklist_id: null })
              .eq("id", row.id);
            pushed += 1;
            continue;
          }
          if (row.google_task_id && row.google_tasklist_id) {
            const g = googleByKey.get(`${row.google_tasklist_id}:${row.google_task_id}`);
            if (g && !g.deleted && !googleMatchesLocal(g, row)) {
              await patchTask(accessToken, row.google_tasklist_id, row.google_task_id, {
                title: row.title,
                notes: row.notes,
                due: msToGoogleDue(row.due_at ? Date.parse(row.due_at) : null),
                status: row.done ? "completed" : "needsAction",
              });
              pushed += 1;
            }
            continue;
          }
          // Unlinked local todo: create it in the default tasklist.
          const created = await insertTask(accessToken, defaultTasklistId, {
            title: row.title,
            notes: row.notes,
            due: msToGoogleDue(row.due_at ? Date.parse(row.due_at) : null),
            status: row.done ? "completed" : "needsAction",
          });
          if (created) {
            await supabase
              .from("todos")
              .update({ google_task_id: created.id, google_tasklist_id: defaultTasklistId })
              .eq("id", row.id);
            pushed += 1;
          }
        } catch {
          // One bad row never blocks the rest of the push.
        }
      }

      await supabase
        .from("calendar_connections")
        .update({ last_tasks_sync: new Date(syncStart).toISOString() })
        .eq("id", conn.id);

      results.push({
        connection: conn.provider_account_email ?? "Google",
        pulled,
        pushed,
      });
    }

    const needsReconsent = results.some((r) => r.skipped === "needs reconsent");
    return NextResponse.json({ ok: true, results, needsReconsent });
  } catch {
    return NextResponse.json(
      { error: "Google Tasks didn't sync. Your to-dos are safe — try again in a moment." },
      { status: 500 },
    );
  }
}
