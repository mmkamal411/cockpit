/**
 * Email sending — pluggable interface.
 *
 * v1 ships with the LogEmailSender: invite "emails" are written to the server
 * log instead of being delivered. This is deliberate — no mail provider is
 * wired yet (founder decision pending; see README.md — Resend recommended).
 *
 * The share API returns the invite URL in its response, so owners can copy
 * and send the link themselves until a provider is connected.
 *
 * Tier 2 note: when real-time live sync lands, share notifications (e.g.
 * "Alex checked off Milk") should reuse this interface, not a new one.
 */

export interface ShareInviteEmail {
  /** Invitee's email address. */
  to: string;
  /** Display name of the person sharing (never anonymous). */
  fromName: string;
  /** Name of the shared shopping list. */
  listName: string;
  /** Full invite URL: <origin>/invite/<token>. */
  inviteUrl: string;
  /** Which kind of list is being shared (drives the email copy). */
  kind?: "shopping" | "todo";
}

export interface EmailSender {
  sendShareInvite(email: ShareInviteEmail): Promise<void>;
  sendTodoReminder(email: TodoReminderEmail): Promise<void>;
}

/** A to-do reminder: due soon or due now. */
export interface TodoReminderEmail {
  /** Pilot's email address. */
  to: string;
  /** The to-do's text. */
  todoText: string;
  /** Plain-English due label, e.g. "Today at 3:00 PM". */
  dueLabel: string;
  /** Name of the list the to-do lives in. */
  listName: string;
}

/**
 * Default driver: logs the email that would have been sent. Safe for v1 —
 * nothing leaves the server, and the invite URL is still returned to the
 * owner via the API so sharing works end-to-end without a provider.
 */
export class LogEmailSender implements EmailSender {
  async sendShareInvite(email: ShareInviteEmail): Promise<void> {
    const { subject, text, html } = buildShareInvite(email);
    console.log(
      JSON.stringify({
        event: "email.share_invite",
        to: email.to,
        subject,
        text,
        html,
        timestamp: new Date().toISOString(),
      }),
    );
  }

  async sendTodoReminder(email: TodoReminderEmail): Promise<void> {
    console.log(
      JSON.stringify({
        event: "email.todo_reminder",
        to: email.to,
        todoText: email.todoText,
        dueLabel: email.dueLabel,
        listName: email.listName,
        timestamp: new Date().toISOString(),
      }),
    );
  }
}

/** Integration point: swap the driver here when a provider is connected. */
let sender: EmailSender | null = null;

export function getEmailSender(): EmailSender {
  if (!sender) sender = new LogEmailSender();
  return sender;
}

/** Test seam — lets future provider drivers be injected without editing callers. */
export function setEmailSender(next: EmailSender): void {
  sender = next;
}

function firstName(displayName: string): string {
  const clean = displayName.trim();
  if (clean) return clean.split(" ")[0];
  return "Someone";
}

export function buildShareInvite(email: ShareInviteEmail): {
  subject: string;
  text: string;
  html: string;
} {
  const from = firstName(email.fromName);
  const kindNoun = email.kind === "todo" ? "to-do list" : "shopping list";
  const subject = `${from} shared a ${kindNoun} with you`;
  const text = [
    `Hi there,`,
    ``,
    `${from} shared their "${email.listName}" ${kindNoun} with you on Crystal.`,
    ``,
    `Open it here:`,
    email.inviteUrl,
    ``,
    `This link works once and expires in 30 days. If ${from} shares more lists with you later, you'll get a fresh link each time.`,
    ``,
    `What is Crystal? It's your personal command center — lists, bills, health, and more — with a smart AI assistant to help through the day.`,
    ``,
    `Didn't expect this? You can safely ignore this email — nothing was shared until you open the link and sign in.`,
  ].join("\n");

  const html = `<!doctype html>
<html><body style="font-family: system-ui, -apple-system, sans-serif; line-height: 1.6; color: #1a1a1a; max-width: 560px; margin: 0 auto; padding: 24px;">
<p>Hi there,</p>
<p><strong>${escapeHtml(from)}</strong> shared their &ldquo;${escapeHtml(email.listName)}&rdquo; ${kindNoun} with you on Crystal.</p>
<p><a href="${escapeHtml(email.inviteUrl)}" style="display: inline-block; background: #16a34a; color: #fff; padding: 12px 24px; border-radius: 10px; text-decoration: none; font-weight: 600;">Open the shared list</a></p>
<p style="color: #555; font-size: 14px;">This link works once and expires in 30 days.</p>
<hr style="border: none; border-top: 1px solid #ddd; margin: 24px 0;" />
<p style="color: #555; font-size: 14px;"><strong>What is Crystal?</strong> Your personal command center &mdash; lists, bills, health, and more &mdash; with a smart AI assistant to help through the day.</p>
<p style="color: #888; font-size: 13px;">Didn&rsquo;t expect this? You can safely ignore this email &mdash; nothing was shared until you open the link and sign in.</p>
</body></html>`;

  return { subject, text, html };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
