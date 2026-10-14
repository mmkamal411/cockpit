"use client";

import { useMemo, useState } from "react";
import { openApplet } from "@/lib/applet-bus";
import { STATIONS, stationsByBay, type StationDef } from "@/lib/stations";
import {
  invalidateStationPreviews,
  useStationPreview,
} from "@/lib/station-preview";

/**
 * Station deck variant: BAYS.
 *
 * Five life-domain bays. Every station is a bolted-in card with a status
 * LED — dark-quiet cockpit: everything defaults to quiet (dim green), and
 * only a station with fresh live data gets the amber pulse.
 *
 * Tap = SELECT (consequence-free, idempotent; tapping the selected station
 * again does nothing). Nothing opens on select. Opening happens only from
 * the pinned preview panel's "Open" button.
 */

function GearGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      aria-hidden="true"
      className="h-5 w-5"
    >
      <circle cx="12" cy="12" r="3.4" />
      <path d="M12 2.6v2.8M12 18.6v2.8M2.6 12h2.8M18.6 12h2.8M5.3 5.3l2 2M16.7 16.7l2 2M18.7 5.3l-2 2M7.3 16.7l-2 2" />
    </svg>
  );
}

function StationLed({ attention, glow }: { attention: boolean; glow: string }) {
  if (attention) {
    return (
      <span
        aria-hidden="true"
        className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-neon-amber shadow-[0_0_8px_2px_rgb(252_211_77/0.7)]"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="h-2 w-2 shrink-0 rounded-full bg-neon-green/50 shadow-[0_0_6px_1px_rgb(134_239_172/0.35)]"
      style={{ boxShadow: `0 0 6px 1px ${glow}55` }}
    />
  );
}

export function StationDeckBays() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [notified, setNotified] = useState<Record<string, boolean>>({});

  const selected: StationDef | null = useMemo(
    () => STATIONS.find((s) => s.id === selectedId) ?? null,
    [selectedId]
  );
  const datum = useStationPreview(selected);

  const q = query.trim().toLowerCase();
  const bays = useMemo(
    () =>
      stationsByBay()
        .map(({ bay, stations }) => ({
          bay,
          stations: q
            ? stations.filter(
                (s) =>
                  s.name.toLowerCase().includes(q) ||
                  s.blurb.toLowerCase().includes(q)
              )
            : stations,
        }))
        .filter(({ stations }) => stations.length > 0),
    [q]
  );

  const select = (s: StationDef) => {
    if (s.id === selectedId) return;
    setSelectedId(s.id);
  };

  const open = (s: StationDef) => {
    if (!s.appletId) return;
    invalidateStationPreviews(s.id);
    openApplet(s.appletId, {}, { replace: true });
  };

  const notify = (s: StationDef) =>
    setNotified((n) => ({ ...n, [s.id]: true }));

  return (
    <div className="flex min-h-full flex-col">
      {/* Hail a station — search across every bay */}
      <div className="px-4 pt-4">
        <label htmlFor="station-search" className="sr-only">
          Find a station
        </label>
        <input
          id="station-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Hail a station — search by name…"
          autoComplete="off"
          className="min-h-[48px] w-full rounded-2xl border border-line bg-panel-2/80 px-4 text-sm text-star placeholder:text-dim focus:border-white/40 focus:outline-none"
        />
      </div>

      {/* Bays */}
      <div className="flex-1 space-y-7 px-4 py-5">
        {bays.length === 0 && (
          <p className="py-10 text-center text-sm text-dim">
            No stations match “{query.trim()}” — try another word.
          </p>
        )}
        {bays.map(({ bay, stations }) => (
          <section key={bay.id} aria-labelledby={`bay-${bay.id}`}>
            <h3
              id={`bay-${bay.id}`}
              className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-dim"
            >
              {bay.name}
            </h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {stations.map((s) => {
                const isSelected = s.id === selectedId;
                const isSeedling = s.appletId === null;
                const hasFreshData = isSelected && datum !== null;
                return (
                  <div
                    key={s.id}
                    className="rounded-2xl border bg-panel-2/80 p-[3px] transition-colors"
                    style={{
                      borderColor: isSelected ? `${s.glow}66` : undefined,
                      boxShadow: isSelected
                        ? `inset 0 1px 0 rgb(255 255 255 / 0.06), 0 0 18px ${s.glow}26`
                        : `inset 0 1px 0 rgb(255 255 255 / 0.04), 0 0 10px ${s.glow}14`,
                    }}
                  >
                    <div className="rounded-[13px] bg-abyss/70">
                      <button
                        type="button"
                        onClick={() => select(s)}
                        aria-pressed={isSelected}
                        className="block min-h-[88px] w-full rounded-[13px] p-4 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
                      >
                        <span className="flex items-center gap-2">
                          <StationLed
                            attention={hasFreshData}
                            glow={s.glow}
                          />
                          <span className="text-sm font-semibold text-star">
                            {s.name}
                          </span>
                          {isSeedling && (
                            <span className="ml-auto rounded-full border border-line px-2 py-0.5 text-[10px] uppercase tracking-widest text-dim">
                              Coming soon
                            </span>
                          )}
                        </span>
                        <span className="mt-1 block text-xs leading-relaxed text-stardust">
                          {s.blurb}
                        </span>
                        {hasFreshData && (
                          <span
                            className="mt-2 block truncate text-xs"
                            style={{ color: s.glow }}
                          >
                            {datum}
                          </span>
                        )}
                      </button>
                      {isSeedling &&
                        (notified[s.id] ? (
                          <p className="px-4 pb-4 text-xs font-medium text-neon-green">
                            You&rsquo;re on the list ✓
                          </p>
                        ) : (
                          <button
                            type="button"
                            onClick={() => notify(s)}
                            className="mx-4 mb-4 block min-h-[44px] w-[calc(100%-2rem)] rounded-xl border border-line bg-panel-3 px-4 text-xs font-medium text-stardust transition-colors hover:text-star"
                          >
                            Notify me when it&rsquo;s live
                          </button>
                        ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {/* Pinned preview panel + settings footer — never scrolls away */}
      <div className="sticky bottom-0 mt-auto">
        <div className="bg-gradient-to-t from-abyss via-abyss/95 to-transparent px-4 pb-4 pt-8">
          <div
            className="rounded-2xl border border-line bg-panel-2 p-4"
            aria-live="polite"
          >
            {selected ? (
              <>
                <div className="flex items-center gap-2">
                  <StationLed
                    attention={datum !== null}
                    glow={selected.glow}
                  />
                  <p className="text-sm font-semibold text-star">
                    {selected.name}
                  </p>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-stardust">
                  {selected.blurb}
                </p>
                {datum !== null && (
                  <p
                    className="mt-2 truncate text-sm font-medium"
                    style={{ color: selected.glow }}
                  >
                    {datum}
                  </p>
                )}
                {selected.appletId ? (
                  <button
                    type="button"
                    onClick={() => open(selected)}
                    className="mt-3 block min-h-[48px] w-full rounded-xl px-4 text-sm font-semibold text-star transition-colors"
                    style={{
                      backgroundColor: `${selected.glow}26`,
                      boxShadow: `inset 0 0 0 1px ${selected.glow}66`,
                    }}
                  >
                    Open {selected.name} →
                  </button>
                ) : notified[selected.id] ? (
                  <p className="mt-3 text-sm font-medium text-neon-green">
                    You&rsquo;re on the list ✓
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={() => notify(selected)}
                    className="mt-3 block min-h-[48px] w-full rounded-xl border border-line bg-panel-3 px-4 text-sm font-medium text-stardust transition-colors hover:text-star"
                  >
                    Notify me when it&rsquo;s live
                  </button>
                )}
              </>
            ) : (
              <p className="py-2 text-center text-sm text-dim">
                Select a station to preview it.
              </p>
            )}
          </div>

          {/* Settings footer — backlit keycap */}
          <button
            type="button"
            onClick={() => openApplet("settings")}
            className="mt-3 flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl border border-line bg-panel-3 text-sm font-medium text-stardust shadow-[inset_0_1px_0_rgb(255_255_255/0.08),0_0_14px_rgb(103_232_249/0.12)] transition-colors hover:text-star"
          >
            <GearGlyph />
            Settings
          </button>
        </div>
      </div>
    </div>
  );
}
