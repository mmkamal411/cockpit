"use client";

import type { ReactNode } from "react";
import type { AppletParams } from "@/lib/applet-bus";
import { TodayApplet } from "./applets/today-applet";
import { CrystalApplet } from "./applets/crystal-applet";
import { ProgressApplet } from "./applets/progress-applet";
import { MoreApplet } from "./applets/more-applet";
import { CrewApplet } from "./applets/crew-applet";
import { BillsApplet } from "./applets/bills-applet";
import { WeatherApplet } from "./applets/weather-applet";
import { CalendarApplet } from "./applets/calendar-applet";
import { ShoppingApplet } from "./applets/shopping-applet";
import { HealthApplet } from "./applets/health-applet";
import { NudgeCenterApplet } from "./applets/nudge-center-applet";
import { SchoolOverviewApplet } from "./applets/school-overview-applet";

/**
 * Settings placeholder — the full User Settings module (Profile,
 * Integrations, Notifications, Privacy & Data, Appearance, Account) is
 * being built separately. This keeps openApplet("settings") safe to call
 * from the station deck's pinned footer in the meantime.
 */
function SettingsPlaceholderApplet() {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-neon-teal">
          Ship systems
        </p>
        <h2 className="mt-1 text-xl font-semibold text-star">Settings</h2>
        <p className="mt-1 text-sm leading-relaxed text-stardust">
          Your settings station is taking shape — profile, integrations,
          notifications, privacy, appearance, and account controls are on
          the way.
        </p>
      </div>
    </div>
  );
}

export interface AppletDef {
  /** Short plain-English name shown in the window chrome. */
  name: string;
  /** Tiny cockpit readout shown beside the glow dot. */
  readout: string;
  /** Neon glow color for the window chrome. */
  glow: string;
  render: (params: AppletParams) => ReactNode;
}

/** Every module that can open as a temporary applet. Pilot-level, no scoping. */
export const APPLETS: Record<string, AppletDef> = {
  today: {
    name: "Today",
    readout: "ATTN",
    glow: "#67e8f9",
    render: () => <TodayApplet />,
  },
  crystal: {
    name: "Crystal",
    readout: "AI",
    glow: "#5eead4",
    render: () => <CrystalApplet />,
  },
  progress: {
    name: "Progress",
    readout: "GRWTH",
    glow: "#c4b5fd",
    render: () => <ProgressApplet />,
  },
  more: {
    name: "More",
    readout: "SHIP",
    glow: "#fcd34d",
    render: () => <MoreApplet />,
  },
  crew: {
    name: "Crew",
    readout: "CREW",
    glow: "#86efac",
    render: () => <CrewApplet />,
  },
  bills: {
    name: "Bills",
    readout: "BILLS",
    glow: "#fcd34d",
    render: () => <BillsApplet />,
  },
  weather: {
    name: "Weather",
    readout: "WX",
    glow: "#67e8f9",
    render: () => <WeatherApplet />,
  },
  calendar: {
    name: "Calendar",
    readout: "CAL",
    glow: "#f0abfc",
    render: () => <CalendarApplet />,
  },
  shopping: {
    name: "Shopping",
    readout: "LIST",
    glow: "#5eead4",
    render: (params) => <ShoppingApplet params={params} />,
  },
  health: {
    name: "Health",
    readout: "MED",
    glow: "#86efac",
    render: () => <HealthApplet />,
  },
  nudges: {
    name: "Nudge Center",
    readout: "NUDGE",
    glow: "#fcd34d",
    render: () => <NudgeCenterApplet />,
  },
  school: {
    name: "School Overview",
    readout: "SKL",
    glow: "#67e8f9",
    render: (params) => <SchoolOverviewApplet params={params} />,
  },
  settings: {
    name: "Settings",
    readout: "SYS",
    glow: "#67e8f9",
    render: () => <SettingsPlaceholderApplet />,
  },
};

export function AppletContent({ id, params }: { id: string; params: AppletParams }) {
  const def = APPLETS[id];
  if (!def) return null;
  return <>{def.render(params)}</>;
}
