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
};

export function AppletContent({ id, params }: { id: string; params: AppletParams }) {
  const def = APPLETS[id];
  if (!def) return null;
  return <>{def.render(params)}</>;
}
