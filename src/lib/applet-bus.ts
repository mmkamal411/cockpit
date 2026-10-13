// Applet bus — the ship's temporary-applet dispatcher (2026-10-12).
//
// Every module opens as a TEMPORARY APPLET — a modal overlay floating in
// front of the pilot — with minimize + close, and NO full-page navigations
// for modules. The pilot is the user; every module is pilot-level, so there
// is no child/crew scoping anywhere in this bus.
//
// State model:
//   open:      the currently-visible applet { id, params } (one at a time)
//   minimized: stowed applets [{ id, params }] in minimize order — content
//              stays mounted in the host, so form state survives
//   justRestored: drives the restore animation, then clears

import { useSyncExternalStore } from "react";

export type AppletParams = Record<string, string>;

export interface OpenApplet {
  id: string;
  params: AppletParams;
}

interface AppletBusState {
  open: OpenApplet | null;
  minimized: OpenApplet[];
  justRestored: string | null;
}

const EMPTY: AppletBusState = { open: null, minimized: [], justRestored: null };

let state: AppletBusState = EMPTY;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function getSnapshot(): AppletBusState {
  return state;
}

/** React subscription for the applet host. */
export function useAppletBus(): AppletBusState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export interface OpenOptions {
  /**
   * Replace the currently-open applet instead of stowing it. Used for
   * in-applet sub-navigation (station-category → module, category overlay →
   * "coming soon" panel, class drill-downs) so the minimized dock doesn't
   * accumulate stepping stones.
   */
  replace?: boolean;
}

/**
 * Open an applet. A currently-open applet is stowed (minimized) first —
 * the pilot never loses work by tapping a second module.
 */
export function openApplet(id: string, params: AppletParams = {}, opts: OpenOptions = {}): void {
  const next: OpenApplet = { id, params };
  const stowed = state.open && !opts.replace ? [...state.minimized, { ...state.open }] : state.minimized;
  // The opened applet can never also sit minimized — one instance, one state.
  const minimized = stowed.filter((m) => m.id !== id);
  state = { open: next, minimized, justRestored: null };
  emit();
}

/** Close the open applet (unmounts its content). */
export function closeApplet(): void {
  if (!state.open) return;
  state = { open: null, minimized: state.minimized, justRestored: null };
  emit();
}

/** Close every applet — the path back to the open viewport. */
export function closeAllApplets(): void {
  if (!state.open && state.minimized.length === 0) return;
  state = EMPTY;
  emit();
}

/** Minimize the open applet — stowed as a chip, content stays mounted. */
export function minimizeApplet(): void {
  if (!state.open) return;
  const cur = state.open;
  state = {
    open: null,
    minimized: state.minimized.some((m) => m.id === cur.id)
      ? state.minimized
      : [...state.minimized, cur],
    justRestored: null,
  };
  emit();
}

/** Restore a minimized applet to the foreground. */
export function restoreApplet(id: string): void {
  const found = state.minimized.find((m) => m.id === id);
  if (!found) return;
  const open = state.open;
  const minimized =
    open && open.id !== id
      ? [...state.minimized.filter((m) => m.id !== id && m.id !== open.id), { ...open }]
      : state.minimized.filter((m) => m.id !== id);
  state = { open: { ...found }, minimized, justRestored: id };
  emit();
}

/** Clear the restore-animation flag after it plays. */
export function clearAppletRestored(): void {
  if (!state.justRestored) return;
  state = { ...state, justRestored: null };
  emit();
}

// ---------------------------------------------------------------------------
// Station-category flow — the home-station button → subcategory → applet path.
//
// A home station button opens the intermediate subcategory overlay
// (`station-category` applet); a subcategory tap opens its target module
// with `replace` so the overlay never clogs the minimized dock. Subcategories
// whose module isn't built yet stay inside the overlay as an honest
// "coming soon" panel — never a blank page, never a dead end.
// ---------------------------------------------------------------------------

/** Open a station's subcategory overlay (the intermediate step). */
export function openStationCategory(categoryId: string): void {
  openApplet("station-category", { category: categoryId });
}

/** Open a module from a subcategory tap, replacing the overlay. */
export function openStationModule(id: string, params: AppletParams = {}): void {
  openApplet(id, params, { replace: true });
}

// ---------------------------------------------------------------------------
// In-applet link interception — links inside an applet that point at a module
// route open that module as an applet instead of navigating the page.
// External links, anchors, mailto/tel pass through untouched.
// ---------------------------------------------------------------------------

export interface AppletLinkTarget {
  id: string;
  params: AppletParams;
}

/** Pilot-level module routes that open as applets instead of navigating. */
const MODULE_ROUTES: Record<string, string> = {
  "/today": "today",
  "/crystal": "crystal",
  "/progress": "progress",
  "/school": "school",
  "/crew": "crew",
};

/**
 * Map an href (as written in module markup) to an applet target.
 * Returns null for external links, anchors, and routes that must keep
 * navigating (landing, login, home).
 */
export function resolveAppletLink(href: string): AppletLinkTarget | null {
  if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
    return null;
  }
  let url: URL;
  try {
    url = new URL(href, "https://applet.local");
  } catch {
    return null;
  }
  // External — never intercept, let the browser handle it.
  if (url.origin !== "https://applet.local") return null;
  const id = MODULE_ROUTES[url.pathname];
  if (!id) return null;
  return { id, params: {} };
}
