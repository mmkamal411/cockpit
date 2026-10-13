"use client";

import { useMemo, useState } from "react";
import { openApplet } from "@/lib/applet-bus";
import { BAYS, STATIONS, type BayId, type StationDef } from "@/lib/stations";
import { invalidateStationPreviews, useStationPreview } from "@/lib/station-preview";

const NOTIFY_KEY = "cockpit-station-notify-list";

function readNotifyList(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(NOTIFY_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, boolean>;
    }
  } catch {
    // Corrupt or unavailable storage — start with an empty list.
  }
  return {};
}

function StationCard({
  station,
  selected,
  liveLine,
  onSelect,
}: {
  station: StationDef;
  selected: boolean;
  liveLine: string;
  onSelect: () => void;
}) {
  const seedling = station.appletId === null;
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={`${station.name}. ${liveLine}`}
      onClick={onSelect}
      className="relative flex min-h-[76px] w-full flex-col justify-center gap-1.5 rounded-xl border border-white/10 bg-[#080808] p-3 text-left transition-transform active:scale-[0.98]"
      style={
        selected
          ? {
              borderColor: station.glow,
              boxShadow: `0 0 14px ${station.glow}66, inset 0 0 0 1px ${station.glow}`,
            }
          : { boxShadow: "inset 0 1px 0 rgba(255,255,255,0.06)" }
      }
    >
      {/* Bezel rivets — console hardware feel */}
      <span className="absolute left-1.5 top-1.5 h-1 w-1 rounded-full bg-white/15" aria-hidden="true" />
      <span className="absolute bottom-1.5 right-1.5 h-1 w-1 rounded-full bg-white/15" aria-hidden="true" />
      <span className="flex items-center gap-2">
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          aria-hidden="true"
          style={
            seedling
              ? { backgroundColor: "#3d3d3d" }
              : { backgroundColor: station.glow, boxShadow: `0 0 6px ${station.glow}` }
          }
        />
        <span className="truncate text-sm font-semibold text-white">{station.name}</span>
      </span>
      <span className="line-clamp-2 text-xs leading-snug text-white/55">{liveLine}</span>
    </button>
  );
}

export function StationDeckGrid() {
  const [bay, setBay] = useState<"all" | BayId>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notifyList, setNotifyList] = useState<Record<string, boolean>>(readNotifyList);

  const selected: StationDef | null = useMemo(
    () => STATIONS.find((s) => s.id === selectedId) ?? null,
    [selectedId]
  );

  const previewDatum = useStationPreview(selected);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return STATIONS.filter((s) => {
      if (bay !== "all" && s.bay !== bay) return false;
      if (!q) return true;
      return s.name.toLowerCase().includes(q) || s.blurb.toLowerCase().includes(q);
    });
  }, [bay, query]);

  function openStation(station: StationDef) {
    if (station.appletId === null) return;
    openApplet(station.appletId, {}, { replace: true });
    invalidateStationPreviews(station.id);
    setSelectedId(null);
  }

  function subscribe(station: StationDef) {
    setNotifyList((prev) => {
      const next = { ...prev, [station.id]: true };
      try {
        window.localStorage.setItem(NOTIFY_KEY, JSON.stringify(next));
      } catch {
        // Storage unavailable — the in-memory state still shows the checkmark.
      }
      return next;
    });
  }

  const selectedIsSeedling = selected?.appletId === null;
  const selectedSubscribed = selected ? notifyList[selected.id] === true : false;

  return (
    <div className="flex h-full min-h-0 flex-col bg-black text-white">
      {/* Scroll zone: bay chips, search, grid */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-4">
        {/* Bay filter chips */}
        <div className="mb-3 flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Filter stations by bay">
          {(["all", ...BAYS.map((b) => b.id)] as const).map((id) => {
            const label = id === "all" ? "All" : (BAYS.find((b) => b.id === id)?.name ?? id);
            const active = bay === id;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={active}
                onClick={() => setBay(id)}
                className={`min-h-[44px] shrink-0 rounded-full border px-4 text-sm font-medium transition-colors ${
                  active
                    ? "border-cyan-300 bg-cyan-300/15 text-cyan-100"
                    : "border-white/15 bg-white/5 text-white/60"
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        {/* Hail-a-station search */}
        <label htmlFor="station-search" className="sr-only">
          Search stations by name or what they do
        </label>
        <input
          id="station-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Hail a station — search by name or what it does"
          className="mb-4 min-h-[44px] w-full rounded-xl border border-white/15 bg-[#0a0a0a] px-4 text-sm text-white placeholder:text-white/35 focus:border-cyan-300 focus:outline-none"
        />

        {/* Grid */}
        {filtered.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {filtered.map((station) => {
              const isSelected = station.id === selectedId;
              const liveLine =
                isSelected && previewDatum ? previewDatum : station.blurb;
              return (
                <StationCard
                  key={station.id}
                  station={station}
                  selected={isSelected}
                  liveLine={liveLine}
                  onSelect={() => setSelectedId(station.id)}
                />
              );
            })}
          </div>
        ) : (
          <p className="rounded-xl border border-white/10 bg-[#080808] p-6 text-center text-sm text-white/55">
            Nothing matches that search. Try a different word, or pick a bay above.
          </p>
        )}
      </div>

      {/* Pinned preview panel — never scrolls away */}
      <div className="shrink-0 border-t border-white/10 bg-[#060606] px-4 py-3">
        {selected ? (
          <div>
            <p className="text-base font-semibold text-white">{selected.name}</p>
            <p className="mt-0.5 text-sm leading-snug text-white/60">{selected.blurb}</p>
            {previewDatum && (
              <p className="mt-1.5 text-sm font-medium" style={{ color: selected.glow }}>
                {previewDatum}
              </p>
            )}
            {selectedIsSeedling ? (
              selectedSubscribed ? (
                <p className="mt-3 flex min-h-[48px] items-center justify-center rounded-xl border border-white/15 bg-white/5 text-sm font-semibold text-white/80">
                  You&apos;re on the list ✓
                </p>
              ) : (
                <button
                  type="button"
                  onClick={() => subscribe(selected)}
                  className="mt-3 min-h-[48px] w-full rounded-xl border border-white/20 bg-white/10 text-sm font-semibold text-white transition-colors hover:bg-white/15"
                >
                  Notify me when it&apos;s live
                </button>
              )
            ) : (
              <button
                type="button"
                onClick={() => openStation(selected)}
                className="mt-3 min-h-[48px] w-full rounded-xl text-sm font-bold text-black transition-transform active:scale-[0.99]"
                style={{ backgroundColor: selected.glow, boxShadow: `0 0 16px ${selected.glow}66` }}
              >
                Open {selected.name} →
              </button>
            )}
          </div>
        ) : (
          <p className="py-2 text-center text-sm text-white/45">
            Tap a station to see what it does, then open it from here.
          </p>
        )}
      </div>

      {/* Pinned Settings footer */}
      <div className="shrink-0 border-t border-white/10 bg-[#060606] px-4 py-2">
        <button
          type="button"
          onClick={() => openApplet("settings")}
          className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-white/15 bg-gradient-to-b from-white/10 to-white/5 text-sm font-semibold text-white/80 shadow-[0_2px_0_rgba(255,255,255,0.08)] transition-colors hover:text-white"
        >
          <span aria-hidden="true">⚙</span>
          Settings
        </button>
      </div>
    </div>
  );
}
