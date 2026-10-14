"use client";

import { useEffect, useReducer, useState, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { closeAllApplets, openApplet, useAppletBus } from "@/lib/applet-bus";
import { SchoolGlyph } from "./school-glyph";
import { CrystalCommandButton } from "@/components/pilot/crystal-mascot";
import {
  playSound,
  useSoundEnabled,
  type SoundKind,
} from "@/lib/command-center/sound";
import {
  setRedAlert,
  startUrgentNudgeWatch,
  useRedAlert,
} from "@/lib/command-center/red-alert";

/* ------------------------------------------------------------------ */
/* Glyphs (22px, 1.5px stroke, icon + word label — console key parity)  */
/* ------------------------------------------------------------------ */

function GlyphShell({ children }: { children: ReactNode }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

function HomeGlyph() {
  return (
    <GlyphShell>
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5.5 10.5V20h13v-9.5" />
    </GlyphShell>
  );
}

function TodayGlyph() {
  return (
    <GlyphShell>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </GlyphShell>
  );
}

function ChatGlyph() {
  return (
    <GlyphShell>
      <path d="M21 12a8 8 0 0 1-8 8H4l2.3-2.9A8 8 0 1 1 21 12Z" />
    </GlyphShell>
  );
}

function ProgressGlyph() {
  return (
    <GlyphShell>
      <path d="M4 20V10" />
      <path d="M10 20V4" />
      <path d="M16 20v-8" />
      <path d="M2.5 20h19" />
    </GlyphShell>
  );
}

function MoreGlyph() {
  return (
    <GlyphShell>
      <circle cx="5" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="19" cy="12" r="1.5" />
    </GlyphShell>
  );
}

function NudgeGlyph() {
  return (
    <GlyphShell>
      <path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16c0 0-2-1-2-6Z" />
      <path d="M10 20a2.2 2.2 0 0 0 4 0" />
    </GlyphShell>
  );
}

function WeatherGlyph() {
  return (
    <GlyphShell>
      <circle cx="9" cy="9" r="3.5" />
      <path d="M9 2.5v1.6M2.5 9h1.6M4.4 4.4l1.1 1.1M13.6 4.4l-1.1 1.1" />
      <path d="M8 20h9.5a3.5 3.5 0 0 0 .6-6.95A5.5 5.5 0 0 0 7.3 14.6 2.8 2.8 0 0 0 8 20Z" />
    </GlyphShell>
  );
}

function CrewGlyph() {
  return (
    <GlyphShell>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 20c.6-3.4 2.8-5.2 5.5-5.2s4.9 1.8 5.5 5.2" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M16 14.6c2.4.2 3.9 1.7 4.4 4.4" />
    </GlyphShell>
  );
}

function SpeakerGlyph() {
  return (
    <GlyphShell>
      <path d="M4 10v4h3.5L12 18.5v-13L7.5 10H4Z" />
      <path d="M15 9.5a4 4 0 0 1 0 5" />
      <path d="M17.5 7.5a7.5 7.5 0 0 1 0 9" />
    </GlyphShell>
  );
}

function AlertGlyph() {
  return (
    <GlyphShell>
      <path d="M12 3 2.5 20h19L12 3Z" />
      <path d="M12 10v4.5" />
      <circle cx="12" cy="17" r="0.6" fill="currentColor" />
    </GlyphShell>
  );
}

/* ------------------------------------------------------------------ */
/* Data hooks                                                          */
/* ------------------------------------------------------------------ */

interface CrewMember {
  id: string;
  name: string;
  relationship?: string | null;
  school_sync?: { sync_status: string };
}

interface PendingNudge {
  id: string;
  title: string;
  score?: number | null;
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}

/* ------------------------------------------------------------------ */
/* 360° radar — decorative ambient sweep                               */
/* ------------------------------------------------------------------ */

function RadarWidget() {
  return (
    <div
      className="cc-radar"
      role="img"
      aria-label="Tactical radar display (decorative)"
    >
      <div className="cc-radar-face" aria-hidden="true">
        <span className="cc-radar-sweep" />
        <span className="cc-radar-blip cc-radar-blip--a" />
        <span className="cc-radar-blip cc-radar-blip--b" />
        <span className="cc-radar-blip cc-radar-blip--c" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Squad status — crew/family presence dots                            */
/* ------------------------------------------------------------------ */

function syncDotState(
  syncStatus: string | undefined,
): "ok" | "attention" | "idle" {
  if (!syncStatus) return "idle";
  const s = syncStatus.toLowerCase();
  if (s.includes("error") || s.includes("fail") || s.includes("expired"))
    return "attention";
  return "ok";
}

function SquadStatus() {
  const [members, setMembers] = useState<CrewMember[] | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/crew/members", { credentials: "same-origin" })
      .then((res) => (res.ok ? res.json() : { members: [] }))
      .then((json) => {
        if (!live) return;
        const list = (json as { members?: unknown }).members;
        setMembers(
          Array.isArray(list)
            ? (list as CrewMember[]).filter((m) => m && typeof m.id === "string")
            : [],
        );
      })
      .catch(() => {
        // API down or signed out: graceful empty state, never an error box.
        if (live) setMembers([]);
      });
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="cc-squad" aria-label="Crew status">
      <span className="cc-squad-tag">CREW</span>
      <div className="cc-squad-dots">
        {members === null ? (
          <span className="cc-squad-dot cc-squad-dot--loading" aria-hidden="true" />
        ) : members.length === 0 ? (
          <span className="cc-squad-empty" title="No crew members linked">
            <span
              className="cc-squad-dot cc-squad-dot--idle"
              aria-hidden="true"
            />
            <span className="cc-squad-empty-label">NO CREW</span>
          </span>
        ) : (
          members.slice(0, 6).map((m) => (
            <span
              key={m.id}
              className="cc-squad-dot"
              data-state={syncDotState(m.school_sync?.sync_status)}
              title={`${m.name}${m.relationship ? ` — ${m.relationship}` : ""}`}
            >
              {(m.name || "?").trim().charAt(0).toUpperCase() || "?"}
            </span>
          ))
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Feed tickers (tactical + comms)                                     */
/* ------------------------------------------------------------------ */

function useTickerFeeds(): { tactical: string[]; comms: string[] } {
  const [feeds, setFeeds] = useState<{ tactical: string[]; comms: string[] }>({
    tactical: [],
    comms: [],
  });

  useEffect(() => {
    let live = true;
    Promise.all([
      fetch("/api/crew/members", { credentials: "same-origin" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch("/api/nudges?status=pending", { credentials: "same-origin" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]).then(([crewJson, nudgeJson]) => {
      if (!live) return;
      const members = (
        (crewJson as { members?: unknown } | null)?.members ?? []
      ) as CrewMember[];
      const nudges = (
        (nudgeJson as { nudges?: unknown } | null)?.nudges ?? []
      ) as PendingNudge[];

      const tactical: string[] = [];
      tactical.push(`CREW LINK ▸ ${members.length} MEMBER${members.length === 1 ? "" : "S"}`);
      tactical.push(`NUDGE QUEUE ▸ ${nudges.length} PENDING`);
      tactical.push("SIM ▸ DEFENSE GRID NOMINAL");
      tactical.push("SIM ▸ ORBITAL RELAY STABLE");
      tactical.push("SIM ▸ ALL DECKS REPORTING");

      const comms: string[] =
        nudges.length > 0
          ? nudges.slice(0, 6).map((n) => {
              const t = (n.title || "UNTRACKED SIGNAL").trim();
              return t.length > 48 ? `${t.slice(0, 45)}…` : t;
            })
          : ["SIM ▸ NO INCOMING TRANSMISSIONS"];

      setFeeds({ tactical, comms });
    });
    return () => {
      live = false;
    };
  }, []);

  return feeds;
}

function Ticker({
  tag,
  items,
  label,
  reducedMotion,
}: {
  tag: string;
  items: string[];
  label: string;
  reducedMotion: boolean;
}) {
  const shown = items.length > 0 ? items : ["SIM ▸ AWAITING UPLINK"];
  return (
    <div className="cc-ticker" aria-label={label}>
      <span className="cc-ticker-tag">{tag}</span>
      <div className="cc-ticker-viewport">
        {reducedMotion ? (
          <div className="cc-ticker-static">
            {shown.slice(0, 2).map((t, i) => (
              <span key={i} className="cc-ticker-item">
                {t}
              </span>
            ))}
          </div>
        ) : (
          <div className="cc-ticker-track" aria-hidden="true">
            {[...shown, ...shown].map((t, i) => (
              <span key={i} className="cc-ticker-item">
                {t}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* ToolbarStarcraft — the command-center toolbar variant               */
/* ------------------------------------------------------------------ */

const COOLDOWN_MS = 1500;

interface Ability {
  id: string;
  label: string;
  glyph: ReactNode;
  sound: SoundKind;
  run: () => void;
  aria: string;
}

export function ToolbarStarcraft() {
  const router = useRouter();
  const pathname = usePathname();
  const { open, minimized } = useAppletBus();
  const [soundOn, setSoundOn] = useSoundEnabled();
  const redAlert = useRedAlert();
  const reducedMotion = usePrefersReducedMotion();
  const feeds = useTickerFeeds();

  // Cooldown sweeps: id -> timestamp (ms) when the slot re-arms.
  const [cooldowns, setCooldowns] = useState<Record<string, number>>({});
  const [, forceTick] = useReducer((x: number) => x + 1, 0);

  const anyCooling = Object.values(cooldowns).some((end) => end > Date.now());
  useEffect(() => {
    if (!anyCooling) return;
    const timer = setInterval(forceTick, 120);
    return () => clearInterval(timer);
  }, [anyCooling]);

  // Urgent-nudge Red Alert watchdog (first check delayed — never on load).
  useEffect(() => startUrgentNudgeWatch(), []);

  function goHome() {
    closeAllApplets();
    router.push("/home");
  }

  const abilities: Ability[] = [
    {
      id: "home",
      label: "Home",
      glyph: <HomeGlyph />,
      sound: "click",
      run: goHome,
      aria: "Home — back to the open viewport",
    },
    {
      id: "today",
      label: "Today",
      glyph: <TodayGlyph />,
      sound: "open",
      run: () => openApplet("today"),
      aria: "Open Today",
    },
    {
      id: "crystal",
      label: "Crystal",
      glyph: <ChatGlyph />,
      sound: "open",
      run: () => openApplet("crystal"),
      aria: "Open Crystal chat",
    },
    {
      id: "progress",
      label: "Progress",
      glyph: <ProgressGlyph />,
      sound: "open",
      run: () => openApplet("progress"),
      aria: "Open Progress",
    },
    {
      id: "school",
      label: "School",
      glyph: <SchoolGlyph size={22} strokeWidth={1.5} />,
      sound: "open",
      run: () => openApplet("school"),
      aria: "Open School",
    },
    {
      id: "more",
      label: "More",
      glyph: <MoreGlyph />,
      sound: "open",
      run: () => openApplet("more"),
      aria: "Open More — all stations and settings",
    },
    {
      id: "nudges",
      label: "Nudges",
      glyph: <NudgeGlyph />,
      sound: "open",
      run: () => openApplet("nudges"),
      aria: "Open Nudges",
    },
    {
      id: "weather",
      label: "Weather",
      glyph: <WeatherGlyph />,
      sound: "open",
      run: () => openApplet("weather"),
      aria: "Open Weather",
    },
    {
      id: "crew",
      label: "Crew",
      glyph: <CrewGlyph />,
      sound: "open",
      run: () => openApplet("crew"),
      aria: "Open Crew",
    },
  ];

  function isActive(id: string): boolean {
    if (id === "home") return pathname === "/home" && !open;
    return open?.id === id;
  }

  function trigger(a: Ability) {
    const now = Date.now();
    if ((cooldowns[a.id] ?? 0) > now) return; // still cooling down
    a.run();
    playSound(a.sound);
    setCooldowns((prev) => ({ ...prev, [a.id]: now + COOLDOWN_MS }));
  }

  function toggleSound() {
    const next = !soundOn;
    setSoundOn(next);
    if (next) playSound("click"); // confirmation blip on enable
  }

  return (
    <nav
      aria-label="Command center"
      data-red-alert={redAlert}
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[80]"
    >
      <div className="cc-hull pointer-events-auto">
        {redAlert && (
          <div className="cc-alertstrip" role="alert">
            <span className="cc-alertstrip-text">RED ALERT · DEFCON 1</span>
          </div>
        )}
        <div className="cc-tickers">
          <Ticker
            tag="TACTICAL"
            label="Tactical feed"
            items={feeds.tactical}
            reducedMotion={reducedMotion}
          />
          <Ticker
            tag="COMMS"
            label="Comms feed"
            items={feeds.comms}
            reducedMotion={reducedMotion}
          />
        </div>

        <div className="cc-deck">
          <RadarWidget />

          {/* 3×3 ability grid with cooldown sweeps */}
          <div
            className="cc-grid"
            role="group"
            aria-label="Command abilities"
          >
            {abilities.map((a) => {
              const now = Date.now();
              const end = cooldowns[a.id] ?? 0;
              const remaining = Math.max(0, end - now);
              const cooling = remaining > 0;
              const pct = (remaining / COOLDOWN_MS) * 100;
              const pip = isActive(a.id)
                ? "engaged"
                : minimized.some((m) => m.id === a.id)
                  ? "attention"
                  : "off";
              return (
                <div key={a.id} className="cc-cell">
                  <span className="cc-pip" data-state={pip} aria-hidden="true" />
                  <button
                    type="button"
                    onClick={() => trigger(a)}
                    data-active={isActive(a.id)}
                    data-cooling={cooling}
                    aria-disabled={cooling}
                    aria-label={cooling ? `${a.aria} — recharging` : a.aria}
                    title={a.label}
                    className="cc-ability"
                  >
                    {a.glyph}
                    <span className="cc-ability-label">{a.label}</span>
                    {cooling && (
                      <span
                        className="cc-cooldown"
                        aria-hidden="true"
                        style={{
                          background: reducedMotion
                            ? "rgb(2 6 10 / 0.45)"
                            : `conic-gradient(from -90deg, rgb(2 6 10 / 0.78) ${pct}%, transparent ${Math.min(100, pct + 1)}%)`,
                        }}
                      />
                    )}
                  </button>
                </div>
              );
            })}
          </div>

          {/* Pilot seat — Team Mascot's component goes here. */}
          <div className="cc-pilot-seat">
            {/* Pilot seat — the fluffling mascot renders here via
                CrystalCommandButton (src/components/pilot/crystal-mascot.tsx).
                Team Toolbar owns the slot size and mount; artwork and behavior
                belong to Team Mascot. */}
            <CrystalCommandButton
              className="cc-pilot-orb"
              coreClassName="cc-pilot-core"
              active={open?.id === "crystal"}
              onOpen={() => {
                playSound("open");
                openApplet("crystal");
              }}
            />
            <span className="cc-pilot-tag" aria-hidden="true">
              CRYSTAL
            </span>
          </div>

          {/* Squad status + command controls */}
          <div className="cc-starboard">
            <SquadStatus />
            <div className="cc-controls">
              <button
                type="button"
                onClick={toggleSound}
                aria-pressed={soundOn}
                aria-label={soundOn ? "Mute sound effects" : "Enable sound effects"}
                title={soundOn ? "SOUND ON" : "SOUND OFF"}
                data-on={soundOn}
                className="cc-control"
              >
                <SpeakerGlyph />
                <span className="cc-control-label">
                  {soundOn ? "SOUND ON" : "SOUND OFF"}
                </span>
              </button>
              <button
                type="button"
                onClick={() => setRedAlert(!redAlert)}
                aria-pressed={redAlert}
                aria-label={redAlert ? "Stand down from Red Alert" : "Raise Red Alert"}
                title="RED ALERT"
                data-on={redAlert}
                className="cc-control cc-control--alert"
              >
                <AlertGlyph />
                <span className="cc-control-label">ALERT</span>
              </button>
            </div>
          </div>
        </div>
      </div>
      <style>{CC_CSS}</style>
    </nav>
  );
}

const CC_CSS = `
/* StarCraft command-center toolbar — Team Toolbar owns structure + layout.
   Colors/glass come from Team Theme's CSS variables (fallbacks = spec). */
.cc-hull {
  position: relative;
  width: 100%;
  background: var(--color-abyss, #0a0e1a);
  border-top: 1px solid rgb(255 255 255 / 0.07);
  padding: 6px 10px max(8px, env(safe-area-inset-bottom));
  box-shadow: 0 -14px 44px rgb(0 0 0 / 0.65);
}
/* Tactical + comms tickers */
.cc-tickers {
  display: flex; gap: 8px; margin: 0 auto 6px; max-width: 860px;
}
.cc-ticker {
  flex: 1 1 0; min-width: 0;
  display: flex; align-items: center; gap: 8px;
  padding: 3px 8px; border-radius: 6px;
  background: rgb(255 255 255 / 0.025);
  border: 1px solid rgb(255 255 255 / 0.05);
  overflow: hidden;
}
.cc-ticker-tag {
  flex-shrink: 0;
  font-size: 9px; font-weight: 700; letter-spacing: 0.14em;
  color: var(--color-neon-cyan, #22d3ee);
}
.cc-ticker-viewport { flex: 1 1 0; min-width: 0; overflow: hidden; }
.cc-ticker-track {
  display: inline-flex; width: max-content;
  animation: cc-marquee 36s linear infinite;
}
.cc-ticker-static { display: flex; gap: 24px; overflow: hidden; }
.cc-ticker-item {
  display: inline-block; white-space: nowrap;
  font-size: 10px; letter-spacing: 0.08em;
  color: rgb(167 188 199 / 0.85);
  padding-right: 28px;
}
@keyframes cc-marquee {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}
/* Command deck */
.cc-deck {
  display: flex; align-items: stretch; gap: 10px;
  margin: 0 auto; max-width: 860px;
}
/* Radar */
.cc-radar { flex-shrink: 0; align-self: center; }
.cc-radar-face {
  position: relative; width: 64px; height: 64px; border-radius: 9999px;
  background:
    radial-gradient(circle, rgb(34 211 238 / 0.05) 0%, transparent 60%),
    repeating-radial-gradient(circle at 50% 50%, transparent 0 12px, rgb(34 211 238 / 0.12) 12px 13px);
  border: 1px solid rgb(34 211 238 / 0.35);
  box-shadow: 0 0 14px rgb(34 211 238 / 0.15), inset 0 0 12px rgb(34 211 238 / 0.08);
  overflow: hidden;
}
.cc-radar-face::before, .cc-radar-face::after {
  content: ""; position: absolute; background: rgb(34 211 238 / 0.18);
}
.cc-radar-face::before { left: 50%; top: 0; bottom: 0; width: 1px; }
.cc-radar-face::after { top: 50%; left: 0; right: 0; height: 1px; }
.cc-radar-sweep {
  position: absolute; inset: 0; border-radius: 9999px;
  background: conic-gradient(from 0deg, rgb(34 211 238 / 0.5) 0deg, rgb(34 211 238 / 0.12) 60deg, transparent 90deg);
  animation: cc-radar-spin 4s linear infinite;
}
@keyframes cc-radar-spin { to { transform: rotate(360deg); } }
.cc-radar-blip {
  position: absolute; width: 5px; height: 5px; border-radius: 9999px;
  background: var(--color-neon-teal, #5eead4);
  box-shadow: 0 0 6px rgb(94 234 212 / 0.9);
  animation: cc-blip 2.4s ease-in-out infinite;
}
.cc-radar-blip--a { left: 62%; top: 28%; }
.cc-radar-blip--b { left: 30%; top: 62%; animation-delay: 0.8s; }
.cc-radar-blip--c { left: 70%; top: 68%; animation-delay: 1.6s; }
@keyframes cc-blip { 0%, 100% { opacity: 0.25; } 50% { opacity: 1; } }
/* 3×3 ability grid */
.cc-grid {
  flex: 1 1 0; min-width: 0;
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px;
}
.cc-cell {
  display: flex; flex-direction: column; align-items: center; min-width: 0;
}
.cc-pip {
  width: 6px; height: 6px; margin-bottom: 3px; flex-shrink: 0;
  border-radius: 9999px; background: transparent;
}
.cc-pip[data-state="engaged"] {
  background: var(--color-neon-teal, #5eead4);
  box-shadow: 0 0 8px rgb(94 234 212 / 0.9);
}
.cc-pip[data-state="attention"] {
  background: #fbbf24;
  box-shadow: 0 0 8px rgb(251 191 36 / 0.9);
}
.cc-ability {
  position: relative; overflow: hidden;
  width: 100%; min-width: 0; min-height: 52px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px;
  padding: 6px 2px 5px;
  border-radius: 8px;
  color: #93a8b3;
  background: linear-gradient(180deg, #0d1419 0%, #060a0d 100%);
  border: 1px solid rgb(255 255 255 / 0.09);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.10),
    inset 0 -4px 8px rgb(0 0 0 / 0.55),
    0 0 10px rgb(34 211 238 / 0.05);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  transition: transform 80ms ease-out, box-shadow 80ms ease-out, color 80ms ease-out, border-color 80ms ease-out;
}
.cc-ability:hover { color: #d9e8ee; }
.cc-ability:active {
  transform: translateY(1px);
  color: #fff;
  border-color: rgb(34 211 238 / 0.6);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.06),
    inset 0 -2px 5px rgb(0 0 0 / 0.6),
    0 0 18px rgb(34 211 238 / 0.5),
    0 0 44px rgb(34 211 238 / 0.20);
}
.cc-ability:active .cc-ability-label { color: var(--color-neon-cyan, #22d3ee); }
.cc-ability[data-active="true"] {
  color: #f2faf8;
  border-color: rgb(34 211 238 / 0.45);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.10),
    inset 0 -4px 8px rgb(0 0 0 / 0.55),
    0 0 16px rgb(34 211 238 / 0.30),
    0 0 42px rgb(34 211 238 / 0.12);
}
.cc-ability[data-active="true"]::before {
  content: ""; position: absolute; top: -1px; left: 10px; right: 10px; height: 3px;
  border-radius: 0 0 3px 3px; background: var(--color-neon-cyan, #22d3ee);
  box-shadow: 0 0 10px rgb(34 211 238 / 0.9), 0 0 24px rgb(34 211 238 / 0.5);
}
.cc-ability-label {
  font-size: 10px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase;
  color: #7e939e; line-height: 1; white-space: nowrap;
  transition: color 80ms ease-out;
}
.cc-ability[data-active="true"] .cc-ability-label { color: var(--color-neon-cyan, #22d3ee); }
.cc-ability[data-cooling="true"] { cursor: default; }
/* Cooldown sweep overlay — dark sector that wipes away as the slot re-arms */
.cc-cooldown { position: absolute; inset: 0; pointer-events: none; }
/* Pilot seat */
.cc-pilot-seat {
  flex-shrink: 0; align-self: center;
  display: flex; flex-direction: column; align-items: center; gap: 4px;
  position: relative; width: 84px;
}
.cc-pilot-seat::before {
  content: ""; position: absolute; top: -6px; width: 76px; height: 76px;
  border-radius: 9999px;
  background: radial-gradient(circle at 50% 42%, #050b0d 0%, #010304 58%, rgb(1 3 4 / 0) 100%);
  border: 1px solid rgb(255 255 255 / 0.06);
  box-shadow: inset 0 8px 22px rgb(0 0 0 / 0.95), 0 0 0 4px rgb(0 0 0 / 0.35);
}
/* Slot mount only — size and position. The mascot paints itself (Team Mascot). */
.cc-pilot-orb {
  position: relative; z-index: 1;
  width: 58px; height: 58px; margin-top: 3px;
  border: none; cursor: pointer; padding: 0;
  background: transparent;
  transition: transform 200ms ease;
}
.cc-pilot-orb:hover { transform: scale(1.06); }
.cc-pilot-orb:active { transform: scale(0.96); }
.cc-pilot-tag {
  font-size: 9px; font-weight: 700; letter-spacing: 0.18em;
  color: var(--color-neon-teal, #5eead4);
}
/* Starboard: squad status + command controls */
.cc-starboard {
  flex-shrink: 0; align-self: stretch;
  display: flex; flex-direction: column; justify-content: space-between; gap: 6px;
  min-width: 64px;
}
.cc-squad { display: flex; flex-direction: column; gap: 4px; }
.cc-squad-tag {
  font-size: 9px; font-weight: 700; letter-spacing: 0.14em;
  color: var(--color-neon-cyan, #22d3ee);
}
.cc-squad-dots { display: flex; flex-wrap: wrap; gap: 5px; }
.cc-squad-dot {
  width: 22px; height: 22px; border-radius: 9999px;
  display: inline-flex; align-items: center; justify-content: center;
  font-size: 10px; font-weight: 700; color: #04121a;
  background: var(--color-neon-teal, #5eead4);
  box-shadow: 0 0 6px rgb(94 234 212 / 0.5);
}
.cc-squad-dot[data-state="attention"] {
  background: #fbbf24;
  box-shadow: 0 0 6px rgb(251 191 36 / 0.5);
}
.cc-squad-dot[data-state="idle"] {
  background: #5b6b75;
  box-shadow: none;
  color: #cfd9de;
}
.cc-squad-dot--loading { background: #2b343b; animation: cc-blip 1.6s ease-in-out infinite; }
.cc-squad-empty { display: inline-flex; align-items: center; gap: 5px; }
.cc-squad-empty-label { font-size: 9px; letter-spacing: 0.1em; color: #5b6b75; }
.cc-controls { display: flex; flex-direction: column; gap: 4px; }
.cc-control {
  display: flex; align-items: center; gap: 6px;
  padding: 5px 7px; border-radius: 7px;
  color: #7e939e;
  background: rgb(255 255 255 / 0.03);
  border: 1px solid rgb(255 255 255 / 0.08);
  cursor: pointer; -webkit-tap-highlight-color: transparent; touch-action: manipulation;
  transition: color 120ms ease-out, border-color 120ms ease-out;
}
.cc-control svg { width: 16px; height: 16px; flex-shrink: 0; }
.cc-control-label { font-size: 9px; font-weight: 700; letter-spacing: 0.1em; }
.cc-control[data-on="true"] {
  color: var(--color-neon-teal, #5eead4);
  border-color: rgb(94 234 212 / 0.45);
}
.cc-control--alert[data-on="true"] {
  color: #f87171;
  border-color: rgb(248 113 113 / 0.55);
  box-shadow: 0 0 12px rgb(239 68 68 / 0.35);
}
/* Red Alert strip */
.cc-alertstrip {
  margin: -6px -10px 6px; padding: 4px 10px;
  background: linear-gradient(90deg, #7f1d1d, #dc2626 50%, #7f1d1d);
  text-align: center;
  animation: cc-alertstrip-pulse 1.2s ease-in-out infinite;
}
.cc-alertstrip-text {
  font-size: 10px; font-weight: 800; letter-spacing: 0.28em; color: #fff;
  text-shadow: 0 0 8px rgb(255 255 255 / 0.6);
}
@keyframes cc-alertstrip-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.72; } }
/* Red Alert theming: every cyan accent shifts to red */
.cc-root[data-red-alert="true"] .cc-hull {
  border-top-color: rgb(239 68 68 / 0.5);
  animation: cc-hull-alert 1.6s ease-in-out infinite;
}
@keyframes cc-hull-alert {
  0%, 100% { box-shadow: 0 -14px 44px rgb(0 0 0 / 0.65), inset 0 0 0 1px rgb(239 68 68 / 0.2); }
  50% { box-shadow: 0 -14px 60px rgb(239 68 68 / 0.28), inset 0 0 0 1px rgb(239 68 68 / 0.55); }
}
.cc-root[data-red-alert="true"] .cc-ticker-tag,
.cc-root[data-red-alert="true"] .cc-squad-tag {
  color: #f87171;
}
.cc-root[data-red-alert="true"] .cc-radar-face {
  border-color: rgb(248 113 113 / 0.45);
  box-shadow: 0 0 14px rgb(239 68 68 / 0.25), inset 0 0 12px rgb(239 68 68 / 0.12);
}
.cc-root[data-red-alert="true"] .cc-radar-sweep {
  background: conic-gradient(from 0deg, rgb(248 113 113 / 0.55) 0deg, rgb(248 113 113 / 0.12) 60deg, transparent 90deg);
}
.cc-root[data-red-alert="true"] .cc-ability[data-active="true"] {
  border-color: rgb(248 113 113 / 0.5);
}
.cc-root[data-red-alert="true"] .cc-ability[data-active="true"]::before {
  background: #f87171;
  box-shadow: 0 0 10px rgb(248 113 113 / 0.9), 0 0 24px rgb(248 113 113 / 0.5);
}
.cc-root[data-red-alert="true"] .cc-ability[data-active="true"] .cc-ability-label {
  color: #f87171;
}
/* Small screens */
@media (max-width: 640px) {
  .cc-tickers { display: none; }
}
@media (max-width: 480px) {
  .cc-deck { gap: 7px; }
  .cc-radar-face { width: 44px; height: 44px; }
  .cc-ability { min-height: 44px; }
  .cc-ability-label { display: none; }
  .cc-pilot-seat { width: 62px; }
  .cc-pilot-seat::before { width: 58px; height: 58px; top: -4px; }
  .cc-pilot-orb { width: 44px; height: 44px; }
  .cc-pilot-tag { display: none; }
  .cc-control-label { display: none; }
  .cc-starboard { min-width: 48px; }
}
/* Reduced motion: information changes instantly, loops go static */
@media (prefers-reduced-motion: reduce) {
  .cc-ability, .cc-ability-label, .cc-control, .cc-pilot-orb { transition: none; }
  .cc-radar-sweep, .cc-radar-blip, .cc-squad-dot--loading,
  .cc-ticker-track, .cc-alertstrip, .cc-hull { animation: none !important; }
  .cc-root[data-red-alert="true"] .cc-hull {
    box-shadow: 0 -14px 44px rgb(0 0 0 / 0.65), inset 0 0 0 1px rgb(239 68 68 / 0.5);
  }
}
`;
