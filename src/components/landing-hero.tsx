"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { planetaryVista } from "./pilot/vista-sources";

/** LandingHero — the public face of the ship. Cosmic video, the Pookie
 *  brand, and one calm call to action. No mention of children or family —
 *  Pookie is the pilot's personal assistant, full stop. */
export function LandingHero() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const vista = planetaryVista(new Date().getHours());

  useEffect(() => {
    videoRef.current?.play().catch(() => {});
  }, [vista.src]);

  return (
    <div className="relative flex min-h-dvh flex-col overflow-hidden">
      <video
        ref={videoRef}
        className="absolute inset-0 h-full w-full object-cover"
        src={vista.src}
        poster={vista.poster}
        muted
        loop
        playsInline
        autoPlay
        aria-hidden="true"
      />
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(180deg,rgb(4_7_10/0.55)_0%,rgb(4_7_10/0.2)_45%,rgb(4_7_10/0.85)_100%)]"
      />

      <header className="relative z-10 flex items-center justify-between px-6 py-5 sm:px-10">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="landing-orb" />
          <span className="text-lg font-semibold tracking-wide text-star">Pookie</span>
        </div>
        <Link
          href="/login"
          className="rounded-full border border-line bg-white/5 px-5 py-2 text-sm font-medium text-star backdrop-blur-md transition-colors hover:border-neon-teal/50 hover:text-neon-teal"
        >
          Sign in
        </Link>
      </header>

      <main className="relative z-10 flex flex-1 flex-col items-center justify-center px-6 text-center">
        <p className="text-[11px] font-medium uppercase tracking-[0.3em] text-neon-teal">
          Your personal co-pilot
        </p>
        <h1 className="mt-4 max-w-2xl text-4xl font-semibold leading-tight tracking-tight text-star sm:text-6xl">
          Take command of your day
        </h1>
        <p className="mt-4 max-w-xl text-base leading-relaxed text-stardust sm:text-lg">
          Pookie is the calm intelligence at the center of your life — your
          schedule, your goals, your money, your health — quietly handled
          while you fly.
        </p>
        <Link
          href="/login"
          className="mt-8 rounded-full border border-neon-teal/50 bg-neon-teal/15 px-10 py-3.5 text-base font-semibold text-star shadow-[0_0_36px_rgb(94_234_212/0.25)] backdrop-blur-md transition-all hover:scale-[1.03] hover:bg-neon-teal/25"
        >
          Take command
        </Link>
        <p className="mt-4 text-xs text-dim">Free to board · 30 seconds to your bridge</p>
      </main>

      <footer className="relative z-10 px-6 pb-6 text-center text-xs text-dim sm:px-10">
        Pookie — a ball of light, watching over your day.
      </footer>
      <style>{LANDING_CSS}</style>
    </div>
  );
}

const LANDING_CSS = `
.landing-orb {
  width: 30px; height: 30px; border-radius: 9999px; display: inline-block;
  background:
    radial-gradient(circle at 34% 30%, rgb(255 255 255 / 0.9) 0%, rgb(255 255 255 / 0) 36%),
    radial-gradient(circle at 50% 55%, #d8fff4 0%, #5eead4 42%, #0e7d6c 78%, #04211c 100%);
  box-shadow: 0 0 14px rgb(94 234 212 / 0.6), 0 0 34px rgb(94 234 212 / 0.25);
}
@media (prefers-reduced-motion: reduce) {
  .landing-orb { animation: none; }
}
`;
