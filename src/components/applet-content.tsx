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
import { SettingsApplet } from "./applets/settings-applet";
import { SchoolStation } from "./applets/school-station";
import { ClassDetail } from "./applets/class-detail";
import { StationCategoryOverlay } from "./home-stations";
import { openApplet } from "@/lib/applet-bus";

/**
 * Settings — the 7 user-facing settings panels (Phase D of the
 * child-education build). openApplet("settings") renders SettingsApplet.
 */

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
  settings: {
    name: "Settings",
    readout: "SYS",
    glow: "#67e8f9",
    render: () => <SettingsApplet />,
  },
  school: {
    name: "School",
    readout: "SCHL",
    glow: "#86efac",
    render: () => <SchoolStation />,
  },
  "station-category": {
    name: "Stations",
    readout: "NAV",
    glow: "#67e8f9",
    render: (params) => <StationCategoryOverlay params={params} />,
  },
  "class-detail": {
    name: "Class",
    readout: "CLS",
    glow: "#86efac",
    render: (params) =>
      params.member && params.class ? (
        <ClassDetail
          memberId={params.member}
          className={params.class}
          onBack={() => openApplet("school", {}, { replace: true })}
        />
      ) : (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-star">
            That class didn&apos;t open
          </h2>
          <p className="text-sm leading-relaxed text-stardust">
            We lost track of which class you tapped. Head back to the school
            station and try the class again.
          </p>
          <button
            type="button"
            onClick={() => openApplet("school", {}, { replace: true })}
            className="rounded-xl border border-neon-green/40 bg-neon-green/10 px-5 py-2.5 text-sm font-medium text-neon-green transition-colors hover:bg-neon-green/20"
          >
            Back to School
          </button>
        </div>
      ),
  },
};

export function AppletContent({ id, params }: { id: string; params: AppletParams }) {
  const def = APPLETS[id];
  if (!def) return null;
  return <>{def.render(params)}</>;
}
