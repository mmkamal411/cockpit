"use client";

import { useEffect, useState } from "react";
import { openApplet } from "@/lib/applet-bus";
import { STATION_DECK_VARIANT } from "@/lib/feature-flags";
import { StationDeckBays } from "./station-deck-bays";
import { StationDeckEcam } from "./station-deck-ecam";
import { StationDeckGrid } from "./station-deck-grid";

interface CrewMember {
  id: string;
  name: string;
  relationship?: string | null;
}

interface Seedling {
  name: string;
  blurb: string;
  glow: string;
  /** When set, tapping the seedling opens this applet instead of sitting idle. */
  appletId?: string;
}

// Stations still being built — seedlings, not dead ends. Each one says what
// it will do, so the full ship is visible from the first tap.
const SEEDLINGS: Seedling[] = [
  { name: "Health", blurb: "Sleep, movement, and how your body is really doing.", glow: "#86efac", appletId: "health" },
  { name: "Money", blurb: "Bills, spending, and the quiet leaks in your budget.", glow: "#fcd34d", appletId: "bills" },
  { name: "Mail", blurb: "Every inbox, triaged — the important stuff floats up.", glow: "#67e8f9" },
  { name: "Shopping", blurb: "Lists that notice when you're running low.", glow: "#5eead4", appletId: "shopping" },
  { name: "Travel", blurb: "Flights, stays, and trips that plan themselves.", glow: "#c4b5fd" },
  { name: "Learn", blurb: "Skills and courses, one calm session at a time.", glow: "#67e8f9" },
];

/** More — every station on the ship, plus the opt-in Crew section. */
export function MoreApplet() {
  switch (STATION_DECK_VARIANT) {
    case "bays":
      return <StationDeckBays />;
    case "ecam":
      return <StationDeckEcam />;
    case "grid":
      return <StationDeckGrid />;
    case "legacy":
    default:
      return <MoreAppletLegacy />;
  }
}

/** The original More list — preserved untouched as the instant-revert target. */
function MoreAppletLegacy() {
  const [crew, setCrew] = useState<CrewMember[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/crew/members");
        if (res.status === 401) return;
        const json = await res.json();
        if (res.ok && !cancelled) setCrew(json.members ?? []);
      } catch {
        // Leave crew empty; the onboarding prompt stays.
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-7">
      <div>
        <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-neon-amber">All stations</p>
        <h2 className="mt-1 text-xl font-semibold text-star">More</h2>
        <p className="mt-1 text-sm text-stardust">
          Everything else on the ship. Tap a station to visit it.
        </p>
      </div>

      <section aria-labelledby="more-core">
        <h3 id="more-core" className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-dim">
          Core stations
        </h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {[
            { id: "today", name: "Today", blurb: "Your attention, right now." },
            { id: "crystal", name: "Crystal", blurb: "Your AI co-pilot." },
            { id: "progress", name: "Progress", blurb: "Your goals, your momentum." },
          ].map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => openApplet(s.id, {}, { replace: true })}
              className="rounded-2xl border border-line bg-panel-2/60 p-4 text-left transition-colors hover:border-neon-amber/40"
            >
              <p className="text-sm font-semibold text-star">{s.name}</p>
              <p className="mt-0.5 text-xs text-stardust">{s.blurb}</p>
            </button>
          ))}
        </div>
      </section>

      <section aria-labelledby="more-crew">
        <h3 id="more-crew" className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-dim">
          Crew
        </h3>
        <div className="rounded-2xl border border-neon-green/25 bg-panel-2/60 p-4">
          {crew.length > 0 ? (
            <>
              <p className="text-sm font-semibold text-star">Your crew is aboard.</p>
              <ul className="mt-3 space-y-1.5">
                {crew.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => openApplet("school", { memberId: m.id }, { replace: true })}
                      className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-stardust transition-colors hover:bg-panel"
                      aria-label={`View ${m.name}'s school overview`}
                    >
                      <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-neon-green" />
                      <span className="text-base font-medium text-star">{m.name}</span>
                      {m.relationship && (
                        <span className="text-xs text-dim">· {m.relationship}</span>
                      )}
                      <span className="ml-auto rounded-full bg-neon-cyan/10 px-2 py-0.5 text-[11px] text-neon-cyan ring-1 ring-neon-cyan/30">
                        School
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => openApplet("crew", {}, { replace: true })}
                className="mt-3 rounded-xl border border-line px-4 py-2 text-sm text-stardust transition-colors hover:border-neon-green/40 hover:text-star"
              >
                Add another child
              </button>
            </>
          ) : (
            <>
              <p className="text-sm font-semibold text-star">Family aboard? Add your crew.</p>
              <p className="mt-1 text-xs leading-relaxed text-stardust">
                Crystal is yours first. If you&apos;d like, bring children aboard and
                Crystal will help watch over their school life too — grades,
                homework, and the gentle nudges.
              </p>
              <button
                type="button"
                onClick={() => openApplet("crew", {}, { replace: true })}
                className="mt-3 rounded-xl border border-neon-green/40 bg-neon-green/10 px-4 py-2 text-sm font-medium text-neon-green transition-colors hover:bg-neon-green/20"
              >
                Add a child
              </button>
            </>
          )}
        </div>
      </section>

      <section aria-labelledby="more-seedlings">
        <h3 id="more-seedlings" className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-dim">
          Taking shape
        </h3>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {SEEDLINGS.map((s) => {
            const inner = (
              <>
                <p className="flex items-center gap-2 text-sm font-semibold text-star">
                  <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ background: s.glow }} />
                  {s.name}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed text-stardust">{s.blurb}</p>
                <p className="mt-2 text-[11px] uppercase tracking-[0.18em] text-dim">
                  {s.appletId ? "Live · tap to open" : "Seedling · growing soon"}
                </p>
              </>
            );
            const cls =
              "rounded-2xl border border-line bg-panel-2/40 p-4 text-left w-full transition-colors";
            const style = { boxShadow: `inset 0 0 24px ${s.glow}0d` };
            return s.appletId ? (
              <button
                key={s.name}
                type="button"
                onClick={() => openApplet(s.appletId!, {}, { replace: true })}
                className={cls + " hover:border-neon-amber/40 cursor-pointer"}
                style={style}
              >
                {inner}
              </button>
            ) : (
              <div key={s.name} className={cls} style={style}>
                {inner}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
