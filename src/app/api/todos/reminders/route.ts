import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/admin/serviceClient";
import { getEmailSender } from "@/lib/email/sender";

export const dynamic = "force-dynamic";

/**
 * GET /api/todos/reminders — send due to-do reminders (email channel).
 *
 * Cron target (not user-facing). Auth: Authorization: Bearer
 * <SUPABASE_SERVICE_ROLE_KEY> — the same gate as the nudge producers.
 *
 * Picks up todos whose reminder_at has passed and reminder_sent_at is
 * still null, sends one reminder each via the email sender, and stamps
 * reminder_sent_at so nothing double-sends. In-app reminders are rendered
 * client-side from reminder_at; this route is the email half of the
 * default automatic reminder policy.
 */

const BATCH_LIMIT = 100;

function isAuthorized(req: Request): boolean {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return false;
  return req.headers.get("authorization") === `Bearer ${key}`;
}

function dueLabel(dueAt: string | null): string {
  if (!dueAt) return "soon";
  const d = new Date(dueAt);
  const today = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOfDay(d) - startOfDay(today)) / 86_400_000);
  const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (diffDays < 0) return `was due ${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
  if (diffDays === 0) return `today at ${time}`;
  if (diffDays === 1) return `tomorrow at ${time}`;
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json(
      { error: "This endpoint is for the reminder scheduler, not browsers." },
      { status: 401 },
    );
  }

  try {
    const admin = createAdminClient();
    const now = new Date().toISOString();

    const { data: due, error } = await admin
      .from("todos")
      .select("id, pilot_id, title, due_at, reminder_at, list_id")
      .lte("reminder_at", now)
      .is("reminder_sent_at", null)
      .eq("done", false)
      .is("deleted_at", null)
      .order("reminder_at", { ascending: true })
      .limit(BATCH_LIMIT);
    if (error) throw error;

    const sender = getEmailSender();
    let sent = 0;

    for (const todo of due ?? []) {
      try {
        const { data: pilot } = await admin
          .from("pilots")
          .select("email")
          .eq("id", todo.pilot_id)
          .maybeSingle();
        const email = (pilot as { email?: string | null } | null)?.email;
        if (!email) {
          // No email on file — mark sent so we don't retry forever.
          await admin.from("todos").update({ reminder_sent_at: now }).eq("id", todo.id);
          continue;
        }

        let listName = "My tasks";
        if (todo.list_id) {
          const { data: list } = await admin
            .from("todo_lists")
            .select("name")
            .eq("id", todo.list_id)
            .maybeSingle();
          if ((list as { name?: string } | null)?.name) {
            listName = (list as { name: string }).name;
          }
        }

        await sender.sendTodoReminder({
          to: email,
          todoText: todo.title,
          dueLabel: dueLabel(todo.due_at),
          listName,
        });
        await admin.from("todos").update({ reminder_sent_at: now }).eq("id", todo.id);
        sent += 1;
      } catch {
        // One bad row never blocks the rest of the batch.
      }
    }

    return NextResponse.json({ ok: true, sent, checked: (due ?? []).length });
  } catch {
    return NextResponse.json(
      { error: "The reminder run failed on our end. It will retry on the next schedule." },
      { status: 500 },
    );
  }
}
