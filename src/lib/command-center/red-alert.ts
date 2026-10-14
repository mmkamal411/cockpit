/**
 * Red Alert (DEFCON 1) state — Team Toolbar.
 *
 * Module-level store so ANY component can raise/lower the alert without a
 * React tree dependency:
 *
 *   import { setRedAlert } from "@/lib/command-center/red-alert";
 *   setRedAlert(true);   // toolbar shifts to red-alert styling + alert sound
 *   setRedAlert(false);  // back to normal
 *
 * The toolbar's `useRedAlert()` hook subscribes to changes. The alert sound
 * only plays if the pilot has enabled sound (polite default: off).
 *
 * Auto-trigger: `startUrgentNudgeWatch()` polls for high-score pending
 * nudges and raises the alert when one appears. It deliberately waits
 * before its first check so Red Alert never fires on page load.
 */
import { useSyncExternalStore } from "react";
import { isSoundEnabled, playSound } from "./sound";

let redAlert = false;
const listeners = new Set<(on: boolean) => void>();

/** Raise (true) or stand down (false) Red Alert. No-op if unchanged. */
export function setRedAlert(on: boolean): void {
  if (redAlert === on) return;
  redAlert = on;
  listeners.forEach((fn) => fn(on));
  if (on && isSoundEnabled()) playSound("alert");
}

/** Current Red Alert state. */
export function isRedAlert(): boolean {
  return redAlert;
}

export function subscribeRedAlert(fn: (on: boolean) => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** React binding for the current Red Alert state. */
export function useRedAlert(): boolean {
  return useSyncExternalStore(subscribeRedAlert, isRedAlert, () => false);
}

interface PendingNudge {
  id: string;
  score?: number | null;
}

/** Nudges at/above this score count as urgent enough for Red Alert. */
const URGENT_SCORE = 80;

/**
 * Starts the urgent-nudge watchdog. Polls /api/nudges for pending nudges
 * and raises Red Alert when one scores at/above URGENT_SCORE. It only ever
 * turns the alert ON — standing down stays a deliberate human action.
 * Returns a stop function.
 */
export function startUrgentNudgeWatch(options?: {
  intervalMs?: number;
  firstDelayMs?: number;
}): () => void {
  if (typeof window === "undefined") return () => undefined;
  const intervalMs = options?.intervalMs ?? 60_000;
  const firstDelayMs = options?.firstDelayMs ?? 45_000;
  let stopped = false;

  async function check(): Promise<void> {
    if (stopped || isRedAlert()) return;
    try {
      const res = await fetch("/api/nudges?status=pending", {
        credentials: "same-origin",
      });
      if (!res.ok) return;
      const json = (await res.json()) as { nudges?: PendingNudge[] };
      const urgent = (json.nudges ?? []).some(
        (n) => Number(n.score ?? 0) >= URGENT_SCORE,
      );
      if (urgent) setRedAlert(true);
    } catch {
      // Watchdog failures stay silent — they must never break the toolbar.
    }
  }

  const first = window.setTimeout(() => {
    void check();
  }, firstDelayMs);
  const timer = window.setInterval(() => {
    void check();
  }, intervalMs);
  return () => {
    stopped = true;
    window.clearTimeout(first);
    window.clearInterval(timer);
  };
}
