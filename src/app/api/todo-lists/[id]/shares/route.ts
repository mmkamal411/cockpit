import { NextResponse } from "next/server";
import { requirePilot, serverError } from "@/lib/api-auth";
import { getEmailSender } from "@/lib/email/sender";

interface RouteParams {
  params: Promise<{ id: string }>;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_INVITES_PER_DAY = 10;

/** Portable SHA-256 hex (Node + Workers-safe, no node:crypto import). */
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 256-bit token, URL-safe hex. */
function newToken(): string {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
}

function displayNameFor(user: { email?: string; user_metadata?: Record<string, unknown> }): string {
  const full = user.user_metadata?.["full_name"];
  if (typeof full === "string" && full.trim()) return full.trim().split(" ")[0];
  if (user.email) {
    const handle = user.email.split("@")[0].replace(/[._-]+/g, " ").trim();
    if (handle) return handle.charAt(0).toUpperCase() + handle.slice(1);
  }
  return "Someone";
}

/**
 * GET /api/todo-lists/[id]/shares
 * Owner only: who this list is shared with.
 */
export async function GET(_req: Request, { params }: RouteParams) {
  const auth = await requirePilot();
  if (auth instanceof NextResponse) return auth;
  const { supabase, user } = auth;
  const { id } = await params;

  try {
    const { data: list } = await supabase
      .from("todo_lists")
      .select("id")
      .eq("id", id)
      .eq("pilot_id", user.id)
      .maybeSingle();
    if (!list) {
      return NextResponse.json({ error: "That list wasn't found." }, { status: 404 });
    }

    const { data: shares, error } = await supabase
      .from("todo_list_shares")
      .select("id, shared_with_email, permission, created_at, shared_with_pilot_id")
      .eq("list_id", id)
      .order("created_at", { ascending: true });
    if (error) throw error;

    return NextResponse.json({
      shares: (shares ?? []).map((s) => ({
        id: s.id,
        email: s.shared_with_email,
        permission: s.permission,
        accepted: s.shared_with_pilot_id !== null,
        created_at: s.created_at,
      })),
    });
  } catch {
    return serverError();
  }
}

/**
 * POST /api/todo-lists/[id]/shares
 * Body: { email, permission?: "view" | "edit" }. Owner only.
 *
 * Creates the share row + a single-use invite token, then "sends" the invite
 * email (log driver in v1 — see src/lib/email). Returns the invite URL so
 * the owner can also share the link directly.
 *
 * Child-safe: the invite is addressed to one email and the redeem step
 * binds it to the signed-in pilot's email server-side — a child (or their
 * parent steward when under 13) accepts from the link, and only that
 * account ever gains access.
 */
export async function POST(req: Request, { params }: RouteParams) {
  const auth = await requirePilot();
  if (auth instanceof NextResponse) return auth;
  const { supabase, user } = auth;
  const { id } = await params;

  try {
    const { data: list } = await supabase
      .from("todo_lists")
      .select("id, name")
      .eq("id", id)
      .eq("pilot_id", user.id)
      .maybeSingle();
    if (!list) {
      return NextResponse.json({ error: "That list wasn't found." }, { status: 404 });
    }

    const body = await req.json().catch(() => ({}));
    const rawEmail = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    const permission = body.permission === "view" ? "view" : "edit";

    if (!EMAIL_RE.test(rawEmail)) {
      return NextResponse.json({ error: "That email address doesn't look right." }, { status: 400 });
    }
    if (user.email && rawEmail === user.email.toLowerCase()) {
      return NextResponse.json({ error: "That's your own email — the list is already yours." }, { status: 400 });
    }

    // Abuse guard: max 10 invites per pilot per day.
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count: inviteCount, error: countError } = await supabase
      .from("share_invites")
      .select("id, todo_list_shares!inner(owner_pilot_id)", { count: "exact", head: true })
      .eq("todo_list_shares.owner_pilot_id", user.id)
      .gte("created_at", dayAgo);
    if (countError) throw countError;
    if ((inviteCount ?? 0) >= MAX_INVITES_PER_DAY) {
      return NextResponse.json(
        { error: "You've sent a lot of invites today — try again tomorrow." },
        { status: 429 },
      );
    }

    // Duplicate guard.
    const { data: existing } = await supabase
      .from("todo_list_shares")
      .select("id")
      .eq("list_id", id)
      .eq("shared_with_email", rawEmail)
      .maybeSingle();
    if (existing) {
      return NextResponse.json(
        { error: "You've already shared this list with that email." },
        { status: 409 },
      );
    }

    // Resolve the pilot now if they already have an account.
    // Scoped to this list (which we own) — the function refuses to resolve
    // emails outside that context.
    const { data: pilotId } = await supabase.rpc("find_todo_pilot_by_email", {
      p_email: rawEmail,
      p_list_id: id,
    });

    const ownerName = displayNameFor(user);

    const { data: share, error: shareError } = await supabase
      .from("todo_list_shares")
      .insert({
        list_id: id,
        owner_pilot_id: user.id,
        shared_with_email: rawEmail,
        shared_with_pilot_id: pilotId ?? null,
        permission,
        owner_display_name: ownerName,
      })
      .select("id, shared_with_email, permission")
      .single();
    if (shareError) throw shareError;

    const token = newToken();
    const tokenHash = await sha256Hex(token);
    const { error: inviteError } = await supabase.from("share_invites").insert({
      todo_share_id: share.id,
      token_hash: tokenHash,
    });
    if (inviteError) throw inviteError;

    const inviteUrl = `${new URL(req.url).origin}/invite/${token}`;

    // Fire-and-forget email (log driver in v1). A failed send must not fail
    // the share — the owner still gets the link to send manually.
    try {
      await getEmailSender().sendShareInvite({
        to: rawEmail,
        fromName: displayNameFor(user),
        listName: list.name,
        inviteUrl,
        kind: "todo",
      });
    } catch {
      // Logged by the driver itself; the share stands regardless.
    }

    return NextResponse.json(
      {
        share: {
          id: share.id,
          email: share.shared_with_email,
          permission: share.permission,
          accepted: pilotId !== null,
        },
        inviteUrl,
      },
      { status: 201 },
    );
  } catch {
    return serverError();
  }
}
