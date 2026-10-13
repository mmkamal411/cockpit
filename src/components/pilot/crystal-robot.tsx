"use client";

import { useEffect, useMemo, useRef, useState } from "react";

/**
 * CrystalRobot — the Crystal orb reimagined as a tiny, alive companion bot
 * (Meheldi 2026-10-13: cute, funny, expressive, walks the toolbar).
 *
 * Architecture:
 *  - `CrystalCommandButton` is the flag-aware switch every toolbar variant
 *    renders instead of its hand-rolled orb button. When
 *    `NEXT_PUBLIC_CRYSTAL_ROBOT` is not "true", it renders the exact
 *    original orb markup (fallback — orb code paths untouched).
 *  - `CrystalRobotButton` renders the robot and owns the whole personality
 *    engine: idle antics, hover pupil-tracking, click spin, trip-and-fall,
 *    and custom-event reactions (`crystal:celebrate`, `crystal:notice`).
 *  - The button keeps `id="toolbar-crystal-orb"` so the SoothingOrb drift
 *    controller keeps working — it writes the independent CSS `translate`
 *    property on the button, while the robot's own motion lives on nested
 *    spans (`transform`). The two compose instead of fighting.
 *  - `prefers-reduced-motion` → static robot, no loops, no CSS animation.
 *  - Mood API (custom events): `crystal:celebrate`, `crystal:notice`,
 *    `crystal:blush` — see the exported `celebrateCrystal()`,
 *    `noticeCrystal()`, `blushCrystal()` helpers above.
 */

const ROBOT_ENABLED =
  typeof process !== "undefined" &&
  process.env.NEXT_PUBLIC_CRYSTAL_ROBOT === "true";

/* ------------------------------------------------------------------ */
/* Public mood API — other modules dispatch these to make Crystal react */
/* ------------------------------------------------------------------ */

/** Task complete, sync landed, etc. → Crystal does a happy triple-jump. */
export function celebrateCrystal() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("crystal:celebrate"));
  }
}

/** New notification arrived → Crystal looks curious toward it. */
export function noticeCrystal() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("crystal:notice"));
  }
}

/**
 * Blush trigger — call `blushCrystal()` from any module (e.g. after the pilot
 * compliments Crystal, or a compliment nudge fires) and the robot holds the
 * "blush" face (happy eyes + smile + pink cheeks) for a few seconds before
 * returning to its base face. Wired via the `crystal:blush` custom event,
 * same pattern as celebrateCrystal / noticeCrystal.
 */
export function blushCrystal() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("crystal:blush"));
  }
}

/* ------------------------------------------------------------------ */
/* Personality engine tuning                                           */
/* ------------------------------------------------------------------ */

type FaceKind =
  | "happy"
  | "blink"
  | "curious"
  | "surprised"
  | "sleepy"
  | "dizzy"
  | "joy"
  | "blush";

type ActionKind =
  | "walk"
  | "jump"
  | "wave"
  | "trip"
  | "spin"
  | "celebrate"
  | null;

const WADDLE_RANGE = 28; // px left/right of home — stays inside its station
const HUSH_MS = 8000; // calm down this long after the pilot interacts
const IDLE_MIN = 15000; // random idle antics every 15–30s
const IDLE_JITTER = 15000;

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/* ------------------------------------------------------------------ */
/* The robot face — SVG eyes + mouth per expression                    */
/* ------------------------------------------------------------------ */

const INK = "#0e2a3a";

function RobotFace({
  face,
  pupil,
}: {
  face: FaceKind;
  pupil: { x: number; y: number };
}) {
  const px = pupil.x;
  const py = pupil.y;
  const smile = (
    <path
      d="M28 35.5 Q32 38.5 36 35.5"
      stroke={INK}
      strokeWidth="1.8"
      fill="none"
      strokeLinecap="round"
    />
  );
  // Sparkly happy eyes — shared by "happy" and "blush".
  const happyEyes = (
    <g transform={`translate(${px} ${py})`}>
      <ellipse cx="26" cy="28" rx="3.6" ry="5.2" fill={INK} />
      <ellipse cx="38" cy="28" rx="3.6" ry="5.2" fill={INK} />
      <circle cx="27.2" cy="26" r="1.25" fill="#fff" />
      <circle cx="39.2" cy="26" r="1.25" fill="#fff" />
      <circle cx="25" cy="29.6" r="0.6" fill="#fff" opacity="0.8" />
      <circle cx="37" cy="29.6" r="0.6" fill="#fff" opacity="0.8" />
    </g>
  );
  switch (face) {
    case "blink":
      return (
        <g>
          <rect x="22.5" y="27.4" width="7" height="1.6" rx="0.8" fill={INK} />
          <rect x="34.5" y="27.4" width="7" height="1.6" rx="0.8" fill={INK} />
          {smile}
        </g>
      );
    case "curious":
      return (
        <g>
          <g transform={`translate(${px} ${py})`}>
            <ellipse cx="26" cy="28" rx="4.4" ry="6" fill={INK} />
            <ellipse cx="38" cy="28.5" rx="3" ry="4.4" fill={INK} />
            <circle cx="27.4" cy="25.8" r="1.3" fill="#fff" />
            <circle cx="38.9" cy="26.8" r="0.9" fill="#fff" />
          </g>
          <path
            d="M29 36 Q33 37.5 36.5 34.5"
            stroke={INK}
            strokeWidth="1.8"
            fill="none"
            strokeLinecap="round"
          />
        </g>
      );
    case "surprised":
      return (
        <g>
          <g transform={`translate(${px} ${py})`}>
            <circle cx="26" cy="28" r="4.6" fill={INK} />
            <circle cx="38" cy="28" r="4.6" fill={INK} />
            <circle cx="27.4" cy="26.2" r="1.4" fill="#fff" />
            <circle cx="39.4" cy="26.2" r="1.4" fill="#fff" />
          </g>
          <ellipse cx="32" cy="36.5" rx="2.2" ry="2.8" fill={INK} />
        </g>
      );
    case "sleepy":
      return (
        <g>
          <path
            d="M22.5 28 Q26 30.2 29.5 28"
            stroke={INK}
            strokeWidth="1.8"
            fill="none"
            strokeLinecap="round"
          />
          <path
            d="M34.5 28 Q38 30.2 41.5 28"
            stroke={INK}
            strokeWidth="1.8"
            fill="none"
            strokeLinecap="round"
          />
          <path
            d="M29 36 Q32 37.4 35 36"
            stroke={INK}
            strokeWidth="1.6"
            fill="none"
            strokeLinecap="round"
          />
        </g>
      );
    case "dizzy":
      return (
        <g>
          <g stroke={INK} strokeWidth="1.8" strokeLinecap="round">
            <path d="M23.5 25.5 L28.5 30.5 M28.5 25.5 L23.5 30.5" />
            <path d="M35.5 25.5 L40.5 30.5 M40.5 25.5 L35.5 30.5" />
          </g>
          <path
            d="M28 36 Q30 34.6 32 36 Q34 37.4 36 36"
            stroke={INK}
            strokeWidth="1.6"
            fill="none"
            strokeLinecap="round"
          />
        </g>
      );
    case "joy":
      return (
        <g>
          <path
            d="M22.5 29 Q26 24.5 29.5 29"
            stroke={INK}
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
          />
          <path
            d="M34.5 29 Q38 24.5 41.5 29"
            stroke={INK}
            strokeWidth="2"
            fill="none"
            strokeLinecap="round"
          />
          <path d="M27 34.5 Q32 39.5 37 34.5 Z" fill={INK} />
        </g>
      );
    case "blush":
      return (
        <g>
          <ellipse cx="20.5" cy="33.2" rx="4" ry="2.8" fill="url(#crystalBlush)" />
          <ellipse cx="43.5" cy="33.2" rx="4" ry="2.8" fill="url(#crystalBlush)" />
          {happyEyes}
          {smile}
        </g>
      );
    case "happy":
    default:
      return (
        <g>
          {happyEyes}
          {smile}
        </g>
      );
  }
}

/* ------------------------------------------------------------------ */
/* The robot body — cute bot matching the approved design reference     */
/* ------------------------------------------------------------------ */

function RobotBody({
  face,
  pupil,
  action,
}: {
  face: FaceKind;
  pupil: { x: number; y: number };
  action: ActionKind;
}) {
  const actionClass = action ? ` crystal-act-${action}` : "";
  return (
    <span className={`crystal-robot-body${actionClass}`}>
      <svg viewBox="0 0 64 64" aria-hidden="true" className="crystal-robot-svg">
        <defs>
          <linearGradient id="crystalScreen" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#d8f3fd" />
            <stop offset="100%" stopColor="#a3dbf2" />
          </linearGradient>
          <linearGradient id="crystalShell" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#d8ecf5" />
          </linearGradient>
          <linearGradient id="crystalCap" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#e2f6fd" />
            <stop offset="100%" stopColor="#8ccbe6" />
          </linearGradient>
          <radialGradient id="crystalGlow">
            <stop offset="0%" stopColor="#e8fbff" stopOpacity="0.95" />
            <stop offset="45%" stopColor="#9be2f7" stopOpacity="0.55" />
            <stop offset="100%" stopColor="#9be2f7" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="crystalBlush">
            <stop offset="0%" stopColor="#ff8fae" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#ff8fae" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="crystalHeart" cx="0.5" cy="0.4" r="0.8">
            <stop offset="0%" stopColor="#d5f4fe" />
            <stop offset="100%" stopColor="#54c3e6" />
          </radialGradient>
        </defs>

        {/* antenna — socket, stem, and a glowing tip with a soft halo */}
        <circle cx="32" cy="10.6" r="2.1" fill="#8ccbe6" />
        <line
          x1="32"
          y1="11"
          x2="32"
          y2="5"
          stroke="#93c8dc"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <g className="crystal-antenna-tip">
          <circle cx="32" cy="4.4" r="5.4" fill="url(#crystalGlow)" />
          <circle cx="32" cy="4.4" r="2.7" fill="#aee7fa" />
          <circle cx="31" cy="3.4" r="0.9" fill="#ffffff" opacity="0.95" />
        </g>

        {/* side pods */}
        <circle cx="7.5" cy="30" r="5" fill="url(#crystalShell)" stroke="#bcdcea" strokeWidth="1" />
        <circle cx="56.5" cy="30" r="5" fill="url(#crystalShell)" stroke="#bcdcea" strokeWidth="1" />
        <circle cx="7.5" cy="30" r="2.2" fill="#9be2f7" opacity="0.7" />
        <circle cx="56.5" cy="30" r="2.2" fill="#9be2f7" opacity="0.7" />
        <circle cx="6.7" cy="29.2" r="0.8" fill="#ffffff" opacity="0.85" />
        <circle cx="55.7" cy="29.2" r="0.8" fill="#ffffff" opacity="0.85" />

        {/* left arm (viewer-left) — the waver, raised in greeting */}
        <g className="crystal-arm-l" style={{ transformOrigin: "19px 47px" }}>
          <rect x="8" y="32" width="7" height="17" rx="3.5" fill="url(#crystalShell)"
            stroke="#bcdcea" strokeWidth="1" transform="rotate(24 11.5 40.5)" />
          <circle cx="7.2" cy="33.5" r="3.4" fill="url(#crystalShell)" stroke="#bcdcea" strokeWidth="1" />
        </g>
        {/* right arm — resting */}
        <rect x="49" y="44" width="6.5" height="13" rx="3.25" fill="url(#crystalShell)"
          stroke="#bcdcea" strokeWidth="1" transform="rotate(-18 52 50)" />

        {/* feet */}
        <ellipse cx="24" cy="59.5" rx="6.2" ry="3.4" fill="url(#crystalShell)" stroke="#bcdcea" strokeWidth="1" />
        <ellipse cx="40" cy="59.5" rx="6.2" ry="3.4" fill="url(#crystalShell)" stroke="#bcdcea" strokeWidth="1" />

        {/* body */}
        <rect x="20" y="43" width="24" height="15" rx="7.5" fill="url(#crystalShell)"
          stroke="#bcdcea" strokeWidth="1" />
        {/* belly heart — radial gradient + sparkle, gently pulsing */}
        <g className="crystal-heart">
          <path
            d="M32 53.2 c-1.8-2.4-5-3.2-5-0.6 c0 1.8 2.6 3.4 5 4.6 c2.4-1.2 5-2.8 5-4.6 c0-2.6-3.2-1.8-5 0.6 z"
            fill="url(#crystalHeart)"
          />
          <circle cx="30.3" cy="53.4" r="0.9" fill="#ffffff" opacity="0.85" />
        </g>

        {/* head */}
        <rect x="10" y="10" width="44" height="36" rx="15" fill="url(#crystalShell)"
          stroke="#bcdcea" strokeWidth="1" />
        {/* icy-blue head cap — gradient + soft top sheen */}
        <path
          d="M10 25 Q10 10 25 10 L39 10 Q54 10 54 25 Z"
          fill="url(#crystalCap)"
        />
        <path
          d="M16 14.6 Q32 10.9 48 14.6"
          stroke="#ffffff"
          strokeWidth="1.4"
          strokeLinecap="round"
          fill="none"
          opacity="0.55"
        />
        {/* face screen */}
        <rect x="16" y="17" width="32" height="24" rx="10" fill="url(#crystalScreen)"
          stroke="#0e2a3a" strokeOpacity="0.18" strokeWidth="1" />
        {/* screen pixel accents */}
        <rect x="19" y="20" width="2.4" height="2.4" rx="0.8" fill="#7cc4de" opacity="0.8" />
        <rect x="42.6" y="20" width="2.4" height="2.4" rx="0.8" fill="#7cc4de" opacity="0.8" />
        <rect x="19" y="35.6" width="2.4" height="2.4" rx="0.8" fill="#7cc4de" opacity="0.8" />
        <rect x="42.6" y="35.6" width="2.4" height="2.4" rx="0.8" fill="#7cc4de" opacity="0.8" />

        <RobotFace face={face} pupil={pupil} />
      </svg>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Interactive robot button + personality engine                       */
/* ------------------------------------------------------------------ */

function CrystalRobotButton({
  className,
  active,
  waiting,
  onOpen,
}: {
  className: string;
  active?: boolean;
  waiting?: boolean;
  onOpen: () => void;
}) {
  const reduced = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    []
  );
  const [face, setFace] = useState<FaceKind>("happy");
  const [action, setAction] = useState<ActionKind>(null);
  const [walkX, setWalkX] = useState(0);
  const [pupil, setPupil] = useState({ x: 0, y: 0 });

  const baseFace = useRef<FaceKind>("happy");
  const walkXRef = useRef(0);
  const busy = useRef(false);
  const hushedUntil = useRef(0);
  const timers = useRef<number[]>([]);
  const btnRef = useRef<HTMLButtonElement>(null);

  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  // Clear every pending timer on unmount.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  const setBaseFace = (f: FaceKind) => {
    baseFace.current = f;
    setFace(f);
  };

  /* Blink loop — a quick blink every few seconds when idle. */
  useEffect(() => {
    if (reduced) return;
    let alive = true;
    const loop = () => {
      later(() => {
        if (!alive) return;
        if (!busy.current && performance.now() >= hushedUntil.current) {
          setFace("blink");
          later(() => {
            if (!alive) return;
            if (!busy.current) setFace(baseFace.current);
            loop();
          }, 150);
        } else {
          loop();
        }
      }, rand(3800, 7000));
    };
    loop();
    return () => {
      alive = false;
    };
  }, [reduced]);

  /* Idle antics — every 15–30s Crystal does something delightful. */
  useEffect(() => {
    if (reduced) return;
    let alive = true;

    const doIdle = () => {
      const roll = Math.random();
      if (roll < 0.34) {
        // Waddle to a new spot along the toolbar.
        busy.current = true;
        const target = Math.round(rand(-WADDLE_RANGE, WADDLE_RANGE));
        const dist = Math.abs(target - walkXRef.current);
        walkXRef.current = target;
        setWalkX(target);
        setAction("walk");
        later(() => {
          setAction(null);
          busy.current = false;
        }, 500 + dist * 22);
      } else if (roll < 0.54) {
        // Happy little jump.
        busy.current = true;
        setAction("jump");
        later(() => {
          setAction(null);
          busy.current = false;
        }, 700);
      } else if (roll < 0.74) {
        // Wave at the pilot.
        busy.current = true;
        setAction("wave");
        setBaseFace("happy");
        later(() => {
          setAction(null);
          busy.current = false;
        }, 1700);
      } else if (roll < 0.9) {
        // Curious look-around.
        busy.current = true;
        setBaseFace("curious");
        setPupil({ x: -2.2, y: 0 });
        later(() => setPupil({ x: 2.2, y: 0 }), 600);
        later(() => {
          setPupil({ x: 0, y: 0 });
          setBaseFace("happy");
          busy.current = false;
        }, 1300);
      } else if (roll < 0.95) {
        // Rare, funny trip-and-fall. Recovers with a shake.
        busy.current = true;
        setAction("trip");
        setFace("dizzy");
        later(() => {
          setAction(null);
          setBaseFace("happy");
          busy.current = false;
        }, 1400);
      } else {
        // Sleepy moment.
        busy.current = true;
        setBaseFace("sleepy");
        later(() => {
          setBaseFace("happy");
          busy.current = false;
        }, 2200);
      }
    };

    const schedule = () => {
      later(() => {
        if (!alive) return;
        if (performance.now() < hushedUntil.current || busy.current) {
          schedule();
          return;
        }
        doIdle();
        schedule();
      }, rand(IDLE_MIN, IDLE_MIN + IDLE_JITTER));
    };
    schedule();
    return () => {
      alive = false;
    };
  }, [reduced]);

  /* Interaction hush — the pilot is working; Crystal stays calm. */
  useEffect(() => {
    const hush = () => {
      hushedUntil.current = performance.now() + HUSH_MS;
    };
    const events = ["keydown", "pointerdown", "touchstart"] as const;
    events.forEach((ev) => window.addEventListener(ev, hush, { passive: true }));
    return () => {
      events.forEach((ev) => window.removeEventListener(ev, hush));
    };
  }, []);

  /* Custom-event reactions (celebrate / notice). */
  useEffect(() => {
    if (reduced) return;
    const onCelebrate = () => {
      if (busy.current) return;
      busy.current = true;
      setAction("celebrate");
      setBaseFace("joy");
      later(() => {
        setAction(null);
        setBaseFace("happy");
        busy.current = false;
      }, 1750);
    };
    const onNotice = () => {
      if (busy.current) return;
      busy.current = true;
      setBaseFace("curious");
      setPupil({ x: 0, y: -1.5 });
      later(() => {
        setPupil({ x: 0, y: 0 });
        setBaseFace("happy");
        busy.current = false;
      }, 2600);
    };
    const onBlush = () => {
      if (busy.current) return;
      busy.current = true;
      setBaseFace("blush");
      later(() => {
        setBaseFace("happy");
        busy.current = false;
      }, 2600);
    };
    window.addEventListener("crystal:celebrate", onCelebrate);
    window.addEventListener("crystal:notice", onNotice);
    window.addEventListener("crystal:blush", onBlush);
    return () => {
      window.removeEventListener("crystal:celebrate", onCelebrate);
      window.removeEventListener("crystal:notice", onNotice);
      window.removeEventListener("crystal:blush", onBlush);
    };
  }, [reduced]);

  /* Hover: look at the cursor and smile. */
  const handleMouseMove = (e: React.MouseEvent) => {
    if (reduced || !btnRef.current || busy.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    setPupil({
      x: Math.max(-1, Math.min(1, dx)) * 2.4,
      y: Math.max(-1, Math.min(1, dy)) * 2.0,
    });
  };

  const handleMouseEnter = () => {
    if (!busy.current) setBaseFace("happy");
  };

  const handleMouseLeave = () => {
    setPupil({ x: 0, y: 0 });
  };

  /* Click: happy spin, then open Crystal chat as before. */
  const handleClick = () => {
    if (!reduced && !busy.current) {
      busy.current = true;
      setAction("spin");
      setFace("joy");
      later(() => {
        setAction(null);
        setFace(baseFace.current);
        busy.current = false;
      }, 700);
    }
    onOpen();
  };

  return (
    <button
      ref={btnRef}
      type="button"
      id="toolbar-crystal-orb"
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      data-active={active}
      data-waiting={waiting}
      aria-label="Talk to Crystal — your AI co-pilot"
      title="Crystal"
      className={`${className} crystal-robot-mode`}
    >
      <span
        className="crystal-robot-track"
        style={{ transform: `translateX(${walkX}px)` }}
        aria-hidden="true"
      >
        <RobotBody face={face} pupil={pupil} action={action} />
      </span>
      <style>{CRYSTAL_ROBOT_CSS}</style>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Flag-aware switch — drop-in replacement for each toolbar's orb       */
/* ------------------------------------------------------------------ */

export function CrystalCommandButton({
  className,
  coreClassName,
  active,
  waiting,
  ariaCurrent,
  onOpen,
}: {
  className: string;
  coreClassName?: string;
  active?: boolean;
  waiting?: boolean;
  ariaCurrent?: "page";
  onOpen: () => void;
}) {
  if (!ROBOT_ENABLED) {
    // Orb fallback — original markup, untouched behavior.
    return (
      <button
        type="button"
        id="toolbar-crystal-orb"
        onClick={onOpen}
        data-active={active}
        data-waiting={waiting}
        aria-label="Talk to Crystal — your AI co-pilot"
        aria-current={ariaCurrent}
        title="Crystal"
        className={className}
      >
        {coreClassName ? (
          <span className={coreClassName} aria-hidden="true" />
        ) : null}
      </button>
    );
  }
  return (
    <CrystalRobotButton
      className={className}
      active={active}
      waiting={waiting}
      onOpen={onOpen}
    />
  );
}

const CRYSTAL_ROBOT_CSS = `
/* Crystal robot mode — neutralizes the orb chrome, keeps the slot layout */
.crystal-robot-mode {
  background: transparent !important;
  box-shadow: none !important;
  animation: none !important;
  border: none !important;
  overflow: visible !important;
  padding: 0;
}
.crystal-robot-mode:hover { transform: none !important; }
.crystal-robot-mode:active { transform: none !important; }
.crystal-robot-track {
  display: block;
  width: 44px;
  height: 44px;
  transition: transform 0.45s ease-in-out;
}
.crystal-robot-body {
  display: block;
  width: 100%;
  height: 100%;
  transform-origin: 50% 92%;
}
.crystal-robot-svg {
  width: 100%;
  height: 100%;
  overflow: visible;
  animation: crystal-idle 4.2s ease-in-out infinite;
  filter: drop-shadow(0 0 10px rgb(103 232 249 / 0.35));
}
@keyframes crystal-idle {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-1.6px); }
}
/* antenna + heart glow */
.crystal-antenna-tip { animation: crystal-glow 3s ease-in-out infinite; }
.crystal-heart { animation: crystal-glow 4.5s ease-in-out infinite; }
@keyframes crystal-glow {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}
/* waving arm */
.crystal-arm-l { transform-box: view-box; }
.crystal-act-wave .crystal-arm-l { animation: crystal-wave 1.6s ease-in-out; }
@keyframes crystal-wave {
  0%, 100% { transform: rotate(0deg); }
  25% { transform: rotate(-28deg); }
  50% { transform: rotate(6deg); }
  75% { transform: rotate(-22deg); }
}
/* walk waddle (translate handled by the track span) */
.crystal-act-walk { animation: crystal-waddle 0.5s ease-in-out infinite; }
@keyframes crystal-waddle {
  0%, 100% { transform: translateY(0) rotate(-2.5deg); }
  50% { transform: translateY(-2px) rotate(2.5deg); }
}
/* jump */
.crystal-act-jump { animation: crystal-jump 0.65s ease-in-out; }
.crystal-act-celebrate { animation: crystal-jump 0.55s ease-in-out 3; }
@keyframes crystal-jump {
  0%, 100% { transform: translateY(0) scaleY(1); }
  35% { transform: translateY(-11px) scaleY(1.04); }
  70% { transform: translateY(0) scaleY(0.92); }
  82% { transform: translateY(-2px) scaleY(1); }
}
/* trip and fall — playful, recovers with a spring */
.crystal-act-trip { animation: crystal-trip 1.3s ease-in-out; }
@keyframes crystal-trip {
  0% { transform: rotate(0) translateY(0); }
  25% { transform: rotate(-70deg) translateY(6px); }
  45% { transform: rotate(-70deg) translateY(6px); }
  70% { transform: rotate(8deg) translateY(-2px); }
  85% { transform: rotate(-4deg) translateY(0); }
  100% { transform: rotate(0) translateY(0); }
}
/* click spin */
.crystal-act-spin { animation: crystal-spin 0.65s ease-in-out; }
@keyframes crystal-spin {
  to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
  .crystal-robot-svg,
  .crystal-antenna-tip,
  .crystal-heart,
  .crystal-robot-body { animation: none !important; }
  .crystal-robot-track { transition: none; }
}
`;
