"use client";

import type { CSSProperties, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { closeAllApplets, openApplet, useAppletBus } from "@/lib/applet-bus";
import { useHasLinkedChildren } from "@/lib/use-crew-roster";
import { SchoolGlyph } from "./school-glyph";
import { CrystalCommandButton } from "@/components/pilot/crystal-robot";

/* Glyphs copied verbatim from toolbar-legacy.tsx — the ship's station icons. */
function HomeGlyph() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 11.5 12 4l9 7.5" />
      <path d="M5.5 10.5V20h13v-9.5" />
    </svg>
  );
}

function TodayGlyph() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

function ProgressGlyph() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 20V10" />
      <path d="M10 20V4" />
      <path d="M16 20v-8" />
      <path d="M2.5 20h19" />
    </svg>
  );
}

type StationId = "home" | "today" | "crystal" | "progress" | "school";

interface DashStation {
  id: Exclude<StationId, "crystal">;
  label: string;
  glyph: ReactNode;
  /** Tangent tilt so the key feels mounted on the console arc (spec cap: 4°). */
  tilt: string;
  /** Vertical step down the arc — the crown (Crystal) rides highest. */
  lift: string;
  /** Neon accent for press bloom, active rail, and status pip. */
  accent: string;
}

/**
 * Station layout math (verified for 320px and 390px viewports):
 * - 3–4 keys × min 48px (PROGRESS renders ~64px at 11px/600/0.05em)
 * - hex master bezel 76px + gaps × 3px + 4px row padding → ≤300px total
 * - nav px-2 leaves 304px at a 320px viewport → no overflow either way.
 * - Tilts and lifts are pure transforms (never affect layout), and the SVG
 *   arch uses preserveAspectRatio="none", so the arc cannot break at any width.
 * The School key (right flank) renders only when the pilot has a linked child.
 */
function buildStations(showSchool: boolean): DashStation[] {
  return [
    { id: "home", label: "Home", glyph: <HomeGlyph />, tilt: "-3deg", lift: "6px", accent: "#eef6fa" },
    { id: "today", label: "Today", glyph: <TodayGlyph />, tilt: "-1.5deg", lift: "2.5px", accent: "#22d3ee" },
    { id: "progress", label: "Progress", glyph: <ProgressGlyph />, tilt: "1.5deg", lift: "2.5px", accent: "#34d399" },
    ...(showSchool
      ? [
          {
            id: "school" as const,
            label: "School",
            glyph: <SchoolGlyph size={19} strokeWidth={1.9} />,
            tilt: "3deg",
            lift: "6px",
            accent: "#86efac",
          },
        ]
      : []),
  ];
}

/**
 * ToolbarDash — the "Panoramic Dash" toolbar direction.
 *
 * A curved console dashboard: the top edge arcs gently like a panoramic
 * windshield frame, traced by a neon rail. Stations ride the arc —
 * machined keys tilted to the curve tangent, with the Crystal orb set in a
 * hexagonal master bezel at the crown. Dark black panels (#04070a) with
 * subtle neon accents from the locked palette.
 *
 * Behavior is identical to toolbar-legacy.tsx — only the chrome differs.
 */
export function ToolbarDash() {
  const router = useRouter();
  const { open } = useAppletBus();
  const showSchool = useHasLinkedChildren();

  function goHome() {
    closeAllApplets();
    router.push("/home");
  }

  const STATIONS = buildStations(showSchool);

  // Chrome-only active state: whichever applet is open (home when none).
  const activeId = (open?.id as StationId | undefined) ?? "home";

  function runStation(id: DashStation["id"]) {
    if (id === "home") goHome();
    else openApplet(id);
  }

  function keyButton(s: DashStation) {
    const isActive = activeId === s.id;
    return (
      <button
        key={s.id}
        type="button"
        onClick={() => runStation(s.id)}
        data-active={isActive}
        aria-label={s.id === "home" ? "Home — back to the open viewport" : `Open ${s.label}`}
        aria-current={isActive ? "page" : undefined}
        title={s.label}
        className="dash-key"
        style={{ "--tilt": s.tilt, "--lift": s.lift, "--accent": s.accent } as CSSProperties}
      >
        <span className="dash-glyph" aria-hidden="true">
          {s.glyph}
        </span>
        <span className="dash-label">{s.label}</span>
        <span className="dash-pip" aria-hidden="true" />
      </button>
    );
  }

  const crystalActive = activeId === "crystal";

  return (
    <nav
      aria-label="Ship stations"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[80] flex justify-center px-2 pb-[max(14px,env(safe-area-inset-bottom))] sm:px-4"
    >
      <div className="dash-console pointer-events-auto">
        {/* Arched console panel + neon rail, drawn as resolution-independent SVG
            so the arc holds at 320px, 390px, and beyond. */}
        <svg
          className="dash-chrome"
          viewBox="0 0 320 116"
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          <defs>
            <linearGradient id="dash-panel-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#0a0f14" />
              <stop offset="0.5" stopColor="#04070a" />
              <stop offset="1" stopColor="#020405" />
            </linearGradient>
            <linearGradient id="dash-rail-stroke" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#22d3ee" stopOpacity="0" />
              <stop offset="0.28" stopColor="#22d3ee" />
              <stop offset="0.5" stopColor="#5eead4" />
              <stop offset="0.72" stopColor="#a78bfa" />
              <stop offset="1" stopColor="#a78bfa" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d="M6,116 L6,30 Q160,12 314,30 L314,106 Q314,116 304,116 L16,116 Q6,116 6,106 Z"
            fill="url(#dash-panel-fill)"
            stroke="rgb(255 255 255 / 0.09)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
          {/* Rail bloom underlay */}
          <path
            d="M6,30 Q160,12 314,30"
            fill="none"
            stroke="#5eead4"
            strokeOpacity="0.22"
            strokeWidth="7"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          {/* Neon rail tracing the arch */}
          <path
            d="M6,30 Q160,12 314,30"
            fill="none"
            stroke="url(#dash-rail-stroke)"
            strokeWidth="1.6"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          {/* Glass highlight just inside the arch */}
          <path
            d="M14,35 Q160,18 306,35"
            fill="none"
            stroke="rgb(255 255 255 / 0.07)"
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        <div className="dash-stations">
          {keyButton(STATIONS[0])}
          {keyButton(STATIONS[1])}

          {/* Master control: the Crystal orb in a hexagonal machined bezel,
              riding the crown of the arc. The orb keeps id="toolbar-crystal-orb"
              and its breathing/shimmer animation; the SoothingOrb controller
              owns drift via the CSS `translate` property, so this component
              never sets `translate` or `transform` on the orb itself. */}
          <div className="dash-orb-station">
            <div className="dash-bezel" data-active={crystalActive}>
              <div className="dash-bezel-core">
                <CrystalCommandButton
                  className="dash-orb"
                  coreClassName="dash-orb-core"
                  active={crystalActive}
                  ariaCurrent={crystalActive ? "page" : undefined}
                  onOpen={() => openApplet("crystal")}
                />
              </div>
            </div>
            <span
              className="dash-pip"
              data-active={crystalActive}
              style={{ "--accent": "#5eead4" } as CSSProperties}
              aria-hidden="true"
            />
          </div>

          {keyButton(STATIONS[2])}
          {STATIONS[3] && keyButton(STATIONS[3])}
        </div>
      </div>
      <style>{DASH_CSS}</style>
    </nav>
  );
}

const DASH_CSS = `
/* ---- Panoramic Dash console ---- */
.dash-console {
  position: relative;
  width: 100%;
  max-width: 432px;
}
.dash-chrome {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.dash-stations {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 22px 2px 10px;
}
@media (min-width: 640px) {
  .dash-stations { gap: 6px; padding: 24px 10px 12px; }
}

/* ---- Machined keys riding the arc tangent ---- */
.dash-key {
  --tilt: 0deg;
  --lift: 0px;
  --accent: #5eead4;
  position: relative;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 3px;
  min-width: 48px; min-height: 58px;
  padding: 8px 3px 7px;
  flex-shrink: 0;
  border-radius: 14px;
  border: 1px solid rgb(255 255 255 / 0.09);
  background: linear-gradient(180deg, #0c1216 0%, #060a0d 70%, #04070a 100%);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.08),
    inset 0 -2px 5px rgb(0 0 0 / 0.55),
    0 4px 12px rgb(0 0 0 / 0.45);
  color: #9db4bf;
  cursor: pointer;
  /* Arc mount: tangent tilt + step down the curve. Pure transform — never
     affects layout, so the arc cannot break the row at any width. */
  transform: rotate(var(--tilt)) translateY(var(--lift));
  /* No scale bounce, no opacity tricks — state changes are color/light only. */
  transition: transform 80ms ease-out, box-shadow 80ms ease-out,
    border-color 80ms ease-out, color 80ms ease-out, background-color 80ms ease-out;
}
.dash-key:hover {
  color: #eef6fa;
  border-color: rgb(255 255 255 / 0.16);
  background: linear-gradient(180deg, #111a20 0%, #080d11 70%, #04070a 100%);
}
/* Backlit press: sink 1px + edge glow bloom (80ms), glyph to white. */
.dash-key:active {
  transform: rotate(var(--tilt)) translateY(calc(var(--lift) + 1px));
  color: #ffffff;
  border-color: var(--accent);
  background: linear-gradient(180deg, #0a0f13 0%, #05080b 70%, #030507 100%);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.1),
    inset 0 -1px 3px rgb(0 0 0 / 0.6),
    0 0 0 1px var(--accent),
    0 0 20px var(--accent),
    0 4px 12px rgb(0 0 0 / 0.45);
}
.dash-key:focus-visible {
  outline: 2px solid rgb(94 234 212 / 0.85);
  outline-offset: 2px;
}
/* Active station: neon rail (an unlit light-pipe when idle) + status pip. */
.dash-key::before {
  content: "";
  position: absolute;
  top: 6px; left: 12px; right: 12px;
  height: 2px;
  border-radius: 2px;
  background: linear-gradient(90deg, transparent, rgb(255 255 255 / 0.1), transparent);
  pointer-events: none;
  transition: background 120ms ease-out, box-shadow 120ms ease-out;
}
.dash-key[data-active="true"]::before {
  background: linear-gradient(90deg, transparent, var(--accent), transparent);
  box-shadow: 0 0 10px var(--accent), 0 0 4px var(--accent);
}
.dash-glyph { display: inline-flex; line-height: 0; }
.dash-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  line-height: 1.15;
  white-space: nowrap;
}
/* Status pip — a dashboard indicator lamp under each key. */
.dash-pip {
  width: 5px; height: 5px;
  border-radius: 9999px;
  margin-top: 2px;
  background: #1b252b;
  box-shadow: inset 0 1px 2px rgb(0 0 0 / 0.7), 0 1px 0 rgb(255 255 255 / 0.05);
  transition: background-color 120ms ease-out, box-shadow 120ms ease-out;
}
.dash-key[data-active="true"] .dash-pip,
.dash-pip[data-active="true"] {
  background: var(--accent);
  box-shadow: 0 0 8px var(--accent), 0 0 3px rgb(255 255 255 / 0.6);
}

/* ---- Hex master bezel: the Crystal orb at the crown of the arc ---- */
.dash-orb-station {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
}
.dash-bezel {
  width: 76px; height: 76px;
  flex-shrink: 0;
  clip-path: polygon(50% 0%, 93.3% 25%, 93.3% 75%, 50% 100%, 6.7% 75%, 6.7% 25%);
  background: linear-gradient(135deg, rgb(94 234 212 / 0.55), rgb(167 139 250 / 0.45) 55%, rgb(34 211 238 / 0.5));
  display: flex; align-items: center; justify-content: center;
  filter: drop-shadow(0 0 10px rgb(94 234 212 / 0.35));
  transition: filter 120ms ease-out;
}
.dash-bezel-core {
  width: 66px; height: 66px;
  flex-shrink: 0;
  clip-path: polygon(50% 0%, 93.3% 25%, 93.3% 75%, 50% 100%, 6.7% 75%, 6.7% 25%);
  background: conic-gradient(from 210deg, #232e35, #0b1013 30%, #2b363e 50%, #0b1013 70%, #232e35);
  box-shadow: inset 0 2px 4px rgb(255 255 255 / 0.16), inset 0 -4px 8px rgb(0 0 0 / 0.65);
  display: flex; align-items: center; justify-content: center;
}
.dash-orb-station:hover .dash-bezel {
  filter: drop-shadow(0 0 16px rgb(94 234 212 / 0.55));
}
.dash-bezel[data-active="true"] {
  background: linear-gradient(135deg, rgb(94 234 212 / 0.9), rgb(167 139 250 / 0.8) 55%, rgb(34 211 238 / 0.85));
  filter: drop-shadow(0 0 18px rgb(94 234 212 / 0.6));
}

/* ---- The orb — a ball of soft divine light. Breathing animation only.
   (Keyframes renamed from toolbar-legacy to avoid global collisions.) */
.dash-orb {
  position: relative;
  width: 58px; height: 58px; flex-shrink: 0;
  border-radius: 9999px; border: none; cursor: pointer; padding: 0;
  background:
    radial-gradient(circle at 34% 30%, rgb(255 255 255 / 0.85) 0%, rgb(255 255 255 / 0) 34%),
    radial-gradient(circle at 50% 55%, #d8fff4 0%, #5eead4 38%, #0e7d6c 72%, #04211c 100%);
  box-shadow:
    0 0 18px rgb(94 234 212 / 0.55),
    0 0 46px rgb(94 234 212 / 0.28),
    0 0 90px rgb(94 234 212 / 0.14),
    inset 0 -6px 14px rgb(0 0 0 / 0.35);
  animation: dash-orb-breathe 5.5s ease-in-out infinite;
}
.dash-orb:focus-visible {
  outline: 2px solid rgb(94 234 212 / 0.85);
  outline-offset: 3px;
}
.dash-orb-core {
  position: absolute; inset: 0; border-radius: 9999px;
  background: radial-gradient(circle at 50% 42%, rgb(255 255 255 / 0.5) 0%, rgb(255 255 255 / 0) 46%);
  animation: dash-orb-shimmer 7s ease-in-out infinite;
}
@keyframes dash-orb-breathe {
  0%, 100% { box-shadow: 0 0 18px rgb(94 234 212 / 0.55), 0 0 46px rgb(94 234 212 / 0.28), 0 0 90px rgb(94 234 212 / 0.14), inset 0 -6px 14px rgb(0 0 0 / 0.35); }
  50% { box-shadow: 0 0 24px rgb(94 234 212 / 0.7), 0 0 60px rgb(94 234 212 / 0.36), 0 0 110px rgb(94 234 212 / 0.18), inset 0 -6px 14px rgb(0 0 0 / 0.35); }
}
@keyframes dash-orb-shimmer {
  0%, 100% { opacity: 0.7; }
  50% { opacity: 1; }
}

/* ---- Reduced motion: instant state swap, orb fully static ---- */
@media (prefers-reduced-motion: reduce) {
  .dash-key, .dash-key::before, .dash-pip, .dash-bezel { transition: none; }
  .dash-orb, .dash-orb-core { animation: none; }
}
`;
