"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { closeAllApplets, openApplet, useAppletBus } from "@/lib/applet-bus";
import { createClient } from "@/lib/supabase/client";

/* Glyphs — same 24px line icons as the other variants. Icon + word label. */
function HomeGlyph() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5.5 10.5V20h13v-9.5" />
    </svg>
  );
}

function TodayGlyph() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

function ProgressGlyph() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
      <path d="M4 20V10" />
      <path d="M10 20V4" />
      <path d="M16 20v-8" />
      <path d="M2.5 20h19" />
    </svg>
  );
}

function MoreGlyph() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="5" cy="12" r="1.8" />
      <circle cx="12" cy="12" r="1.8" />
      <circle cx="19" cy="12" r="1.8" />
    </svg>
  );
}

/** Live ship clock — real time, updates every second. */
function useShipClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function fmtTime(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
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

/** Pilot display name from auth, uppercase for the info bar. Falls back to "PILOT". */
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
/* Ambient cockpit gadgets — decorative only, no real data. Slow,      */
/* soothing motion per the standing rule: calm, never jarring.         */
/* ------------------------------------------------------------------ */

/** Signal bars: four bars with a staggered soft pulse. */
function SignalBars() {
  return (
    <span className="pano-sigbars" aria-hidden="true">
      {[0, 1, 2, 3].map((i) => (
        <span key={i} className="pano-sigbar" style={{ animationDelay: `${i * 0.7}s` }} />
      ))}
    </span>
  );
}

/** Sys bars: three thin vertical diagnostic bars that drift gently. */
function SysBars() {
  return (
    <span className="pano-sysbars" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <span key={i} className="pano-sysbar" style={{ animationDelay: `${i * 1.1}s` }} />
      ))}
    </span>
  );
}

/** Power ring: small SVG ring with a slowly rotating arc. */
function PowerRing() {
  return (
    <svg className="pano-power" viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="8" fill="none" stroke="rgb(34 211 238 / 0.18)" strokeWidth="2" />
      <circle
        cx="10"
        cy="10"
        r="8"
        fill="none"
        stroke="#22d3ee"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray="14 38"
        className="pano-power-arc"
      />
    </svg>
  );
}

/** Waveform: tiny sparkline that drifts horizontally, very slow. */
function Waveform() {
  return (
    <svg className="pano-wave" viewBox="0 0 60 16" preserveAspectRatio="none" aria-hidden="true">
      <path
        d="M0 8 L5 8 L8 3 L12 13 L16 6 L20 10 L24 8 L30 8 L33 4 L37 12 L41 7 L45 9 L50 8 L60 8"
        fill="none"
        stroke="rgb(94 234 212 / 0.7)"
        strokeWidth="1.2"
        className="pano-wave-path"
      />
    </svg>
  );
}

const TICKER_ITEMS = [
  "SYS NOMINAL",
  "ORBIT STABLE",
  "CRYSTAL SYNC // OK",
  "PWR DIST // BALANCED",
  "COMMS // CLEAR",
  "NAV // ON COURSE",
];

/** Comm-log ticker: a very slow ambient marquee of cockpit status flavor. */
function CommTicker() {
  const items = [...TICKER_ITEMS, ...TICKER_ITEMS];
  return (
    <span className="pano-ticker" aria-hidden="true">
      <span className="pano-ticker-track">
        {items.map((t, i) => (
          <span key={i} className="pano-ticker-item">
            {"// "}
            {t}
          </span>
        ))}
      </span>
    </span>
  );
}

/**
 * ToolbarPanoramic — "Panoramic Cockpit" toolbar variant.
 *
 * A full-bleed bottom dashboard: trapezoidal console panel (wider at the
 * base, chamfered top corners) so the video vista reads as a window above
 * it. Three layers, top to bottom:
 *
 *   1. Status strip — ambient gadgets (sys bars, signal, power ring,
 *      waveform) framing DATE / VIEW / TIME readouts (time is live).
 *   2. Command row — Home · Today · [Crystal orb in a bezel well] · Progress · More.
 *      The orb is the central command element and opens the Crystal applet.
 *   3. Pilot info bar — PILOT // <name> on the left, a slow ambient
 *      comm ticker in the center, Crystal status on the right.
 *
 * Everything except the five nav keys and the orb is atmospheric dressing.
 * Behavior (nav targets, applet-bus calls, orb id) is identical to the
 * other variants. Only the chrome changes.
 */
export function ToolbarPanoramic() {
  const router = useRouter();
  const pathname = usePathname();
  const { open, minimized } = useAppletBus();
  const now = useShipClock();
  const pilotName = usePilotName();

  function goHome() {
    closeAllApplets();
    router.push("/home");
  }

  const viewName = open ? open.id.toUpperCase() : pathname === "/home" ? "HOME" : "VIEW";

  const keys = [
    {
      id: "home",
      label: "Home",
      glyph: <HomeGlyph />,
      run: goHome,
      aria: "Home — back to the open viewport",
      active: pathname === "/home" && !open,
    },
    {
      id: "today",
      label: "Today",
      glyph: <TodayGlyph />,
      run: () => openApplet("today"),
      aria: "Open Today",
      active: open?.id === "today",
    },
    {
      id: "progress",
      label: "Progress",
      glyph: <ProgressGlyph />,
      run: () => openApplet("progress"),
      aria: "Open Progress",
      active: open?.id === "progress",
    },
    {
      id: "more",
      label: "More",
      glyph: <MoreGlyph />,
      run: () => openApplet("more"),
      aria: "Open More",
      active: open?.id === "more",
    },
  ];

  const crystalActive = open?.id === "crystal";
  const crystalWaiting = minimized.some((m) => m.id === "crystal");

  function pipState(id: string): "engaged" | "attention" | "off" {
    const k = keys.find((kk) => kk.id === id);
    if (k?.active) return "engaged";
    if (minimized.some((m) => m.id === id)) return "attention";
    return "off";
  }

  return (
    <nav
      aria-label="Ship stations"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[80]"
    >
      <div className="pano-dash pointer-events-auto">
        {/* Cyan edge light along the panel's top edge — gentle glow drift */}
        <div className="pano-edge" aria-hidden="true" />

        {/* Status strip: ambient gadgets framing the live readouts */}
        <div className="pano-status" aria-hidden="true">
          <span className="pano-readout pano-readout-date">
            <SysBars />
            <span className="pano-readout-label">Date</span>
            <span className="pano-readout-value">{fmtDate(now)}</span>
          </span>
          <span className="pano-readout pano-readout-view">
            <SignalBars />
            <span className="pano-readout-label">View</span>
            <span className="pano-readout-value">{viewName}</span>
          </span>
          <span className="pano-readout pano-readout-time">
            <span className="pano-readout-label">Time</span>
            <span className="pano-readout-value pano-time-value tabular-nums">{fmtTime(now)}</span>
            <Waveform />
            <PowerRing />
          </span>
        </div>

        {/* Command row: two keys, the orb well, two keys */}
        <div className="pano-command">
          {keys.slice(0, 2).map((k) => (
            <span className="pano-keycell" key={k.id}>
              <span className="pano-pip" data-state={pipState(k.id)} aria-hidden="true" />
              <button
                type="button"
                onClick={k.run}
                data-active={k.active}
                aria-label={k.aria}
                title={k.label}
                className="pano-key"
              >
                {k.glyph}
                <span className="pano-key-label">{k.label}</span>
              </button>
            </span>
          ))}

          {/* Central command: the Crystal orb in a bezel well */}
          <span className="pano-keycell pano-orbcell">
            <span
              className="pano-pip"
              data-state={crystalActive ? "engaged" : crystalWaiting ? "attention" : "off"}
              aria-hidden="true"
            />
            <span className="pano-bezel" aria-hidden="true">
              <span className="pano-bezel-ring" />
            </span>
            <button
              type="button"
              id="toolbar-crystal-orb"
              onClick={() => openApplet("crystal")}
              data-active={crystalActive}
              aria-label="Talk to Crystal — your AI co-pilot"
              title="Crystal"
              className="pano-orb"
            >
              <span className="pano-orb-core" aria-hidden="true" />
            </button>
            <span className="pano-key-label pano-orb-label">Crystal</span>
          </span>

          {keys.slice(2).map((k) => (
            <span className="pano-keycell" key={k.id}>
              <span className="pano-pip" data-state={pipState(k.id)} aria-hidden="true" />
              <button
                type="button"
                onClick={k.run}
                data-active={k.active}
                aria-label={k.aria}
                title={k.label}
                className="pano-key"
              >
                {k.glyph}
                <span className="pano-key-label">{k.label}</span>
              </button>
            </span>
          ))}
        </div>

        {/* Pilot info bar: PILOT // <name> · ambient ticker · Crystal status */}
        <div className="pano-infobar" aria-hidden="true">
          <span className="pano-pilot">
            Pilot&nbsp;//&nbsp;<span className="pano-pilot-name">{pilotName}</span>
          </span>
          <CommTicker />
          <span className="pano-crystal" data-state={crystalActive ? "engaged" : "idle"}>
            Crystal // {crystalActive ? "Engaged" : "Standing by"}
          </span>
        </div>
      </div>
      <style>{PANORAMIC_CSS}</style>
    </nav>
  );
}

const PANORAMIC_CSS = `
.pano-dash {
  --pano-inset: 14px;
  position: relative;
  width: 100%;
  /* Trapezoidal console: top edge inset, flaring to full width at the base */
  clip-path: polygon(var(--pano-inset) 0, calc(100% - var(--pano-inset)) 0, 100% 100%, 0 100%);
  background:
    linear-gradient(180deg, rgb(10 18 24 / 0.96) 0%, rgb(4 7 10 / 0.98) 34%, #020304 100%);
  padding: 12px 18px max(8px, env(safe-area-inset-bottom));
}
/* Cyan edge light tracing the panel's top edge — slow glow drift */
.pano-edge {
  position: absolute; top: 0; left: var(--pano-inset); right: var(--pano-inset); height: 2px;
  background: linear-gradient(90deg,
    rgb(34 211 238 / 0) 0%,
    rgb(34 211 238 / 0.75) 22%,
    rgb(167 139 250 / 0.75) 50%,
    rgb(34 211 238 / 0.75) 78%,
    rgb(34 211 238 / 0) 100%);
  box-shadow: 0 0 16px rgb(34 211 238 / 0.45), 0 1px 8px rgb(34 211 238 / 0.3);
  pointer-events: none;
  animation: pano-edge-drift 8s ease-in-out infinite;
}
@keyframes pano-edge-drift {
  0%, 100% { opacity: 0.75; }
  50% { opacity: 1; }
}
/* Status strip: ambient gadgets + live readouts */
.pano-status {
  display: flex; justify-content: space-between; align-items: center;
  max-width: 720px; margin: 0 auto; padding: 2px 6px 10px;
  gap: 8px;
}
.pano-readout {
  display: flex; align-items: center; gap: 7px;
  font-size: 12px; letter-spacing: 0.14em; text-transform: uppercase;
  min-width: 0;
}
.pano-readout-label { color: rgb(34 211 238 / 0.65); font-weight: 600; font-size: 10px; }
.pano-readout-value { color: #dbe9ef; font-weight: 600; white-space: nowrap; }
.pano-time-value { text-shadow: 0 0 10px rgb(34 211 238 / 0.35); animation: pano-readout-glow 6s ease-in-out infinite; }
@keyframes pano-readout-glow {
  0%, 100% { text-shadow: 0 0 10px rgb(34 211 238 / 0.35); }
  50% { text-shadow: 0 0 14px rgb(34 211 238 / 0.55); }
}
/* Sys bars: three thin diagnostic bars, gentle drift */
.pano-sysbars { display: inline-flex; align-items: flex-end; gap: 2.5px; height: 14px; }
.pano-sysbar {
  width: 3px; border-radius: 1px;
  background: linear-gradient(180deg, #5eead4, rgb(94 234 212 / 0.35));
  transform-origin: bottom;
  animation: pano-sysbar 3.2s ease-in-out infinite;
}
.pano-sysbar:nth-child(1) { height: 14px; }
.pano-sysbar:nth-child(2) { height: 10px; }
.pano-sysbar:nth-child(3) { height: 12px; }
@keyframes pano-sysbar {
  0%, 100% { transform: scaleY(0.65); opacity: 0.55; }
  50% { transform: scaleY(1); opacity: 1; }
}
/* Signal bars: four bars, staggered soft pulse */
.pano-sigbars { display: inline-flex; align-items: flex-end; gap: 2.5px; height: 14px; }
.pano-sigbar {
  width: 3px; border-radius: 1px; background: #22d3ee;
  box-shadow: 0 0 6px rgb(34 211 238 / 0.5);
  animation: pano-sigbar 4s ease-in-out infinite;
}
.pano-sigbar:nth-child(1) { height: 5px; }
.pano-sigbar:nth-child(2) { height: 8px; }
.pano-sigbar:nth-child(3) { height: 11px; }
.pano-sigbar:nth-child(4) { height: 14px; }
@keyframes pano-sigbar {
  0%, 100% { opacity: 0.45; }
  50% { opacity: 1; }
}
/* Power ring: small ring with a slowly rotating arc */
.pano-power { width: 16px; height: 16px; flex-shrink: 0; }
.pano-power-arc { transform-origin: 10px 10px; animation: pano-power-spin 20s linear infinite; filter: drop-shadow(0 0 3px rgb(34 211 238 / 0.6)); }
@keyframes pano-power-spin { to { transform: rotate(360deg); } }
/* Waveform: tiny sparkline drifting very slowly */
.pano-wave { width: 52px; height: 14px; flex-shrink: 0; }
.pano-wave-path { animation: pano-wave-drift 7s ease-in-out infinite; }
@keyframes pano-wave-drift {
  0%, 100% { transform: translateX(-3px); opacity: 0.6; }
  50% { transform: translateX(3px); opacity: 1; }
}
/* Command row: full-width key bank */
.pano-command {
  display: flex; align-items: stretch; justify-content: center;
  gap: 6px; max-width: 720px; margin: 0 auto;
}
.pano-keycell {
  flex: 1 1 0; min-width: 0;
  display: flex; flex-direction: column; align-items: center;
}
/* Status pip above each key — engaged pips breathe softly */
.pano-pip {
  width: 6px; height: 6px; margin-bottom: 5px; flex-shrink: 0;
  border-radius: 9999px; background: transparent;
}
.pano-pip[data-state="engaged"] {
  background: #5eead4;
  box-shadow: 0 0 8px rgb(94 234 212 / 0.9);
  animation: pano-pip-breathe 4s ease-in-out infinite;
}
.pano-pip[data-state="attention"] {
  background: #fbbf24;
  box-shadow: 0 0 8px rgb(251 191 36 / 0.9);
  animation: pano-pip-breathe 3s ease-in-out infinite;
}
@keyframes pano-pip-breathe {
  0%, 100% { opacity: 0.7; }
  50% { opacity: 1; }
}
/* Chamfered command key — beveled like a cockpit switch */
.pano-key {
  width: 100%; min-height: 62px;
  position: relative;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px;
  padding: 8px 2px 7px;
  color: #8fa6b1;
  background: linear-gradient(180deg, #0b1218 0%, #05090c 100%);
  border: 1px solid rgb(255 255 255 / 0.08);
  clip-path: polygon(9px 0, 100% 0, 100% calc(100% - 9px), calc(100% - 9px) 100%, 0 100%, 0 9px);
  box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.09), inset 0 -5px 10px rgb(0 0 0 / 0.6);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  transition: color 90ms ease-out, background 90ms ease-out;
}
.pano-key:hover { color: #d9e8ee; }
.pano-key:active { color: #ffffff; background: linear-gradient(180deg, #0d1620 0%, #060a0d 100%); }
.pano-key-label {
  font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;
  color: #7e939e; line-height: 1; white-space: nowrap;
}
/* Active key: cyan top rail + backlit glyph */
.pano-key[data-active="true"] { color: #f2faf8; background: linear-gradient(180deg, #0e1a22 0%, #060b0e 100%); }
.pano-key[data-active="true"]::before {
  content: ""; position: absolute; top: 0; left: 14px; right: 14px; height: 3px;
  background: #22d3ee;
  box-shadow: 0 0 12px rgb(34 211 238 / 0.9), 0 0 28px rgb(34 211 238 / 0.45);
}
.pano-key[data-active="true"] .pano-key-label { color: #5eead4; }
/* Orb cell: the central command element */
.pano-orbcell { position: relative; flex: 1 1 0; }
.pano-bezel {
  position: relative; width: 66px; height: 66px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
}
.pano-bezel-ring {
  position: absolute; inset: 0; border-radius: 9999px;
  background:
    radial-gradient(circle at 50% 42%, #050b0d 0%, #010304 62%, rgb(1 3 4 / 0) 100%);
  border: 1px solid rgb(255 255 255 / 0.07);
  box-shadow:
    inset 0 8px 22px rgb(0 0 0 / 0.95),
    inset 0 -3px 8px rgb(34 211 238 / 0.12),
    0 0 0 3px rgb(0 0 0 / 0.4);
}
.pano-bezel-ring::after {
  content: ""; position: absolute; inset: -5px; border-radius: 9999px;
  border: 1px dashed rgb(34 211 238 / 0.28);
  animation: pano-ring-spin 24s linear infinite;
}
@keyframes pano-ring-spin { to { transform: rotate(360deg); } }
/* The orb — divine light, brightest element on the dash */
.pano-orb {
  position: absolute; width: 52px; height: 52px;
  border-radius: 9999px; border: none; cursor: pointer; padding: 0;
  background:
    radial-gradient(circle at 34% 30%, rgb(255 255 255 / 0.9) 0%, rgb(255 255 255 / 0) 34%),
    radial-gradient(circle at 50% 55%, #dcfff5 0%, #5eead4 38%, #0e7d6c 72%, #04211c 100%);
  box-shadow:
    0 0 20px rgb(94 234 212 / 0.6),
    0 0 50px rgb(94 234 212 / 0.3),
    0 0 100px rgb(94 234 212 / 0.14),
    inset 0 -6px 14px rgb(0 0 0 / 0.35);
  animation: pano-orb-breathe 5.5s ease-in-out infinite;
  transition: transform 200ms ease;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
}
.pano-orb:hover { transform: scale(1.06); }
.pano-orb:active { transform: scale(0.95); }
.pano-orb[data-active="true"] {
  box-shadow:
    0 0 26px rgb(94 234 212 / 0.85),
    0 0 64px rgb(94 234 212 / 0.42),
    0 0 120px rgb(94 234 212 / 0.2),
    inset 0 -6px 14px rgb(0 0 0 / 0.35);
}
.pano-orb-core {
  position: absolute; inset: 0; border-radius: 9999px;
  background: radial-gradient(circle at 50% 42%, rgb(255 255 255 / 0.5) 0%, rgb(255 255 255 / 0) 46%);
  animation: pano-orb-shimmer 7s ease-in-out infinite;
}
@keyframes pano-orb-breathe {
  0%, 100% { box-shadow: 0 0 20px rgb(94 234 212 / 0.6), 0 0 50px rgb(94 234 212 / 0.3), 0 0 100px rgb(94 234 212 / 0.14), inset 0 -6px 14px rgb(0 0 0 / 0.35); }
  50% { box-shadow: 0 0 26px rgb(94 234 212 / 0.75), 0 0 64px rgb(94 234 212 / 0.38), 0 0 120px rgb(94 234 212 / 0.18), inset 0 -6px 14px rgb(0 0 0 / 0.35); }
}
@keyframes pano-orb-shimmer {
  0%, 100% { opacity: 0.7; }
  50% { opacity: 1; }
}
.pano-orb-label { margin-top: 5px; }
/* Pilot info bar: thin strip along the base */
.pano-infobar {
  display: flex; justify-content: space-between; align-items: center;
  max-width: 720px; margin: 8px auto 0; padding: 0 6px;
  gap: 10px;
  font-size: 9px; font-weight: 600; letter-spacing: 0.18em; text-transform: uppercase;
  color: rgb(143 166 177 / 0.55);
}
.pano-pilot { white-space: nowrap; }
.pano-pilot-name { color: #dbe9ef; }
.pano-crystal { white-space: nowrap; }
.pano-crystal[data-state="engaged"] { color: #5eead4; }
/* Comm ticker: very slow ambient marquee, clipped between pilot and crystal */
.pano-ticker {
  flex: 1 1 auto; min-width: 0; overflow: hidden;
  mask-image: linear-gradient(90deg, transparent, #000 18%, #000 82%, transparent);
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 18%, #000 82%, transparent);
}
.pano-ticker-track {
  display: inline-flex; gap: 28px; white-space: nowrap;
  animation: pano-ticker 48s linear infinite;
}
.pano-ticker-item { color: rgb(34 211 238 / 0.5); }
@keyframes pano-ticker {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}
/* Desktop: roomier dash, wider flare */
@media (min-width: 640px) {
  .pano-dash { --pano-inset: 26px; padding: 14px 28px max(10px, env(safe-area-inset-bottom)); }
  .pano-key { min-height: 68px; }
  .pano-bezel { width: 76px; height: 76px; }
  .pano-orb { width: 60px; height: 60px; }
  .pano-wave { width: 72px; }
}
/* Small phones: compress — essentials only (date, time, pilot, crystal, nav) */
@media (max-width: 380px) {
  .pano-dash { --pano-inset: 10px; padding-left: 12px; padding-right: 12px; }
  .pano-readout-view { display: none; }
  .pano-sysbars, .pano-wave, .pano-power, .pano-ticker { display: none; }
  .pano-command { gap: 4px; }
  .pano-key-label { font-size: 9px; }
  .pano-infobar { font-size: 8px; letter-spacing: 0.14em; }
}
@media (prefers-reduced-motion: reduce) {
  .pano-key, .pano-key-label { transition: none; }
  .pano-orb, .pano-orb-core { animation: none; }
  .pano-bezel-ring::after { animation: none; }
  .pano-edge, .pano-time-value, .pano-sysbar, .pano-sigbar,
  .pano-power-arc, .pano-wave-path, .pano-pip, .pano-ticker-track { animation: none; }
}
`;
