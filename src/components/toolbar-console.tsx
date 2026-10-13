"use client";

import { Fragment } from "react";
import { usePathname, useRouter } from "next/navigation";
import { closeAllApplets, openApplet, useAppletBus } from "@/lib/applet-bus";
import { useHasLinkedChildren } from "@/lib/use-crew-roster";
import { SchoolGlyph } from "./school-glyph";

/* Glyphs — copied from toolbar-legacy.tsx, resized to the console spec
   (22px, 1.5px stroke). Icon + word label, always. */
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

function ChatGlyph() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a8 8 0 0 1-8 8H4l2.3-2.9A8 8 0 1 1 21 12Z" />
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

/**
 * ToolbarConsole — "Cockpit Console" toolbar variant.
 *
 * A bottom-anchored, full-bleed black instrument shelf (#04070a) with a 2px
 * teal light strip along its top edge. Backlit machined keys sit in a
 * single shared inset key bank (milled recess, engraved dividers between the
 * Home | Today·Crystal | Progress·School groups) — the School key renders
 * only when the pilot has a linked child. The 58px breathing Crystal
 * orb rides in a deeper circular well at dead center, overlapping the shelf's
 * top edge — the ship's reactor core, and the brightest element on the shelf.
 *
 * Behavior (nav targets, applet-bus calls, orb id) is identical to
 * toolbar-legacy.tsx. Only the chrome changes.
 */
export function ToolbarConsole() {
  const router = useRouter();
  const pathname = usePathname();
  const { open, minimized } = useAppletBus();
  // The School key renders iff the pilot has ≥1 linked child (D4: on child
  // add, not after first sync). Childless pilots see zero parenting pixels.
  const showSchool = useHasLinkedChildren();

  function goHome() {
    closeAllApplets();
    router.push("/home");
  }

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
      id: "crystal",
      label: "Crystal",
      glyph: <ChatGlyph />,
      run: () => openApplet("crystal"),
      aria: "Open Crystal",
      active: open?.id === "crystal",
    },
    {
      id: "progress",
      label: "Progress",
      glyph: <ProgressGlyph />,
      run: () => openApplet("progress"),
      aria: "Open Progress",
      active: open?.id === "progress",
    },
    ...(showSchool
      ? [
          {
            id: "school",
            label: "School",
            glyph: <SchoolGlyph size={22} strokeWidth={1.5} />,
            run: () => openApplet("school"),
            aria: "Open School",
            active: open?.id === "school",
          },
        ]
      : []),
  ];

  return (
    <nav
      aria-label="Ship stations"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[80]"
    >
      <div className="console-shelf pointer-events-auto">
        <div className="console-lightstrip" aria-hidden="true" />

        {/* Reactor core: the Crystal orb in a deeper circular well, dead
            center, overlapping the shelf's top edge. */}
        <div className="console-reactor">
          <div className="console-well" aria-hidden="true" />
          <button
            type="button"
            id="toolbar-crystal-orb"
            onClick={() => openApplet("crystal")}
            aria-label="Talk to Crystal — your AI co-pilot"
            title="Crystal"
            className="console-orb"
          >
            <span className="console-orb-core" aria-hidden="true" />
          </button>
        </div>

        {/* Inset key bank: five machined keys, one milled recess. */}
        <div className="console-keybank">
          {keys.map((k, i) => {
            const pip = k.active
              ? "engaged"
              : minimized.some((m) => m.id === k.id)
                ? "attention"
                : "off";
            return (
              <Fragment key={k.id}>
                <span className="console-keycell">
                  <span
                    className="console-pip"
                    data-state={pip}
                    aria-hidden="true"
                  />
                  <button
                    type="button"
                    onClick={k.run}
                    data-active={k.active}
                    aria-label={k.aria}
                    title={k.label}
                    className="console-key"
                  >
                    {k.glyph}
                    <span className="console-key-label">{k.label}</span>
                  </button>
                </span>
                {/* Engraved dividers: Home alone | Today · Crystal | Progress · School */}
                {(i === 0 || i === 2) && (
                  <span className="console-divider" aria-hidden="true" />
                )}
              </Fragment>
            );
          })}
        </div>
      </div>
      <style>{CONSOLE_CSS}</style>
    </nav>
  );
}

const CONSOLE_CSS = `
.console-shelf {
  position: relative;
  width: 100%;
  background: #04070a;
  border-top: 1px solid rgb(255 255 255 / 0.05);
  padding: 10px 12px max(10px, env(safe-area-inset-bottom));
  box-shadow: 0 -14px 44px rgb(0 0 0 / 0.65);
}
/* 2px teal light strip along the shelf's top edge */
.console-lightstrip {
  position: absolute; top: -1px; left: 0; right: 0; height: 2px;
  background: linear-gradient(90deg,
    rgb(94 234 212 / 0) 0%,
    rgb(94 234 212 / 0.6) 16%,
    rgb(94 234 212 / 0.6) 84%,
    rgb(94 234 212 / 0) 100%);
  box-shadow: 0 0 14px rgb(94 234 212 / 0.35), 0 1px 6px rgb(94 234 212 / 0.25);
  pointer-events: none;
}
/* Reactor mount: dead center, straddling the shelf's top edge so the orb
   overlaps it (orb bottom sits 8px inside the shelf). */
.console-reactor {
  position: absolute; left: 50%; top: -57px; transform: translateX(-50%);
  width: 72px; height: 72px; pointer-events: none; z-index: 1;
}
/* The deeper circular well the orb sits in */
.console-well {
  position: absolute; inset: 0; border-radius: 9999px;
  background: radial-gradient(circle at 50% 42%, #050b0d 0%, #010304 58%, rgb(1 3 4 / 0) 100%);
  border: 1px solid rgb(255 255 255 / 0.06);
  box-shadow:
    inset 0 8px 22px rgb(0 0 0 / 0.95),
    inset 0 -3px 8px rgb(94 234 212 / 0.10),
    0 0 0 4px rgb(0 0 0 / 0.35);
}
/* The orb — a ball of divine light, brightest element on the shelf.
   Breathing/shimmer keyframes carried over from toolbar-legacy. */
.console-orb {
  position: absolute; left: 50%; top: 50%; width: 58px; height: 58px;
  transform: translate(-50%, -50%);
  border-radius: 9999px; border: none; cursor: pointer; padding: 0;
  pointer-events: auto;
  background:
    radial-gradient(circle at 34% 30%, rgb(255 255 255 / 0.9) 0%, rgb(255 255 255 / 0) 34%),
    radial-gradient(circle at 50% 55%, #dcfff5 0%, #5eead4 38%, #0e7d6c 72%, #04211c 100%);
  box-shadow:
    0 0 22px rgb(94 234 212 / 0.65),
    0 0 55px rgb(94 234 212 / 0.32),
    0 0 110px rgb(94 234 212 / 0.16),
    inset 0 -6px 14px rgb(0 0 0 / 0.35);
  animation: console-orb-breathe 5.5s ease-in-out infinite;
  transition: transform 200ms ease;
}
.console-orb:hover { transform: translate(-50%, -50%) scale(1.06); }
.console-orb:active { transform: translate(-50%, -50%) scale(0.96); }
.console-orb-core {
  position: absolute; inset: 0; border-radius: 9999px;
  background: radial-gradient(circle at 50% 42%, rgb(255 255 255 / 0.5) 0%, rgb(255 255 255 / 0) 46%);
  animation: console-orb-shimmer 7s ease-in-out infinite;
}
@keyframes console-orb-breathe {
  0%, 100% { box-shadow: 0 0 22px rgb(94 234 212 / 0.65), 0 0 55px rgb(94 234 212 / 0.32), 0 0 110px rgb(94 234 212 / 0.16), inset 0 -6px 14px rgb(0 0 0 / 0.35); }
  50% { box-shadow: 0 0 28px rgb(94 234 212 / 0.8), 0 0 70px rgb(94 234 212 / 0.4), 0 0 130px rgb(94 234 212 / 0.2), inset 0 -6px 14px rgb(0 0 0 / 0.35); }
}
@keyframes console-orb-shimmer {
  0%, 100% { opacity: 0.7; }
  50% { opacity: 1; }
}
/* The shared inset key bank — one milled recess for all five keys */
.console-keybank {
  position: relative; z-index: 0;
  margin: 0 auto; max-width: 560px;
  display: flex; align-items: stretch; gap: 2px;
  padding: 7px 8px; border-radius: 14px;
  background: linear-gradient(180deg, #020405 0%, #050a0d 100%);
  border: 1px solid rgb(255 255 255 / 0.05);
  box-shadow:
    inset 0 2px 12px rgb(0 0 0 / 0.85),
    inset 0 -1px 0 rgb(255 255 255 / 0.04),
    0 1px 0 rgb(255 255 255 / 0.03);
}
.console-keycell {
  flex: 1 1 0; min-width: 48px;
  display: flex; flex-direction: column; align-items: center;
}
/* 6px status pip above the key: teal = engaged, amber = attention */
.console-pip {
  width: 6px; height: 6px; margin-bottom: 4px; flex-shrink: 0;
  border-radius: 9999px; background: transparent;
}
.console-pip[data-state="engaged"] {
  background: #5eead4;
  box-shadow: 0 0 8px rgb(94 234 212 / 0.9);
}
.console-pip[data-state="attention"] {
  background: #fbbf24;
  box-shadow: 0 0 8px rgb(251 191 36 / 0.9);
}
/* Subtle engraved divider between key groups */
.console-divider {
  width: 2px; flex-shrink: 0; align-self: stretch; margin: 16px 3px 8px;
  background: linear-gradient(180deg,
    rgb(0 0 0 / 0) 0%,
    rgb(0 0 0 / 0.85) 28%,
    rgb(0 0 0 / 0.85) 72%,
    rgb(0 0 0 / 0) 100%);
  box-shadow: 1px 0 0 rgb(255 255 255 / 0.05);
}
/* Machined key: rectilinear (never pill), top-lit bevel, machined lip,
   inset bottom shade, faint teal ambient halo. */
.console-key {
  position: relative;
  width: 100%; min-width: 48px; min-height: 58px;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
  padding: 7px 2px 6px;
  border-radius: 10px;
  color: #93a8b3;
  background: linear-gradient(180deg, #0d1419 0%, #060a0d 100%);
  border: 1px solid rgb(255 255 255 / 0.09);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.10),
    inset 0 -4px 8px rgb(0 0 0 / 0.55),
    0 0 10px rgb(94 234 212 / 0.06);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  transition: transform 80ms ease-out, box-shadow 80ms ease-out, color 80ms ease-out, border-color 80ms ease-out, background 80ms ease-out;
}
.console-key:hover { color: #d9e8ee; }
/* Pressed: sinks 1px and ignites — glow blooms over 80ms, glyph to white,
   label to hot teal. No scale bounce, no opacity dim. */
.console-key:active {
  transform: translateY(1px);
  color: #ffffff;
  border-color: rgb(94 234 212 / 0.6);
  background: linear-gradient(180deg, #0a1116 0%, #05090c 100%);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.06),
    inset 0 -2px 5px rgb(0 0 0 / 0.6),
    0 0 18px rgb(94 234 212 / 0.5),
    0 0 44px rgb(94 234 212 / 0.20);
}
.console-key:active .console-key-label { color: #5eead4; }
.console-key-label {
  font-size: 11px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase;
  color: #7e939e; line-height: 1; white-space: nowrap;
  transition: color 80ms ease-out;
}
/* Active (applet open): 3px neon rail on the key's top edge + steady backlight */
.console-key[data-active="true"] {
  color: #f2faf8;
  border-color: rgb(94 234 212 / 0.45);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.10),
    inset 0 -4px 8px rgb(0 0 0 / 0.55),
    0 0 16px rgb(94 234 212 / 0.30),
    0 0 42px rgb(94 234 212 / 0.12);
}
.console-key[data-active="true"]::before {
  content: ""; position: absolute; top: -1px; left: 10px; right: 10px; height: 3px;
  border-radius: 0 0 3px 3px; background: #5eead4;
  box-shadow: 0 0 10px rgb(94 234 212 / 0.9), 0 0 24px rgb(94 234 212 / 0.5);
}
.console-key[data-active="true"] .console-key-label { color: #5eead4; }
@media (prefers-reduced-motion: reduce) {
  /* Instant state swap; the light still changes (it's information), motion doesn't. */
  .console-key, .console-key-label { transition: none; }
  .console-orb, .console-orb-core { animation: none; }
}
`;
