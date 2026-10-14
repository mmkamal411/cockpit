/**
 * Command-center sound synthesizer — Team Toolbar.
 *
 * Tiny Web Audio blips (click / open / close / alert) with zero audio
 * files. Sounds are OFF by default: the AudioContext is never created
 * until the pilot enables sound, which also keeps us safely inside
 * browser autoplay policies and is the polite default.
 *
 * Preference persists in localStorage ("crystal-cc-sound").
 */
import { useSyncExternalStore } from "react";

export type SoundKind = "click" | "open" | "close" | "alert";

const STORAGE_KEY = "crystal-cc-sound";

let audioCtx: AudioContext | null = null;
let masterGain: GainNode | null = null;
const listeners = new Set<() => void>();

/** True once the pilot has explicitly enabled sound. Defaults to false. */
export function isSoundEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSoundEnabled(on: boolean): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
  } catch {
    // Storage unavailable — sound stays off, no error surfaces.
  }
  listeners.forEach((fn) => fn());
}

export function subscribeSound(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** React binding for the sound toggle: [enabled, setEnabled]. */
export function useSoundEnabled(): [boolean, (on: boolean) => void] {
  const enabled = useSyncExternalStore(subscribeSound, isSoundEnabled, () => false);
  return [enabled, setSoundEnabled];
}

function getWebkitAudioContext(): typeof AudioContext | undefined {
  return (window as unknown as { webkitAudioContext?: typeof AudioContext })
    .webkitAudioContext;
}

/** Creates the context lazily on first enabled sound. Never before. */
function ensureCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!isSoundEnabled()) return null;
  try {
    if (!audioCtx) {
      const AC = window.AudioContext ?? getWebkitAudioContext();
      if (!AC) return null;
      audioCtx = new AC();
      masterGain = audioCtx.createGain();
      masterGain.gain.value = 0.16;
      masterGain.connect(audioCtx.destination);
    }
    if (audioCtx.state === "suspended") void audioCtx.resume();
    return audioCtx;
  } catch {
    return null;
  }
}

function tone(
  freq: number,
  startSec: number,
  durSec: number,
  type: OscillatorType = "sine",
  volume = 1,
): void {
  const ctx = ensureCtx();
  if (!ctx || !masterGain) return;
  try {
    const t0 = ctx.currentTime + startSec;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.linearRampToValueAtTime(volume, t0 + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + durSec);
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(t0);
    osc.stop(t0 + durSec + 0.05);
  } catch {
    // A failed blip must never break the UI.
  }
}

/** Fire-and-forget UI blip. No-op unless sound is enabled. */
export function playSound(kind: SoundKind): void {
  if (!isSoundEnabled()) return;
  switch (kind) {
    case "click":
      tone(880, 0, 0.07, "square", 0.5);
      break;
    case "open":
      tone(440, 0, 0.09, "sine", 0.9);
      tone(660, 0.07, 0.12, "sine", 0.9);
      break;
    case "close":
      tone(660, 0, 0.08, "sine", 0.9);
      tone(440, 0.06, 0.12, "sine", 0.9);
      break;
    case "alert":
      tone(622, 0, 0.14, "sawtooth", 0.6);
      tone(622, 0.2, 0.14, "sawtooth", 0.6);
      tone(622, 0.4, 0.22, "sawtooth", 0.6);
      break;
  }
}
