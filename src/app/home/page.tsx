import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { HeroVista } from "@/components/pilot/hero-vista";
import { GlassPane } from "@/components/glass-pane";
import { HomeStations } from "@/components/home-stations";
import { ChildHome } from "@/components/child/child-home";

/** Session-gated: reads cookies per request — opt out of static-shell validation. */
export const dynamic = "force-dynamic";

function pilotNameFor(email: string | undefined, fullName: string | undefined): string {
  if (fullName && fullName.trim()) return fullName.trim().split(" ")[0];
  if (email) {
    const handle = email.split("@")[0].replace(/[._-]+/g, " ").trim();
    if (handle) return handle.charAt(0).toUpperCase() + handle.slice(1);
  }
  return "Pilot";
}

/**
 * Home — the opening page. The pilot floats idle before a planetary vista
 * with a glass pane for weather + the day. Everything else is a station
 * you visit from the toolbar.
 */
export default async function HomePage() {
  let user = null;
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch (e) {
    // Auth check threw (Supabase unreachable, etc.): the error boundary
    // would 500 without this. Redirect to login — the pilot can retry there.
    console.error(JSON.stringify({
      route: "/home",
      operation: "getUser",
      error: e instanceof Error ? e.message : String(e),
      timestamp: new Date().toISOString(),
    }));
  }
  if (!user) redirect("/login");

  const pilotName = pilotNameFor(
    user.email,
    typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : undefined,
  );

  // Pilot-type aware home: a linked child (13+) gets their own school-day
  // home (morning spark → bell strip → check-in hero → tonight's ONE action).
  // Everyone else gets the standard glass pane. One query, fail-open to the
  // standard home if the pilot row can't be read.
  let isChildPilot = false;
  try {
    const supabase = await createClient();
    const { data: pilot } = await supabase
      .from("pilots")
      .select("child_crew_member_id")
      .eq("id", user.id)
      .single();
    isChildPilot = !!(pilot?.child_crew_member_id as string | null);
  } catch {
    isChildPilot = false;
  }

  if (isChildPilot) {
    return (
      <div className="relative h-dvh overflow-hidden">
        <HeroVista pilotName={pilotName} />
        <div className="absolute inset-x-0 bottom-0 z-10 flex max-h-[calc(100dvh-72px)] flex-col items-center gap-3 overflow-y-auto px-4 pb-[104px] pt-2 sm:items-end sm:px-8 sm:pb-[110px]">
          <ChildHome />
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-dvh overflow-hidden">
      <HeroVista pilotName={pilotName} />
      {/* Glass pane + station buttons float over the vista, clear of the
          toolbar. The stack scrolls internally on short screens rather than
          clipping — nothing ever renders as a dead blank region. */}
      <div className="absolute inset-x-0 bottom-0 z-10 flex max-h-[calc(100dvh-72px)] flex-col items-center gap-3 overflow-y-auto px-4 pb-[104px] pt-2 sm:items-end sm:px-8 sm:pb-[110px]">
        <GlassPane />
        <HomeStations />
      </div>
    </div>
  );
}
