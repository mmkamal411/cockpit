import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LandingHero } from "@/components/landing-hero";
import { LandingFeatures } from "@/components/landing/features";
import { MeetCrystal } from "@/components/landing/meet-crystal";
import { LandingAuthSection } from "@/components/landing/auth-section";
import { LandingFooter } from "@/components/landing/footer";
import { SalesChat } from "@/components/landing/sales-chat";

/** Session-gated: reads cookies per request — opt out of static-shell validation. */
export const dynamic = "force-dynamic";

/** Public landing. Signed-in pilots go straight to their bridge. */
export default async function LandingPage({
  searchParams,
}: {
  searchParams: Promise<{ cal?: string }>;
}) {
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
  // Carry the calendar connect result (e.g. ?cal=connected) into the app
  // so the calendar applet can show a friendly confirmation notice.
  const { cal } = await searchParams;
  if (user) redirect(cal ? `/home?cal=${encodeURIComponent(cal)}` : "/home");

  return (
    <>
      <LandingHero />
      <LandingFeatures />
      <MeetCrystal />
      <LandingAuthSection />
      <LandingFooter />
      <SalesChat />
    </>
  );
}
