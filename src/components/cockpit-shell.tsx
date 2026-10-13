"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { planetaryVista } from "@/components/pilot/vista-sources";
import { SoothingOrb } from "@/components/pilot/soothing-orb";
import { Toolbar } from "@/components/toolbar";
import { AppletHost } from "@/components/applet-host";

/**
 * CockpitShell — the dark cockpit frame rendered by the root layout.
 *
 * - Video background layer (per route; /home brings its own daypart vista)
 * - Black-hole transit veil on route changes
 * - Persistent toolbar with the centered Crystal orb
 * - SoothingOrb drift controller
 * - AppletHost for temporary module windows
 *
 * Shell chrome (toolbar / orb / applets) only appears inside the ship —
 * never on the public landing or login pages.
 */

function backgroundFor(pathname: string): string | null {
  if (pathname === "/" || pathname === "/home") return null;
  // Login + everything else: a calm cosmic drift behind the glass.
  return "/videos/vista-planets-1.mp4";
}

function BackgroundVideo({ src }: { src: string | null }) {
  if (!src) return null;
  return (
    <div aria-hidden="true" className="fixed inset-0 -z-10 overflow-hidden bg-abyss">
      <video
        key={src}
        className="h-full w-full object-cover"
        src={src}
        muted
        loop
        playsInline
        autoPlay
      />
      <div className="absolute inset-0 bg-[linear-gradient(180deg,rgb(4_7_10/0.45)_0%,rgb(4_7_10/0.15)_50%,rgb(4_7_10/0.6)_100%)]" />
    </div>
  );
}

/** Black-hole transit — a brief dark veil when the pilot changes pages. */
function TransitVeil() {
  const pathname = usePathname();
  const [visible, setVisible] = useState(false);
  const first = useRef(true);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setVisible(true);
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setVisible(false), 650);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [pathname]);

  if (!visible) return null;
  return (
    <div aria-hidden="true" className="transit-veil">
      <style>{TRANSIT_CSS}</style>
    </div>
  );
}

const TRANSIT_CSS = `
.transit-veil {
  position: fixed; inset: 0; z-index: 120; pointer-events: none;
  background: radial-gradient(ellipse at center, rgb(0 0 0 / 0.25) 0%, rgb(2 4 7 / 0.88) 62%, #000 100%);
  animation: transit-pass 650ms ease-in-out forwards;
}
@keyframes transit-pass {
  0% { opacity: 0; }
  35% { opacity: 1; }
  100% { opacity: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .transit-veil { animation: none; opacity: 0; }
}
`;

export function CockpitShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const inShip = pathname === "/home" || pathname.startsWith("/home/");
  const bg = backgroundFor(pathname);

  // Precompute the home vista poster for the daypart after mount (client
  // only — reading the clock during prerender is forbidden) so the opening
  // frame is ready on arrival.
  const [homePoster, setHomePoster] = useState<string | null>(null);
  useEffect(() => {
    setHomePoster(planetaryVista(new Date().getHours()).src.replace(".mp4", "-poster.jpg"));
  }, []);

  return (
    <>
      <BackgroundVideo src={bg} />
      {homePoster && !inShip && <link rel="preload" as="image" href={homePoster} />}
      <TransitVeil />
      <div className="relative z-0 min-h-dvh">{children}</div>
      {inShip && (
        <>
          <SoothingOrb />
          <AppletHost />
          <Toolbar />
        </>
      )}
    </>
  );
}
