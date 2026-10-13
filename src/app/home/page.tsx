import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { HeroVista } from "@/components/pilot/hero-vista";
import { GlassPane } from "@/components/glass-pane";

/** Session-gated: reads cookies per request — opt out of static-shell validation. */
export const instant = false;

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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const pilotName = pilotNameFor(
    user.email,
    typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : undefined,
  );

  return (
    <div className="relative h-dvh overflow-hidden">
      <HeroVista pilotName={pilotName} />
      {/* Glass pane floats over the vista, clear of the toolbar. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-center px-4 pb-[104px] sm:justify-end sm:px-8 sm:pb-[110px]">
        <GlassPane />
      </div>
    </div>
  );
}
