"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { closeAllApplets, openApplet, useAppletBus } from "@/lib/applet-bus";
import { CrystalCommandButton } from "@/components/pilot/crystal-mascot";
import { createClient } from "@/lib/supabase/client";
import { SchoolGlyph } from "./school-glyph";

/* Glyphs — same 24px line icons as the other variants. Icon + word label. */
function HomeGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5.5 10.5V20h13v-9.5" />
    </svg>
  );
}

function TodayGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

function ProgressGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <path d="M4 20V10" />
      <path d="M10 20V4" />
      <path d="M16 20v-8" />
      <path d="M2.5 20h19" />
    </svg>
  );
}

function MicGlyph() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}

/** Live ship clock — date readout. Updates every 30s (date only needs daily, but cheap). */
function useShipDate() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function fmtDate(d: Date) {
  const days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  return `${days[d.getDay()]} ${months[d.getMonth()]} ${String(d.getDate()).padStart(2, "0")}`;
}

/** Same pilot-name logic as the home page: first name → email handle → "Pilot". */
function pilotNameFor(email: string | undefined, fullName: string | undefined): string {
  if (fullName && fullName.trim()) return fullName.trim().split(" ")[0];
  if (email) {
    const handle = email.split("@")[0].replace(/[._-]+/g, " ").trim();
    if (handle) return handle.charAt(0).toUpperCase() + handle.slice(1);
  }
  return "Pilot";
}

/** Pilot display name from auth, uppercase. Falls back to "PILOT". */
function usePilotName() {
  const [name, setName] = useState("PILOT");
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const supabase = createClient();
        const { data } = await supabase.auth.getUser();
        if (!alive) return;
        const u = data.user;
        const full =
          typeof u?.user_metadata?.full_name === "string"
            ? u.user_metadata.full_name
            : undefined;
        setName(pilotNameFor(u?.email, full).toUpperCase());
      } catch {
        /* keep the PILOT fallback */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  return name;
}

/* ------------------------------------------------------------------ */
/* Cockpit gadgets — decorative only. Slow, soothing motion per the     */
/* standing rule: calm, never jarring. No red anywhere.                */
/* ------------------------------------------------------------------ */

/** Radar detector: concentric rings, slow 14s sweep, two soft blips. */
function RadarDetector() {
  return (
    <div className="pano2-radar" aria-hidden="true">
      <svg viewBox="0 0 40 40" className="pano2-radar-svg">
        <circle cx="20" cy="20" r="18" fill="rgb(4 10 14 / 0.85)" stroke="rgb(34 211 238 / 0.35)" strokeWidth="1" />
        <circle cx="20" cy="20" r="12" fill="none" stroke="rgb(34 211 238 / 0.22)" strokeWidth="0.75" />
        <circle cx="20" cy="20" r="6" fill="none" stroke="rgb(34 211 238 / 0.22)" strokeWidth="0.75" />
        <path d="M20 2v36M2 20h36" stroke="rgb(34 211 238 / 0.12)" strokeWidth="0.5" />
        {/* sweep */}
        <g className="pano2-radar-sweep">
          <path d="M20 20 L20 3 A17 17 0 0 1 32 8 Z" fill="rgb(34 211 238 / 0.28)" />
          <line x1="20" y1="20" x2="20" y2="3" stroke="#22d3ee" strokeWidth="1" strokeLinecap="round" />
        </g>
        {/* blips */}
        <circle cx="26" cy="14" r="1.6" fill="#5eead4" className="pano2-blip" style={{ animationDelay: "0s" }} />
        <circle cx="13" cy="26" r="1.3" fill="#a5b4fc" className="pano2-blip" style={{ animationDelay: "2.4s" }} />
        <circle cx="20" cy="20" r="1.4" fill="#22d3ee" />
      </svg>
    </div>
  );
}

/** Neon dummy switches: three toggles with glowing tips. Visual only. */
function NeonSwitches() {
  return (
    <div className="pano2-switches" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span key={i} className="pano2-switch" data-on={i !== 1}>
          <span className="pano2-switch-track">
            <span className="pano2-switch-knob" />
          </span>
        </span>
      ))}
    </div>
  );
}

/** Speaker grille: vertical slats. Decorative. */
function SpeakerGrille() {
  return (
    <div className="pano2-speaker" aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} className="pano2-speaker-slat" />
      ))}
    </div>
  );
}

/** Throttle: vertical track with a handle set ~70% up. Decorative. */
function Throttle() {
  return (
    <div className="pano2-throttle" aria-hidden="true">
      <span className="pano2-throttle-track">
        <span className="pano2-throttle-fill" />
        <span className="pano2-throttle-handle" />
      </span>
      <span className="pano2-throttle-label">THR</span>
    </div>
  );
}

/** Radio transmission box with mic: TX indicator pulses slowly. */
function RadioBox() {
  return (
    <div className="pano2-radio" aria-hidden="true">
      <span className="pano2-radio-tx" />
      <MicGlyph />
      <span className="pano2-radio-label">COMMS</span>
    </div>
  );
}

/**
 * Spaceship yoke: ram's-horn yoke drawn in SVG with the Crystal orb
 * seated in the center hub. Two dummy side buttons per handle.
 * The orb button (44px touch target) opens the Crystal applet.
 */
function Yoke({ onOrb, orbActive, orbWaiting }: { onOrb: () => void; orbActive: boolean; orbWaiting: boolean }) {
  return (
    <div className="pano2-yoke">
      <svg viewBox="0 0 120 64" className="pano2-yoke-svg" aria-hidden="true">
        {/* yoke arms — ram's horn curves from the hub */}
        <path
          d="M60 52 C 44 52, 34 44, 28 28 C 25 20, 22 14, 16 12"
          fill="none" stroke="#1b2b35" strokeWidth="9" strokeLinecap="round"
        />
        <path
          d="M60 52 C 76 52, 86 44, 92 28 C 95 20, 98 14, 104 12"
          fill="none" stroke="#1b2b35" strokeWidth="9" strokeLinecap="round"
        />
        {/* arm highlight */}
        <path
          d="M60 50 C 46 50, 37 43, 31 29"
          fill="none" stroke="rgb(94 234 212 / 0.25)" strokeWidth="2" strokeLinecap="round"
        />
        <path
          d="M60 50 C 74 50, 83 43, 89 29"
          fill="none" stroke="rgb(94 234 212 / 0.25)" strokeWidth="2" strokeLinecap="round"
        />
        {/* grips */}
        <rect x="8" y="6" width="16" height="14" rx="7" fill="#0d161c" stroke="rgb(255 255 255 / 0.1)" strokeWidth="1" transform="rotate(-18 16 13)" />
        <rect x="96" y="6" width="16" height="14" rx="7" fill="#0d161c" stroke="rgb(255 255 255 / 0.1)" strokeWidth="1" transform="rotate(18 104 13)" />
        {/* side buttons — dummy, two per handle */}
        <circle cx="15" cy="10" r="2.6" fill="#22d3ee" opacity="0.85" className="pano2-yoke-btn" />
        <circle cx="15" cy="17" r="2.2" fill="#5eead4" opacity="0.7" className="pano2-yoke-btn" style={{ animationDelay: "1.2s" }} />
        <circle cx="105" cy="10" r="2.6" fill="#22d3ee" opacity="0.85" className="pano2-yoke-btn" style={{ animationDelay: "0.6s" }} />
        <circle cx="105" cy="17" r="2.2" fill="#a5b4fc" opacity="0.7" className="pano2-yoke-btn" style={{ animationDelay: "1.8s" }} />
        {/* hub ring behind the orb */}
        <circle cx="60" cy="46" r="24" fill="#05090c" stroke="rgb(255 255 255 / 0.08)" strokeWidth="1.5" />
        <circle cx="60" cy="46" r="24" fill="none" stroke="rgb(34 211 238 / 0.3)" strokeWidth="1" strokeDasharray="4 5" className="pano2-hub-ring" />
      </svg>
      {/* Crystal command — orb or robot (flag), seated in the hub */}
      <CrystalCommandButton
        className="pano2-orb"
        coreClassName="pano2-orb-core"
        active={orbActive}
        waiting={orbWaiting}
        onOpen={onOrb}
      />
    </div>
  );
}

/**
 * ToolbarPanoramic — "Panoramic Cockpit" toolbar variant (redesigned).
 *
 * A compact arched console (2/3 the height of the original): stations ride
 * a wraparound arc peaking at the central spaceship yoke, which seats the
 * Crystal orb in its hub. Flanking gadgets — radar detector, throttle,
 * speaker grilles, neon dummy switches, radio/mic box — are decorative.
 * Bottom strip carries only the pilot name and date. Neon light traces
 * the arched top edge.
 *
 * Behavior (nav targets, applet-bus calls, orb id) is identical to the
 * other variants. Only the chrome changes.
 */
export function ToolbarPanoramic() {
  const router = useRouter();
  const pathname = usePathname();
  const { open, minimized } = useAppletBus();
  const today = useShipDate();
  const pilotName = usePilotName();
  // School renders iff the pilot has ≥1 linked child (D4) — zero parenting
  // pixels for childless pilots. More is dead: the 6 home-station buttons
  // are the module hub now.

  function goHome() {
    closeAllApplets();
    router.push("/home");
  }

  const stations = [
    {
      id: "home",
      label: "Home",
      glyph: <HomeGlyph />,
      run: goHome,
      aria: "Home — back to the open viewport",
      active: pathname === "/home" && !open,
      arc: "outer" as const,
    },
    {
      id: "today",
      label: "Today",
      glyph: <TodayGlyph />,
      run: () => openApplet("today"),
      aria: "Open Today",
      active: open?.id === "today",
      arc: "inner" as const,
    },
    {
      id: "progress",
      label: "Progress",
      glyph: <ProgressGlyph />,
      run: () => openApplet("progress"),
      aria: "Open Progress",
      active: open?.id === "progress",
      arc: "inner" as const,
    },
    {
      id: "school",
      label: "School",
      glyph: <SchoolGlyph size={22} strokeWidth={1.5} />,
      run: () => openApplet("school"),
      aria: "Open School",
      active: open?.id === "school",
      arc: "outer" as const,
    },
  ];

  const crystalActive = open?.id === "crystal";
  const crystalWaiting = minimized.some((m) => m.id === "crystal");

  function pipState(id: string): "engaged" | "attention" | "off" {
    const s = stations.find((k) => k.id === id);
    if (s?.active) return "engaged";
    if (minimized.some((m) => m.id === id)) return "attention";
    return "off";
  }

  return (
    <nav
      aria-label="Ship stations"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[80]"
    >
      <div className="pano2-console pointer-events-auto">
        {/* Neon light tracing the arched top edge */}
        <div className="pano2-neon" aria-hidden="true" />

        {/* Main deck: arc of stations around the central yoke */}
        <div className="pano2-deck">
          <SpeakerGrille />
          <RadarDetector />

          {stations.slice(0, 2).map((s) => (
            <span className="pano2-cell" data-arc={s.arc} key={s.id}>
              <span className="pano2-pip" data-state={pipState(s.id)} aria-hidden="true" />
              <button
                type="button"
                onClick={s.run}
                data-active={s.active}
                aria-label={s.aria}
                title={s.label}
                className="pano2-key"
              >
                {s.glyph}
                <span className="pano2-key-label">{s.label}</span>
              </button>
            </span>
          ))}

          <Yoke
            onOrb={() => openApplet("crystal")}
            orbActive={crystalActive}
            orbWaiting={crystalWaiting}
          />

          {stations.slice(2).map((s) => (
            <span className="pano2-cell" data-arc={s.arc} key={s.id}>
              <span className="pano2-pip" data-state={pipState(s.id)} aria-hidden="true" />
              <button
                type="button"
                onClick={s.run}
                data-active={s.active}
                aria-label={s.aria}
                title={s.label}
                className="pano2-key"
              >
                {s.glyph}
                <span className="pano2-key-label">{s.label}</span>
              </button>
            </span>
          ))}

          <Throttle />
          <SpeakerGrille />
        </div>

        {/* Bottom strip: switches + radio on the left, pilot + date on the right */}
        <div className="pano2-strip">
          <NeonSwitches />
          <RadioBox />
          <span className="pano2-spacer" aria-hidden="true" />
          <span className="pano2-pilot">
            Pilot&nbsp;//&nbsp;<span className="pano2-pilot-name">{pilotName}</span>
          </span>
          <span className="pano2-date">{fmtDate(today)}</span>
        </div>
      </div>
      <style>{PANORAMIC_CSS}</style>
    </nav>
  );
}

const PANORAMIC_CSS = `
.pano2-console {
  position: relative;
  width: 100%;
  /* Arched console: domed top edge */
  border-radius: 34px 34px 0 0;
  background:
    linear-gradient(180deg, rgb(10 18 24 / 0.97) 0%, rgb(4 7 10 / 0.98) 40%, #020304 100%);
  border-top: 1px solid rgb(255 255 255 / 0.07);
  padding: 10px 10px max(8px, env(safe-area-inset-bottom));
  box-shadow: 0 -8px 32px rgb(0 0 0 / 0.55);
}
/* Neon light tracing the arched top — slow glow drift (kept per Meheldi) */
.pano2-neon {
  position: absolute; top: -1px; left: 34px; right: 34px; height: 2px;
  border-radius: 2px;
  background: linear-gradient(90deg,
    rgb(34 211 238 / 0) 0%,
    rgb(34 211 238 / 0.8) 20%,
    rgb(167 139 250 / 0.85) 50%,
    rgb(34 211 238 / 0.8) 80%,
    rgb(34 211 238 / 0) 100%);
  box-shadow: 0 0 18px rgb(34 211 238 / 0.5), 0 1px 10px rgb(34 211 238 / 0.35);
  pointer-events: none;
  animation: pano2-neon-drift 8s ease-in-out infinite;
}
@keyframes pano2-neon-drift {
  0%, 100% { opacity: 0.7; }
  50% { opacity: 1; }
}
/* Main deck: horizontal instrument row */
.pano2-deck {
  display: flex; align-items: flex-end; justify-content: center;
  gap: 5px; max-width: 760px; margin: 0 auto;
}
/* Arc: outer stations sit lower, inner stations higher, yoke at the apex */
.pano2-cell { display: flex; flex-direction: column; align-items: center; flex: 0 1 56px; min-width: 48px; }
.pano2-cell[data-arc="outer"] { transform: translateY(5px); }
.pano2-cell[data-arc="inner"] { transform: translateY(0px); }
/* Status pip above each key */
.pano2-pip {
  width: 5px; height: 5px; margin-bottom: 3px; flex-shrink: 0;
  border-radius: 9999px; background: transparent;
}
.pano2-pip[data-state="engaged"] {
  background: #5eead4;
  box-shadow: 0 0 8px rgb(94 234 212 / 0.9);
  animation: pano2-pip-breathe 4s ease-in-out infinite;
}
.pano2-pip[data-state="attention"] {
  background: #fbbf24;
  box-shadow: 0 0 8px rgb(251 191 36 / 0.9);
  animation: pano2-pip-breathe 3s ease-in-out infinite;
}
@keyframes pano2-pip-breathe {
  0%, 100% { opacity: 0.7; }
  50% { opacity: 1; }
}
/* Station key — compact chamfered switch, 44px+ touch target */
.pano2-key {
  width: 100%; min-width: 48px; min-height: 52px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px;
  padding: 6px 2px 5px;
  color: #8fa6b1;
  background: linear-gradient(180deg, #0b1218 0%, #05090c 100%);
  border: 1px solid rgb(255 255 255 / 0.08);
  clip-path: polygon(7px 0, 100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%, 0 7px);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.09), inset 0 -4px 8px rgb(0 0 0 / 0.6);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  transition: color 90ms ease-out, background 90ms ease-out;
}
.pano2-key:hover { color: #d9e8ee; }
.pano2-key:active { color: #ffffff; }
.pano2-key-label {
  font-size: 9px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase;
  color: #7e939e; line-height: 1; white-space: nowrap;
}
.pano2-key[data-active="true"] { color: #f2faf8; }
.pano2-key[data-active="true"]::before {
  content: ""; position: absolute; top: 0; left: 10px; right: 10px; height: 2px;
  background: #22d3ee;
  box-shadow: 0 0 10px rgb(34 211 238 / 0.9), 0 0 22px rgb(34 211 238 / 0.4);
}
.pano2-key[data-active="true"] .pano2-key-label { color: #5eead4; }
/* Yoke: the central command element, raised at the arc apex */
.pano2-yoke {
  position: relative; flex: 0 0 104px;
  height: 64px; transform: translateY(-2px);
  display: flex; align-items: flex-end; justify-content: center;
}
.pano2-yoke-svg { position: absolute; bottom: 6px; left: 50%; transform: translateX(-50%); width: 104px; height: 56px; }
.pano2-hub-ring { transform-origin: 60px 46px; animation: pano2-hub-spin 26s linear infinite; }
@keyframes pano2-hub-spin { to { transform: rotate(360deg); } }
.pano2-yoke-btn { animation: pano2-yoke-glow 5s ease-in-out infinite; }
@keyframes pano2-yoke-glow {
  0%, 100% { opacity: 0.55; }
  50% { opacity: 0.95; }
}
/* Crystal orb seated in the yoke hub — 44px touch target */
.pano2-orb {
  position: relative; z-index: 1; width: 44px; height: 44px; margin-bottom: 2px;
  border-radius: 9999px; border: none; cursor: pointer; padding: 0;
  background:
    radial-gradient(circle at 34% 30%, rgb(255 255 255 / 0.9) 0%, rgb(255 255 255 / 0) 34%),
    radial-gradient(circle at 50% 55%, #dcfff5 0%, #5eead4 38%, #0e7d6c 72%, #04211c 100%);
  box-shadow:
    0 0 18px rgb(94 234 212 / 0.6),
    0 0 44px rgb(94 234 212 / 0.28),
    0 0 90px rgb(94 234 212 / 0.12),
    inset 0 -5px 12px rgb(0 0 0 / 0.35);
  animation: pano2-orb-breathe 5.5s ease-in-out infinite;
  transition: transform 200ms ease;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
}
.pano2-orb:hover { transform: scale(1.06); }
.pano2-orb:active { transform: scale(0.95); }
.pano2-orb[data-active="true"] {
  box-shadow:
    0 0 24px rgb(94 234 212 / 0.85),
    0 0 56px rgb(94 234 212 / 0.4),
    0 0 110px rgb(94 234 212 / 0.18),
    inset 0 -5px 12px rgb(0 0 0 / 0.35);
}
.pano2-orb-core {
  position: absolute; inset: 0; border-radius: 9999px;
  background: radial-gradient(circle at 50% 42%, rgb(255 255 255 / 0.5) 0%, rgb(255 255 255 / 0) 46%);
  animation: pano2-orb-shimmer 7s ease-in-out infinite;
}
@keyframes pano2-orb-breathe {
  0%, 100% { box-shadow: 0 0 18px rgb(94 234 212 / 0.6), 0 0 44px rgb(94 234 212 / 0.28), 0 0 90px rgb(94 234 212 / 0.12), inset 0 -5px 12px rgb(0 0 0 / 0.35); }
  50% { box-shadow: 0 0 24px rgb(94 234 212 / 0.75), 0 0 56px rgb(94 234 212 / 0.36), 0 0 110px rgb(94 234 212 / 0.16), inset 0 -5px 12px rgb(0 0 0 / 0.35); }
}
@keyframes pano2-orb-shimmer {
  0%, 100% { opacity: 0.7; }
  50% { opacity: 1; }
}
/* Radar detector */
.pano2-radar { flex: 0 0 34px; width: 34px; height: 34px; margin-bottom: 8px; }
.pano2-radar-svg { width: 100%; height: 100%; filter: drop-shadow(0 0 6px rgb(34 211 238 / 0.35)); }
.pano2-radar-sweep { transform-origin: 20px 20px; animation: pano2-sweep 14s linear infinite; }
@keyframes pano2-sweep { to { transform: rotate(360deg); } }
.pano2-blip { animation: pano2-blip-pulse 4.8s ease-in-out infinite; }
@keyframes pano2-blip-pulse {
  0%, 100% { opacity: 0.35; }
  50% { opacity: 1; }
}
/* Throttle */
.pano2-throttle { flex: 0 0 22px; display: flex; flex-direction: column; align-items: center; gap: 2px; margin-bottom: 4px; }
.pano2-throttle-track {
  position: relative; width: 8px; height: 40px; border-radius: 4px;
  background: #05090c; border: 1px solid rgb(255 255 255 / 0.08);
  box-shadow: inset 0 2px 6px rgb(0 0 0 / 0.8);
}
.pano2-throttle-fill {
  position: absolute; bottom: 2px; left: 2px; right: 2px; height: 65%;
  border-radius: 3px;
  background: linear-gradient(180deg, #22d3ee, rgb(34 211 238 / 0.35));
  box-shadow: 0 0 8px rgb(34 211 238 / 0.5);
}
.pano2-throttle-handle {
  position: absolute; left: -3px; right: -3px; top: 22%;
  height: 7px; border-radius: 3px;
  background: linear-gradient(180deg, #2b3d47, #0d161c);
  border: 1px solid rgb(94 234 212 / 0.5);
  box-shadow: 0 0 6px rgb(94 234 212 / 0.4);
}
.pano2-throttle-label { font-size: 7px; font-weight: 700; letter-spacing: 0.14em; color: rgb(143 166 177 / 0.6); }
/* Speaker grilles */
.pano2-speaker { flex: 0 0 12px; display: flex; flex-direction: column; gap: 3px; margin-bottom: 10px; padding: 4px 0; }
.pano2-speaker-slat { width: 12px; height: 2px; border-radius: 1px; background: rgb(143 166 177 / 0.35); box-shadow: inset 0 1px 2px rgb(0 0 0 / 0.7); }
/* Bottom strip: switches + radio left, pilot + date right */
.pano2-strip {
  display: flex; align-items: center; gap: 10px;
  max-width: 760px; margin: 6px auto 0; padding: 0 4px;
}
.pano2-spacer { flex: 1 1 auto; }
/* Neon dummy switches */
.pano2-switches { display: flex; gap: 7px; }
.pano2-switch-track {
  display: block; width: 14px; height: 22px; border-radius: 7px;
  background: #05090c; border: 1px solid rgb(255 255 255 / 0.09);
  box-shadow: inset 0 2px 5px rgb(0 0 0 / 0.8);
  position: relative;
}
.pano2-switch-knob {
  position: absolute; left: 2px; right: 2px; height: 9px; border-radius: 5px;
  background: linear-gradient(180deg, #3b4d57, #141e24);
  border: 1px solid rgb(255 255 255 / 0.12);
  transition: none;
}
.pano2-switch[data-on="true"] .pano2-switch-knob {
  top: 2px;
  box-shadow: 0 0 8px rgb(94 234 212 / 0.8), 0 0 3px rgb(94 234 212 / 1);
  border-color: rgb(94 234 212 / 0.7);
  animation: pano2-switch-glow 6s ease-in-out infinite;
}
.pano2-switch[data-on="false"] .pano2-switch-knob { bottom: 2px; opacity: 0.6; }
@keyframes pano2-switch-glow {
  0%, 100% { box-shadow: 0 0 8px rgb(94 234 212 / 0.8), 0 0 3px rgb(94 234 212 / 1); }
  50% { box-shadow: 0 0 12px rgb(94 234 212 / 1), 0 0 5px rgb(94 234 212 / 1); }
}
/* Radio box with mic */
.pano2-radio {
  display: flex; align-items: center; gap: 5px;
  padding: 4px 8px; border-radius: 6px;
  background: #05090c; border: 1px solid rgb(255 255 255 / 0.09);
  box-shadow: inset 0 2px 5px rgb(0 0 0 / 0.7);
  color: #8fa6b1;
}
.pano2-radio-tx {
  width: 6px; height: 6px; border-radius: 9999px; background: #5eead4;
  box-shadow: 0 0 7px rgb(94 234 212 / 0.9);
  animation: pano2-tx-pulse 4s ease-in-out infinite;
}
@keyframes pano2-tx-pulse {
  0%, 100% { opacity: 0.5; }
  50% { opacity: 1; }
}
.pano2-radio-label { font-size: 8px; font-weight: 700; letter-spacing: 0.16em; }
/* Pilot + date — the only labels */
.pano2-pilot, .pano2-date {
  font-size: 9px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase;
  color: rgb(143 166 177 / 0.6); white-space: nowrap;
}
.pano2-pilot-name, .pano2-date { color: #dbe9ef; }
/* Desktop: roomier */
@media (min-width: 640px) {
  .pano2-console { border-radius: 44px 44px 0 0; padding: 12px 20px max(10px, env(safe-area-inset-bottom)); }
  .pano2-neon { left: 60px; right: 60px; }
  .pano2-deck { gap: 10px; }
  .pano2-cell { flex-basis: 64px; }
  .pano2-yoke { flex-basis: 120px; }
  .pano2-radar { flex-basis: 40px; width: 40px; height: 40px; }
}
/* Small phones: compress — hide radar + throttle, keep essentials */
@media (max-width: 380px) {
  .pano2-radar, .pano2-throttle { display: none; }
  .pano2-deck { gap: 4px; }
  .pano2-cell { min-width: 44px; }
  .pano2-key-label { font-size: 8px; }
  .pano2-strip { gap: 7px; }
  .pano2-pilot, .pano2-date { font-size: 8px; letter-spacing: 0.12em; }
}
@media (prefers-reduced-motion: reduce) {
  .pano2-neon, .pano2-pip, .pano2-orb, .pano2-orb-core,
  .pano2-radar-sweep, .pano2-blip, .pano2-hub-ring, .pano2-yoke-btn,
  .pano2-switch-knob, .pano2-radio-tx { animation: none; }
  .pano2-key, .pano2-orb { transition: none; }
}
`;
