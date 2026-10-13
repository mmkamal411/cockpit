"use client";

import { useEffect, useMemo, useState } from "react";
import { DEFAULT_SETTINGS, type AllSettings } from "@/lib/pilot-settings";
import { StationProfile } from "./settings/station-profile";
import { StationConnections } from "./settings/station-connections";
import { StationAlerts } from "./settings/station-alerts";
import { StationAI } from "./settings/station-ai";
import { StationShip } from "./settings/station-ship";
import { StationFamily } from "./settings/station-family";
import { StationPrivacy } from "./settings/station-privacy";

type StationId =
  | "profile"
  | "connections"
  | "alerts"
  | "crystal"
  | "ship"
  | "family"
  | "privacy";

interface StationDef {
  id: StationId;
  name: string;
  blurb: string;
  keywords: string;
  render: (props: { onBack: () => void }) => React.ReactNode;
  summary: (s: AllSettings) => string;
}

const STATIONS: StationDef[] = [
  {
    id: "profile",
    name: "Your profile",
    blurb: "Your name, photo, timezone, and where home is.",
    keywords: "profile name photo avatar picture email timezone location home fahrenheit celsius units",
    render: (p) => <StationProfile {...p} />,
    summary: () => "",
  },
  {
    id: "connections",
    name: "Connections",
    blurb: "Calendars, school logins, and everything feeding your cockpit.",
    keywords: "connections calendar google outlook sync school login health bank shopping travel mail gmail integrations",
    render: (p) => <StationConnections {...p} />,
    summary: () => "",
  },
  {
    id: "alerts",
    name: "Alerts",
    blurb: "What Crystal tells you, and when — including quiet hours.",
    keywords: "alerts notifications nudges grade threshold due soon reminder quiet hours silence urgent sensitivity",
    render: (p) => <StationAlerts {...p} />,
    summary: (s) =>
      `Grade alerts ${s.alerts.grade_alerts_enabled ? `on, target ${s.alerts.grade_drop_threshold}` : "off"} · quiet hours ${s.alerts.quiet_hours.enabled ? `${s.alerts.quiet_hours.start}–${s.alerts.quiet_hours.end}` : "off"}`,
  },
  {
    id: "crystal",
    name: "Crystal",
    blurb: "How your AI co-pilot behaves — eager, gentle, or hands-off.",
    keywords: "crystal ai assistant proactive gentle eager fireball learn corrections persona mode",
    render: (p) => <StationAI {...p} />,
    summary: (s) =>
      `Proactive help: ${s.crystal.proactive_help} · learns from corrections: ${s.crystal.learn_from_corrections ? "yes" : "no"}`,
  },
  {
    id: "ship",
    name: "Your cockpit",
    blurb: "Arrange your ship — station order, colors, motion, and celebrations.",
    keywords: "cockpit ship layout order stations reorder appearance theme neon accent motion orb calm lively celebrations widgets home",
    render: (p) => <StationShip {...p} />,
    summary: (s) =>
      `${s.cockpit.home_stations.length} home stations · ${s.cockpit.orb_behavior === "calm" ? "calm" : "lively"} Crystal · motion ${s.cockpit.reduce_motion ? "reduced" : "full"}`,
  },
  {
    id: "family",
    name: "Family & sharing",
    blurb: "Who's aboard, what they can see, and every sharing change ever made.",
    keywords: "family sharing crew children kids parents invite code link grant access audit history independent graduation visibility checkin",
    render: (p) => <StationFamily {...p} />,
    summary: (s) =>
      `Check-ins ${s.family.checkin_shared_by_default ? "shared" : "private"} by default · full text 13–15: ${s.family.full_checkin_text_13_15 ? "on" : "off"}`,
  },
  {
    id: "privacy",
    name: "Privacy & data",
    blurb: "What we keep, your full download, cookies, sign out, and the exits.",
    keywords: "privacy data retention download export cookies sign out delete account erase danger",
    render: (p) => <StationPrivacy {...p} />,
    summary: (s) =>
      s.privacy.retention_days === 0
        ? "Data kept forever"
        : `Data kept ${s.privacy.retention_days} days`,
  },
];

/**
 * Settings — the 7 instrument panels. The home view is the iOS-Settings
 * pattern: one scrolling list, each row with a plain-English description and
 * a live summary of the current state. Search filters panels by anything
 * you'd call them. No panel is ever blank — every empty state says what it
 * is and what to do next.
 */
export function SettingsApplet() {
  const [open, setOpen] = useState<StationId | null>(null);
  const [query, setQuery] = useState("");
  const [settings, setSettings] = useState<AllSettings>(DEFAULT_SETTINGS);

  // One read for the state-summary lines on each row.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/settings");
        if (!res.ok || res.status === 401) return;
        const json = await res.json();
        if (!cancelled && json.settings) setSettings(json.settings as AllSettings);
      } catch {
        // Summaries fall back to defaults; each panel loads its own data.
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return STATIONS;
    return STATIONS.filter((s) =>
      `${s.name} ${s.blurb} ${s.keywords}`.toLowerCase().includes(q),
    );
  }, [query]);

  if (open) {
    const def = STATIONS.find((s) => s.id === open);
    if (!def) {
      setOpen(null);
      return null;
    }
    return <div key={def.id}>{def.render({ onBack: () => setOpen(null) })}</div>;
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-neon-teal">
          Ship systems
        </p>
        <h2 className="mt-1 text-xl font-semibold text-star">Settings</h2>
        <p className="mt-1 text-sm text-stardust">
          Seven panels, one for each part of your ship. Tap one to tune it.
        </p>
      </div>

      <label className="block">
        <span className="sr-only">Search settings</span>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search settings — try “calendar”, “photo”, “quiet hours”…"
          autoComplete="off"
          className="w-full rounded-xl border border-line bg-panel px-4 py-2.5 text-sm text-star placeholder:text-dim focus:border-neon-teal/60 focus:outline-none"
        />
      </label>

      {results.length === 0 ? (
        <div className="rounded-xl border border-line bg-panel-2/60 px-4 py-6 text-center">
          <p className="text-sm font-medium text-star">Nothing matched “{query.trim()}”</p>
          <p className="mt-1 text-sm text-dim">
            Try “calendar”, “photo”, “alerts”, or “privacy” — or clear the
            search to see all seven panels.
          </p>
          <button
            type="button"
            onClick={() => setQuery("")}
            className="mt-3 rounded-xl border border-neon-teal/40 bg-neon-teal/10 px-4 py-2 text-sm font-medium text-neon-teal transition-colors hover:bg-neon-teal/20"
          >
            Show all panels
          </button>
        </div>
      ) : (
        <ul className="space-y-2">
          {results.map((s) => {
            const summary = s.summary(settings);
            return (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setOpen(s.id)}
                  className="flex w-full items-center justify-between gap-3 rounded-xl border border-line bg-panel-2/60 px-4 py-3.5 text-left transition-colors hover:border-neon-teal/40"
                  aria-label={`Open ${s.name} settings`}
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-star">{s.name}</span>
                    <span className="mt-0.5 block text-xs text-stardust">{s.blurb}</span>
                    {summary && (
                      <span className="mt-1 block text-[11px] text-neon-teal/90">
                        {summary}
                      </span>
                    )}
                  </span>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className="shrink-0 text-dim"
                  >
                    <path d="M9 18l6-6-6-6" />
                  </svg>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
