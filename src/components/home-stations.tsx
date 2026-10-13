"use client";

import { useEffect, useState } from "react";
import {
  closeApplet,
  openApplet,
  openStationCategory,
  openStationModule,
  type AppletParams,
} from "@/lib/applet-bus";
import {
  STATION_CATEGORIES,
  getCategory,
  type StationCategory,
} from "@/lib/station-categories";
import { useCrewRoster } from "@/lib/use-crew-roster";

/* ------------------------------------------------------------------ */
/* Category glyphs — 24px line icons, one per station. Labels always    */
/* accompany them; the icon is never the only signal.                   */
/* ------------------------------------------------------------------ */

function CategoryGlyph({ id }: { id: string }) {
  const common = {
    width: 26,
    height: 26,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  } as const;
  switch (id) {
    case "my-day":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2.8v2.4M12 18.8v2.4M2.8 12h2.4M18.8 12h2.4M5.2 5.2l1.7 1.7M17.1 17.1l1.7 1.7M18.8 5.2l-1.7 1.7M6.9 17.1l-1.7 1.7" />
        </svg>
      );
    case "home-money":
      return (
        <svg {...common}>
          <path d="M3.5 11 12 4l8.5 7" />
          <path d="M5.5 9.8V19h13V9.8" />
          <circle cx="12" cy="14.2" r="2.6" />
          <path d="M12 12.9v2.6M10.8 13.6h2.4" />
        </svg>
      );
    case "go-explore":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M15.5 8.5 13.2 13.2 8.5 15.5l2.3-4.7 4.7-2.3Z" />
        </svg>
      );
    case "family-school":
      return (
        <svg {...common}>
          <path d="M4 11.5 12 5.5l8 6" />
          <path d="M6 10.3V19h12v-8.7" />
          <path d="M12 5.5V3.2M12 3.2h3.2" />
        </svg>
      );
    case "health-habits":
      return (
        <svg {...common}>
          <path d="M12 20s-7.2-4.6-7.2-10A4.1 4.1 0 0 1 12 7.4 4.1 4.1 0 0 1 19.2 10c0 5.4-7.2 10-7.2 10Z" />
          <path d="M7 12.5h2.6l1.2-2 2 3.4 1.2-1.4H17" />
        </svg>
      );
    case "messages-mail":
      return (
        <svg {...common}>
          <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
          <path d="m4.5 7.5 7.5 5.5 7.5-5.5" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
        </svg>
      );
  }
}

/* ------------------------------------------------------------------ */
/* Attention (lit) state — a button is an instrument, not decoration.   */
/* Lit = something needs the pilot's eye, with a plain-English line.   */
/* ------------------------------------------------------------------ */

interface CategoryAttention {
  lit: boolean;
  detail: string | null;
}

const DARK_ATTENTION: Record<string, CategoryAttention> = {
  "my-day": { lit: false, detail: null },
  "home-money": { lit: false, detail: null },
  "go-explore": { lit: false, detail: null },
  "family-school": { lit: false, detail: null },
  "health-habits": { lit: false, detail: null },
  "messages-mail": { lit: false, detail: null },
};

function useStationAttention(): Record<string, CategoryAttention> {
  const { members, loading: rosterLoading } = useCrewRoster();
  const [billsDue, setBillsDue] = useState<number | null>(null);
  const [belowGoal, setBelowGoal] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/bills?status=due&status=overdue&window=7");
        if (!res.ok) return;
        const json = await res.json();
        if (alive) setBillsDue(Array.isArray(json.bills) ? json.bills.length : 0);
      } catch {
        /* stays dim — the button still works, it just doesn't light up */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (rosterLoading || members.length === 0) return;
    let alive = true;
    (async () => {
      let count = 0;
      for (const m of members) {
        try {
          const res = await fetch(`/api/crew/members/${m.id}/classes`);
          if (!res.ok) continue;
          const json = await res.json();
          const classes = Array.isArray(json.classes) ? json.classes : [];
          count += classes.filter(
            (c: { gap_to_90?: number | null }) =>
              typeof c.gap_to_90 === "number" && c.gap_to_90 > 0,
          ).length;
        } catch {
          /* skip this child — one bad fetch never darkens the whole station */
        }
      }
      if (alive) setBelowGoal(count);
    })();
    return () => {
      alive = false;
    };
  }, [rosterLoading, members]);

  return {
    ...DARK_ATTENTION,
    "home-money":
      billsDue !== null && billsDue > 0
        ? { lit: true, detail: `${billsDue} bill${billsDue === 1 ? "" : "s"} due soon` }
        : DARK_ATTENTION["home-money"],
    "family-school":
      belowGoal !== null && belowGoal > 0
        ? { lit: true, detail: `${belowGoal} to lift toward 90` }
        : DARK_ATTENTION["family-school"],
  };
}

/* ------------------------------------------------------------------ */
/* The 6-button grid (3 left / 3 right). Family & School only renders   */
/* when the pilot has linked children — childless pilots see 5 buttons  */
/* and zero parenting pixels.                                          */
/* ------------------------------------------------------------------ */

function StationButton({
  category,
  attention,
}: {
  category: StationCategory;
  attention: CategoryAttention;
}) {
  const label = attention.detail
    ? `${category.label} — ${attention.detail}`
    : category.label;
  return (
    <button
      type="button"
      onClick={() => openStationCategory(category.id)}
      aria-label={label}
      data-lit={attention.lit}
      style={{ "--glow": category.glow } as React.CSSProperties}
      className="station-btn"
    >
      <span className="station-btn-icon" aria-hidden="true">
        <CategoryGlyph id={category.id} />
      </span>
      <span className="station-btn-label">{category.label}</span>
      {attention.detail && (
        <span className="station-btn-attn">{attention.detail}</span>
      )}
      <span className="station-btn-pip" data-lit={attention.lit} aria-hidden="true" />
    </button>
  );
}

export function HomeStations() {
  const { members, loading } = useCrewRoster();
  const attention = useStationAttention();
  const categories = STATION_CATEGORIES.filter(
    (c) => !c.childrenOnly || (!loading && members.length > 0),
  );

  return (
    <nav aria-label="Ship stations" className="pointer-events-auto w-full max-w-sm">
      <div className="grid grid-cols-2 gap-2.5">
        {categories.map((c) => (
          <StationButton
            key={c.id}
            category={c}
            attention={attention[c.id] ?? DARK_ATTENTION[c.id]}
          />
        ))}
      </div>
      <style>{STATIONS_CSS}</style>
    </nav>
  );
}

/* ------------------------------------------------------------------ */
/* StationCategoryOverlay — the intermediate overlay between a station  */
/* button and a module applet. Registered as the `station-category`     */
/* applet in applet-content.tsx.                                        */
/* ------------------------------------------------------------------ */

export function StationCategoryOverlay({ params }: { params: AppletParams }) {
  const category = getCategory(params.category);

  if (!category) {
    return (
      <div className="space-y-4">
        <h2 className="text-xl font-semibold text-star">That station isn&apos;t on this ship</h2>
        <p className="text-sm leading-relaxed text-stardust">
          The station you tapped doesn&apos;t exist. Nothing is broken — let&apos;s get you back to the viewport.
        </p>
        <button
          type="button"
          onClick={() => closeApplet()}
          className="rounded-xl border border-neon-teal/40 bg-neon-teal/10 px-5 py-2.5 text-sm font-medium text-neon-teal transition-colors hover:bg-neon-teal/20"
        >
          Back to Home
        </button>
      </div>
    );
  }

  const soonId = params.soon;
  const soonSub = soonId
    ? category.subcategories.find((s) => s.id === soonId)
    : undefined;

  // "Coming soon" panel — honest about what's missing, one way back.
  if (soonSub) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => openStationCategory(category.id)}
          className="flex items-center gap-1.5 text-sm text-stardust transition-colors hover:text-star"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          Back to {category.label}
        </button>
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-dim">
            {category.label}
          </p>
          <h2 className="mt-1 text-xl font-semibold text-star">{soonSub.label}</h2>
          <p className="mt-2 text-sm leading-relaxed text-stardust">
            {soonSub.soonNote ?? "This module is still being built."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => openStationCategory(category.id)}
          className="w-full rounded-xl border border-neon-teal/40 bg-neon-teal/10 px-4 py-2.5 text-sm font-medium text-neon-teal transition-colors hover:bg-neon-teal/20"
        >
          Back to {category.label}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <button
          type="button"
          onClick={() => closeApplet()}
          className="mb-3 flex items-center gap-1.5 text-sm text-stardust transition-colors hover:text-star"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M15 18l-6-6 6-6" />
          </svg>
          All stations
        </button>
        <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-dim">
          Station
        </p>
        <h2 className="mt-1 text-xl font-semibold text-star">{category.label}</h2>
        <p className="mt-1 text-sm text-stardust">
          Pick where to go — everything opens right here, nothing reloads.
        </p>
      </div>

      <ul className="space-y-2">
        {category.subcategories.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() =>
                s.appletId
                  ? openStationModule(s.appletId, s.params ?? {})
                  : openApplet(
                      "station-category",
                      { category: category.id, soon: s.id },
                      { replace: true },
                    )
              }
              aria-label={s.appletId ? `Open ${s.label}` : `${s.label} — coming soon`}
              className="flex w-full items-center justify-between gap-3 rounded-2xl border border-line bg-panel-2/60 px-4 py-3.5 text-left transition-colors hover:border-neon-teal/30"
            >
              <span>
                <span className="block text-sm font-semibold text-star">{s.label}</span>
                <span className="mt-0.5 block text-xs text-stardust">{s.blurb}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {!s.appletId && (
                  <span className="rounded-full border border-line bg-panel px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-dim">
                    Coming soon
                  </span>
                )}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-dim">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const STATIONS_CSS = `
/* Cockpit instrument button: black machined panel, neon only when lit. */
.station-btn {
  position: relative;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 5px;
  min-height: 78px; /* ≥44pt touch target, room for icon + label + attention line */
  padding: 12px 8px 10px;
  border-radius: 16px;
  color: #c3d2da;
  background: linear-gradient(180deg, #0b1116 0%, #04070a 100%);
  border: 1px solid rgb(255 255 255 / 0.09);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.08),
    inset 0 -5px 10px rgb(0 0 0 / 0.55),
    0 6px 18px rgb(0 0 0 / 0.45);
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
  transition: transform 90ms ease-out, border-color 90ms ease-out, box-shadow 90ms ease-out, color 90ms ease-out;
}
.station-btn:hover { color: #eef6fa; }
.station-btn:active { transform: translateY(1px); }
/* Lit = has attention items: the button glows in its station color. */
.station-btn[data-lit="true"] {
  color: #f2faf8;
  border-color: color-mix(in srgb, var(--glow) 55%, transparent);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.10),
    inset 0 -5px 10px rgb(0 0 0 / 0.55),
    0 0 16px color-mix(in srgb, var(--glow) 30%, transparent),
    0 0 42px color-mix(in srgb, var(--glow) 12%, transparent);
}
.station-btn-icon { color: #8fa3ae; line-height: 0; transition: color 90ms ease-out; }
.station-btn[data-lit="true"] .station-btn-icon { color: var(--glow); }
.station-btn-label {
  font-size: 13px; font-weight: 600; letter-spacing: 0.04em; line-height: 1.2;
  text-align: center;
}
.station-btn-attn {
  font-size: 11px; font-weight: 500; line-height: 1.2; text-align: center;
  color: var(--glow);
}
/* Status pip: teal-by-default would lie — only lit buttons get a pip. */
.station-btn-pip { width: 6px; height: 6px; border-radius: 9999px; background: transparent; }
.station-btn-pip[data-lit="true"] {
  background: var(--glow);
  box-shadow: 0 0 8px var(--glow);
}
@media (prefers-reduced-motion: reduce) {
  .station-btn, .station-btn-icon { transition: none; }
}
`;
