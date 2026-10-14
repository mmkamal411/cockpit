import { createClient } from "@/lib/supabase/server";
import { InviteWelcome } from "./invite-welcome";

/** Session-gated: reads cookies per request — opt out of static-shell validation. */
export const dynamic = "force-dynamic";

interface Preview {
  valid: boolean;
  kind?: "todo" | "shopping";
  reason?: "invalid" | "expired" | "accepted";
  list_name?: string;
  list_icon?: string;
  list_color?: string;
  owner_name?: string;
  permission?: "view" | "edit";
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function DeadEnd({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-black px-6">
      <div className="w-full max-w-md rounded-2xl border border-line bg-panel-2/60 p-8 text-center">
        <p aria-hidden="true" className="text-4xl">🛒</p>
        <h1 className="mt-4 text-xl font-semibold text-star">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-stardust">{body}</p>
        <a
          href="/login"
          className="mt-6 inline-block rounded-xl border border-neon-cyan/40 bg-neon-cyan/10 px-5 py-2.5 text-sm font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/20"
        >
          Go to Cockpit
        </a>
      </div>
    </div>
  );
}

/**
 * /invite/<token> — redeem a shared-list invite.
 *
 * Signed out: shows who shared what, with a sign-in button that returns here.
 * Signed in: redeems the single-use token, then shows the one-screen welcome
 * before opening the shared list. Expired/used links get plain-English pages.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));

  const tokenHash = await sha256Hex(token);
  const { data: shopPreview } = await supabase.rpc("get_share_invite_preview", {
    p_token_hash: tokenHash,
  });
  const sp = (shopPreview ?? { valid: false, reason: "invalid" }) as Preview;
  let p = sp;
  if (!p.valid) {
    // Not a shopping invite — maybe a to-do list invite.
    const { data: todoPreview } = await supabase.rpc("get_todo_share_invite_preview", {
      p_token_hash: tokenHash,
    });
    const tp = (todoPreview ?? { valid: false, reason: "invalid" }) as Preview;
    if (tp.valid) p = tp;
  }

  if (!p.valid) {
    if (p.reason === "expired") {
      return (
        <DeadEnd
          title="This invite expired"
          body="Invite links last 30 days. Ask the person who shared it to send you a fresh one — it only takes them a moment."
        />
      );
    }
    if (p.reason === "accepted") {
      return (
        <DeadEnd
          title="This invite was already used"
          body="Invite links work once. If you accepted it before, the list is waiting in your Cockpit — check your shared lists."
        />
      );
    }
    return (
      <DeadEnd
        title="This invite link isn't valid"
        body="It may have been revoked or mistyped. Ask the person who shared it to send you a new link."
      />
    );
  }

  // Valid invite, not signed in yet: the pitch + sign-in that returns here.
  const kindNoun = p.kind === "todo" ? "to-do list" : "shopping list";
  const kindIcon = p.kind === "todo" ? "✅" : (p.list_icon ?? "🛒");
  if (!user) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-black px-6">
        <div className="w-full max-w-md rounded-2xl border border-line bg-panel-2/60 p-8 text-center">
          <p aria-hidden="true" className="text-5xl">{kindIcon}</p>
          <h1 className="mt-4 text-xl font-semibold text-star">
            {p.owner_name} shared a {kindNoun} with you
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-stardust">
            <strong className="text-star">&ldquo;{p.list_name}&rdquo;</strong>
            {p.permission === "edit"
              ? p.kind === "todo"
                ? " — you can add tasks, check them off, and assign them together."
                : " — you can add and check off items together."
              : " — you can follow along as it updates."}
          </p>
          <a
            href={`/login?next=/invite/${encodeURIComponent(token)}`}
            className="mt-6 inline-block rounded-xl border border-neon-green/40 bg-neon-green/10 px-6 py-3 text-sm font-medium text-neon-green transition-colors hover:bg-neon-green/20"
          >
            Sign in to open it
          </a>
          <p className="mt-4 text-xs leading-relaxed text-dim">
            New to Cockpit? Signing in creates your free account — the list opens right after.
          </p>
        </div>
      </div>
    );
  }

  // Valid invite + signed in: redeem the single-use token.
  // Identity comes from the session server-side (auth.uid() + JWT email);
  // only the token hash travels as a parameter.
  const redeemRpc = p.kind === "todo" ? "redeem_todo_share_invite" : "redeem_share_invite";
  const { data: result } = await supabase.rpc(redeemRpc, {
    p_token_hash: tokenHash,
  });
  const r = (result ?? { ok: false, reason: "invalid" }) as {
    ok: boolean;
    reason?: string;
    already?: boolean;
    list_id?: string;
    list_name?: string;
    permission?: "view" | "edit";
  };

  if (!r.ok) {
    if (r.reason === "expired") {
      return (
        <DeadEnd
          title="This invite expired"
          body="Invite links last 30 days. Ask the person who shared it to send you a fresh one."
        />
      );
    }
    return (
      <DeadEnd
        title="This invite was already used"
        body="Invite links work once. Check your shared lists in Cockpit — it should be there."
      />
    );
  }

  // First-run moment: one screen, then straight into the shared list.
  return (
    <InviteWelcome
      listId={r.list_id ?? ""}
      listName={r.list_name ?? p.list_name ?? (p.kind === "todo" ? "To-do list" : "Shopping list")}
      ownerName={p.owner_name ?? "Someone"}
      permission={r.permission ?? p.permission ?? "view"}
      already={r.already ?? false}
      kind={p.kind === "todo" ? "todo" : "shopping"}
    />
  );
}

// Re-export guard: Next.js requires a default export; named helper above.
export async function generateMetadata() {
  return { title: "Shared list — Cockpit" };
}
