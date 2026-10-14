"use client";

import { useRouter } from "next/navigation";
import { closeAllApplets, openApplet } from "@/lib/applet-bus";
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
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
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
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" aria-hidden="true">
      <path d="M4 20V10" />
      <path d="M10 20V4" />
      <path d="M16 20v-8" />
      <path d="M2.5 20h19" />
    </svg>
  );
}

/**
 * Toolbar — the persistent bottom-center command bar.
 * Center: the Crystal orb (soothing, glowing, id="toolbar-crystal-orb").
 * Flanks: Home · Today · Crystal · Progress · School (School only when the
 * pilot has a linked child). Always a path back home.
 */
export function ToolbarLegacy() {
  const router = useRouter();

  function goHome() {
    closeAllApplets();
    router.push("/home");
  }

  const stations = [
    { label: "Today", glyph: <TodayGlyph />, run: () => openApplet("today") },
    { label: "Crystal", glyph: <ChatGlyph />, run: () => openApplet("crystal") },
    { label: "Progress", glyph: <ProgressGlyph />, run: () => openApplet("progress") },
    {
      label: "School",
      glyph: <SchoolGlyph size={19} strokeWidth={1.9} />,
      run: () => openApplet("school"),
    },
  ];

  return (
    <nav
      aria-label="Ship stations"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[80] flex justify-center px-4 pb-[max(14px,env(safe-area-inset-bottom))]"
    >
      <div className="toolbar-bar pointer-events-auto flex items-center gap-1 rounded-[26px] border border-line bg-panel/80 px-2.5 py-2 shadow-[0_18px_60px_rgb(0_0_0/0.55)] backdrop-blur-xl sm:gap-2 sm:px-4">
        <button
          type="button"
          onClick={goHome}
          aria-label="Home — back to the open viewport"
          title="Home"
          className="toolbar-btn"
        >
          <HomeGlyph />
          <span className="toolbar-label">Home</span>
        </button>

        {stations.slice(0, 2).map((s) => (
          <button key={s.label} type="button" onClick={s.run} aria-label={`Open ${s.label}`} title={s.label} className="toolbar-btn">
            {s.glyph}
            <span className="toolbar-label">{s.label}</span>
          </button>
        ))}

        {/* The Crystal command — orb or robot (flag), centered in the toolbar. */}
        <CrystalCommandButton
          className="crystal-orb"
          coreClassName="crystal-orb-core"
          onOpen={() => openApplet("crystal")}
        />

        {stations.slice(2).map((s) => (
          <button key={s.label} type="button" onClick={s.run} aria-label={`Open ${s.label}`} title={s.label} className="toolbar-btn">
            {s.glyph}
            <span className="toolbar-label">{s.label}</span>
          </button>
        ))}
      </div>
      <style>{TOOLBAR_CSS}</style>
    </nav>
  );
}

const TOOLBAR_CSS = `
.toolbar-btn {
  display: flex; flex-direction: column; align-items: center; gap: 3px;
  min-width: 52px; padding: 8px 6px; border-radius: 16px;
  color: #a7bcc7; background: transparent; border: none; cursor: pointer;
  transition: color 150ms ease, background 150ms ease, transform 150ms ease;
}
.toolbar-btn:hover { color: #eef6fa; background: rgb(255 255 255 / 0.06); transform: translateY(-1px); }
.toolbar-btn:active { transform: translateY(0); }
.toolbar-label { font-size: 10px; font-weight: 500; letter-spacing: 0.06em; }
/* The orb — a ball of soft divine light. Breathing animation only; the
   SoothingOrb controller owns drift via the independent CSS translate. */
.crystal-orb {
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
  animation: orb-breathe 5.5s ease-in-out infinite;
  transition: transform 200ms ease;
}
.crystal-orb:hover { transform: scale(1.07); }
.crystal-orb:active { transform: scale(0.97); }
.crystal-orb-core {
  position: absolute; inset: 0; border-radius: 9999px;
  background: radial-gradient(circle at 50% 42%, rgb(255 255 255 / 0.5) 0%, rgb(255 255 255 / 0) 46%);
  animation: orb-shimmer 7s ease-in-out infinite;
}
@keyframes orb-breathe {
  0%, 100% { box-shadow: 0 0 18px rgb(94 234 212 / 0.55), 0 0 46px rgb(94 234 212 / 0.28), 0 0 90px rgb(94 234 212 / 0.14), inset 0 -6px 14px rgb(0 0 0 / 0.35); }
  50% { box-shadow: 0 0 24px rgb(94 234 212 / 0.7), 0 0 60px rgb(94 234 212 / 0.36), 0 0 110px rgb(94 234 212 / 0.18), inset 0 -6px 14px rgb(0 0 0 / 0.35); }
}
@keyframes orb-shimmer {
  0%, 100% { opacity: 0.7; }
  50% { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .crystal-orb, .crystal-orb-core { animation: none; }
}
`;
