"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

/**
 * CrystalMascot — Crystal as a tiny snow-white fluffling (Meheldi's pick).
 *
 * A soft, cloud-like fluffy creature with neon cyan/pink tuft highlights and
 * big glossy blue eyes, sitting in the toolbar pilot seat. She reacts to the
 * pilot: click → excited bounce + opens Crystal chat; hover → curious lean;
 * 30s idle → sleepy; `crystal:notice` → surprised hop.
 *
 * Architecture:
 *  - `CrystalCommandButton` is the drop-in switch every toolbar variant
 *    renders. It keeps the same props, the same `id="toolbar-crystal-orb"`
 *    (so the SoothingOrb drift controller keeps working — it writes the
 *    independent CSS `translate` property on the button, while mascot motion
 *    lives on nested spans), the same data attributes, and the same
 *    onOpen → opens Crystal chat behavior. The slot's orb chrome
 *    (background/box-shadow/breathe animation) is neutralized by
 *    `.crystal-mascot-mode`; each toolbar keeps its own positioning.
 *  - Moods are SVG facial-expression groups crossfaded via CSS opacity
 *    transitions; body motion is CSS keyframes (bounce, hop, lean,
 *    squash-and-stretch). No heavy JS loops — timers only flip state.
 *  - `prefers-reduced-motion` → static happy face, no loops, no animation.
 *  - Mood API (custom events): `crystal:celebrate`, `crystal:notice`,
 *    `crystal:blush` — see the exported helpers below.
 */

type Mood =
  | "happy"
  | "curious"
  | "sleepy"
  | "excited"
  | "surprised"
  | "giggly"
  | "content";

type BodyAction = "excited" | "surprised" | null;

const INK = "#12303f";
const CYAN = "#22d3ee";
const PINK = "#f472b6";

const IDLE_SLEEP_MS = 30000; // no interaction this long → sleepy
const BLINK_MIN = 3800;
const BLINK_JITTER = 3200;

/* ------------------------------------------------------------------ */
/* Public mood API — other modules dispatch these to make Crystal react */
/* ------------------------------------------------------------------ */

/** Task complete, sync landed, etc. → Crystal does an excited triple-bounce. */
export function celebrateCrystal() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("crystal:celebrate"));
  }
}

/** New notification / nudge arrived → Crystal does a surprised hop. */
export function noticeCrystal() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("crystal:notice"));
  }
}

/**
 * Blush trigger — call `blushCrystal()` from any module (e.g. after the pilot
 * compliments Crystal) and she holds the giggly face for a few seconds
 * before returning to her base face. Same event pattern as the other two.
 */
export function blushCrystal() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("crystal:blush"));
  }
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/* ------------------------------------------------------------------ */
/* Face pieces                                                         */
/* ------------------------------------------------------------------ */

function OpenEye({
  cx,
  cy,
  rx,
  ry,
  irisR,
  irisId,
  pupil,
  dx = 0,
  dy = 0,
}: {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  irisR: number;
  irisId: string;
  pupil: { x: number; y: number };
  dx?: number;
  dy?: number;
}) {
  return (
    <g className="ceye-open">
      <ellipse
        cx={cx}
        cy={cy}
        rx={rx}
        ry={ry}
        fill="#ffffff"
        stroke="#cfe6f1"
        strokeWidth="1"
      />
      <g
        className="cpupil"
        style={{ transform: `translate(${pupil.x + dx}px, ${pupil.y + dy}px)` }}
      >
        <circle cx={cx} cy={cy} r={irisR} fill={`url(#${irisId})`} />
        <circle
          cx={cx - irisR * 0.34}
          cy={cy - irisR * 0.42}
          r={irisR * 0.36}
          fill="#ffffff"
          opacity="0.95"
        />
        <circle
          cx={cx + irisR * 0.42}
          cy={cy + irisR * 0.46}
          r={irisR * 0.15}
          fill="#ffffff"
          opacity="0.85"
        />
      </g>
    </g>
  );
}

/** Closed-eye curve shown during blinks (overrides the open eyes). */
function BlinkLid({ d }: { d: string }) {
  return (
    <g className="ceye-lid">
      <path
        d={d}
        stroke={INK}
        strokeWidth="1.8"
        fill="none"
        strokeLinecap="round"
      />
    </g>
  );
}

function MascotFace({
  pupil,
  irisId,
  blushId,
}: {
  pupil: { x: number; y: number };
  irisId: string;
  blushId: string;
}) {
  const eye = {
    irisId,
    pupil,
  };
  const nose = (
    <ellipse
      cx="32"
      cy="36.6"
      rx="2.1"
      ry="1.5"
      fill="#f9a8d4"
      stroke={PINK}
      strokeWidth="0.8"
    />
  );
  const blush = (opacity: number) => (
    <g opacity={opacity}>
      <ellipse cx="17.5" cy="38.5" rx="3.6" ry="2.4" fill={`url(#${blushId})`} />
      <ellipse cx="46.5" cy="38.5" rx="3.6" ry="2.4" fill={`url(#${blushId})`} />
    </g>
  );
  return (
    <g>
      {/* happy — default idle face */}
      <g className="cface cface-happy">
        {blush(0.55)}
        <OpenEye cx={24} cy={31} rx={6} ry={7.5} irisR={4.6} {...eye} />
        <OpenEye cx={40} cy={31} rx={6} ry={7.5} irisR={4.6} {...eye} />
        <BlinkLid d="M18.5 31.2 q5.5 2 11 0" />
        <BlinkLid d="M34.5 31.2 q5.5 2 11 0" />
        {nose}
        <path
          d="M27 39.5 q5 4.2 10 0"
          stroke={INK}
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
        />
      </g>

      {/* curious — hover lean: one eye wider, brow raised, crooked smile */}
      <g className="cface cface-curious">
        {blush(0.5)}
        <OpenEye
          cx={23.5}
          cy={30.5}
          rx={6.6}
          ry={8}
          irisR={5}
          dx={1.6}
          dy={-0.8}
          {...eye}
        />
        <OpenEye
          cx={40.5}
          cy={31.5}
          rx={5}
          ry={6.4}
          irisR={4}
          dx={1.6}
          dy={-0.8}
          {...eye}
        />
        <BlinkLid d="M17.5 30.7 q6 2 12 0" />
        <BlinkLid d="M35.5 31.7 q5 2 10 0" />
        <path
          d="M17.5 21.5 q5.5 -2.8 11 -1"
          stroke={INK}
          strokeWidth="1.6"
          fill="none"
          strokeLinecap="round"
        />
        {nose}
        <path
          d="M28.5 40 q3.5 2 7 -1"
          stroke={INK}
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
        />
      </g>

      {/* sleepy — closed resting eyes, soft yawn-smile (eyes already shut,
          so the blink loop leaves this face alone) */}
      <g className="cface cface-sleepy">
        {blush(0.8)}
        <path
          d="M18.5 31 q5.5 4.5 11 0"
          stroke={INK}
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M34.5 31 q5.5 4.5 11 0"
          stroke={INK}
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
        />
        {nose}
        <path
          d="M29 40.5 q3 1.6 6 0"
          stroke={INK}
          strokeWidth="1.6"
          fill="none"
          strokeLinecap="round"
        />
      </g>

      {/* excited — click / celebrate: biggest eyes, open joyful mouth */}
      <g className="cface cface-excited">
        {blush(0.85)}
        <OpenEye cx={24} cy={30.5} rx={7} ry={8.5} irisR={5.4} {...eye} />
        <OpenEye cx={40} cy={30.5} rx={7} ry={8.5} irisR={5.4} {...eye} />
        <BlinkLid d="M17.5 30.7 q6.5 2 13 0" />
        <BlinkLid d="M33.5 30.7 q6.5 2 13 0" />
        {nose}
        <ellipse cx="32" cy="41.2" rx="4.2" ry="3.4" fill="#8a4a55" />
        <ellipse cx="32" cy="42.8" rx="2.1" ry="1.3" fill="#f9a8d4" />
        <path
          className="cspark"
          transform="translate(9 28) scale(0.9)"
          d="M0 -4 C1 -1 1 -1 4 0 C1 1 1 1 0 4 C-1 1 -1 1 -4 0 C-1 -1 -1 -1 0 -4 Z"
          fill="#fde68a"
        />
        <path
          className="cspark"
          style={{ animationDelay: "0.35s" }}
          transform="translate(55 28) scale(0.7)"
          d="M0 -4 C1 -1 1 -1 4 0 C1 1 1 1 0 4 C-1 1 -1 1 -4 0 C-1 -1 -1 -1 0 -4 Z"
          fill="#bae6fd"
        />
        <path
          className="cspark"
          style={{ animationDelay: "0.7s" }}
          transform="translate(25 3) scale(0.55)"
          d="M0 -4 C1 -1 1 -1 4 0 C1 1 1 1 0 4 C-1 1 -1 1 -4 0 C-1 -1 -1 -1 0 -4 Z"
          fill="#fbcfe8"
        />
      </g>

      {/* surprised — new nudge: round eyes, little "o" mouth */}
      <g className="cface cface-surprised">
        {blush(0.45)}
        <OpenEye cx={24} cy={31} rx={6.8} ry={7.2} irisR={4.2} {...eye} />
        <OpenEye cx={40} cy={31} rx={6.8} ry={7.2} irisR={4.2} {...eye} />
        <BlinkLid d="M17.5 31.2 q6.5 2 13 0" />
        <BlinkLid d="M33.5 31.2 q6.5 2 13 0" />
        {nose}
        <ellipse cx="32" cy="41" rx="2.1" ry="2.9" fill="#5b3a41" />
      </g>

      {/* giggly — blush trigger: squeezed-shut happy eyes, big grin */}
      <g className="cface cface-giggly">
        {blush(0.95)}
        <path
          d="M18 30.5 q6 -7 12 0"
          stroke={INK}
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M34 30.5 q6 -7 12 0"
          stroke={INK}
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
        {nose}
        <path d="M25 38.5 q7 8.5 14 0 Z" fill="#8a4a55" />
        <path d="M28.6 42.6 q3.4 2.6 6.8 0 q-3.4 1.4 -6.8 0 Z" fill="#f9a8d4" />
      </g>

      {/* content — post-excitement settle: gentle half-moon eyes */}
      <g className="cface cface-content">
        {blush(0.65)}
        <path
          d="M18.5 30.8 q5.5 -4.5 11 0"
          stroke={INK}
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M34.5 30.8 q5.5 -4.5 11 0"
          stroke={INK}
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
        />
        {nose}
        <path
          d="M28 39.5 q4 2.6 8 0"
          stroke={INK}
          strokeWidth="1.8"
          fill="none"
          strokeLinecap="round"
        />
      </g>
    </g>
  );
}

/* ------------------------------------------------------------------ */
/* The fluffling body — snow-white fur, neon cyan/pink tuft highlights  */
/* ------------------------------------------------------------------ */

const FUR_BUMPS: Array<[number, number, number]> = [
  [13, 30, 5], [11, 40, 5.5], [15, 50, 5], [22, 56, 5.5], [32, 58.5, 5],
  [42, 56, 5.5], [49, 50, 5], [53, 40, 5.5], [51, 30, 5], [46, 21, 5],
  [38, 16, 5], [26, 16, 5], [18, 21, 5],
];

function MascotBody({
  mood,
  pupil,
  action,
  lean,
  blinking,
}: {
  mood: Mood;
  pupil: { x: number; y: number };
  action: BodyAction;
  lean: "l" | "r" | null;
  blinking: boolean;
}) {
  // Per-instance gradient ids so multiple mascot mounts never collide on
  // duplicate SVG ids document-wide.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const ids = {
    fur: `cm-fur-${uid}`,
    back: `cm-back-${uid}`,
    iris: `cm-iris-${uid}`,
    blush: `cm-blush-${uid}`,
  };
  const bodyClass = [
    "cm-body",
    action ? `m-act-${action}` : "",
    lean ? `m-lean-${lean}` : "",
    mood === "sleepy" ? "m-sleepy" : "",
  ].join("");
  return (
    <span
      className={`cm${blinking ? " is-blinking" : ""}`}
      data-mood={mood}
      aria-hidden="true"
    >
      <span className={bodyClass}>
        <svg viewBox="0 0 64 64" className="cm-svg">
          <defs>
            <linearGradient id={ids.fur} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#ffffff" />
              <stop offset="100%" stopColor="#e9f5fa" />
            </linearGradient>
            <linearGradient id={ids.back} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#e3f0f6" />
              <stop offset="100%" stopColor="#cfdfe8" />
            </linearGradient>
            <radialGradient id={ids.iris} cx="0.38" cy="0.34" r="0.85">
              <stop offset="0%" stopColor="#93d5fd" />
              <stop offset="45%" stopColor="#3b82f6" />
              <stop offset="100%" stopColor="#1e3a8a" />
            </radialGradient>
            <radialGradient id={ids.blush}>
              <stop offset="0%" stopColor="#ff9ec4" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#ff9ec4" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* tail puff peeking out behind */}
          <circle cx="55" cy="47" r="4.5" fill={`url(#${ids.back})`} />
          <circle cx="56.6" cy="45.4" r="1.4" fill={PINK} opacity="0.75" />

          {/* back fur layer — soft depth behind the white fluff */}
          <g fill={`url(#${ids.back})`} transform="translate(0 1.6)">
            {FUR_BUMPS.map(([x, y, r], i) => (
              <circle key={i} cx={x} cy={y} r={r} />
            ))}
            <ellipse cx="32" cy="36" rx="20" ry="18.5" />
          </g>

          {/* ears — rounded, pink inside */}
          <ellipse
            cx="14.5" cy="15" rx="4.2" ry="6"
            transform="rotate(-20 14.5 15)"
            fill={`url(#${ids.fur})`} stroke="#d5e7f0" strokeWidth="0.8"
          />
          <ellipse
            cx="49.5" cy="15" rx="4.2" ry="6"
            transform="rotate(20 49.5 15)"
            fill={`url(#${ids.fur})`} stroke="#d5e7f0" strokeWidth="0.8"
          />
          <ellipse
            cx="14.5" cy="15.5" rx="2" ry="3.4"
            transform="rotate(-20 14.5 15.5)" fill="#ffd6e7"
          />
          <ellipse
            cx="49.5" cy="15.5" rx="2" ry="3.4"
            transform="rotate(20 49.5 15.5)" fill="#ffd6e7"
          />

          {/* front fur — scalloped white fluff */}
          <g fill={`url(#${ids.fur})`}>
            {FUR_BUMPS.map(([x, y, r], i) => (
              <circle key={i} cx={x} cy={y} r={r} />
            ))}
            <ellipse cx="32" cy="36" rx="20" ry="18.5" />
          </g>

          {/* head tufts — short wispy fur spikes with neon tips */}
          <g strokeLinecap="round" fill="none">
            <path d="M24 13.5 C21.5 9.5 18.5 8 15.5 7.6" stroke="#ffffff" strokeWidth="3.2" />
            <path d="M32 12.5 C32 9 32.6 6.8 33.8 5.4" stroke="#ffffff" strokeWidth="3.2" />
            <path d="M40 13.5 C42.5 9.5 45.5 8 48.5 7.6" stroke="#ffffff" strokeWidth="3.2" />
            <path d="M19 7.9 C17.8 7.7 16.6 7.6 15.5 7.6" stroke={PINK} strokeWidth="2" />
            <path d="M33 6.4 C33.3 6 33.5 5.7 33.8 5.4" stroke={CYAN} strokeWidth="2" />
            <path d="M45 7.9 C46.2 7.7 47.4 7.6 48.5 7.6" stroke={PINK} strokeWidth="2" />
          </g>

          {/* neon fur streaks on the sides */}
          <path
            d="M11 40 q-1.5 4 0.5 7" stroke={CYAN}
            strokeWidth="1.6" fill="none" strokeLinecap="round" opacity="0.8"
          />
          <path
            d="M53 41 q1.5 4 -0.5 7" stroke={PINK}
            strokeWidth="1.6" fill="none" strokeLinecap="round" opacity="0.8"
          />

          {/* feet + toe beans */}
          <ellipse cx="23.5" cy="58" rx="5.5" ry="3" fill={`url(#${ids.fur})`} stroke="#d5e7f0" strokeWidth="0.8" />
          <ellipse cx="40.5" cy="58" rx="5.5" ry="3" fill={`url(#${ids.fur})`} stroke="#d5e7f0" strokeWidth="0.8" />
          <g stroke="#f9a8d4" strokeWidth="1" strokeLinecap="round">
            <path d="M21.5 57.5 v1.6 M23.5 57.2 v1.8 M25.5 57.5 v1.6" />
            <path d="M38.5 57.5 v1.6 M40.5 57.2 v1.8 M42.5 57.5 v1.6" />
          </g>

          {/* little side paws */}
          <ellipse cx="11.5" cy="45" rx="3.2" ry="4.6" transform="rotate(14 11.5 45)" fill={`url(#${ids.fur})`} />
          <ellipse cx="52.5" cy="45" rx="3.2" ry="4.6" transform="rotate(-14 52.5 45)" fill={`url(#${ids.fur})`} />

          <MascotFace pupil={pupil} irisId={ids.iris} blushId={ids.blush} />

          {/* sleepy Zzz — floats up, only while sleepy */}
          <g
            className="czzz" stroke="#7dd3fc" strokeWidth="1.8"
            fill="none" strokeLinecap="round" strokeLinejoin="round"
          >
            <path d="M48 15 h5 l-5 5 h5" />
            <path d="M53.5 8 h4 l-4 4 h4" />
          </g>
        </svg>
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Interactive mascot button + personality engine                      */
/* ------------------------------------------------------------------ */

function CrystalMascotButton({
  className,
  active,
  waiting,
  ariaCurrent,
  onOpen,
}: {
  className: string;
  active?: boolean;
  waiting?: boolean;
  ariaCurrent?: "page";
  onOpen: () => void;
}) {
  const reduced = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    []
  );
  const [mood, setMood] = useState<Mood>("happy");
  const [action, setAction] = useState<BodyAction>(null);
  const [lean, setLean] = useState<"l" | "r" | null>(null);
  const [blinking, setBlinking] = useState(false);
  const [pupil, setPupilState] = useState({ x: 0, y: 0 });

  const pupilRef = useRef(pupil);
  const moodRef = useRef<Mood>("happy");
  const busy = useRef(false);
  const asleep = useRef(false);
  const alive = useRef(true);
  const timers = useRef<number[]>([]);
  const btnRef = useRef<HTMLButtonElement>(null);

  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  useEffect(() => {
    alive.current = true;
    const pending = timers.current;
    return () => {
      alive.current = false;
      pending.forEach((t) => window.clearTimeout(t));
    };
  }, []);

  // Guarded pupil writer: rounds and skips no-op updates so high-frequency
  // hover tracking doesn't spam re-renders. Glide smoothness comes from the
  // .cpupil CSS transition.
  const setPupil = (next: { x: number; y: number }) => {
    const x = Math.round(next.x * 100) / 100;
    const y = Math.round(next.y * 100) / 100;
    const prev = pupilRef.current;
    if (prev.x === x && prev.y === y) return;
    pupilRef.current = { x, y };
    setPupilState({ x, y });
  };

  const baseMood = () => (asleep.current ? "sleepy" : "happy");

  const applyMood = (m: Mood) => {
    moodRef.current = m;
    setMood(m);
  };

  /* Blink loop — a quick blink every few seconds while awake with open eyes. */
  useEffect(() => {
    if (reduced) return;
    const loop = () => {
      later(() => {
        if (!alive.current) return;
        const m = moodRef.current;
        const eyesOpen =
          m === "happy" || m === "curious" || m === "excited" || m === "surprised";
        if (!busy.current && !asleep.current && eyesOpen) {
          setBlinking(true);
          later(() => {
            if (!alive.current) return;
            setBlinking(false);
            loop();
          }, 150);
        } else {
          loop();
        }
      }, rand(BLINK_MIN, BLINK_MIN + BLINK_JITTER));
    };
    loop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  /* Idle sleep — 30s without interaction → sleepy; any interaction wakes. */
  useEffect(() => {
    if (reduced) return;
    let t = 0;
    const arm = () => {
      window.clearTimeout(t);
      t = window.setTimeout(() => {
        if (!alive.current || busy.current) {
          arm();
          return;
        }
        asleep.current = true;
        applyMood("sleepy");
      }, IDLE_SLEEP_MS);
    };
    const wake = () => {
      window.clearTimeout(t);
      if (asleep.current && !busy.current) {
        asleep.current = false;
        applyMood("happy");
      }
      arm();
    };
    arm();
    window.addEventListener("pointerdown", wake, { passive: true });
    window.addEventListener("keydown", wake);
    window.addEventListener("touchstart", wake, { passive: true });
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("pointerdown", wake);
      window.removeEventListener("keydown", wake);
      window.removeEventListener("touchstart", wake);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  /* Custom-event reactions (celebrate / notice / blush). */
  useEffect(() => {
    if (reduced) return;
    const settle = (m: Mood, ms: number) => {
      later(() => {
        if (!alive.current) return;
        setAction(null);
        applyMood(m);
        busy.current = false;
      }, ms);
    };
    const onCelebrate = () => {
      if (busy.current) return;
      busy.current = true;
      setAction("excited");
      applyMood("excited");
      later(() => {
        if (!alive.current) return;
        setAction(null);
        applyMood("content");
        settle(baseMood(), 2600);
      }, 1750);
    };
    const onNotice = () => {
      if (busy.current) return;
      busy.current = true;
      setAction("surprised");
      applyMood("surprised");
      settle(baseMood(), 1300);
    };
    const onBlush = () => {
      if (busy.current) return;
      busy.current = true;
      applyMood("giggly");
      settle(baseMood(), 2600);
    };
    window.addEventListener("crystal:celebrate", onCelebrate);
    window.addEventListener("crystal:notice", onNotice);
    window.addEventListener("crystal:blush", onBlush);
    return () => {
      window.removeEventListener("crystal:celebrate", onCelebrate);
      window.removeEventListener("crystal:notice", onNotice);
      window.removeEventListener("crystal:blush", onBlush);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduced]);

  const leanSide = (clientX: number): "l" | "r" => {
    if (!btnRef.current) return "r";
    const r = btnRef.current.getBoundingClientRect();
    return clientX < r.left + r.width / 2 ? "l" : "r";
  };

  /* Hover: curious lean toward the cursor, pupils follow. */
  const handleMouseEnter = (e: React.MouseEvent) => {
    if (reduced || busy.current || asleep.current) return;
    applyMood("curious");
    setLean(leanSide(e.clientX));
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (reduced || !btnRef.current || busy.current || asleep.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    setPupil({
      x: Math.max(-1, Math.min(1, dx)) * 2.6,
      y: Math.max(-1, Math.min(1, dy)) * 2.2,
    });
    setLean(leanSide(e.clientX));
  };

  const handleMouseLeave = () => {
    setPupil({ x: 0, y: 0 });
    setLean(null);
    if (!busy.current) applyMood(baseMood());
  };

  /* Click: excited bounce, then open Crystal chat as before. */
  const handleClick = () => {
    if (!reduced && !busy.current) {
      busy.current = true;
      asleep.current = false;
      setAction("excited");
      applyMood("excited");
      later(() => {
        if (!alive.current) return;
        setAction(null);
        applyMood("content");
      }, 1250);
      later(() => {
        if (!alive.current) return;
        applyMood(baseMood());
        busy.current = false;
      }, 3800);
    }
    onOpen();
  };

  return (
    <button
      ref={btnRef}
      type="button"
      id="toolbar-crystal-orb"
      onClick={handleClick}
      onMouseEnter={handleMouseEnter}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      data-active={active}
      data-waiting={waiting}
      aria-label="Talk to Crystal — your AI co-pilot"
      aria-current={ariaCurrent}
      title="Crystal"
      className={`${className} crystal-mascot-mode`}
    >
      <MascotBody
        mood={mood}
        pupil={pupil}
        action={action}
        lean={lean}
        blinking={blinking}
      />
      <style>{CRYSTAL_MASCOT_CSS}</style>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Drop-in replacement for each toolbar's orb button                    */
/* ------------------------------------------------------------------ */

export function CrystalCommandButton({
  className,
  active,
  waiting,
  ariaCurrent,
  onOpen,
}: {
  className: string;
  /** Accepted for toolbar call-site compatibility; the orb core span is not
      rendered — the mascot replaces the orb entirely. */
  coreClassName?: string;
  active?: boolean;
  waiting?: boolean;
  ariaCurrent?: "page";
  onOpen: () => void;
}) {
  return (
    <CrystalMascotButton
      className={className}
      active={active}
      waiting={waiting}
      ariaCurrent={ariaCurrent}
      onOpen={onOpen}
    />
  );
}

const CRYSTAL_MASCOT_CSS = `
/* Crystal mascot mode — neutralizes the slot's orb chrome (ball-of-light
   background, glow box-shadow, breathe animation) while keeping the slot's
   own size and positioning. */
.crystal-mascot-mode {
  background: transparent !important;
  box-shadow: none !important;
  animation: none !important;
  border: none !important;
  overflow: visible !important;
  padding: 0 !important;
  border-radius: 9999px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.crystal-mascot-mode:hover,
.crystal-mascot-mode:active,
.crystal-mascot-mode:focus-visible { transform: none !important; }
.crystal-mascot-mode:focus-visible {
  outline: 2px solid rgb(34 211 238 / 0.8);
  outline-offset: 3px;
}
/* The console variant centers itself with translate(-50%,-50%) — restore it
   so the neutralizer above can't snap the mascot ~29px on hover. */
.console-orb.crystal-mascot-mode,
.console-orb.crystal-mascot-mode:hover,
.console-orb.crystal-mascot-mode:active {
  transform: translate(-50%, -50%) !important;
}
/* "Active" signal (chat open): cyan aura on the mascot instead of the orb's
   box-shadow glow the neutralizer killed. "Waiting" signal: pink aura. */
.crystal-mascot-mode[data-active="true"] .cm-svg {
  filter: drop-shadow(0 0 12px rgb(34 211 238 / 0.75));
}
.crystal-mascot-mode[data-waiting="true"] .cm-svg {
  filter: drop-shadow(0 0 14px rgb(244 114 182 / 0.8));
}
.cm {
  display: block;
  width: 82%;
  height: 82%;
}
.cm-body {
  display: block;
  width: 100%;
  height: 100%;
  transform-origin: 50% 90%;
  transition: transform 0.3s ease;
}
.cm-svg {
  width: 100%;
  height: 100%;
  overflow: visible;
  animation: cm-breathe 4.6s ease-in-out infinite;
  filter: drop-shadow(0 0 10px rgb(34 211 238 / 0.35));
}
/* Idle — a gentle breath: barely-there bob with a whisper of scale. */
@keyframes cm-breathe {
  0%, 100% { transform: translateY(0) scale(1, 1); }
  50% { transform: translateY(-1.4px) scale(1.006, 0.994); }
}
/* Sleepy — slower, deeper breathing, sinking slightly. */
.m-sleepy .cm-svg { animation: cm-sleep-breathe 5.5s ease-in-out infinite; }
@keyframes cm-sleep-breathe {
  0%, 100% { transform: translateY(0) scale(1, 1); }
  50% { transform: translateY(1.2px) scale(1.015, 0.985); }
}
/* Mood crossfade — all seven faces live in the SVG; only the active mood's
   group is opaque. */
.cface { opacity: 0; transition: opacity 0.22s ease; }
.cm[data-mood="happy"] .cface-happy,
.cm[data-mood="curious"] .cface-curious,
.cm[data-mood="sleepy"] .cface-sleepy,
.cm[data-mood="excited"] .cface-excited,
.cm[data-mood="surprised"] .cface-surprised,
.cm[data-mood="giggly"] .cface-giggly,
.cm[data-mood="content"] .cface-content { opacity: 1; }
/* Blink — closed-lid curves swap over the open eyes for 150ms. */
.ceye-open { transition: opacity 0.12s ease; }
.ceye-lid { opacity: 0; transition: opacity 0.12s ease; }
.cm.is-blinking .ceye-open { opacity: 0; }
.cm.is-blinking .ceye-lid { opacity: 1; }
/* Pupil glide — cursor tracking eases through this compositor-only
   transition instead of jumping. */
.cpupil {
  transition: transform 0.35s cubic-bezier(0.3, 1.3, 0.5, 1);
  will-change: transform;
}
/* Excited bounce — squash-and-stretch: crouch anticipation, stretch through
   the rise, landing squash, tiny rebound, then settle. Repeats 3x. */
.m-act-excited { animation: cm-bounce 0.55s cubic-bezier(0.3, 0, 0.4, 1) 3; }
@keyframes cm-bounce {
  0% { transform: translateY(0) scale(1, 1); }
  18% { transform: translateY(2.5px) scale(1.12, 0.84); animation-timing-function: cubic-bezier(0.3, 0, 0.6, 1); }
  45% { transform: translateY(-13px) scale(0.93, 1.09); animation-timing-function: cubic-bezier(0.2, 0.6, 0.4, 1); }
  68% { transform: translateY(0) scale(1.12, 0.84); }
  82% { transform: translateY(-3px) scale(0.97, 1.03); animation-timing-function: cubic-bezier(0.3, 0, 0.4, 1); }
  100% { transform: translateY(0) scale(1, 1); }
}
/* Surprised hop — quick rise, soft landing squash. */
.m-act-surprised { animation: cm-hop 0.5s ease-out; }
@keyframes cm-hop {
  0% { transform: translateY(0) scale(1, 1); }
  32% { transform: translateY(-9px) scale(0.95, 1.06); }
  62% { transform: translateY(0) scale(1.1, 0.86); animation-timing-function: ease-out; }
  100% { transform: translateY(0) scale(1, 1); }
}
/* Curious lean — tilt toward the cursor side on hover. */
.m-lean-l { transform: rotate(-6deg) translateX(-1.5px); }
.m-lean-r { transform: rotate(6deg) translateX(1.5px); }
/* Sleepy Zzz — each letter drifts upward and fades, staggered, only while
   sleepy. (Animation lives on the paths so the group's position stays put.) */
.czzz path { opacity: 0; }
.cm[data-mood="sleepy"] .czzz path { animation: cm-zzz 2.6s ease-in-out infinite; }
.cm[data-mood="sleepy"] .czzz path:nth-child(2) { animation-delay: 1.1s; }
@keyframes cm-zzz {
  0% { transform: translateY(0); opacity: 0; }
  25% { opacity: 0.9; }
  100% { transform: translateY(-8px); opacity: 0; }
}
/* Excited sparkles — twinkle around the head, only while excited.
   Opacity-only: the sparkles are positioned via the SVG transform attribute,
   which a CSS transform keyframe would override. */
.cspark { opacity: 0; }
.cm[data-mood="excited"] .cspark { animation: cm-twinkle 1.1s ease-in-out infinite; }
@keyframes cm-twinkle {
  0%, 100% { opacity: 0; }
  50% { opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .cm-svg, .cm-body, .czzz, .cspark { animation: none !important; }
  .cm-body { transition: none; }
  .cpupil, .cface, .ceye-open, .ceye-lid { transition: none; }
  .cm[data-mood="sleepy"] .czzz, .cm[data-mood="excited"] .cspark { animation: none !important; }
}
`;
