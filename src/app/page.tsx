import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LandingHero } from "@/components/landing-hero";

/** Session-gated: reads cookies per request — opt out of static-shell validation. */
export const instant = false;

/** Public landing. Signed-in pilots go straight to their bridge. */
export default async function LandingPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/home");

  return <LandingHero />;
}
