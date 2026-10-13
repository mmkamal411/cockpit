import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { MySharing } from "@/components/my-sharing";

/** Session-gated: reads cookies per request — opt out of static-shell validation. */
export const dynamic = "force-dynamic";

/**
 * /sharing — the child's "who can see my school life" screen.
 * Any signed-in pilot can open it; the screen itself explains when it
 * doesn't apply (the API 404s for non-child pilots).
 */
export default async function SharingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser().catch(() => ({ data: { user: null } }));
  if (!user) redirect("/login?next=/sharing");

  return (
    <div className="min-h-dvh bg-black text-star">
      <div className="mx-auto flex max-w-2xl items-center justify-between px-4 pt-6">
        <a href="/home" className="text-sm text-dim transition-colors hover:text-stardust">
          ← Home
        </a>
      </div>
      <MySharing />
    </div>
  );
}

export async function generateMetadata() {
  return { title: "My sharing — Cockpit" };
}
