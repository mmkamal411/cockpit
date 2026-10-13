# Email — provider integration

**Status:** v1 ships with the log driver only (`LogEmailSender`). Invite emails
are written to the server log; the share API returns the invite URL so owners
can copy-paste the link themselves. Nothing is delivered.

## Connecting a real provider (founder decision)

**Recommended: Resend** — free tier covers early volume, one HTTP call, no
SMTP wrestling, first-class Next.js support.

Steps when approved:

1. `npm install resend`
2. Add `RESEND_API_KEY` to Cloudflare Pages env vars (and `.env.local`).
3. Create `src/lib/email/resend-sender.ts`:

```ts
import { Resend } from "resend";
import { buildShareInvite, type EmailSender, type ShareInviteEmail } from "./sender";

export class ResendSender implements EmailSender {
  async sendShareInvite(email: ShareInviteEmail): Promise<void> {
    const resend = new Resend(process.env.RESEND_API_KEY);
    const { subject, text, html } = buildShareInvite(email);
    const { error } = await resend.emails.send({
      from: `${email.fromName} via Cockpit <invites@cockpit.example.com>`,
      to: email.to,
      subject,
      text,
      html,
    });
    if (error) throw new Error(`Resend: ${error.message}`);
  }
}
```

4. In `sender.ts`, change `getEmailSender()` to return `new ResendSender()`
   when `process.env.RESEND_API_KEY` is set (keep the log driver as fallback).
5. Verify the sending domain in Resend before going live (SPF/DKIM), or
   invites land in spam.

## Copy rules (apply to every template)

- The sender is always named — never anonymous invites.
- Grandmother test: plain words, one CTA, what Cockpit is in one line.
- Every invite email carries a "didn't expect this? ignore it" line.
- No tracking pixels, no marketing footer — transactional only.
