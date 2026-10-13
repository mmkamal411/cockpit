"use client";

import { useEffect } from "react";

/**
 * SoothingOrb — the Pookie orb as a calm companion (Mehedi 2026-10-12 ~22:30).
 *
 * Behavior:
 *  - Slow wander cycles (20–40s): the orb drifts a short way from home on a
 *    soft ease-in-out path, holds, then settles back to toolbar-center home.
 *  - Never hyperactive: small radius, long durations, gentle curves.
 *  - Interaction hush: while the pilot types, taps, or drags, the orb eases
 *    home and stays still — it never distracts from the work.
 *  - Reduced motion: fully static (the controller never starts).
 *
 * Mounted once in the root layout; it tracks the toolbar orb home in the
 * DOM via MutationObserver. Drift is applied through the independent CSS
 * `translate` property so it composes with the orb's own transform
 * animations (breathing) instead of fighting them. Transform-only — GPU cheap.
 */

const ORB_SELECTOR = "#toolbar-pookie-orb";

// Wander tuning — calm companion in zero gravity, not a bouncing paperclip.
const WANDER_RADIUS = 16; // px from home, max
const LEG_MIN = 7000; // slowest single leg (out / back)
const LEG_JITTER = 4000;
const HOLD_MIN = 4000;
const HOLD_JITTER = 5000;
const HOME_REST_MIN = 8000; // stillness at home between wanders
const HOME_REST_JITTER = 8000;
const HUSH_MS = 8000; // stillness after the pilot interacts

type Phase = "home" | "out" | "hold" | "back";

interface OrbState {
  el: HTMLElement;
  phase: Phase;
  x: number;
  y: number;
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  t0: number;
  dur: number;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function SoothingOrb() {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const orbs = new Map<HTMLElement, OrbState>();
    let hushUntil = 0;
    let raf = 0;

    function hush() {
      hushUntil = performance.now() + HUSH_MS;
    }
    const hushEvents = ["keydown", "pointerdown", "touchstart", "dragstart", "input", "focusin"] as const;
    for (const ev of hushEvents) window.addEventListener(ev, hush, { passive: true });

    function track(el: HTMLElement) {
      if (orbs.has(el)) return;
      orbs.set(el, {
        el,
        phase: "home",
        x: 0, y: 0,
        fromX: 0, fromY: 0,
        toX: 0, toY: 0,
        t0: performance.now() + rand(4000, 12000),
        dur: 1,
      });
    }

    function scan() {
      document.querySelectorAll<HTMLElement>(ORB_SELECTOR).forEach(track);
      // Drop orbs that left the DOM (route change) — their home will be
      // re-tracked on the next scan if it returns.
      for (const [el] of orbs) {
        if (!el.isConnected) {
          el.style.translate = "";
          orbs.delete(el);
        }
      }
    }
    scan();
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });

    function beginLeg(s: OrbState, now: number, phase: Phase, toX: number, toY: number, dur: number) {
      s.phase = phase;
      s.fromX = s.x;
      s.fromY = s.y;
      s.toX = toX;
      s.toY = toY;
      s.t0 = now;
      s.dur = dur;
    }

    function tick(now: number) {
      raf = requestAnimationFrame(tick);
      const hushed = now < hushUntil;

      for (const s of orbs.values()) {
        if (hushed && !(s.phase === "home" && s.x === 0 && s.y === 0)) {
          // The pilot is working — ease home gently and rest.
          beginLeg(s, now, "back", 0, 0, 2500);
        }

        const t = Math.min(1, (now - s.t0) / s.dur);
        const e = easeInOutCubic(t);

        switch (s.phase) {
          case "home":
            if (!hushed && now >= s.t0) {
              const ang = rand(0, Math.PI * 2);
              const r = rand(6, WANDER_RADIUS);
              beginLeg(s, now, "out", Math.cos(ang) * r, Math.sin(ang) * r, rand(LEG_MIN, LEG_MIN + LEG_JITTER));
            }
            break;
          case "out":
            s.x = s.fromX + (s.toX - s.fromX) * e;
            s.y = s.fromY + (s.toY - s.fromY) * e;
            if (t >= 1) beginLeg(s, now, "hold", s.toX, s.toY, rand(HOLD_MIN, HOLD_MIN + HOLD_JITTER));
            break;
          case "hold":
            if (t >= 1) beginLeg(s, now, "back", 0, 0, rand(LEG_MIN, LEG_MIN + LEG_JITTER));
            break;
          case "back":
            s.x = s.fromX + (s.toX - s.fromX) * e;
            s.y = s.fromY + (s.toY - s.fromY) * e;
            if (t >= 1) {
              s.x = 0;
              s.y = 0;
              s.phase = "home";
              // Rest at home before the next wander — keeps the full
              // cycle in the 20–40s band.
              s.t0 = now + rand(HOME_REST_MIN, HOME_REST_MIN + HOME_REST_JITTER);
              s.dur = 1;
            }
            break;
        }

        s.el.style.translate = `${s.x.toFixed(2)}px ${s.y.toFixed(2)}px`;
      }
    }
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      for (const ev of hushEvents) window.removeEventListener(ev, hush);
      for (const [el] of orbs) el.style.translate = "";
      orbs.clear();
    };
  }, []);

  return null;
}
