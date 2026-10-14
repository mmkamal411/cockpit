"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { closeAllApplets, openApplet, useAppletBus } from "@/lib/applet-bus";
import { SchoolGlyph } from "./school-glyph";
import { CrystalCommandButton } from "@/components/pilot/crystal-mascot";

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

function ChatGlyph() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 12a8 8 0 0 1-8 8H4l2.3-2.9A8 8 0 1 1 21 12Z" />
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

interface Station {
  id: "home" | "today" | "crystal" | "progress" | "school";
  label: string;
  glyph: ReactNode;
}

/**
 * ToolbarHologlass — the "Hologlass" toolbar direction.
 *
 * Near-invisible plate; five projected-light keys that rest as a hairline
 * outline + glyph + label floating over the vista, and bloom with a soft
 * radial glow + teal outline on hover/press. The Crystal orb stays the
 * brightest element, centered, with its breathing/shimmer animation.
 *
 * Behavior is identical to toolbar-legacy.tsx — only the chrome differs.
 */
export function ToolbarHologlass() {
  const router = useRouter();
  const { open } = useAppletBus();

  function goHome() {
    closeAllApplets();
    router.push("/home");
  }

  // Chrome-only active state: whichever applet is open (home when none).
  const activeId: Station["id"] = (open?.id as Station["id"]) ?? "home";

  const stations: Station[] = [
    { id: "today", label: "Today", glyph: <TodayGlyph /> },
    { id: "crystal", label: "Crystal", glyph: <ChatGlyph /> },
    { id: "progress", label: "Progress", glyph: <ProgressGlyph /> },
    {
      id: "school" as const,
      label: "School",
      glyph: <SchoolGlyph size={19} strokeWidth={1.9} />,
    },
  ];

  function runStation(id: Station["id"]) {
    if (id === "home") goHome();
    else openApplet(id);
  }

  function keyButton(s: Station) {
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
        className="holo-key"
      >
        <span className="holo-glyph" aria-hidden="true">{s.glyph}</span>
        <span className="holo-label">{s.label}</span>
        <span className="holo-pip" aria-hidden="true" />
      </button>
    );
  }

  return (
    <nav
      aria-label="Ship stations"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[80] flex justify-center px-4 pb-[max(14px,env(safe-area-inset-bottom))]"
    >
      <div className="hologlass-plate pointer-events-auto flex gap-1 px-2 py-2 sm:gap-2 sm:px-3">
        {keyButton({ id: "home", label: "Home", glyph: <HomeGlyph /> })}
        {stations.slice(0, 2).map(keyButton)}

        {/* The Crystal command — orb or robot (flag), home base, centered. */}
        <CrystalCommandButton
          className="hologlass-orb"
          coreClassName="hologlass-orb-core"
          active={activeId === "crystal"}
          onOpen={() => openApplet("crystal")}
        />

        {stations.slice(2).map(keyButton)}
      </div>
      <style>{HOLOGLASS_CSS}</style>
    </nav>
  );
}

const HOLOGLASS_CSS = `
/* ---- Hologlass plate: near-invisible, maximum vista ---- */
.hologlass-plate {
  align-items: center;
  border-radius: 30px;
  border: 1px solid rgb(255 255 255 / 0.07);
  background: linear-gradient(180deg, rgb(255 255 255 / 0.045), rgb(255 255 255 / 0.015));
  -webkit-backdrop-filter: blur(10px) saturate(1.15);
  backdrop-filter: blur(10px) saturate(1.15);
  box-shadow: 0 10px 36px rgb(0 0 0 / 0.28);
}
/* ---- Projected-light keys ---- */
.holo-key {
  position: relative;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 3px;
  min-width: 56px; min-height: 58px; padding: 7px 8px 6px;
  border-radius: 18px;
  border: 1px solid rgb(255 255 255 / 0.15);
  background: rgb(2 8 10 / 0.14);
  -webkit-backdrop-filter: blur(8px);
  backdrop-filter: blur(8px);
  color: rgb(255 255 255 / 0.8);
  cursor: pointer;
  /* No transforms — Hologlass never scale-bounces. */
  transition: border-color 80ms ease-out, color 80ms ease-out, background-color 80ms ease-out;
}
.holo-key::before {
  content: ""; position: absolute; inset: -1px; border-radius: inherit; pointer-events: none;
  background: radial-gradient(circle at 50% 42%, rgb(94 234 212 / 0.38) 0%, rgb(94 234 212 / 0.12) 46%, rgb(94 234 212 / 0) 72%);
  opacity: 0;
  transition: opacity 80ms ease-out;
}
.holo-key:hover::before,
.holo-key:active::before,
.holo-key[data-active="true"]::before { opacity: 1; }
.holo-key:hover,
.holo-key:active { border-color: rgb(94 234 212 / 0.65); color: #ffffff; background: rgb(2 8 10 / 0.08); }
.holo-key[data-active="true"] { border-color: rgb(94 234 212 / 0.55); }
.holo-glyph {
  display: inline-flex; line-height: 0;
  filter: drop-shadow(0 1px 4px rgb(0 0 0 / 0.75));
  transition: filter 80ms ease-out;
}
.holo-key:hover .holo-glyph,
.holo-key:active .holo-glyph,
.holo-key[data-active="true"] .holo-glyph {
  color: #ffffff;
  filter: drop-shadow(0 0 7px rgb(94 234 212 / 0.9)) drop-shadow(0 1px 3px rgb(0 0 0 / 0.6));
}
.holo-label {
  font-size: 11px; font-weight: 500; letter-spacing: 0.05em; line-height: 1.2;
  color: #f3f8fa;
  text-shadow: 0 1px 6px rgb(0 0 0 / 0.8), 0 0 2px rgb(0 0 0 / 0.9);
}
.holo-pip {
  width: 4px; height: 4px; border-radius: 9999px; margin-top: 1px;
  background: transparent;
  transition: background-color 80ms ease-out, box-shadow 80ms ease-out;
}
.holo-key[data-active="true"] .holo-pip {
  background: #5eead4;
  box-shadow: 0 0 8px rgb(94 234 212 / 0.95);
}
.holo-key:focus-visible {
  outline: 2px solid rgb(94 234 212 / 0.85);
  outline-offset: 2px;
}
/* ---- The orb — a ball of soft divine light. Brightest element. ---- */
.hologlass-orb {
  position: relative;
  width: 58px; height: 58px; margin: 0 6px; flex-shrink: 0;
  border-radius: 9999px; border: none; cursor: pointer; padding: 0;
  background:
    radial-gradient(circle at 34% 30%, rgb(255 255 255 / 0.85) 0%, rgb(255 255 255 / 0) 34%),
    radial-gradient(circle at 50% 55%, #d8fff4 0%, #5eead4 38%, #0e7d6c 72%, #04211c 100%);
  box-shadow:
    0 0 18px rgb(94 234 212 / 0.55),
    0 0 46px rgb(94 234 212 / 0.28),
    0 0 90px rgb(94 234 212 / 0.14),
    inset 0 -6px 14px rgb(0 0 0 / 0.35);
  animation: holo-orb-breathe 5.5s ease-in-out infinite;
}
.hologlass-orb-core {
  position: absolute; inset: 0; border-radius: 9999px;
  background: radial-gradient(circle at 50% 42%, rgb(255 255 255 / 0.5) 0%, rgb(255 255 255 / 0) 46%);
  animation: holo-orb-shimmer 7s ease-in-out infinite;
}
@keyframes holo-orb-breathe {
  0%, 100% { box-shadow: 0 0 18px rgb(94 234 212 / 0.55), 0 0 46px rgb(94 234 212 / 0.28), 0 0 90px rgb(94 234 212 / 0.14), inset 0 -6px 14px rgb(0 0 0 / 0.35); }
  50% { box-shadow: 0 0 24px rgb(94 234 212 / 0.7), 0 0 60px rgb(94 234 212 / 0.36), 0 0 110px rgb(94 234 212 / 0.18), inset 0 -6px 14px rgb(0 0 0 / 0.35); }
}
@keyframes holo-orb-shimmer {
  0%, 100% { opacity: 0.7; }
  50% { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .holo-key, .holo-key::before, .holo-glyph, .holo-pip { transition: none; }
  .hologlass-orb, .hologlass-orb-core { animation: none; }
}
`;
