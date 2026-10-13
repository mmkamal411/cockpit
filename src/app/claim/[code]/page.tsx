import { createClient } from "@/lib/supabase/server";
import { ClaimFlow, type ClaimPreview } from "@/components/claim-flow";

/** Session-gated: reads cookies per request — opt out of static-shell validation. */
export const dynamic = "force-dynamic";

function DeadEnd({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-black px-6">
      <div className="w-full max-w-md rounded-2xl border border-line bg-panel-2/60 p-8 text-center">
        <p aria-hidden="true" className="text-4xl">🔑</p>
        <h1 className="mt-4 text-xl font-semibold text-star">{title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-stardust">{body}</p>
        <a
          href="/home"
          className="mt-6 inline-block rounded-xl border border-neon-cyan/40 bg-neon-cyan/10 px-5 py-2.5 text-sm font-medium text-neon-cyan transition-colors hover:bg-neon-cyan/20"
        >
          Go to Cockpit
        </a>
      </div>
    </div>
  );
}

/**
 * /claim/<6-digit code> — the child's link-code claim flow (v1, D5).
 *
 * The server validates the code via preview_link_code() (safe pre-auth).
 * Signed out → the pitch with a sign-in button that returns here.
 * Signed in → the consent screen (WILL see / will NOT see), then the
 * atomic claim. Expired/used codes get plain-English pages, never blanks.
 */
export default async function ClaimPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));

  const { data: previewData } = await supabase.rpc("preview_link_code", {
    p_code: code,
  });
  const preview = (previewData ?? { valid: false, reason: "invalid" }) as ClaimPreview;

  if (!preview.valid) {
    if (preview.reason === "expired") {
      return (
        <DeadEnd
          title="This code expired"
          body="Link codes last 15 minutes. Ask your parent to make you a fresh one — it only takes them a moment."
        />
      );
    }
    return (
      <DeadEnd
        title="This code isn't valid"
        body="It may have been used already or typed wrong. Check the 6 digits on your parent's screen and try again."
      />
    );
  }

  // Valid code, not signed in yet: the pitch + sign-in that returns here.
  if (!user) {
    const firstName = (preview.crew_member_name ?? "there").split(" ")[0];
    return (
      <div className="flex min-h-dvh items-center justify-center bg-black px-6">
        <div className="w-full max-w-md rounded-3xl border border-line bg-panel/70 p-8 text-center shadow-[0_24px_80px_rgb(0_0_0/0.55)] backdrop-blur-xl">
          <p aria-hidden="true" className="text-5xl">🎒</p>
          <h1 className="mt-4 text-xl font-semibold text-star">
            {preview.steward_name} invited you to Cockpit, {firstName}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-stardust">
            Sign in to link your school. You&apos;ll see <em>exactly</em> what
            they can see — and what stays private — before you say yes.
          </p>
          <a
            href={`/login?next=/claim/${encodeURIComponent(code)}`}
            className="mt-6 inline-block rounded-xl border border-neon-green/40 bg-neon-green/10 px-6 py-3 text-sm font-semibold text-neon-green transition-colors hover:bg-neon-green/20"
          >
            Sign in to continue
          </a>
          <p className="mt-4 text-xs leading-relaxed text-dim">
            New to Cockpit? Signing in creates your free account — the invite picks up right after.
          </p>
        </div>
      </div>
    );
  }

  // Valid code + signed in: the consent flow.
  return <ClaimFlow code={code} preview={preview} />;
}

export async function generateMetadata() {
  return { title: "Link your school — Cockpit" };
}
