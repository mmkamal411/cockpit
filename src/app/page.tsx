import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LandingHero } from "@/components/landing-hero";

/** Session-gated: reads cookies per request — opt out of static-shell validation. */
export const dynamic = "force-dynamic";

/** Public landing. Signed-in pilots go straight to their bridge. */
export default async function LandingPage() {
  let user = null;
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch (e) {
    // Auth check failed (Supabase unreachable, etc.): treat as signed out
    // and render the public landing rather than 500ing it.
    console.error(JSON.stringify({
      route: "/",
      operation: "getUser",
      error: e instanceof Error ? e.message : String(e),
      timestamp: new Date().toISOString(),
    }));
  }
  if (user) redirect("/home");

  return <LandingHero />;
}
