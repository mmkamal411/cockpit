"use client";

import { useEffect, useRef } from "react";
import { planetaryVista } from "./vista-sources";

/**
 * HeroVista — the opening viewport. Fills its positioned parent with the
 * live planetary vista behind the glass pane, chosen by daypart
 * (dawn / day / dusk / night). Greeting + date float over the frame —
 * calm, not a wall of cards.
 */
export function HeroVista({ pilotName }: { pilotName: string }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  const now = new Date();
  const vista = planetaryVista(now.getHours());
  const src = vista.src;
  const poster = vista.poster;

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    v.play().catch(() => {});
  }, [src]);

  const dateLine = now.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const hour = now.getHours();
  const greeting =
    hour < 5 ? "Night watch" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="pilot-vista-hero">
      <video
        ref={videoRef}
        className="pilot-vista-video"
        src={src}
        poster={poster}
        muted
        loop
        playsInline
        autoPlay
        aria-hidden="true"
      />
      <div className="pilot-vista-scrim" aria-hidden="true" />
      <div className="pilot-vista-caption">
        <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-neon-teal">
          {dateLine}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-star sm:text-4xl">
          {greeting}, {pilotName}
        </h1>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-stardust">
          Your bridge is quiet. Crystal is handling the small stuff in the
          background — and will speak up when something needs you.
        </p>
      </div>
      <style>{VISTA_CSS}</style>
    </div>
  );
}

const VISTA_CSS = `
.pilot-vista-hero {
  position: absolute;
  inset: 0;
  overflow: hidden;
}
.pilot-vista-video {
  position: absolute; inset: 0;
  width: 100%; height: 100%;
  object-fit: cover;
}
.pilot-vista-scrim {
  position: absolute; inset: 0;
  background: linear-gradient(180deg, rgb(4 7 10 / 0.35) 0%, rgb(4 7 10 / 0.05) 40%, rgb(4 7 10 / 0.78) 100%);
}
.pilot-vista-caption {
  position: absolute; z-index: 1;
  left: 24px; right: 24px; bottom: 120px;
  text-shadow: 0 2px 18px rgb(0 0 0 / 0.7);
}
@media (min-width: 640px) {
  .pilot-vista-caption { left: 48px; bottom: 132px; }
}
@media (prefers-reduced-motion: reduce) {
  .pilot-vista-video { display: none; }
}
`;
