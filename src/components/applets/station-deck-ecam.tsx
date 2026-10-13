"use client";

import { useEffect, useMemo, useState } from "react";
import { openApplet } from "@/lib/applet-bus";
import { BAYS, STATIONS, type BayId, type StationDef } from "@/lib/stations";
import { useStationPreview } from "@/lib/station-preview";

interface Phase {
  /** Plain-language label — grandmother test. */
  label: string;
  stationIds: string[];
}

/**
 * Phase-aware emphasis is subtle by design: the listed stations get a
 * brighter LED + sort-to-top inside the synoptic area. Bays are never
 * reordered, stations are never hidden.
 */
function phaseForHour(hour: number): Phase {
  if (hour >= 5 && hour < 12) return { label: "Morning flow", stationIds: ["calendar", "weather"] };
  if (hour >= 12 && hour < 18) return { label: "Midday flow", stationIds: ["todos", "reminders"] };
  return { label: "Evening flow", stationIds: ["health", "family"] };
}

/** Small round LED with a soft neon bloom. */
function Led({ color, bright, label }: { color: string; bright: boolean; label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      className="inline-block h-2 w-2 shrink-0 rounded-full transition-all"
      style={{
        backgroundColor: color,
        opacity: bright ? 1 : 0.3,
        boxShadow: bright ? `0 0 8px 2px ${color}` : "none",
      }}
    />
  );
}

function isSeedling(station: StationDef): boolean {
  return station.appletId === null;
}

/**
 * ECAM variant of the station deck: an aviation systems panel for the ship.
 *
 * Top: one category key per bay with a status LED. Middle: the synoptic
 * area showing the selected bay's stations as bezeled cards. Bottom: a
 * pinned preview panel (never scrolls away) plus a pinned Settings keycap.
 * Tapping a station only SELECTS it — opening happens only from the
 * preview panel's Open button.
 */
export function StationDeckEcam() {
  const [bayId, setBayId] = useState<BayId>("you");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [notified, setNotified] = useState<Set<string>>(new Set());
  const [hour, setHour] = useState<number | null>(null);

  useEffect(() => {
    setHour(new Date().getHours());
  }, []);

  const phase = useMemo(() => (hour === null ? null : phaseForHour(hour)), [hour]);
  const isEmphasized = (s: StationDef) => phase?.stationIds.includes(s.id) ?? false;

  const selected = useMemo(
    () => STATIONS.find((s) => s.id === selectedId) ?? null,
    [selectedId],
  );
  const liveDatum = useStationPreview(selected);

  const bayStations = useMemo(() => {
    const list = STATIONS.filter((s) => s.bay === bayId);
    if (!phase) return list;
    // Phase-emphasized stations sort to top; everything else keeps its order.
    return [...list].sort(
      (a, b) =>
        (phase.stationIds.includes(b.id) ? 1 : 0) - (phase.stationIds.includes(a.id) ? 1 : 0),
    );
  }, [bayId, phase]);

  const bayOf = useMemo(
    () => new Map(BAYS.map((b) => [b.id, b.name])),
    [],
  );

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return STATIONS.filter(
      (s) => s.name.toLowerCase().includes(q) || s.blurb.toLowerCase().includes(q),
    ).slice(0, 8);
  }, [query]);

  const selectStation = (s: StationDef) => {
    setSelectedId(s.id);
  };

  const pickSearchResult = (s: StationDef) => {
    setBayId(s.bay);
    setSelectedId(s.id);
    setQuery("");
  };

  const notifySeedling = (s: StationDef) => {
    setNotified((prev) => new Set(prev).add(s.id));
  };

  const openSelected = () => {
    if (selected?.appletId) openApplet(selected.appletId, {}, { replace: true });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-black">
      {/* Panel header */}
      <div className="shrink-0 px-4 pt-4">
        <p className="text-[11px] font-medium uppercase tracking-[0.25em] text-neon-cyan">
          Systems
        </p>
        <h2 className="mt-1 text-xl font-semibold text-star">Station Deck</h2>
        <p className="mt-1 text-sm text-stardust">Pick a section, then a station to preview it.</p>

        {/* Hail a station — searches every station on the ship */}
        <div className="relative mt-3">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Hail a station — search by name"
            aria-label="Hail a station: search all stations"
            className="h-11 w-full rounded-xl border border-line bg-panel-2 px-4 text-sm text-star placeholder:text-dim focus:border-neon-cyan/60 focus:outline-none"
          />
          {searchResults.length > 0 && (
            <ul
              role="listbox"
              aria-label="Station search results"
              className="absolute inset-x-0 top-full z-20 mt-1 overflow-hidden rounded-xl border border-line bg-panel-2 shadow-2xl"
            >
              {searchResults.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={selectedId === s.id}
                    onClick={() => pickSearchResult(s)}
                    className="flex min-h-[44px] w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-panel-3"
                  >
                    <Led
                      color={s.glow}
                      bright={!isSeedling(s)}
                      label={isSeedling(s) ? "Not live yet" : "Live"}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium text-star">{s.name}</span>
                      <span className="block truncate text-xs text-dim">
                        {bayOf.get(s.bay)}
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Category keys — one per bay */}
        <div
          role="tablist"
          aria-label="Station sections"
          className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1"
        >
          {BAYS.map((bay) => {
            const active = bay.id === bayId;
            const holdsEmphasis = STATIONS.some((s) => s.bay === bay.id && isEmphasized(s));
            const ledColor = active ? "#67e8f9" : holdsEmphasis ? "#fcd34d" : "#6f8894";
            return (
              <button
                key={bay.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setBayId(bay.id)}
                className={`flex min-h-[44px] shrink-0 items-center gap-2 rounded-xl border px-4 text-sm font-medium transition-colors ${
                  active
                    ? "border-neon-cyan/60 bg-panel-2 text-star"
                    : "border-line bg-panel text-stardust hover:border-neon-cyan/30"
                }`}
              >
                <Led
                  color={ledColor}
                  bright={active || holdsEmphasis}
                  label={active ? `${bay.name} selected` : holdsEmphasis ? `${bay.name} has highlighted stations` : bay.name}
                />
                {bay.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Synoptic area — the selected bay's stations */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-3">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-dim">
            {BAYS.find((b) => b.id === bayId)?.name}
          </h3>
          {phase && (
            <span className="text-xs text-dim">
              <span className="text-neon-amber">●</span> {phase.label}
            </span>
          )}
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {bayStations.map((s) => {
            const isSelected = s.id === selectedId;
            const emphasized = isEmphasized(s);
            const seedling = isSeedling(s);
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={isSelected}
                onClick={() => selectStation(s)}
                className={`min-h-[44px] rounded-xl border bg-black p-3 text-left transition-all ${
                  isSelected
                    ? "border-neon-cyan/70"
                    : emphasized
                      ? "border-neon-amber/40"
                      : "border-line hover:border-white/25"
                }`}
                style={
                  isSelected
                    ? { boxShadow: `0 0 12px 0 ${s.glow}55, inset 0 0 18px 0 ${s.glow}11` }
                    : emphasized
                      ? { boxShadow: `0 0 8px 0 ${s.glow}33` }
                      : undefined
                }
              >
                <span className="flex items-center gap-2">
                  <Led
                    color={seedling ? "#6f8894" : s.glow}
                    bright={!seedling || isSelected}
                    label={
                      seedling
                        ? `${s.name} — not live yet`
                        : `${s.name} — ${isSelected ? "selected" : "live"}`
                    }
                  />
                  <span className="flex-1 truncate text-sm font-semibold text-star">
                    {s.name}
                  </span>
                  {emphasized && (
                    <span className="text-[10px] font-medium uppercase tracking-widest text-neon-amber">
                      Up first
                    </span>
                  )}
                </span>
                <span className="mt-1 block text-sm text-stardust">{s.blurb}</span>
                <span className="mt-1.5 block min-h-[1.25rem] text-xs text-dim">
                  {isSelected
                    ? (liveDatum ?? (seedling ? "Not live yet — coming soon." : "Checking the latest…"))
                    : seedling
                      ? "Not live yet — coming soon."
                      : "Tap to preview"}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Pinned preview panel — never scrolls away */}
      <div className="shrink-0 border-t border-line bg-panel-2 px-4 py-3">
        {selected ? (
          <div className="flex items-center gap-3">
            <Led
              color={isSeedling(selected) ? "#6f8894" : selected.glow}
              bright
              label={selected.name}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-star">{selected.name}</p>
              <p className="truncate text-xs text-stardust">
                {liveDatum ?? selected.blurb}
              </p>
            </div>
            {isSeedling(selected) ? (
              notified.has(selected.id) ? (
                <span className="flex min-h-[48px] items-center rounded-xl border border-neon-green/40 px-4 text-sm font-medium text-neon-green">
                  You&rsquo;re on the list ✓
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => notifySeedling(selected)}
                  className="min-h-[48px] shrink-0 rounded-xl border border-neon-amber/50 px-4 text-sm font-medium text-neon-amber transition-colors hover:bg-neon-amber/10"
                >
                  Notify me when it&rsquo;s live
                </button>
              )
            ) : (
              <button
                type="button"
                onClick={openSelected}
                className="min-h-[48px] shrink-0 rounded-xl bg-neon-cyan px-5 text-sm font-semibold text-black transition-opacity hover:opacity-90"
              >
                Open {selected.name} →
              </button>
            )}
          </div>
        ) : (
          <p className="py-2 text-center text-sm text-dim">
            Select a station to preview it.
          </p>
        )}
      </div>

      {/* Pinned Settings keycap footer */}
      <div className="shrink-0 border-t border-line bg-black px-4 pb-4 pt-3">
        <button
          type="button"
          onClick={() => openApplet("settings", {}, { replace: true })}
          aria-label="Open settings"
          className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-line bg-panel-2 text-sm font-medium text-stardust transition-colors hover:border-neon-cyan/40 hover:text-star"
          style={{ boxShadow: "inset 0 1px 0 0 rgb(255 255 255 / 0.08)" }}
        >
          <span aria-hidden="true" className="text-base leading-none">
            &#x2699;&#xFE0E;
          </span>
          Settings
        </button>
      </div>
    </div>
  );
}
