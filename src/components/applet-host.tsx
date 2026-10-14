// AppletHost — renders temporary module applets as modal overlays floating
// in front of the pilot.
//
// Chrome: title bar with glow dot + readout + plain-English name, working
// minimize (_) and close (X). One pattern, everywhere.
//
// Behavior:
// - open: overlay fades/scales in over a dimmed cockpit; body scroll locks
// - minimize: collapses to a chip in the applet dock; content STAYS MOUNTED
//   so form state survives
// - close: unmounts, returns to the open viewport
// - Escape closes; backdrop clicks do NOT close (explicit X only —
//   a stray tap must never nuke the pilot's work)
// - links inside an applet that point at module routes open that module as
//   an applet — NO full-page navigations for modules; external links pass
//   through untouched
// - an error boundary per applet: a crashing module shows a plain-English
//   card with a way back, never a blank cockpit

"use client";

import {
  Component,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import {
  clearAppletRestored,
  closeApplet,
  minimizeApplet,
  openApplet,
  resolveAppletLink,
  restoreApplet,
  useAppletBus,
  type AppletParams,
} from "@/lib/applet-bus";
import { APPLETS, AppletContent } from "@/components/applet-content";

function MinimizeGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M5 12h14" />
    </svg>
  );
}

function CloseGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

/** Per-applet crash containment — a dying module never kills the cockpit. */
class AppletErrorBoundary extends Component<
  { label: string; children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <div className="p-1">
          <div className="rounded-2xl border border-line bg-panel-2/70 p-6 text-center">
            <p aria-hidden="true" className="text-3xl">
              🛰️
            </p>
            <p className="mt-3 text-base font-semibold text-star">Something Went Wrong</p>
            <p className="mx-auto mt-1.5 max-w-xs text-sm leading-relaxed text-stardust">
              {this.props.label} hit a rough patch and had to stop. Nothing was lost —
              close this window and try again.
            </p>
            <button
              type="button"
              onClick={() => closeApplet()}
              className="mt-4 rounded-xl border border-neon-teal/40 bg-neon-teal/10 px-5 py-2.5 text-sm font-medium text-star transition-colors hover:bg-neon-teal/20"
            >
              Close Window
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function AppletWindow({
  id,
  params,
  restored,
}: {
  id: string;
  params: AppletParams;
  restored: boolean;
}) {
  const def = APPLETS[id];
  const [phase, setPhase] = useState<"in" | "idle" | "minimizing" | "closing">("in");
  const timers = useRef<number[]>([]);
  const winRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = window.setTimeout(() => setPhase("idle"), 300);
    timers.current.push(t);
    return () => {
      timers.current.forEach((x) => window.clearTimeout(x));
      timers.current = [];
    };
  }, [id]);

  // Clear the restore-animation flag after it plays.
  useEffect(() => {
    if (!restored) return;
    const t = window.setTimeout(clearAppletRestored, 500);
    return () => window.clearTimeout(t);
  }, [restored]);

  // Escape closes the applet; focus the window on open for keyboard users.
  useEffect(() => {
    winRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setPhase((p) => (p === "idle" || p === "in" ? "closing" : p));
        const t = window.setTimeout(closeApplet, 290);
        timers.current.push(t);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [id]);

  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };

  const handleMinimize = () => {
    if (phase !== "idle" && phase !== "in") return;
    setPhase("minimizing");
    later(minimizeApplet, 290);
  };

  const handleClose = () => {
    if (phase !== "idle" && phase !== "in") return;
    setPhase("closing");
    later(closeApplet, 290);
  };

  // In-applet link interception — module routes open as applets, never
  // as full-page navigations. External / new-tab links pass through.
  const onBodyClickCapture = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    const el = e.target as HTMLElement;
    const anchor = el.closest("a[href]");
    if (!anchor || !(anchor instanceof HTMLAnchorElement)) return;
    if (anchor.target && anchor.target !== "_self") return;
    const target = resolveAppletLink(anchor.getAttribute("href") ?? "");
    if (!target) return;
    e.preventDefault();
    openApplet(target.id, target.params, { replace: true });
  }, []);

  if (!def) return null;

  const phaseClass =
    phase === "in"
      ? "applet-entering"
      : phase === "minimizing"
        ? "modwin-minimizing"
        : phase === "closing"
          ? "modwin-closing"
          : restored
            ? "modwin-restored"
            : "";

  return (
    <div className="applet-backdrop" data-testid={`applet-${id}`}>
      <div
        ref={winRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={def.name}
        className={`applet-window modwin ${phaseClass}`}
        style={{ "--modwin-glow": def.glow } as CSSProperties}
      >
        <div className="modwin-titlebar" role="heading" aria-level={1}>
          <span className="modwin-dot" aria-hidden="true" />
          <span className="modwin-readout" aria-hidden="true">
            {def.readout}
          </span>
          <span className="modwin-name">{def.name}</span>
          <button
            type="button"
            className="modwin-btn"
            onClick={handleMinimize}
            aria-label={`Minimize ${def.name} — stow the window and view space`}
            title="Minimize"
          >
            <MinimizeGlyph />
          </button>
          <button
            type="button"
            className="modwin-btn"
            onClick={handleClose}
            aria-label={`Close ${def.name} — return to the open viewport`}
            title="Close"
          >
            <CloseGlyph />
          </button>
        </div>
        <div className="applet-scroll" onClickCapture={onBodyClickCapture}>
          <div className="modwin-body">
            <AppletErrorBoundary label={def.name}>
              <AppletContent id={id} params={params} />
            </AppletErrorBoundary>
          </div>
        </div>
      </div>
    </div>
  );
}

export function AppletHost() {
  const { open, minimized, justRestored } = useAppletBus();

  // Body scroll lock while any applet is open.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open && minimized.length === 0) return null;

  return (
    <>
      <style>{APPLET_CSS}</style>
      {/* Stowed applets stay mounted (hidden) so their state survives. */}
      {minimized.map((m) => {
        const def = APPLETS[m.id];
        if (!def) return null;
        return (
          <div key={m.id} hidden aria-hidden="true" style={{ display: "none" }}>
            <AppletErrorBoundary label={def.name}>
              <AppletContent id={m.id} params={m.params} />
            </AppletErrorBoundary>
          </div>
        );
      })}
      {open && (
        <AppletWindow
          key={open.id}
          id={open.id}
          params={open.params}
          restored={justRestored === open.id}
        />
      )}
      {/* Minimized-applet dock — chips stacked above the toolbar. */}
      {minimized.length > 0 && (
        <div className="applet-dock" role="toolbar" aria-label="Minimized applets — tap to restore">
          {minimized.map((m) => {
            const def = APPLETS[m.id];
            if (!def) return null;
            return (
              <button
                key={m.id}
                type="button"
                className="modwin-chip"
                style={{ "--modwin-glow": def.glow } as CSSProperties}
                onClick={() => restoreApplet(m.id)}
                aria-label={`Restore ${def.name}`}
              >
                <span className="modwin-dot" aria-hidden="true" />
                <span>{def.name}</span>
                <span className="modwin-chip-hint" aria-hidden="true">
                  tap to open
                </span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}

/**
 * Self-contained applet chrome CSS. Dark cockpit panels (#05080a–#141a1f)
 * with a per-applet neon glow — no navy, no gray panels. No globals.css
 * edits needed.
 */
const APPLET_CSS = `
.applet-backdrop {
  position: fixed; inset: 0; z-index: 90;
  display: flex; align-items: center; justify-content: center;
  padding: max(16px, env(safe-area-inset-top)) 16px calc(16px + env(safe-area-inset-bottom));
  background: rgb(4 7 10 / 0.62);
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
  animation: applet-backdrop-in 200ms ease;
}
.applet-window {
  width: 100%; max-width: 880px;
  max-height: min(88dvh, 920px);
  display: flex; flex-direction: column; overflow: hidden;
  border-radius: 18px;
  border: 1px solid rgb(255 255 255 / 0.12);
  background: linear-gradient(180deg, #0b1116 0%, #05080a 100%);
  box-shadow: 0 24px 80px rgb(0 0 0 / 0.6), 0 0 44px color-mix(in srgb, var(--modwin-glow) 18%, transparent);
  outline: none;
}
.modwin-titlebar {
  display: flex; align-items: center; gap: 10px;
  padding: 12px 8px 12px 16px;
  border-bottom: 1px solid rgb(255 255 255 / 0.08);
  background: rgb(255 255 255 / 0.02);
  flex-shrink: 0;
}
.modwin-dot {
  width: 9px; height: 9px; border-radius: 9999px; flex-shrink: 0;
  background: var(--modwin-glow);
  box-shadow: 0 0 10px var(--modwin-glow), 0 0 22px color-mix(in srgb, var(--modwin-glow) 60%, transparent);
  animation: modwin-pulse 3.2s ease-in-out infinite;
}
.modwin-readout {
  font-family: var(--font-geist-mono), ui-monospace, monospace;
  font-size: 10px; letter-spacing: 0.22em;
  color: color-mix(in srgb, var(--modwin-glow) 80%, white);
  opacity: 0.85;
}
.modwin-name {
  flex: 1; text-align: center;
  font-size: 14px; font-weight: 600; letter-spacing: 0.04em;
  color: #eef6fa;
}
.modwin-btn {
  display: flex; align-items: center; justify-content: center;
  width: 34px; height: 34px; border-radius: 10px;
  color: #a7bcc7; background: transparent; border: none; cursor: pointer;
  transition: background 150ms ease, color 150ms ease;
}
.modwin-btn:hover { background: rgb(255 255 255 / 0.08); color: #eef6fa; }
.modwin-body { padding: 4px 2px; }
.applet-entering { animation: applet-in 300ms cubic-bezier(0.2, 0.9, 0.3, 1.08); }
.modwin-minimizing { animation: applet-out-down 290ms ease-in forwards; }
.modwin-closing { animation: applet-out 290ms ease-in forwards; }
.modwin-restored { animation: applet-in 280ms cubic-bezier(0.2, 0.9, 0.3, 1.08); }
.applet-scroll {
  overflow-y: auto; overscroll-behavior: contain;
  padding: 16px 16px 20px;
  -webkit-overflow-scrolling: touch;
}
.applet-dock {
  position: fixed; left: 0; right: 0; z-index: 90;
  bottom: calc(120px + env(safe-area-inset-bottom));
  display: flex; justify-content: center; gap: 8px;
  padding: 0 16px; pointer-events: none;
  max-width: 100vw; overflow-x: auto; scrollbar-width: none;
}
.applet-dock::-webkit-scrollbar { display: none; }
.modwin-chip {
  pointer-events: auto;
  display: flex; align-items: center; gap: 8px;
  padding: 8px 14px; border-radius: 9999px;
  border: 1px solid rgb(255 255 255 / 0.14);
  background: rgb(11 17 22 / 0.92); color: #eef6fa;
  font-size: 13px; font-weight: 500; cursor: pointer;
  box-shadow: 0 8px 28px rgb(0 0 0 / 0.5), 0 0 18px color-mix(in srgb, var(--modwin-glow) 22%, transparent);
  backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
  transition: transform 150ms ease;
}
.modwin-chip:hover { transform: translateY(-2px); }
.modwin-chip .modwin-dot { width: 7px; height: 7px; animation: none; }
.modwin-chip-hint { font-size: 11px; color: #6f8894; }
@keyframes applet-in {
  from { opacity: 0; transform: scale(0.94) translateY(18px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}
@keyframes applet-out {
  to { opacity: 0; transform: scale(0.96) translateY(10px); }
}
@keyframes applet-out-down {
  to { opacity: 0; transform: scale(0.9) translateY(120px); }
}
@keyframes applet-backdrop-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes modwin-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}
@media (prefers-reduced-motion: reduce) {
  .applet-backdrop, .applet-entering, .modwin-minimizing,
  .modwin-closing, .modwin-restored, .modwin-dot { animation: none !important; }
}
`;
